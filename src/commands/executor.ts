import { ToolTimeoutError, runWithTimeout } from "../tools/timeout";
import { validateArgs } from "../tools/validate";
import type { ConsentManager } from "../consent/manager";
import type {
	AgentCommand,
	CommandPlan,
	CommandPlanResult,
	CommandResult,
	CommandRisk,
	CommandRisk as Risk,
	AgentExecutionMode,
	ToolDef,
	ToolResult,
} from "../types";
import type { ToolRegistry } from "../tools/registry";
import { commandPlanSchema } from "./tool";
import { commandDescriptor } from "./catalog";

const MAX_COMMANDS = 32;

export type CommandExecutorEvent =
	| { kind: "started"; command: AgentCommand; risk: CommandRisk; warning?: string }
	| { kind: "consent_requested"; command: AgentCommand; risk: CommandRisk; warning?: string }
	| { kind: "finished"; result: CommandResult };

export interface ExecutePlanOptions {
	planId: string;
	consent?: ConsentManager;
	executionMode?: AgentExecutionMode;
	signal?: AbortSignal;
}

/**
 * Maps the stable model-facing command vocabulary onto the existing, tested
 * ToolDef implementations. No command reaches a ToolDef without both an
 * allowlisted mapping and the ToolDef's own schema validation.
 */
export class CommandExecutor {
	constructor(private readonly registry: ToolRegistry) {}

	async *executePlan(plan: CommandPlan, opts: ExecutePlanOptions): AsyncGenerator<CommandExecutorEvent, CommandPlanResult> {
		const planValidation = validateArgs(plan, commandPlanSchema(this.registry));
		if (!planValidation.ok) {
			return { ok: false, results: [], error: `CommandPlanError: ${planValidation.error}` };
		}
		if (plan.commands.length === 0) return { ok: true, results: [] };
		if (plan.commands.length > MAX_COMMANDS) {
			return { ok: false, results: [], error: `CommandPlanError: at most ${MAX_COMMANDS} commands are allowed.` };
		}

		const ids = new Set<string>();
		for (const command of plan.commands) {
			if (ids.has(command.id)) {
				return { ok: false, results: [], error: `CommandPlanError: duplicate command id '${command.id}'.` };
			}
			ids.add(command.id);
		}

		const results: CommandResult[] = [];
		for (const command of plan.commands) {
			if (opts.signal?.aborted) {
				const result: CommandResult = { id: command.id, ok: false, risk: "read", error: "CommandCancelled" };
				results.push(result);
				yield { kind: "finished", result };
				return { ok: false, results, stoppedAt: command.id, error: "CommandCancelled" };
			}

			const resolved = this.resolveCommand(command);
			const risk = resolved ? riskForTool(resolved.tool) : "read";
			yield { kind: "started", command, risk, warning: commandWarning(command) };

			if (!resolved) {
				const error = commandToolName(command)
					? `UnsupportedCapability: ${command.domain} commands are unavailable in this Obsidian environment.`
					: `UnsupportedCommand: ${command.domain}.${command.action}`;
				const result: CommandResult = { id: command.id, ok: false, risk, error };
				results.push(result);
				yield { kind: "finished", result };
				return { ok: false, results, stoppedAt: command.id, error: result.error };
			}

			const validated = validateArgs(command.args, resolved.tool.schema);
			if (!validated.ok) {
				const result: CommandResult = { id: command.id, ok: false, risk, error: `CommandArgError: ${validated.error}` };
				results.push(result);
				yield { kind: "finished", result };
				return { ok: false, results, stoppedAt: command.id, error: result.error };
			}

			if (isWriteCommand(resolved.tool) && opts.executionMode === "read") {
				const result: CommandResult = {
					id: command.id,
					ok: false,
					risk,
					error: "ReadOnlyMode",
					details: "Read mode allows inspection only; switch to Agent or Full mode for this command.",
				};
				results.push(result);
				yield { kind: "finished", result };
				return { ok: false, results, stoppedAt: command.id, error: result.error };
			}

			const requiresApproval = requiresCommandApproval(resolved.tool);
			if (requiresApproval) {
				if (!opts.consent) {
					const result: CommandResult = { id: command.id, ok: false, risk, error: "ConsentDeniedError: no consent manager" };
					results.push(result);
					yield { kind: "finished", result };
					return { ok: false, results, stoppedAt: command.id, error: result.error };
				}
				// Start the approval request before yielding the UI event. This keeps
				// the approval channel live while the consumer renders the prompt and
				// also makes programmatic consumers able to resolve it immediately
				// after observing consent_requested.
				const approval = opts.consent.requestApproval(resolved.tool, validated.value);
				yield {
					kind: "consent_requested",
					command,
					risk,
					warning: commandWarning(command),
				};
				const approved = await approval;
				if (!approved) {
					const result: CommandResult = {
						id: command.id,
						ok: false,
						risk,
						error: "ConsentDeniedError",
						details: "User rejected this command.",
					};
					results.push(result);
					yield { kind: "finished", result };
					return { ok: false, results, stoppedAt: command.id, error: result.error };
				}
			}

			const toolResult = await runTool(resolved.tool, validated.value, opts.signal);
			const result = toCommandResult(command.id, risk, toolResult);
			results.push(result);
			yield { kind: "finished", result };
			if (!result.ok) return { ok: false, results, stoppedAt: command.id, error: result.error };
		}

		return { ok: true, results };
	}

	private resolveCommand(command: AgentCommand): { tool: ToolDef } | null {
		const toolName = commandToolName(command);
		if (!toolName) return null;
		const tool = this.registry.get(toolName);
		return tool ? { tool } : null;
	}
}

export function commandToolName(command: AgentCommand): string | null {
	return commandDescriptor(command)?.toolName ?? null;
}

function riskForTool(tool: ToolDef): Risk {
	if (tool.category === "vault_write") return "vault_write";
	if (tool.category === "external_write") return "external_write";
	if (tool.category === "network_read") return "network_read";
	if (tool.category === "plugin_control") return "plugin_control";
	return "read";
}

function isWriteCommand(tool: ToolDef): boolean {
	return tool.mutates || tool.category === "vault_write" || tool.category === "external_write" || tool.category === "plugin_control";
}

function requiresCommandApproval(tool: ToolDef): boolean {
	return tool.mutates || tool.requiresApproval === true || tool.category === "network_read" || tool.category === "plugin_control";
}

function commandWarning(command: AgentCommand): string | undefined {
	if (command.domain !== "git") return undefined;
	if (command.action === "commit") return "Git commit may execute repository hooks and modify the local repository.";
	if (command.action === "pull") return "Git pull may execute hooks, contact a remote, and use configured credentials.";
	if (command.action === "push") return "Git push may execute hooks, contact a remote, and use configured credentials.";
	return undefined;
}

async function runTool(tool: ToolDef, args: Record<string, unknown>, signal: AbortSignal | undefined): Promise<ToolResult> {
	try {
		return await runWithTimeout(tool.run(args, { signal }), 30_000, tool.name, signal);
	} catch (error) {
		if (error instanceof ToolTimeoutError) return { ok: false, error: "ToolTimeoutError", details: error.message };
		if (error instanceof Error) return { ok: false, error: error.name || "ToolError", details: error.message };
		return { ok: false, error: "ToolError", details: String(error) };
	}
}

function toCommandResult(id: string, risk: CommandRisk, result: ToolResult): CommandResult {
	return result.ok
		? { id, ok: true, risk, value: result.value }
		: { id, ok: false, risk, error: result.error, ...(result.details !== undefined ? { details: result.details } : {}) };
}
