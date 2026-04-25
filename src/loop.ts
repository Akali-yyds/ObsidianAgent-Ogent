import type { ChatMessage, ModelProvider, StreamOptions, TextDelta } from "./types";

export interface RunTurnOptions extends StreamOptions {
	systemPrompt?: string;
}

export async function* runTurn(
	messages: ChatMessage[],
	provider: ModelProvider,
	opts: RunTurnOptions = {},
): AsyncIterable<TextDelta> {
	const prepared: ChatMessage[] = [];
	if (opts.systemPrompt && opts.systemPrompt.trim().length > 0) {
		prepared.push({ role: "system", content: opts.systemPrompt });
	}
	prepared.push(...messages);

	for await (const delta of provider.stream(prepared, { signal: opts.signal })) {
		// Defensive: even though we ask for tools=undefined, some endpoints may
		// emit non-content fields. ModelProvider.stream() yields TextDelta only,
		// so we just pass through here. Any future tool-call surface is M1+.
		yield delta;
	}
}
