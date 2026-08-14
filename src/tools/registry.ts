import type { OpenAiToolSpec, ToolDef } from "../types";

export class ToolRegistry {
	private readonly tools = new Map<string, ToolDef>();
	private readonly disabled = new Set<string>();

	register(tool: ToolDef): void {
		this.tools.set(tool.name, tool);
	}

	registerAll(tools: ToolDef[]): void {
		for (const t of tools) this.register(t);
	}

	get(name: string): ToolDef | undefined {
		return this.disabled.has(name) ? undefined : this.tools.get(name);
	}

	list(): ToolDef[] {
		return [...this.tools.values()].filter((tool) => !this.disabled.has(tool.name));
	}

	listAll(): ToolDef[] {
		return [...this.tools.values()];
	}

	setEnabled(name: string, enabled: boolean): void {
		if (!this.tools.has(name)) return;
		if (enabled) this.disabled.delete(name);
		else this.disabled.add(name);
	}

	isEnabled(name: string): boolean {
		return this.tools.has(name) && !this.disabled.has(name);
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
