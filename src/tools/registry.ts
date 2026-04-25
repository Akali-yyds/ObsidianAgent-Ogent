import type { OpenAiToolSpec, ToolDef } from "../types";

export class ToolRegistry {
	private readonly tools = new Map<string, ToolDef>();

	register(tool: ToolDef): void {
		this.tools.set(tool.name, tool);
	}

	registerAll(tools: ToolDef[]): void {
		for (const t of tools) this.register(t);
	}

	get(name: string): ToolDef | undefined {
		return this.tools.get(name);
	}

	list(): ToolDef[] {
		return [...this.tools.values()];
	}

	size(): number {
		return this.tools.size;
	}

	toApiSpec(): OpenAiToolSpec[] {
		return this.list().map((t) => ({
			type: "function",
			function: {
				name: t.name,
				description: t.description,
				parameters: t.schema,
			},
		}));
	}
}
