import type { OpenAICompatibleConfig } from "../../src/provider-config";
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
} from "../../src/types";

export function createNodeEvalProvider(config: OpenAICompatibleConfig): ModelProvider {
	return new NodeOpenAICompatibleProvider(config);
}

class NodeOpenAICompatibleProvider implements ModelProvider {
	private readonly config: OpenAICompatibleConfig;

	constructor(config: OpenAICompatibleConfig) {
		this.config = config;
	}

	async *stream(messages: ChatMessage[], opts: StreamOptions = {}): AsyncIterable<StreamEvent> {
		if (opts.signal?.aborted) return;

		const url = this.endpoint();
		const tools = opts.tools && opts.tools.length > 0 ? opts.tools : undefined;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.config.apiKey}`,
		};

		let responseText = "";
		let responseStatus = 0;
		let degraded = false;
		try {
			const primary = await requestCompletion(
				url,
				headers,
				this.config.model,
				messages,
				tools,
				opts.responseFormat,
				opts.signal,
			);
			responseText = primary.text;
			responseStatus = primary.status;
			if (opts.responseFormat && shouldRetryWithoutResponseFormat(primary.status, primary.text)) {
				const fallback = await requestCompletion(url, headers, this.config.model, messages, tools, undefined, opts.signal);
				responseText = fallback.text;
				responseStatus = fallback.status;
				degraded = true;
			}
		} catch (error) {
			if (isAbortError(error) || opts.signal?.aborted) return;
			throw new NetworkError(redactNetworkError(error));
		}

		if (opts.signal?.aborted) return;
		if (responseStatus >= 400) throw mapHttpError(responseStatus, responseText);

		const choice = parseChatCompletionChoice(responseText);
		if (!choice) throw new ProviderError("Malformed response from completion endpoint");

		const text = extractMessageText(choice.message?.content);
		if (text.length > 0) {
			yield { kind: "text", text, degraded: degraded || undefined };
		}

		const calls = parseCompletionToolCalls(choice.message?.tool_calls);
		if (calls.length > 0) {
			yield { kind: "tool_call_assembled", calls, degraded: degraded || undefined };
			yield { kind: "done", finishReason: "tool_calls" };
		} else {
			yield { kind: "done", finishReason: mapFinishReason(choice.finish_reason ?? undefined) };
		}
	}

	async listModels(): Promise<string[]> {
		try {
			const base = this.config.baseUrl.replace(/\/$/, "");
			const response = await fetch(`${base}/models`, {
				method: "GET",
				headers: { Authorization: `Bearer ${this.config.apiKey}` },
			});
			if (response.status >= 400) return [];
			return parseModelIds(await response.text()).sort();
		} catch {
			return [];
		}
	}

	private endpoint(): string {
		const base = this.config.baseUrl.replace(/\/$/, "");
		return `${base}/chat/completions`;
	}
}

async function requestCompletion(
	url: string,
	headers: Record<string, string>,
	model: string,
	messages: ChatMessage[],
	tools?: OpenAiToolSpec[],
	responseFormat?: StreamOptions["responseFormat"],
	signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
	const body = JSON.stringify({
		model,
		messages,
		stream: false,
		temperature: 0,
		...(tools ? { tools, tool_choice: "auto" } : {}),
		...(responseFormat ? { response_format: responseFormat } : {}),
	});
	const response = await fetch(url, {
		method: "POST",
		headers,
		body,
		signal,
	});
	return { status: response.status, text: await response.text() };
}

function mapHttpError(status: number, text: string): Error {
	if (status === 401 || status === 403) return new AuthError(`HTTP ${status}`);
	if (status === 429) return new RateLimitError(`HTTP ${status}`);
	return new ProviderError(`HTTP ${status}: ${text.slice(0, 200)}`, status);
}

function mapFinishReason(reason: string | undefined): "stop" | "tool_calls" | "length" | "content_filter" | "unknown" {
	if (reason === "stop" || reason === "tool_calls" || reason === "length" || reason === "content_filter") return reason;
	return "unknown";
}

function parseAssembled(buf: { id: string; index: number; name: string; args: string }): AssembledToolCall {
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

function shouldRetryWithoutResponseFormat(status: number, text: string): boolean {
	if (![400, 404, 415, 422].includes(status)) return false;
	const lowered = text.toLowerCase();
	return lowered.includes("response_format") || lowered.includes("json_schema");
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
	for (let index = 0; index < value.length; index += 1) {
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
		if (isRecord(entry) && typeof entry.id === "string" && entry.id.length > 0) ids.push(entry.id);
	}
	return ids;
}

function parseJsonResponse(text: string): unknown | null {
	try {
		return JSON.parse(text) as unknown;
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
