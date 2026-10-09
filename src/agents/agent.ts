import type { ConsentManager } from "../consent/manager";
import { ToolTimeoutError, runWithTimeout } from "../tools/timeout";
import type { ToolRegistry } from "../tools/registry";
import { validateArgs } from "../tools/validate";
import type {
	AgentDefinition,
	AgentEvent,
	AgentRunOptions,
} from "./types";
import type {
	AssembledToolCall,
	ChatMessage,
	CommandPlan,
	CommandPlanResult,
	ModelProvider,
	OpenAiToolSpec,
	ResponseFormatConfig,
	ToolCallSpec,
	ToolDef,
	ToolResult,
	AgentExecutionMode,
	LoopEvent,
} from "../types";
import type { CommandExecutor } from "../commands/executor";

const DEFAULT_MAX_STEPS = 8;

interface BoundTools {
	get(name: string): ToolDef | undefined;
	toApiSpec(): OpenAiToolSpec[];
}

export class Agent {
	private readonly definition: AgentDefinition;

	constructor(definition: AgentDefinition) {
		this.definition = definition;
	}

	getDefinition(): AgentDefinition {
		return this.definition;
	}

	async *run(opts: AgentRunOptions): AsyncIterable<AgentEvent> {
		yield* executeAgentLoop(this.definition, opts);
	}
}

export interface ExecuteAgentLoopOptions {
	messages: ChatMessage[];
	provider: ModelProvider;
	signal?: AbortSignal;
	systemPrompt?: string;
	tools?: ToolRegistry;
	consent?: ConsentManager;
	maxSteps?: number;
	requireToolCall?: boolean;
	responseFormat?: ResponseFormatConfig;
	executionMode?: AgentExecutionMode;
	toolAllowlist?: string[];
	commandExecutor?: CommandExecutor;
	sessionId?: string;
	undo?: import("../consent/undo").UndoBuffer;
}

async function* executeAgentLoop(
	definition: AgentDefinition,
	opts: ExecuteAgentLoopOptions,
): AsyncIterable<AgentEvent> {
	const messages: ChatMessage[] = [];
	const parts = [definition.systemPrompt, opts.systemPrompt].filter((p) => p && p.trim().length > 0);
	const systemPrompt = parts.join("\n\n");
	if (systemPrompt.length > 0) {
		messages.push({ role: "system", content: systemPrompt });
	}
	messages.push(...opts.messages);

	const maxSteps = opts.maxSteps ?? definition.maxSteps ?? DEFAULT_MAX_STEPS;
	const toolsApi = bindTools(opts.tools, opts.toolAllowlist ?? definition.toolAllowlist, opts.commandExecutor);
	const providerCapabilities = opts.provider.capabilities?.();
	const useTools = Boolean(toolsApi && toolsApi.toApiSpec().length > 0 && (providerCapabilities?.toolCalls ?? true));
	const supportsRequiredToolChoice = providerCapabilities?.requiredToolChoice ?? true;
	let requiredToolSatisfied = false;
	let toolCallRecoveryAttempts = 0;
	const maxToolCallRecoveryAttempts = 1;

	for (let step = 0; step < maxSteps; step++) {
		const assembled: AssembledToolCall[] = [];
		let assistantText = "";
		const requireStructuredToolCall = Boolean(opts.requireToolCall && !requiredToolSatisfied);

		for await (const ev of opts.provider.stream(messages, {
				signal: opts.signal,
				tools: useTools ? toolsApi?.toApiSpec() : undefined,
				toolChoice: useTools && requireStructuredToolCall && supportsRequiredToolChoice ? "required" : undefined,
				responseFormat: opts.responseFormat,
		})) {
			if (opts.signal?.aborted) return;
			if (ev.kind === "text") {
				assistantText += ev.text;
				// A mutation request must not be represented by ordinary assistant
				// prose. Buffer it until a structured tool call is confirmed; this
				// prevents "please approve" text from bypassing the approval UI.
				if (!requireStructuredToolCall) yield { kind: "text", text: ev.text, degraded: ev.degraded };
			} else if (ev.kind === "thinking_text") {
				yield { kind: "thinking_text", text: ev.text };
			} else if (ev.kind === "tool_call_assembled") {
				assembled.push(...ev.calls);
			}
		}

		if (assembled.length === 0) {
			if (requireStructuredToolCall) {
				if (toolCallRecoveryAttempts < maxToolCallRecoveryAttempts) {
					// Some thinking endpoints reject tool_choice=required and fall
					// back to auto. Give the model one hidden repair turn instead of
					// exposing a prose approval request as if it were executable.
					if (assistantText.trim().length > 0) messages.push({ role: "assistant", content: assistantText });
					messages.push({
						role: "user",
						content: "The previous response did not emit the required execute_commands function call. Retry by returning exactly one valid structured execute_commands call for the user's request. Do not answer in prose and do not ask the user for approval; Ogent will show the approval UI after it receives the command.",
					});
					toolCallRecoveryAttempts += 1;
					continue;
				}
				yield {
					kind: "tool_call_required",
					message: "The model did not return a structured execute_commands call. No command was executed. Retry the request or use a model/provider with tool-calling support.",
					attempts: toolCallRecoveryAttempts + 1,
				};
				yield { kind: "done" };
				return;
			}
			// If we processed tool results but the model returned nothing, emit a fallback.
			if (step > 0 && assistantText.trim() === "") {
				yield { kind: "text", text: "*(No response from the model after tool use.)*", degraded: true };
			}
			yield { kind: "done" };
			return;
		}
		requiredToolSatisfied = true;

		const toolCallSpecs: ToolCallSpec[] = assembled.map((call) => ({
			id: call.id,
			type: "function",
			function: { name: call.name, arguments: call.rawArguments || JSON.stringify(call.arguments) },
		}));
		messages.push({ role: "assistant", content: assistantText, tool_calls: toolCallSpecs });

		let consentDenied = false;
		for (const call of assembled) {
			if (opts.signal?.aborted) return;
			const toolDef = toolsApi?.get(call.name);
			if (!toolDef) {
				yield { kind: "tool_call_started", id: call.id, name: call.name, args: call.arguments, mutates: false };
				const result: ToolResult = { ok: false, error: `UnknownToolError: ${call.name}` };
				yield { kind: "tool_call_finished", id: call.id, result };
				messages.push(toolMessage(call, result));
				continue;
			}

			yield {
				kind: "tool_call_started",
				id: call.id,
				name: call.name,
				args: call.arguments,
				mutates: toolDef.mutates,
			};

			const validated = validateArgs(call.arguments, toolDef.schema);
			if (!validated.ok) {
				const result: ToolResult = { ok: false, error: `ToolArgError: ${validated.error}` };
				yield { kind: "tool_call_finished", id: call.id, result };
				messages.push(toolMessage(call, result));
				continue;
			}

			if (call.name === "execute_commands") {
				let result: ToolResult = { ok: false, error: "CommandPlanFailed" };
				for await (const event of executeCommandPlan(call.id, validated.value, opts.commandExecutor, opts)) {
					yield event;
					if (event.kind === "command_plan_finished") {
						result = event.result.ok
							? { ok: true, value: event.result }
							: { ok: false, error: event.result.error ?? "CommandPlanFailed", details: event.result };
					}
				}
				yield { kind: "tool_call_finished", id: call.id, result };
				messages.push(toolMessage(call, result));
				continue;
			}

			const executionMode = opts.executionMode ?? "ask";
			if ((toolDef.mutates || toolDef.requiresApproval === true || toolDef.category === "network_read" || toolDef.category === "external_write" || toolDef.category === "plugin_control") && executionMode === "read") {
				const result: ToolResult = {
					ok: false,
					error: "ReadOnlyMode",
					details: "Read-only scope allows low-risk inspection only. Switch to Ask or Full permission to run this command.",
				};
				yield { kind: "tool_call_finished", id: call.id, result };
				messages.push(toolMessage(call, result));
				continue;
			}

			const requiresApproval = executionMode !== "full" && (toolDef.mutates || toolDef.requiresApproval === true || toolDef.category === "network_read" || toolDef.category === "external_write" || toolDef.category === "plugin_control");
			if (requiresApproval) {
				if (!opts.consent) {
					const result: ToolResult = { ok: false, error: "ConsentDeniedError: no consent manager" };
					yield { kind: "tool_call_finished", id: call.id, result };
					messages.push(toolMessage(call, result));
					continue;
				}
				yield { kind: "consent_requested", id: call.id, name: call.name };
				const approved = await opts.consent.requestApproval(toolDef, validated.value, executionMode, call.id);
				if (!approved) {
					const result: ToolResult = {
						ok: false,
						error: "ConsentDeniedError",
						details: "User rejected this operation.",
					};
					yield { kind: "tool_call_finished", id: call.id, result };
					messages.push(toolMessage(call, result));
					consentDenied = true;
					continue;
				}
			}

			let result: ToolResult;
			try {
				result = await runWithTimeout(
					toolDef.run(validated.value, { signal: opts.signal }),
					30_000,
					toolDef.name,
					opts.signal,
				);
			} catch (err) {
				if (err instanceof ToolTimeoutError) {
					result = { ok: false, error: "ToolTimeoutError", details: err.message };
				} else if (err instanceof Error) {
					result = { ok: false, error: err.name || "ToolError", details: err.message };
				} else {
					result = { ok: false, error: "ToolError", details: String(err) };
				}
			}

			yield { kind: "tool_call_finished", id: call.id, result };
			messages.push(toolMessage(call, result));
		}

		if (consentDenied) {
			yield { kind: "done" };
			return;
		}
	}

	yield { kind: "cap_hit" };
	yield { kind: "done" };
}

async function* executeCommandPlan(
	callId: string,
	args: Record<string, unknown>,
	executor: CommandExecutor | undefined,
	opts: ExecuteAgentLoopOptions,
	): AsyncGenerator<LoopEvent> {
	if (!executor) {
		yield { kind: "command_plan_finished", id: callId, result: { ok: false, results: [], error: "UnsupportedCapability: command executor is unavailable." } };
		return;
	}
	const plan = args as unknown as CommandPlan;
	yield { kind: "command_plan_started", id: callId, commands: plan.commands };
	const iterator = executor.executePlan(plan, {
		planId: callId,
		consent: opts.consent,
		executionMode: opts.executionMode,
		signal: opts.signal,
		sessionId: opts.sessionId,
		undo: opts.undo,
	});
	let next = await iterator.next();
	while (!next.done) {
		if (next.value.kind === "started") yield { kind: "command_started", planId: callId, command: next.value.command, risk: next.value.risk, warning: next.value.warning };
		else if (next.value.kind === "consent_requested") yield { kind: "command_consent_requested", planId: callId, command: next.value.command, risk: next.value.risk, warning: next.value.warning };
		else if (next.value.kind === "change_set_created") yield { kind: "change_set_created", planId: callId, commandId: next.value.command.id, changeSet: next.value.changeSet };
		else if (next.value.kind === "change_set_blocked") yield { kind: "change_set_blocked", planId: callId, commandId: next.value.command.id, changeSet: next.value.changeSet };
		else if (next.value.kind === "change_set_approval_required") yield { kind: "change_set_approval_required", planId: callId, commandId: next.value.command.id, changeSet: next.value.changeSet };
		else if (next.value.kind === "change_set_started") yield { kind: "change_set_started", planId: callId, commandId: next.value.command.id, changeSetId: next.value.changeSetId };
		else if (next.value.kind === "change_set_completed") yield { kind: "change_set_completed", planId: callId, commandId: next.value.command.id, result: next.value.result };
		else if (next.value.kind === "change_set_rolled_back") yield { kind: "change_set_rolled_back", planId: callId, commandId: next.value.command.id, result: next.value.result };
		else yield { kind: "command_finished", planId: callId, result: next.value.result };
		next = await iterator.next();
	}
	const finished = next.value as CommandPlanResult;
	yield { kind: "command_plan_finished", id: callId, result: finished };
}

function bindTools(registry?: ToolRegistry, allowlist?: string[], commandExecutor?: CommandExecutor): BoundTools | undefined {
	if (!registry) return undefined;
	// A command executor marks this as the command-driven Agent path. In that
	// path the model must never see the legacy implementation ToolDefs, even if
	// a caller forgets to pass a UI-level allowlist.
	const effectiveAllowlist = commandExecutor ? ["execute_commands"] : allowlist;
	const allowedNames = effectiveAllowlist && effectiveAllowlist.length > 0 ? new Set(effectiveAllowlist) : null;
	const tools = registry.list().filter((tool) => !allowedNames || allowedNames.has(tool.name));
	return {
		get(name: string): ToolDef | undefined {
			if (allowedNames && !allowedNames.has(name)) return undefined;
			return registry.get(name);
		},
		toApiSpec(): OpenAiToolSpec[] {
			return tools.map((tool) => ({
				type: "function",
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.schema,
				},
			}));
		},
	};
}

function toolMessage(call: AssembledToolCall, result: ToolResult): ChatMessage {
	return {
		role: "tool",
		tool_call_id: call.id,
		name: call.name,
		content: JSON.stringify(result),
	};
}
