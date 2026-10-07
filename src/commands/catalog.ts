import type { AgentCommand, AgentCommandDomain } from "../types";
import type { ToolRegistry } from "../tools/registry";

export interface CommandDescriptor {
	domain: AgentCommandDomain;
	action: string;
	toolName: string;
}

/**
 * The model-facing command vocabulary. The implementation remains mapped to
 * the existing ToolDefs, but the vocabulary itself is defined in one place so
 * schema generation and execution cannot drift apart.
 */
export const COMMAND_DESCRIPTORS: readonly CommandDescriptor[] = [
	...[
		"list", "read", "search", "metadata", "links", "write", "append", "edit", "rename", "move", "delete", "restore",
	].map((action) => ({ domain: "vault" as const, action, toolName: `vault_${action}` })),
	...[
		"status", "diff", "log", "branches", "remotes", "init", "stage", "commit", "switch", "pull", "push",
	].map((action) => ({ domain: "git" as const, action, toolName: `git_${action}` })),
	...[
		"search", "fetch",
	].map((action) => ({ domain: "web" as const, action, toolName: `web_${action}` })),
	...[
		"list", "enable", "invoke",
	].map((action) => ({ domain: "plugin" as const, action, toolName: `plugin_${action}` })),
];

export function commandDescriptor(command: AgentCommand): CommandDescriptor | undefined {
	return COMMAND_DESCRIPTORS.find((entry) => entry.domain === command.domain && entry.action === command.action);
}

export function availableCommandDescriptors(registry?: ToolRegistry): CommandDescriptor[] {
	if (!registry) return [...COMMAND_DESCRIPTORS];
	return COMMAND_DESCRIPTORS.filter((entry) => registry.get(entry.toolName));
}
