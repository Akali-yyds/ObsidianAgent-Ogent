import { Agent } from "./agents/agent";
import type { AgentExecutionMode, ChatMessage, LoopEvent, ModelProvider } from "./types";
import type { ConsentManager } from "./consent/manager";
import type { ToolRegistry } from "./tools/registry";

export interface RunTurnOptions {
	signal?: AbortSignal;
	systemPrompt?: string;
	tools?: ToolRegistry;
	consent?: ConsentManager;
	maxSteps?: number;
	requireToolCall?: boolean;
	executionMode?: AgentExecutionMode;
}

const BASE_SYSTEM_PROMPT = `You are a helpful assistant with access to tools for searching and managing an Obsidian vault, plus live web search when configured.

When the user asks about current, recent, time-sensitive, or version-specific information, use web_search before answering when that tool is available. Prefer the returned source URLs in your final answer and distinguish searched facts from your general knowledge.

When you use a tool, always follow up with a natural language response explaining what you found — even if the result is empty or an error.

When a search returns no results:
- Try alternative search terms or strategies (e.g. different keywords, broader queries)
- After exhausting reasonable alternatives, clearly tell the user nothing was found`;

const classicAgent = new Agent({
	id: "classic",
	name: "Classic",
	systemPrompt: BASE_SYSTEM_PROMPT,
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
		requireToolCall: opts.requireToolCall,
		executionMode: opts.executionMode,
	});
}
