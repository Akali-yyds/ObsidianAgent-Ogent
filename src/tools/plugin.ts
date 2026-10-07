import type { App } from "obsidian";
import { defineTool, fail, ok } from "./define";

interface PluginIdArgs { id: string; }
interface PluginInvokeArgs { id: string; commandId: string; }

/** Optional extension point for plugins that want structured Ogent results. */
export interface OgentPluginAdapter<TArgs = Record<string, unknown>, TResult = unknown> {
	pluginId: string;
	commands: Record<string, {
		description: string;
		args: Record<string, unknown>;
		invoke(args: TArgs): Promise<TResult>;
	}>;
}

interface PluginManagerLike {
	manifests?: Record<string, unknown>;
	enabledPlugins?: Set<string> | string[];
	enablePlugin?: (id: string) => Promise<void>;
}

interface CommandManagerLike {
	listCommands?: () => Record<string, unknown> | unknown[];
	commands?: Record<string, unknown>;
	executeCommandById?: (id: string) => boolean | void;
}

/** Desktop-only, feature-detected access to Obsidian's public command manager. */
export function pluginTools(app: App) {
	return [pluginListTool(app), pluginEnableTool(app), pluginInvokeTool(app)];
}

function pluginListTool(app: App) {
	return defineTool({
		name: "plugin_list",
		description: "List installed Obsidian plugins, including disabled plugins, and the public commands discoverable at runtime.",
		category: "vault_read",
		requiresApproval: false,
		mutates: false,
		schema: { type: "object", properties: {}, additionalProperties: false },
		async run() {
			const manager = getPluginManager(app);
			if (!manager?.manifests) return fail("UnsupportedCapability: Obsidian plugin manifests are unavailable.");
			const commands = listCommands(app);
			const enabled = getEnabledIds(manager);
			const plugins = Object.entries(manager.manifests).map(([id, manifest]) => {
				const info = isRecord(manifest) ? manifest : {};
				return {
					id,
					name: typeof info.name === "string" ? info.name : id,
					version: typeof info.version === "string" ? info.version : "",
					author: typeof info.author === "string" ? info.author : "",
					description: typeof info.description === "string" ? info.description : "",
					enabled: enabled.has(id),
					commands: enabled.has(id) ? commands.filter((commandId) => commandId === id || commandId.startsWith(`${id}:`)) : [],
				};
			});
			return ok({ plugins, commandManagerAvailable: Boolean(getCommandManager(app)?.executeCommandById) });
		},
	});
}

function pluginEnableTool(app: App) {
	return defineTool<PluginIdArgs>({
		name: "plugin_enable",
		description: "Enable an installed Obsidian plugin by id. Requires plugin-control approval.",
		category: "plugin_control",
		requiresApproval: true,
		mutates: true,
		schema: {
			type: "object",
			properties: { id: { type: "string", minLength: 1, maxLength: 200 } },
			required: ["id"],
			additionalProperties: false,
		},
		async run(args) {
			if (!args.id) return fail("Plugin id is required.");
			const manager = getPluginManager(app);
			if (!manager?.manifests) return fail("UnsupportedCapability: Obsidian plugin manager is unavailable.");
			if (!Object.prototype.hasOwnProperty.call(manager.manifests, args.id)) return fail(`NotFound: plugin '${args.id}'.`);
			if (getEnabledIds(manager).has(args.id)) return ok({ id: args.id, enabled: true, changed: false });
			if (!manager.enablePlugin) return fail("UnsupportedCapability: this Obsidian version cannot enable plugins at runtime.");
			try {
				await manager.enablePlugin(args.id);
				return ok({ id: args.id, enabled: true, changed: true });
			} catch (error) {
				return fail(`PluginEnableError: ${error instanceof Error ? error.message : String(error)}`);
			}
		},
	});
}

function pluginInvokeTool(app: App) {
	return defineTool<PluginInvokeArgs>({
		name: "plugin_invoke",
		description: "Invoke a public command registered by an enabled Obsidian plugin. Does not access private plugin APIs.",
		category: "plugin_control",
		requiresApproval: true,
		mutates: true,
		schema: {
			type: "object",
			properties: {
				id: { type: "string", minLength: 1, maxLength: 200 },
				commandId: { type: "string", minLength: 1, maxLength: 300 },
			},
			required: ["id", "commandId"],
			additionalProperties: false,
		},
		async run(args) {
			if (!args.id || !args.commandId) return fail("Plugin id and commandId are required.");
			const manager = getPluginManager(app);
			if (!manager?.manifests) return fail("UnsupportedCapability: Obsidian plugin manifests are unavailable.");
			if (!getEnabledIds(manager).has(args.id)) return fail(`PluginDisabled: '${args.id}' must be enabled before invoking a command.`);
			const commandManager = getCommandManager(app);
			if (!commandManager?.executeCommandById) return fail("UnsupportedCapability: Obsidian command manager is unavailable.");
			const commandIds = listCommands(app);
			if (!commandIds.includes(args.commandId) || !(args.commandId === args.id || args.commandId.startsWith(`${args.id}:`))) {
				return fail(`UnsupportedCommand: '${args.commandId}' is not a discoverable public command for '${args.id}'.`);
			}
			try {
				const result = commandManager.executeCommandById(args.commandId);
				return ok({ pluginId: args.id, commandId: args.commandId, invoked: result !== false, structuredResult: false });
			} catch (error) {
				return fail(`PluginCommandError: ${error instanceof Error ? error.message : String(error)}`);
			}
		},
	});
}

function getPluginManager(app: App): PluginManagerLike | null {
	const manager = (app as unknown as { plugins?: unknown }).plugins;
	return isRecord(manager) ? manager as PluginManagerLike : null;
}

function getCommandManager(app: App): CommandManagerLike | null {
	const commands = (app as unknown as { commands?: unknown }).commands;
	return isRecord(commands) ? commands as CommandManagerLike : null;
}

function getEnabledIds(manager: PluginManagerLike): Set<string> {
	if (manager.enabledPlugins instanceof Set) return new Set([...manager.enabledPlugins].filter((id): id is string => typeof id === "string"));
	if (Array.isArray(manager.enabledPlugins)) return new Set(manager.enabledPlugins.filter((id): id is string => typeof id === "string"));
	return new Set();
}

function listCommands(app: App): string[] {
	const manager = getCommandManager(app);
	const value = manager?.listCommands?.() ?? manager?.commands;
	if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
	if (isRecord(value)) return Object.keys(value);
	return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
