export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCallSpec {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export interface ChatMessage {
	role: Role;
	content: string;
	tool_calls?: ToolCallSpec[];
	tool_call_id?: string;
	name?: string;
}

export interface AssembledToolCall {
	id: string;
	name: string;
	arguments: unknown;
	rawArguments: string;
}

export type StreamEvent =
	| { kind: "text"; text: string; degraded?: boolean }
	| { kind: "thinking_text"; text: string }
	| { kind: "tool_call_assembled"; calls: AssembledToolCall[]; degraded?: boolean }
	| { kind: "done"; finishReason: "stop" | "tool_calls" | "length" | "content_filter" | "unknown" };

export interface ResponseFormatJsonSchemaConfig {
	name: string;
	schema: JsonSchema;
	strict?: boolean;
}

export interface ResponseFormatConfig {
	type: "json_schema";
	json_schema: ResponseFormatJsonSchemaConfig;
}

export interface StreamOptions {
	signal?: AbortSignal;
	tools?: OpenAiToolSpec[];
	toolChoice?: "auto" | "required";
	responseFormat?: ResponseFormatConfig;
}

export interface OpenAiToolSpec {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: JsonSchema;
	};
}

export interface ModelProvider {
	stream(messages: ChatMessage[], opts?: StreamOptions): AsyncIterable<StreamEvent>;
	listModels?(): Promise<string[]>;
	capabilities?(): ProviderCapabilities;
}

export interface ProviderCapabilities {
	streaming: boolean;
	thinking: boolean;
	toolCalls: boolean;
	requiredToolChoice: boolean;
	jsonSchema: boolean;
	vision: boolean;
}

/** Product-level operating mode for the current Agent chat. */
/** User-facing execution scope for the current chat. */
export type AgentExecutionMode = "read" | "ask" | "full";

// JSON Schema (subset we support)
export interface JsonSchemaProperty {
	type: "string" | "number" | "integer" | "boolean" | "object" | "array";
	description?: string;
	enum?: readonly unknown[];
	items?: JsonSchemaProperty;
	properties?: Record<string, JsonSchemaProperty>;
	required?: string[];
	additionalProperties?: boolean;
	default?: unknown;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	oneOf?: Array<JsonSchema | JsonSchemaProperty>;
}

export interface JsonSchema {
	type: "object";
	properties: Record<string, JsonSchemaProperty>;
	required?: string[];
	additionalProperties?: boolean;
	oneOf?: Array<JsonSchema | JsonSchemaProperty>;
}

// Tool definitions
export type PermissionClass =
	| "vault_read"
	| "vault_write"
	| "network_read"
	| "external_write"
	| "plugin_control"
	| "system_command";

// Compatibility alias for tool definitions.
export type ToolCategory = PermissionClass;

export type ToolResult =
	| { ok: true; value: unknown }
	| { ok: false; error: string; details?: unknown };

export interface ToolContext {
	signal?: AbortSignal;
}

/** The only command vocabulary exposed to the model by the chat Agent. */
export type AgentCommandDomain = "vault" | "git" | "web" | "plugin";

export interface AgentCommand {
	id: string;
	domain: AgentCommandDomain;
	action: string;
	args: Record<string, unknown>;
}

export interface CommandPlan {
	commands: AgentCommand[];
}

export type CommandRisk = "read" | "vault_write" | "external_write" | "network_read" | "plugin_control";

export interface CommandResult {
	id: string;
	ok: boolean;
	risk: CommandRisk;
	value?: unknown;
	error?: string;
	details?: unknown;
}

export interface CommandPlanResult {
	ok: boolean;
	results: CommandResult[];
	stoppedAt?: string;
	error?: string;
}

export type ChangeOperationKind = "move" | "rename" | "content_patch";

export interface ChangeOperation {
	kind: ChangeOperationKind;
	sourcePath?: string;
	targetPath?: string;
	path?: string;
	before?: string;
	after?: string;
	reason: string;
}

export interface AffectedFile {
	path: string;
	kind: "move" | "patch";
	bytesBefore?: number;
	bytesAfter?: number;
	summary: string;
	fingerprint?: string;
}

export interface ChangeBlocker {
	code: string;
	message: string;
	paths?: string[];
}

export interface ChangeWarning {
	code: string;
	message: string;
	paths?: string[];
}

export interface ChangeSet {
	id: string;
	intent: string;
	operations: ChangeOperation[];
	affectedFiles: AffectedFile[];
	blockers: ChangeBlocker[];
	warnings: ChangeWarning[];
	createdAt: number;
}

export interface ChangeSetResult {
	changeSetId: string;
	status: "applied" | "rejected" | "blocked" | "rolled_back";
	restored?: boolean;
	recoveryItems?: string[];
}

export interface ToolDef<TArgs = unknown> {
	name: string;
	description: string;
	schema: JsonSchema;
	category: ToolCategory;
	mutates: boolean;
	/** Optional explicit permission class for tools with non-default behavior. */
	permission?: PermissionClass;
	/** Network reads and other sensitive non-mutating operations can opt into approval. */
	requiresApproval?: boolean;
	run(args: TArgs, ctx: ToolContext): Promise<ToolResult>;
}

// Consent
export type ConsentMode = "always" | "ask" | "never";

export interface ConsentDecision {
	approved: boolean;
	approveAllSession?: boolean;
}

// Loop events
export type LoopEvent =
	| { kind: "text"; text: string; degraded?: boolean }
	| { kind: "thinking_text"; text: string }
	| { kind: "tool_call_started"; id: string; name: string; args: unknown; mutates: boolean }
	| { kind: "plan_preview"; id: string; name: string; args: unknown }
	| { kind: "checkpoint"; id: string; state: "started" | "completed" }
	| { kind: "consent_requested"; id: string; name: string }
	| { kind: "tool_call_required"; message: string; attempts: number }
	| { kind: "tool_call_finished"; id: string; result: ToolResult }
	| { kind: "command_plan_started"; id: string; commands: AgentCommand[] }
	| { kind: "command_started"; planId: string; command: AgentCommand; risk: CommandRisk; warning?: string }
	| { kind: "command_consent_requested"; planId: string; command: AgentCommand; risk: CommandRisk; warning?: string }
	| { kind: "command_finished"; planId: string; result: CommandResult }
	| { kind: "change_set_created"; planId: string; commandId: string; changeSet: ChangeSet }
	| { kind: "change_set_blocked"; planId: string; commandId: string; changeSet: ChangeSet }
	| { kind: "change_set_approval_required"; planId: string; commandId: string; changeSet: ChangeSet }
	| { kind: "change_set_started"; planId: string; commandId: string; changeSetId: string }
	| { kind: "change_set_completed"; planId: string; commandId: string; result: ChangeSetResult }
	| { kind: "change_set_rolled_back"; planId: string; commandId: string; result: ChangeSetResult }
	| { kind: "command_plan_finished"; id: string; result: CommandPlanResult }
	| { kind: "cap_hit" }
	| { kind: "done" };

// Errors
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

export class ToolCallParseError extends Error {
	readonly toolCallId: string;
	constructor(toolCallId: string, message = "Failed to parse tool call arguments") {
		super(message);
		this.name = "ToolCallParseError";
		this.toolCallId = toolCallId;
	}
}
