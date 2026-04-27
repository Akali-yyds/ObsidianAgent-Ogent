import type { ConsentMode, ToolCategory, ToolDef } from "../types";

export interface ConsentSettings {
	vault_read: ConsentMode;
	vault_write: ConsentMode;
}

export const DEFAULT_CONSENT: ConsentSettings = {
	vault_read: "always",
	vault_write: "ask",
};

export type ConsentChoice = "approve" | "reject" | "approve-session";

export class ConsentManager {
	private readonly getSettings: () => ConsentSettings;
	private sessionOverrides: Partial<Record<ToolCategory, ConsentMode>> = {};
	private pending: { resolve: (choice: ConsentChoice) => void; category: ToolCategory } | null = null;

	constructor(getSettings: () => ConsentSettings) {
		this.getSettings = getSettings;
	}

	resetSession(): void {
		this.sessionOverrides = {};
	}

	getMode(category: ToolCategory): ConsentMode {
		return this.sessionOverrides[category] ?? this.getSettings()[category];
	}

	resolveConsent(choice: ConsentChoice): void {
		if (!this.pending) return;
		const { resolve, category } = this.pending;
		this.pending = null;
		if (choice === "approve-session") this.sessionOverrides[category] = "always";
		resolve(choice);
	}

	cancelPendingConsent(): void {
		if (this.pending) {
			this.pending.resolve("reject");
			this.pending = null;
		}
	}

	async requestApproval(tool: ToolDef, _args: unknown): Promise<boolean> {
		if (!tool.mutates) return true;
		const mode = this.getMode(tool.category);
		if (mode === "always") return true;
		if (mode === "never") return false;

		const choice = await new Promise<ConsentChoice>((resolve) => {
			this.pending = { resolve, category: tool.category };
		});
		return choice === "approve" || choice === "approve-session";
	}
}
