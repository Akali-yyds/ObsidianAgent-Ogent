import type { AgentExecutionMode, ConsentMode, ToolCategory, ToolDef } from "../types";

export interface ConsentSettings {
	vault_read: ConsentMode;
	vault_write: ConsentMode;
	plugin_control: ConsentMode;
	[key: string]: ConsentMode;
}

export const DEFAULT_CONSENT: ConsentSettings = {
	vault_read: "always",
	vault_write: "ask",
	network_read: "ask",
	external_write: "ask",
	plugin_control: "ask",
	system_command: "never",
};

export type ConsentChoice = "approve" | "reject" | "approve-session" | "approve-always";

export class ConsentManager {
	private readonly getSettings: () => ConsentSettings;
	private readonly persistMode?: (category: ToolCategory, mode: ConsentMode) => void;
	private sessionOverrides: Partial<Record<ToolCategory, ConsentMode>> = {};
	private pending: { resolve: (choice: ConsentChoice) => void; category: ToolCategory } | null = null;

	constructor(getSettings: () => ConsentSettings, persistMode?: (category: ToolCategory, mode: ConsentMode) => void) {
		this.getSettings = getSettings;
		this.persistMode = persistMode;
	}

	resetSession(): void {
		this.sessionOverrides = {};
	}

	getMode(category: ToolCategory): ConsentMode {
		return this.sessionOverrides[category] ?? this.getSettings()[category] ?? DEFAULT_CONSENT[category] ?? "ask";
	}

	/**
	 * Change a permission for the lifetime of the current chat view.
	 * This is the same session-scoped boundary used by the inline approval
	 * action, so changing the composer control never rewrites plugin settings.
	 */
	setSessionMode(category: ToolCategory, mode: ConsentMode): void {
		this.sessionOverrides[category] = mode;
		if (!this.pending || this.pending.category !== category) return;

		// If a write is already waiting for approval, changing the control to
		// Full mode should continue that write instead of leaving the stream
		// apparently stuck behind an obsolete approval prompt.
		if (mode === "always") {
			const resolve = this.pending.resolve;
			this.pending = null;
			resolve("approve-session");
		} else if (mode === "never") {
			const resolve = this.pending.resolve;
			this.pending = null;
			resolve("reject");
		}
	}

	/**
	 * Apply the single user-facing execution scope to every high-risk
	 * capability. The category map remains an internal safety boundary, while
	 * the chat exposes one predictable policy: read, ask, or full.
	 */
	setExecutionMode(mode: AgentExecutionMode): void {
		const highRiskMode: ConsentMode = mode === "read" ? "never" : mode === "full" ? "always" : "ask";
		for (const category of ["vault_write", "external_write", "network_read", "plugin_control"] as ToolCategory[]) {
			this.setSessionMode(category, highRiskMode);
		}
	}

	resolveConsent(choice: ConsentChoice): void {
		if (!this.pending) return;
		const { resolve, category } = this.pending;
		this.pending = null;
		if (choice === "approve-session") this.sessionOverrides[category] = "always";
		if (choice === "approve-always" && this.canPersist(category)) {
			this.persistMode?.(category, "always");
			this.sessionOverrides[category] = "always";
		}
		resolve(choice);
	}

	canPersist(category: ToolCategory): boolean {
		return category === "external_write" || category === "network_read" || category === "plugin_control";
	}

	cancelPendingConsent(): void {
		if (this.pending) {
			this.pending.resolve("reject");
			this.pending = null;
		}
	}

	async requestApproval(tool: ToolDef, _args: unknown, executionMode: AgentExecutionMode = "ask"): Promise<boolean> {
		const requiresApproval = tool.mutates || tool.requiresApproval === true || tool.category === "network_read" || tool.category === "external_write" || tool.category === "plugin_control";
		if (!requiresApproval) return true;
		if (executionMode === "full") return true;
		if (executionMode === "read") return false;

		const choice = await new Promise<ConsentChoice>((resolve) => {
			this.pending = { resolve, category: tool.category };
		});
		return choice === "approve" || choice === "approve-session" || choice === "approve-always";
	}
}
