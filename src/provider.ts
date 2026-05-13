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
		const body = JSON.stringify({
			model: this.config.model,
			messages,
			stream: false,
			...(tools ? { tools, tool_choice: "auto" } : {}),
		});
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.config.apiKey}`,
		};

		let responseText = "";
		let responseStatus = 0;
		try {
			const response = await requestUrl({
				url,
				method: "POST",
				contentType: "application/json",
				headers,
				body,
				throw: false,
			});
			responseText = response.text;
			responseStatus = response.status;
		} catch (err) {
			if (isAbortError(err) || opts.signal?.aborted) return;
			throw new NetworkError(redactNetworkError(err));
		}

		if (opts.signal?.aborted) return;

		if (responseStatus >= 400) {
			throw mapHttpError(responseStatus, responseText);
		}

		const choice = parseChatCompletionChoice(responseText);
		if (!choice) throw new ProviderError("Malformed response from completion endpoint");

		const text = extractMessageText(choice.message?.content);
		if (text.length > 0) {
			yield { kind: "text", text };
		}

		const calls = parseCompletionToolCalls(choice.message?.tool_calls);
		if (calls.length > 0) {
			yield { kind: "tool_call_assembled", calls };
			yield { kind: "done", finishReason: "tool_calls" };
		} else {
			yield { kind: "done", finishReason: mapFinishReason(choice.finish_reason ?? undefined) };
		}
	}

	async listModels(): Promise<string[]> {
		try {
			const base = this.config.baseUrl.replace(/\/$/, "");
			const res = await requestUrl({
				url: `${base}/models`,
				method: "GET",
				headers: { Authorization: `Bearer ${this.config.apiKey}` },
				throw: false,
			});
			if (res.status >= 400) return [];
			return parseModelIds(res.text).sort();
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

function parseChatCompletionChoice(responseText: string): {
	message?: { content?: unknown; tool_calls?: unknown };
	finish_reason?: string | null;
} | null {
	const parsed = parseJsonResponse(responseText);
	if (!isRecord(parsed) || !Array.isArray(parsed.choices) || parsed.choices.length === 0) return null;
	const choice = parsed.choices[0];
	if (!isRecord(choice)) return null;
	return {
		message: isRecord(choice.message)
			? { content: choice.message.content, tool_calls: choice.message.tool_calls }
			: undefined,
		finish_reason:
			typeof choice.finish_reason === "string" || choice.finish_reason === null
				? choice.finish_reason
				: undefined,
	};
}

function parseCompletionToolCalls(value: unknown): AssembledToolCall[] {
	if (!Array.isArray(value)) return [];
	const calls: AssembledToolCall[] = [];
	for (let index = 0; index < value.length; index++) {
		const toolCall = parseResponseToolCall(value[index], index);
		if (toolCall) calls.push(toolCall);
	}
	return calls;
}

function parseResponseToolCall(value: unknown, index: number): AssembledToolCall | null {
	if (!isRecord(value)) return null;
	const fn = isRecord(value.function) ? value.function : null;
	const name = typeof fn?.name === "string" ? fn.name : "";
	if (name.length === 0) return null;
	const args = typeof fn?.arguments === "string" ? fn.arguments : "";
	const id = typeof value.id === "string" && value.id.length > 0 ? value.id : `call-${index}`;
	return parseAssembled({ id, index, name, args });
}

function extractMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map(extractMessagePartText).join("");
}

function extractMessagePartText(part: unknown): string {
	if (typeof part === "string") return part;
	if (!isRecord(part)) return "";
	if (typeof part.text === "string") return part.text;
	if (isRecord(part.text) && typeof part.text.value === "string") return part.text.value;
	return "";
}

function parseModelIds(responseText: string): string[] {
	const parsed = parseJsonResponse(responseText);
	if (!isRecord(parsed) || !Array.isArray(parsed.data)) return [];
	const ids: string[] = [];
	for (const entry of parsed.data) {
		if (isRecord(entry) && typeof entry.id === "string" && entry.id.length > 0) {
			ids.push(entry.id);
		}
	}
	return ids;
}

function parseJsonResponse(text: string): unknown | null {
	try {
		const parsed: unknown = JSON.parse(text);
		return parsed;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(err: unknown): boolean {
	return err instanceof Error && err.name === "AbortError";
}
