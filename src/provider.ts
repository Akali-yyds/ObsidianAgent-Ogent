import {
	type AssembledToolCall,
	AuthError,
	type ChatMessage,
	type ModelProvider,
	NetworkError,
	type OpenAiToolSpec,
	ProviderError,
	RateLimitError,
	type StreamEvent,
	type StreamOptions,
} from "./types";

export interface OpenAICompatibleConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
}

interface ToolCallBuffer {
	id: string;
	index: number;
	name: string;
	args: string;
}

export class OpenAICompatibleProvider implements ModelProvider {
	private readonly config: OpenAICompatibleConfig;

	constructor(config: OpenAICompatibleConfig) {
		this.config = config;
	}

	async *stream(messages: ChatMessage[], opts: StreamOptions = {}): AsyncIterable<StreamEvent> {
		if (opts.signal?.aborted) return;

		const url = this.endpoint();
		const tools = opts.tools && opts.tools.length > 0 ? opts.tools : undefined;
		const body = JSON.stringify({
			model: this.config.model,
			messages,
			stream: true,
			...(tools ? { tools, tool_choice: "auto" } : {}),
		});
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.config.apiKey}`,
		};

		let response: Response;
		try {
			response = await fetch(url, { method: "POST", headers, body, signal: opts.signal });
		} catch (err) {
			if ((err as Error)?.name === "AbortError") return;
			throw new NetworkError(redactNetworkError(err));
		}

		if (opts.signal?.aborted) return;

		if (response.status >= 400) {
			const text = await response.text().catch(() => "");
			throw mapHttpError(response.status, text);
		}

		const reader = response.body?.getReader();
		if (!reader) throw new NetworkError("No response body for streaming");

		const decoder = new TextDecoder();
		let sseBuffer = "";
		const toolBuffers = new Map<number, ToolCallBuffer>();
		let finalFinishReason: string | undefined;
		let done = false;

		try {
			while (!done) {
				if (opts.signal?.aborted) return;
				const chunk = await reader.read();
				if (chunk.done) break;

				sseBuffer += decoder.decode(chunk.value, { stream: true });
				const lines = sseBuffer.split("\n");
				sseBuffer = lines.pop() ?? "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					const data = line.slice(6).trim();
					if (data === "[DONE]") { done = true; break; }

					let parsed: unknown;
					try { parsed = JSON.parse(data); } catch { continue; }

					const choice = (parsed as {
						choices?: Array<{
							delta?: {
								content?: string | null;
								tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
							};
							finish_reason?: string | null;
						}>;
					})?.choices?.[0];
					if (!choice) continue;

					const delta = choice.delta;
					if (delta?.content) {
						yield { kind: "text", text: delta.content };
					}

					if (delta?.tool_calls) {
						for (const tc of delta.tool_calls) {
							let buf = toolBuffers.get(tc.index);
							if (!buf) {
								buf = { id: "", index: tc.index, name: "", args: "" };
								toolBuffers.set(tc.index, buf);
							}
							if (tc.id) buf.id = tc.id;
							if (tc.function?.name) buf.name += tc.function.name;
							if (tc.function?.arguments) buf.args += tc.function.arguments;
						}
					}

					if (choice.finish_reason && choice.finish_reason !== "null") {
						finalFinishReason = choice.finish_reason;
					}
				}
			}
		} catch (err) {
			if ((err as Error)?.name === "AbortError") return;
			if (err instanceof AuthError || err instanceof RateLimitError || err instanceof ProviderError) throw err;
			throw new NetworkError(redactNetworkError(err));
		} finally {
			reader.cancel().catch(() => {});
		}

		if (toolBuffers.size > 0) {
			const calls = [...toolBuffers.values()].map(parseAssembled);
			yield { kind: "tool_call_assembled", calls };
			yield { kind: "done", finishReason: "tool_calls" };
		} else {
			yield { kind: "done", finishReason: mapFinishReason(finalFinishReason) };
		}
	}

	async listModels(): Promise<string[]> {
		try {
			const base = this.config.baseUrl.replace(/\/$/, "");
			const res = await fetch(`${base}/models`, {
				method: "GET",
				headers: { Authorization: `Bearer ${this.config.apiKey}` },
			});
			if (res.status >= 400) return [];
			const json = (await res.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
			const ids = (json?.data ?? []).map((m) => m.id).filter(Boolean);
			return ids.sort();
		} catch {
			return [];
		}
	}

	private endpoint(): string {
		const base = this.config.baseUrl.replace(/\/$/, "");
		return `${base}/chat/completions`;
	}
}

export type { OpenAiToolSpec };

function mapHttpError(status: number, text: string): Error {
	if (status === 401 || status === 403) return new AuthError(`HTTP ${status}`);
	if (status === 429) return new RateLimitError(`HTTP ${status}`);
	const snippet = text.slice(0, 200);
	return new ProviderError(`HTTP ${status}: ${snippet}`, status);
}

function mapFinishReason(reason: string | undefined): "stop" | "tool_calls" | "length" | "content_filter" | "unknown" {
	if (reason === "stop" || reason === "tool_calls" || reason === "length" || reason === "content_filter") return reason;
	return "unknown";
}

function parseAssembled(buf: ToolCallBuffer): AssembledToolCall {
	let parsed: unknown;
	try {
		parsed = buf.args.length > 0 ? JSON.parse(buf.args) : {};
	} catch {
		parsed = { __parse_error: true, raw: buf.args };
	}
	return { id: buf.id, name: buf.name, arguments: parsed, rawArguments: buf.args };
}

function redactNetworkError(err: unknown): string {
	if (err instanceof Error) return err.message.replace(/Bearer [^\s]+/g, "Bearer ***");
	return "Network error";
}
