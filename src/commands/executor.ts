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
import type { SemanticPreparation, SemanticVaultOperations } from "../semantic/changeset";

const MAX_COMMANDS = 32;

export type CommandExecutorEvent =
	| { kind: "started"; command: AgentCommand; risk: CommandRisk; warning?: string }
	| { kind: "consent_requested"; command: AgentCommand; risk: CommandRisk; warning?: string }
	| { kind: "change_set_created"; command: AgentCommand; changeSet: NonNullable<SemanticPreparation["changeSet"]> }
	| { kind: "change_set_blocked"; command: AgentCommand; changeSet: NonNullable<SemanticPreparation["changeSet"]> }
	| { kind: "change_set_approval_required"; command: AgentCommand; changeSet: NonNullable<SemanticPreparation["changeSet"]> }
	| { kind: "change_set_started"; command: AgentCommand; changeSetId: string }
	| { kind: "change_set_completed"; command: AgentCommand; result: import("../types").ChangeSetResult }
	| { kind: "change_set_rolled_back"; command: AgentCommand; result: import("../types").ChangeSetResult }
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
	constructor(
		private readonly registry: ToolRegistry,
		private readonly semantic?: SemanticVaultOperations,
	) {}

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
		const executionMode = opts.executionMode ?? "ask";
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

			if ((isWriteCommand(resolved.tool) || requiresCommandApproval(resolved.tool)) && executionMode === "read") {
				const result: CommandResult = {
					id: command.id,
					ok: false,
					risk,
					error: "ReadOnlyMode",
					details: "Read-only scope allows low-risk inspection only; switch to Ask or Full permission to run this command.",
				};
				results.push(result);
				yield { kind: "finished", result };
				return { ok: false, results, stoppedAt: command.id, error: result.error };
			}

			if (this.semantic && isSemanticPathCommand(command)) {
				let preparation: SemanticPreparation;
				try {
					preparation = await this.semantic.prepare(command.action, validated.value as { oldPath: string; newPath: string });
				} catch (error) {
					const result: CommandResult = {
						id: command.id,
						ok: false,
						risk,
						error: "ChangeSetError",
						details: error instanceof Error ? error.message : String(error),
					};
					results.push(result);
					yield { kind: "finished", result };
					return { ok: false, results, stoppedAt: command.id, error: result.error };
				}
				yield { kind: "change_set_created", command, changeSet: preparation.changeSet };
				if (preparation.changeSet.blockers.length > 0) {
					yield { kind: "change_set_blocked", command, changeSet: preparation.changeSet };
					const result: CommandResult = {
						id: command.id,
						ok: false,
						risk,
						error: "ChangeSetBlocked",
						details: preparation.changeSet,
					};
					results.push(result);
					yield { kind: "finished", result };
					return { ok: false, results, stoppedAt: command.id, error: result.error };
				}
				if (executionMode !== "full" && !opts.consent) {
					const result: CommandResult = { id: command.id, ok: false, risk, error: "ConsentDeniedError: no consent manager", details: preparation.changeSet };
					results.push(result);
					yield { kind: "finished", result };
					return { ok: false, results, stoppedAt: command.id, error: result.error };
				}
				if (executionMode !== "full") {
					const approval = opts.consent?.requestApproval(resolved.tool, validated.value, executionMode) ?? Promise.resolve(false);
					yield { kind: "change_set_approval_required", command, changeSet: preparation.changeSet };
					yield { kind: "consent_requested", command, risk, warning: commandWarning(command) };
					if (!await approval) {
						const result: CommandResult = { id: command.id, ok: false, risk, error: "ConsentDeniedError", details: "User rejected this ChangeSet." };
						results.push(result);
						yield { kind: "finished", result };
						return { ok: false, results, stoppedAt: command.id, error: result.error };
					}
				}
				yield { kind: "change_set_started", command, changeSetId: preparation.changeSet.id };
				const applied = await this.semantic.apply(preparation, opts.signal);
				if (applied.result.status === "blocked") yield { kind: "change_set_blocked", command, changeSet: preparation.changeSet };
				else if (applied.result.status === "rolled_back") yield { kind: "change_set_rolled_back", command, result: applied.result };
				else yield { kind: "change_set_completed", command, result: applied.result };
				const result: CommandResult = applied.error
					? { id: command.id, ok: false, risk, error: applied.error, details: applied.result }
					: { id: command.id, ok: true, risk, value: applied.result };
				results.push(result);
				yield { kind: "finished", result };
				if (!result.ok) return { ok: false, results, stoppedAt: command.id, error: result.error };
				continue;
			}

			const requiresApproval = executionMode !== "full" && requiresCommandApproval(resolved.tool);
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
				const approval = opts.consent.requestApproval(resolved.tool, validated.value, executionMode);
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

function isSemanticPathCommand(command: AgentCommand): command is AgentCommand & { action: "rename" | "move" } {
	return command.domain === "vault" && (command.action === "rename" || command.action === "move");
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
	return tool.mutates || tool.requiresApproval === true || tool.category === "network_read" || tool.category === "external_write" || tool.category === "plugin_control";
}

function commandWarning(command: AgentCommand): string | undefined {
	if (command.domain !== "git") return undefined;
	if (command.action === "commit") return "Git 提交可能执行仓库钩子，并修改本地仓库。";
	if (command.action === "pull") return "拉取更新可能执行仓库钩子、访问远程仓库，并使用已配置的凭据。";
	if (command.action === "push") return "推送可能执行仓库钩子、访问远程仓库，并使用已配置的凭据。";
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
