import { defineTool, fail } from "../tools/define";
import type { JsonSchema, ToolDef } from "../types";
import { availableCommandDescriptors } from "./catalog";
import type { ToolRegistry } from "../tools/registry";

/**
 * Virtual tool shown to the model. The Agent loop intercepts it and routes the
 * plan through CommandExecutor; this fallback is deliberately non-executable.
 */
export function executeCommandsTool(registry?: ToolRegistry): ToolDef {
	return defineTool({
		name: "execute_commands",
		description:
			"Execute a validated, ordered plan of Vault, Git, Web, or Plugin commands. " +
			"Read commands may be batched. Write, remote Git, and plugin commands are approved one at a time.",
		category: "vault_read",
		mutates: false,
		schema: commandPlanSchema(registry),
		async run() {
			return fail("UnsupportedCapability: execute_commands must be handled by the Agent command executor.");
		},
	});
}

export function commandPlanSchema(registry?: ToolRegistry): JsonSchema {
	const descriptors = availableCommandDescriptors(registry);
	const variants = descriptors.map((descriptor) => {
		const tool = registry?.get(descriptor.toolName);
		return {
			type: "object" as const,
			properties: {
				id: { type: "string" as const, minLength: 1, maxLength: 100 },
				domain: { type: "string" as const, enum: [descriptor.domain] },
				action: { type: "string" as const, enum: [descriptor.action] },
				args: tool?.schema
					? { ...tool.schema }
					: { type: "object" as const, description: "Action-specific arguments." },
			},
			required: ["id", "domain", "action", "args"],
			additionalProperties: false,
		};
	});
	const commandProperties: JsonSchema["properties"] = {
		id: { type: "string", minLength: 1, maxLength: 100 },
		domain: { type: "string", enum: ["vault", "git", "web", "plugin"] },
		action: { type: "string", minLength: 1, maxLength: 80 },
		args: { type: "object", description: "Action-specific arguments." },
	};
	return {
		type: "object",
		properties: {
			commands: {
				type: "array",
				description: "Ordered commands. Choose the action that matches the user's intent and pass arguments from the request or prior command results. Execution stops after the first failure.",
				items: {
					type: "object",
					properties: commandProperties,
					required: ["id", "domain", "action", "args"],
					additionalProperties: false,
					...(variants.length > 0 ? { oneOf: variants } : {}),
				},
			},
		},
		required: ["commands"],
		additionalProperties: false,
	};
}
