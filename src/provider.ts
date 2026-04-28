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
		if (opts.signal?.aborted) return;

		const url = this.endpoint();
		const tools = opts.tools && opts.tools.length > 0 ? opts.tools : undefined;
		const body = {
			model: this.config.model,
			messages,
			stream: false,
			...(tools ? { tools, tool_choice: "auto" } : {}),
		};
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.config.apiKey}`,
		};

		try {
			const res = await requestUrl({
				url,
				method: "POST",
				headers,
				body: JSON.stringify(body),
				throw: false,
			});

			if (opts.signal?.aborted) return;

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

			if (text.length > 0) yield { kind: "text", text };
			if (toolCalls.length > 0) {
				const assembled = toolCalls.map((tc) =>
					parseAssembled({ id: tc.id, index: 0, name: tc.function.name, args: tc.function.arguments }),
				);
				yield { kind: "tool_call_assembled", calls: assembled };
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
