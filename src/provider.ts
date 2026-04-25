import { requestUrl } from "obsidian";
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
		const url = this.endpoint();
		const tools = opts.tools && opts.tools.length > 0 ? opts.tools : undefined;
		const body = {
			model: this.config.model,
			messages,
			stream: true,
			...(tools ? { tools, tool_choice: "auto" } : {}),
		};
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.config.apiKey}`,
		};

		// Streaming path: native fetch + SSE.
		try {
			const response = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: opts.signal,
			});

			if (!response.ok) {
				throw mapHttpError(response.status, await safeReadText(response));
			}
			if (!response.body) {
				throw new ProviderError("Provider returned no response body", response.status);
			}

			yield* parseSseStream(response.body, opts.signal);
			return;
		} catch (err) {
			if (isAbortError(err)) return;
			if (err instanceof AuthError || err instanceof RateLimitError || err instanceof ProviderError) throw err;
			if (!isLikelyCorsOrNetwork(err)) throw err;
		}

		// Fallback path: requestUrl, non-streaming.
		try {
			const res = await requestUrl({
				url,
				method: "POST",
				headers,
				body: JSON.stringify({ ...body, stream: false }),
				throw: false,
			});
			if (res.status >= 400) throw mapHttpError(res.status, res.text);

			const json = res.json as {
				choices?: Array<{
					message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
					finish_reason?: string;
				}>;
			};
			const choice = json?.choices?.[0];
			const text = choice?.message?.content ?? "";
			const toolCalls = choice?.message?.tool_calls ?? [];

			if (text.length > 0) yield { kind: "text", text, degraded: true };
			if (toolCalls.length > 0) {
				const assembled = toolCalls.map((tc) => parseAssembled({ id: tc.id, index: 0, name: tc.function.name, args: tc.function.arguments }));
				yield { kind: "tool_call_assembled", calls: assembled, degraded: true };
				yield { kind: "done", finishReason: "tool_calls" };
			} else {
				yield { kind: "done", finishReason: mapFinishReason(choice?.finish_reason) };
			}
		} catch (err) {
			if (err instanceof AuthError || err instanceof RateLimitError || err instanceof ProviderError) throw err;
			throw new NetworkError(redactNetworkError(err));
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

async function safeReadText(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return "";
	}
}

function isAbortError(err: unknown): boolean {
	return err instanceof DOMException && err.name === "AbortError";
}

function isLikelyCorsOrNetwork(err: unknown): boolean {
	if (err instanceof TypeError) return true;
	if (err instanceof Error && /network|fetch|cors/i.test(err.message)) return true;
	return false;
}

function redactNetworkError(err: unknown): string {
	if (err instanceof Error) return err.message.replace(/Bearer [^\s]+/g, "Bearer ***");
	return "Network error";
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

async function* parseSseStream(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal | undefined,
): AsyncIterable<StreamEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const toolBuffers = new Map<number, ToolCallBuffer>();
	let finishReason: "stop" | "tool_calls" | "length" | "content_filter" | "unknown" = "unknown";

	try {
		outer: while (true) {
			if (signal?.aborted) return;
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let idx: number;
			while ((idx = buffer.indexOf("\n\n")) !== -1) {
				const frame = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const result = parseSseFrame(frame, toolBuffers);
				if (result === DONE) break outer;
				if (result === null) continue;
				if (result.kind === "finish") {
					finishReason = result.reason;
					continue;
				}
				yield result.event;
			}
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {
			/* noop */
		}
	}

	if (toolBuffers.size > 0) {
		const calls = [...toolBuffers.values()]
			.sort((a, b) => a.index - b.index)
			.map(parseAssembled);
		yield { kind: "tool_call_assembled", calls };
	}
	yield { kind: "done", finishReason: finishReason === "unknown" && toolBuffers.size > 0 ? "tool_calls" : finishReason };
}

const DONE = Symbol("done");

type FrameResult =
	| { kind: "event"; event: StreamEvent }
	| { kind: "finish"; reason: "stop" | "tool_calls" | "length" | "content_filter" | "unknown" }
	| typeof DONE
	| null;

function parseSseFrame(frame: string, toolBuffers: Map<number, ToolCallBuffer>): FrameResult {
	let payload = "";
	for (const rawLine of frame.split("\n")) {
		const line = rawLine.trimEnd();
		if (!line.startsWith("data:")) continue;
		const data = line.slice(5).trimStart();
		if (data === "[DONE]") return DONE;
		payload += data;
	}
	if (!payload) return null;
	let json: {
		choices?: Array<{
			delta?: {
				content?: string;
				tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
			};
			finish_reason?: string;
		}>;
	};
	try {
		json = JSON.parse(payload);
	} catch {
		return null;
	}
	const choice = json?.choices?.[0];
	if (!choice) return null;
	if (choice.delta?.content) return { kind: "event", event: { kind: "text", text: choice.delta.content } };
	if (choice.delta?.tool_calls) {
		for (const tc of choice.delta.tool_calls) {
			const idx = tc.index;
			let buf = toolBuffers.get(idx);
			if (!buf) {
				buf = { id: tc.id ?? `call_${idx}`, index: idx, name: tc.function?.name ?? "", args: "" };
				toolBuffers.set(idx, buf);
			}
			if (tc.id) buf.id = tc.id;
			if (tc.function?.name) buf.name = tc.function.name;
			if (tc.function?.arguments) buf.args += tc.function.arguments;
		}
		return null;
	}
	if (choice.finish_reason) return { kind: "finish", reason: mapFinishReason(choice.finish_reason) };
	return null;
}
