import { requestUrl } from "obsidian";
import {
	AuthError,
	type ChatMessage,
	type ModelProvider,
	NetworkError,
	ProviderError,
	RateLimitError,
	type StreamOptions,
	type TextDelta,
} from "./types";

export interface OpenAICompatibleConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
}

export class OpenAICompatibleProvider implements ModelProvider {
	private readonly config: OpenAICompatibleConfig;

	constructor(config: OpenAICompatibleConfig) {
		this.config = config;
	}

	async *stream(messages: ChatMessage[], opts: StreamOptions = {}): AsyncIterable<TextDelta> {
		const url = this.endpoint();
		const body = {
			model: this.config.model,
			messages,
			stream: true,
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
			if (isAbortError(err)) {
				return;
			}
			if (err instanceof AuthError || err instanceof RateLimitError || err instanceof ProviderError) {
				throw err;
			}
			// fall through to requestUrl fallback for network/CORS-shaped errors
			if (!isLikelyCorsOrNetwork(err)) {
				throw err;
			}
		}

		// Fallback path: requestUrl, non-streaming, single delta.
		try {
			const res = await requestUrl({
				url,
				method: "POST",
				headers,
				body: JSON.stringify({ ...body, stream: false }),
				throw: false,
			});
			if (res.status >= 400) {
				throw mapHttpError(res.status, res.text);
			}
			const text = extractContentFromCompletion(res.json);
			yield { text, degraded: true };
		} catch (err) {
			if (err instanceof AuthError || err instanceof RateLimitError || err instanceof ProviderError) {
				throw err;
			}
			throw new NetworkError(redactNetworkError(err));
		}
	}

	private endpoint(): string {
		const base = this.config.baseUrl.replace(/\/$/, "");
		return `${base}/chat/completions`;
	}
}

function mapHttpError(status: number, text: string): Error {
	if (status === 401 || status === 403) return new AuthError(`HTTP ${status}`);
	if (status === 429) return new RateLimitError(`HTTP ${status}`);
	const snippet = text.slice(0, 200);
	return new ProviderError(`HTTP ${status}: ${snippet}`, status);
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
	if (err instanceof TypeError) return true; // Most browser CORS / network failures.
	if (err instanceof Error && /network|fetch|cors/i.test(err.message)) return true;
	return false;
}

function redactNetworkError(err: unknown): string {
	if (err instanceof Error) return err.message.replace(/Bearer [^\s]+/g, "Bearer ***");
	return "Network error";
}

async function* parseSseStream(
	body: ReadableStream<Uint8Array>,
	signal: AbortSignal | undefined,
): AsyncIterable<TextDelta> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			if (signal?.aborted) return;
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			// SSE frames are separated by blank lines.
			let idx: number;
			while ((idx = buffer.indexOf("\n\n")) !== -1) {
				const frame = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const delta = parseSseFrame(frame);
				if (delta === DONE_SENTINEL) return;
				if (delta) yield { text: delta };
			}
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {
			/* noop */
		}
	}
}

const DONE_SENTINEL = Symbol("done");

function parseSseFrame(frame: string): string | null | typeof DONE_SENTINEL {
	let payload = "";
	for (const rawLine of frame.split("\n")) {
		const line = rawLine.trimEnd();
		if (!line.startsWith("data:")) continue;
		const data = line.slice(5).trimStart();
		if (data === "[DONE]") return DONE_SENTINEL;
		payload += data;
	}
	if (!payload) return null;
	try {
		const json = JSON.parse(payload);
		const choice = json?.choices?.[0];
		const delta: string | undefined = choice?.delta?.content ?? choice?.message?.content;
		return typeof delta === "string" && delta.length > 0 ? delta : null;
	} catch {
		return null;
	}
}

function extractContentFromCompletion(json: unknown): string {
	if (!json || typeof json !== "object") return "";
	const choices = (json as { choices?: Array<{ message?: { content?: string } }> }).choices;
	const content = choices?.[0]?.message?.content;
	return typeof content === "string" ? content : "";
}
