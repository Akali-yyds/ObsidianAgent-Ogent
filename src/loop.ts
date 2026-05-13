import { Agent } from "./agents/agent";
import type { ChatMessage, LoopEvent, ModelProvider } from "./types";
import type { ConsentManager } from "./consent/manager";
import type { ToolRegistry } from "./tools/registry";

export interface RunTurnOptions {
	signal?: AbortSignal;
	systemPrompt?: string;
	tools?: ToolRegistry;
	consent?: ConsentManager;
	maxSteps?: number;
}

const classicAgent = new Agent({
	id: "classic",
	name: "Classic",
});

export async function* runTurn(
	userMessages: ChatMessage[],
	provider: ModelProvider,
	opts: RunTurnOptions = {},
): AsyncIterable<LoopEvent> {
	yield* classicAgent.run({
		messages: userMessages,
		provider,
		signal: opts.signal,
		systemPrompt: opts.systemPrompt,
		tools: opts.tools,
		consent: opts.consent,
		maxSteps: opts.maxSteps,
	});
}
