import type { JsonSchema, ToolCategory, ToolContext, ToolDef, ToolResult } from "../types";

interface ToolSpec<TArgs> {
	name: string;
	description: string;
	schema: JsonSchema;
	category: ToolCategory;
	mutates: boolean;
	run(args: TArgs, ctx: ToolContext): Promise<ToolResult>;
}

export function defineTool<TArgs = Record<string, unknown>>(spec: ToolSpec<TArgs>): ToolDef<TArgs> {
	return spec;
}

export function ok(value: unknown): ToolResult {
	return { ok: true, value };
}

export function fail(error: string, details?: unknown): ToolResult {
	return { ok: false, error, details };
}
