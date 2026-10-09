import type { ConsentManager } from "../consent/manager";
import type { CommandExecutor } from "../commands/executor";
import type { ToolRegistry } from "../tools/registry";
import type { AgentExecutionMode, ChatMessage, LoopEvent, ModelProvider, ResponseFormatConfig } from "../types";
import type { UndoBuffer } from "../consent/undo";

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
	toolAllowlist?: string[];
	commandExecutor?: CommandExecutor;
	sessionId?: string;
	undo?: UndoBuffer;
}

export type AgentEvent = LoopEvent;
