import { requestUrl } from "obsidian";
import {
	type AssembledToolCall,
	AuthError,
	type ChatMessage,
	type ModelProvider,
	type ProviderCapabilities,
	NetworkError,
	type OpenAiToolSpec,
	ProviderError,
	RateLimitError,
	type StreamEvent,
	type StreamOptions,
} from "./types";
import type { OpenAICompatibleConfig } from "./provider-config";

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

	capabilities(): ProviderCapabilities {
		return {
			streaming: true,
			thinking: true,
			toolCalls: true,
			requiredToolChoice: true,
			jsonSchema: true,
			vision: false,
		};
	}

	async healthCheck(): Promise<{ ok: boolean; modelCount: number; capabilities: ProviderCapabilities }> {
		const models = await this.listModels();
		return { ok: models.length > 0, modelCount: models.length, capabilities: this.capabilities() };
	}

	async *stream(messages: ChatMessage[], opts: StreamOptions = {}): AsyncIterable<StreamEvent> {
		if (opts.signal?.aborted) return;

		const url = this.endpoint();
		const tools = opts.tools && opts.tools.length > 0 ? opts.tools : undefined;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "text/event-stream",
			Authorization: `Bearer ${this.config.apiKey}`,
		};

		let response: Response;
		try {
			response = await requestStreamingCompletion(
				url,
				headers,
				this.config.model,
				messages,
				tools,
				opts.toolChoice,
				opts.responseFormat,
				opts.signal,
			);
		} catch (err) {
			if (isAbortError(err) || opts.signal?.aborted) return;
			// Obsidian's requestUrl bypasses CORS but does not expose a readable
			// response stream. Use it as a compatibility fallback when fetch is
			// unavailable or the renderer blocks the streaming request.
			let fallbackToolChoice = opts.toolChoice;
			let fallback = await requestNonStreamingWithNetworkHandling(
				url,
				headers,
				this.config.model,
				messages,
				tools,
				opts.toolChoice,
				opts.responseFormat,
				opts.signal,
			);
			if (opts.toolChoice === "required" && shouldRetryWithoutToolChoice(fallback.status, fallback.text)) {
				fallbackToolChoice = undefined;
				fallback = await requestNonStreamingWithNetworkHandling(
					url,
					headers,
					this.config.model,
					messages,
					tools,
					undefined,
					opts.responseFormat,
					opts.signal,
				);
			}
			if (opts.signal?.aborted) return;
			yield* emitCompletionWithResponseFormatFallback(
				fallback,
				url,
				headers,
				this.config.model,
				messages,
				tools,
				fallbackToolChoice,
				opts.responseFormat,
				opts.signal,
			);
			return;
		}

		if (opts.signal?.aborted) return;

		if (response.status >= 400) {
			let responseText = await readResponseText(response);
			let effectiveToolChoice = opts.toolChoice;
			if (opts.toolChoice === "required" && shouldRetryWithoutToolChoice(response.status, responseText)) {
				// Some thinking-mode endpoints reject every explicit tool_choice value.
				// Omit it and let the endpoint use its default (usually auto); the
				// vault-context prompt still tells the model that the tool is required.
				effectiveToolChoice = undefined;
				response = await requestStreamingCompletion(
					url,
					headers,
					this.config.model,
					messages,
					tools,
					undefined,
					opts.responseFormat,
					opts.signal,
				);
				if (opts.signal?.aborted) return;
				if (response.status < 400) {
					if (!isStreamingResponse(response)) {
						yield* emitCompletion(await readResponseText(response), response.status, true);
						return;
					}
					try {
						yield* streamCompletion(response, opts.signal);
					} catch (err) {
						if (isAbortError(err) || opts.signal?.aborted) return;
						if (err instanceof ProviderError) throw err;
						throw new NetworkError(redactNetworkError(err));
					}
					return;
				}
				responseText = await readResponseText(response);
			}
			if (opts.responseFormat && shouldRetryWithoutResponseFormat(response.status, responseText)) {
				const fallback = await requestNonStreamingWithNetworkHandling(
					url,
					headers,
					this.config.model,
					messages,
					tools,
					effectiveToolChoice,
					undefined,
					opts.signal,
				);
				if (opts.signal?.aborted) return;
					yield* emitCompletionWithResponseFormatFallback(
						fallback,
						url,
						headers,
					this.config.model,
					messages,
					tools,
					effectiveToolChoice,
					undefined,
					opts.signal,
				);
				return;
			}
			if (shouldRetryWithoutStreaming(response.status, responseText)) {
				const fallback = await requestNonStreamingWithNetworkHandling(
					url,
					headers,
					this.config.model,
					messages,
					tools,
					effectiveToolChoice,
					opts.responseFormat,
					opts.signal,
				);
				if (opts.signal?.aborted) return;
				yield* emitCompletionWithResponseFormatFallback(
					fallback,
					url,
					headers,
					this.config.model,
					messages,
					tools,
					effectiveToolChoice,
					opts.responseFormat,
					opts.signal,
				);
				return;
			}
			throw mapHttpError(response.status, responseText);
		}

		if (!isStreamingResponse(response)) {
			const responseText = await readResponseText(response);
			yield* emitCompletion(responseText, response.status, true);
			return;
		}

		try {
			yield* streamCompletion(response, opts.signal);
		} catch (err) {
			if (isAbortError(err) || opts.signal?.aborted) return;
			if (err instanceof ProviderError) throw err;
			throw new NetworkError(redactNetworkError(err));
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
export type { OpenAICompatibleConfig } from "./provider-config";

async function requestCompletion(
	url: string,
	headers: Record<string, string>,
	model: string,
	messages: ChatMessage[],
	tools?: OpenAiToolSpec[],
	toolChoice?: StreamOptions["toolChoice"],
	responseFormat?: StreamOptions["responseFormat"],
): Promise<{ status: number; text: string }> {
	const body = JSON.stringify({
		model,
		messages,
		stream: false,
		...(tools ? { tools, ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}) } : {}),
		...(responseFormat ? { response_format: responseFormat } : {}),
	});
	const response = await requestUrl({
		url,
		method: "POST",
		contentType: "application/json",
		headers,
		body,
		throw: false,
	});
	return { status: response.status, text: response.text };
}

async function requestStreamingCompletion(
	url: string,
	headers: Record<string, string>,
	model: string,
	messages: ChatMessage[],
	tools: OpenAiToolSpec[] | undefined,
	toolChoice: StreamOptions["toolChoice"],
	responseFormat: StreamOptions["responseFormat"],
	signal?: AbortSignal,
): Promise<Response> {
	const fetchImpl = typeof window !== "undefined"
		? window.fetch.bind(window)
		: typeof fetch === "function" ? fetch : undefined;
	if (typeof fetchImpl !== "function") {
		throw new Error("Streaming fetch is unavailable");
	}
	const body = JSON.stringify({
		model,
		messages,
		stream: true,
		...(tools ? { tools, ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}) } : {}),
		...(responseFormat ? { response_format: responseFormat } : {}),
	});
	return fetchImpl(url, {
		method: "POST",
		headers,
		body,
		signal,
	});
}

async function requestNonStreamingWithNetworkHandling(
	url: string,
	headers: Record<string, string>,
	model: string,
	messages: ChatMessage[],
	tools: OpenAiToolSpec[] | undefined,
	toolChoice: StreamOptions["toolChoice"],
	responseFormat: StreamOptions["responseFormat"],
	signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
	if (signal?.aborted) return { status: 0, text: "" };
	try {
		return await requestCompletion(url, headers, model, messages, tools, toolChoice, responseFormat);
	} catch (err) {
		if (isAbortError(err) || signal?.aborted) return { status: 0, text: "" };
		throw new NetworkError(redactNetworkError(err));
	}
}

async function* emitCompletionWithResponseFormatFallback(
	primary: { status: number; text: string },
	url: string,
	headers: Record<string, string>,
	model: string,
	messages: ChatMessage[],
	tools: OpenAiToolSpec[] | undefined,
	toolChoice: StreamOptions["toolChoice"],
	responseFormat: StreamOptions["responseFormat"],
	signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
	if (responseFormat && shouldRetryWithoutResponseFormat(primary.status, primary.text)) {
		const fallback = await requestNonStreamingWithNetworkHandling(
			url,
			headers,
			model,
			messages,
			tools,
			toolChoice,
			undefined,
			signal,
		);
		yield* emitCompletion(fallback.text, fallback.status, true);
		return;
	}
	yield* emitCompletion(primary.text, primary.status, true);
}

async function* emitCompletion(responseText: string, responseStatus: number, degraded: boolean): AsyncIterable<StreamEvent> {
	if (responseStatus >= 400) {
		throw mapHttpError(responseStatus, responseText);
	}

	const choice = parseChatCompletionChoice(responseText);
	if (!choice) throw new ProviderError("Malformed response from completion endpoint");

	const rawText = extractMessageText(choice.message?.content);
	const { text, thinking } = extractThinking(choice.message?.reasoning_content, rawText);
	if (thinking.length > 0) {
		yield { kind: "thinking_text", text: thinking };
	}
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

function isStreamingResponse(response: Response): boolean {
	const contentType = response.headers?.get("content-type")?.toLowerCase() ?? "";
	if (contentType.includes("text/event-stream")) return true;
	// Some local OpenAI-compatible servers omit Content-Type. A readable body
	// is treated as SSE in that case; JSON responses normally include a type.
	return contentType.length === 0 && response.body !== null;
}

async function readResponseText(response: Response): Promise<string> {
	return response.text();
}

interface StreamChunk {
	content?: unknown;
	reasoning?: unknown;
	reasoningContent?: unknown;
	toolCalls?: unknown;
	finishReason?: string | null;
}

interface StreamToolCallBuffer {
	id: string;
	index: number;
	name: string;
	args: string;
}

async function* streamCompletion(response: Response, signal?: AbortSignal): AsyncIterable<StreamEvent> {
	if (!response.body) throw new ProviderError("Streaming response has no readable body");

	const textDecoder = new TextDecoder();
	const textEmitter = new IncrementalTextEmitter();
	const tools = new Map<number, StreamToolCallBuffer>();
	let finishReason: string | null | undefined;

	for await (const payload of readSsePayloads(response.body, signal, textDecoder)) {
		if (signal?.aborted) return;
		const chunk = parseStreamChunk(payload);
		if (!chunk) continue;

		const reasoning = extractMessageText(chunk.reasoningContent ?? chunk.reasoning);
		if (reasoning.length > 0) yield { kind: "thinking_text", text: stripStreamEos(reasoning) };

		const content = extractMessageText(chunk.content);
		if (content.length > 0) {
			const emitted = textEmitter.push(content);
			if (emitted.thinking.length > 0) {
				yield { kind: "thinking_text", text: stripStreamEos(emitted.thinking) };
			}
			if (emitted.text.length > 0) {
				yield { kind: "text", text: stripStreamEos(emitted.text) };
			}
		}

		appendToolCallDeltas(tools, chunk.toolCalls);
		if (chunk.finishReason !== undefined) finishReason = chunk.finishReason;
	}

	const trailing = textEmitter.finish();
	if (trailing.thinking.length > 0) yield { kind: "thinking_text", text: stripStreamEos(trailing.thinking) };
	if (trailing.text.length > 0) yield { kind: "text", text: stripStreamEos(trailing.text) };

	const calls = [...tools.values()]
		.sort((a, b) => a.index - b.index)
		.map(parseAssembledStreamToolCall)
		.filter((call): call is AssembledToolCall => call !== null);
	if (calls.length > 0) {
		yield { kind: "tool_call_assembled", calls };
		yield { kind: "done", finishReason: "tool_calls" };
		return;
	}
	yield { kind: "done", finishReason: mapFinishReason(finishReason ?? undefined) };
}

async function* readSsePayloads(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal | undefined,
	decoder: TextDecoder,
): AsyncIterable<string> {
	const reader = body.getReader();
	let buffer = "";
	let dataLines: string[] = [];
	try {
		while (true) {
			if (signal?.aborted) return;
			const result = await reader.read();
			if (result.done) break;
			buffer += decoder.decode(result.value, { stream: true });

			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline).replace(/\r$/, "");
				buffer = buffer.slice(newline + 1);
				if (line.length === 0) {
					if (dataLines.length > 0) {
						const payload = dataLines.join("\n");
						dataLines = [];
						if (payload === "[DONE]") return;
						yield payload;
					}
				} else if (line.startsWith("data:")) {
					dataLines.push(line.slice(5).trimStart());
				}
				newline = buffer.indexOf("\n");
			}
		}

		buffer += decoder.decode();
		if (buffer.length > 0) dataLines.push(buffer.replace(/\r$/, ""));
		if (dataLines.length > 0) {
			const payload = dataLines.join("\n");
			if (payload !== "[DONE]") yield payload;
		}
	} finally {
		reader.releaseLock();
	}
}

function parseStreamChunk(payload: string): StreamChunk | null {
	const parsed = parseJsonResponse(payload);
	if (!isRecord(parsed) || !Array.isArray(parsed.choices) || parsed.choices.length === 0) return null;
	const choice = parsed.choices[0];
	if (!isRecord(choice)) return null;
	const delta = isRecord(choice.delta) ? choice.delta : isRecord(choice.message) ? choice.message : {};
	return {
		content: delta.content,
		reasoning: delta.reasoning,
		reasoningContent: delta.reasoning_content,
		toolCalls: delta.tool_calls,
		finishReason: typeof choice.finish_reason === "string" || choice.finish_reason === null ? choice.finish_reason : undefined,
	};
}

function appendToolCallDeltas(buffers: Map<number, StreamToolCallBuffer>, value: unknown): void {
	if (!Array.isArray(value)) return;
	for (let position = 0; position < value.length; position++) {
		const item = value[position];
		if (!isRecord(item)) continue;
		const index = typeof item.index === "number" ? item.index : position;
		const current = buffers.get(index) ?? { id: `call-${index}`, index, name: "", args: "" };
		if (typeof item.id === "string" && item.id.length > 0) current.id = item.id;
		const fn = isRecord(item.function) ? item.function : undefined;
		if (typeof fn?.name === "string") current.name += fn.name;
		if (typeof fn?.arguments === "string") current.args += fn.arguments;
		buffers.set(index, current);
	}
}

function parseAssembledStreamToolCall(buf: StreamToolCallBuffer): AssembledToolCall | null {
	if (buf.name.length === 0) return null;
	return parseAssembled({ id: buf.id, index: buf.index, name: buf.name, args: buf.args });
}

class IncrementalTextEmitter {
	private mode: "prefix" | "thinking" | "text" = "prefix";
	private pending = "";

	push(chunk: string): { text: string; thinking: string } {
		this.pending += chunk;
		return this.drain(false);
	}

	finish(): { text: string; thinking: string } {
		return this.drain(true);
	}

	private drain(flush: boolean): { text: string; thinking: string } {
		let text = "";
		let thinking = "";
		const openTag = "<think>";
		const closeTag = "</think>";

		while (this.pending.length > 0) {
			if (this.mode === "prefix") {
				if (this.pending.startsWith(openTag)) {
					this.pending = this.pending.slice(openTag.length);
					this.mode = "thinking";
					continue;
				}
				if (!flush && openTag.startsWith(this.pending)) break;
				this.mode = "text";
				continue;
			}

			if (this.mode === "thinking") {
				const closeIndex = this.pending.indexOf(closeTag);
				if (closeIndex >= 0) {
					thinking += this.pending.slice(0, closeIndex);
					this.pending = this.pending.slice(closeIndex + closeTag.length);
					this.mode = "text";
					continue;
				}
				if (!flush) {
					const suffixLength = matchingSuffixLength(this.pending, closeTag);
					const safeLength = this.pending.length - suffixLength;
					if (safeLength > 0) {
						thinking += this.pending.slice(0, safeLength);
						this.pending = this.pending.slice(safeLength);
					}
					break;
				}
				thinking += this.pending;
				this.pending = "";
				break;
			}

			text += this.pending;
			this.pending = "";
		}

		if (flush && this.mode === "prefix" && this.pending.length > 0) {
			text += this.pending;
			this.pending = "";
		}
		return { text, thinking };
	}
}

function matchingSuffixLength(value: string, suffix: string): number {
	const max = Math.min(value.length, suffix.length - 1);
	for (let length = max; length > 0; length--) {
		if (value.endsWith(suffix.slice(0, length))) return length;
	}
	return 0;
}

function stripStreamEos(text: string): string {
	return text.replace(/<\|endoftext\|>|<\|eot_id\|>|<\|im_end\|>|<eos>|<\/s>/g, "");
}

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

function shouldRetryWithoutResponseFormat(status: number, text: string): boolean {
	if (![400, 404, 415, 422].includes(status)) return false;
	const lowered = text.toLowerCase();
	return lowered.includes("response_format") || lowered.includes("json_schema");
}

function shouldRetryWithoutToolChoice(status: number, text: string): boolean {
	if (![400, 404, 415, 422].includes(status)) return false;
	const lowered = text.toLowerCase();
	return (
		lowered.includes("tool_choice") &&
		(lowered.includes("thinking") || lowered.includes("reasoning") || lowered.includes("think"))
	);
}

function shouldRetryWithoutStreaming(status: number, text: string): boolean {
	if (![400, 404, 405, 406, 415, 422, 501].includes(status)) return false;
	const lowered = text.toLowerCase();
	return (
		lowered.includes("stream") ||
		lowered.includes("sse") ||
		lowered.includes("text/event-stream")
	);
}

function parseChatCompletionChoice(responseText: string): {
	message?: { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown };
	finish_reason?: string | null;
} | null {
	const parsed = parseJsonResponse(responseText);
	if (!isRecord(parsed) || !Array.isArray(parsed.choices) || parsed.choices.length === 0) return null;
	const choice = parsed.choices[0];
	if (!isRecord(choice)) return null;
	return {
		message: isRecord(choice.message)
			? {
				content: choice.message.content,
				tool_calls: choice.message.tool_calls,
				reasoning_content: choice.message.reasoning_content,
			}
			: undefined,
		finish_reason:
			typeof choice.finish_reason === "string" || choice.finish_reason === null
				? choice.finish_reason
				: undefined,
	};
}

// EOS tokens that some local/open-source models leak into their output
const EOS_TOKENS = ["<|endoftext|>", "<|eot_id|>", "<|im_end|>", "<eos>", "</s>"];

function stripEosTokens(text: string): string {
	let result = text;
	for (const token of EOS_TOKENS) {
		result = result.replaceAll(token, "");
	}
	return result.trim();
}

function extractThinking(
	reasoningContent: unknown,
	rawText: string,
): { text: string; thinking: string } {
	// Prefer an explicit reasoning_content field (DeepSeek-R1, etc.)
	if (typeof reasoningContent === "string" && reasoningContent.trim().length > 0) {
		return { text: stripEosTokens(rawText), thinking: reasoningContent.trim() };
	}

	// Fall back to stripping <think>...</think> from the text content
	const thinkMatch = rawText.match(/^<think>([\s\S]*?)<\/think>\s*/);
	if (thinkMatch) {
		const thinking = thinkMatch[1].trim();
		const remainder = rawText.slice(thinkMatch[0].length);
		return { text: stripEosTokens(remainder), thinking };
	}

	return { text: stripEosTokens(rawText), thinking: "" };
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
