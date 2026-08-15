import type { ConsentManager } from "../consent/manager";
import type { ToolRegistry } from "../tools/registry";
import type { AgentExecutionMode, ChatMessage, LoopEvent, ModelProvider, ResponseFormatConfig } from "../types";

export interface AgentDefinition {
	id: string;
	name: string;
	systemPrompt?: string;
	toolAllowlist?: string[];
	maxSteps?: number;
}

export interface AgentRunOptions {
	messages: ChatMessage[];
	provider: ModelProvider;
	signal?: AbortSignal;
	tools?: ToolRegistry;
	consent?: ConsentManager;
	systemPrompt?: string;
	maxSteps?: number;
	requireToolCall?: boolean;
	responseFormat?: ResponseFormatConfig;
	executionMode?: AgentExecutionMode;
}

export type AgentEvent = LoopEvent;
