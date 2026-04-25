export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
	role: Role;
	content: string;
}

export interface TextDelta {
	text: string;
	degraded?: boolean;
}

export interface StreamOptions {
	signal?: AbortSignal;
}

export interface ModelProvider {
	stream(messages: ChatMessage[], opts?: StreamOptions): AsyncIterable<TextDelta>;
}

export class AuthError extends Error {
	constructor(message = "Authentication failed") {
		super(message);
		this.name = "AuthError";
	}
}

export class RateLimitError extends Error {
	constructor(message = "Rate limit exceeded") {
		super(message);
		this.name = "RateLimitError";
	}
}

export class NetworkError extends Error {
	constructor(message = "Network error") {
		super(message);
		this.name = "NetworkError";
	}
}

export class ProviderError extends Error {
	readonly status?: number;
	constructor(message: string, status?: number) {
		super(message);
		this.name = "ProviderError";
		this.status = status;
	}
}
