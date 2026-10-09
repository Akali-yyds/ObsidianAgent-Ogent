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
	private pending = new Map<string, { resolve: (choice: ConsentChoice) => void; category: ToolCategory }>();

	constructor(getSettings: () => ConsentSettings, persistMode?: (category: ToolCategory, mode: ConsentMode) => void) {
		this.getSettings = getSettings;
		this.persistMode = persistMode;
	}

	resetSession(): void {
		this.sessionOverrides = {};
		this.cancelAllPending();
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
		// Access is captured when a run starts; changing the selector must not
		// implicitly approve or reject a request already waiting for the user.
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
		const requestId = this.pending.keys().next().value as string | undefined;
		if (requestId) this.resolveConsentFor(requestId, choice);
	}

	resolveConsentFor(requestId: string, choice: ConsentChoice): void {
		const pending = this.pending.get(requestId);
		if (!pending) return;
		const { resolve, category } = pending;
		this.pending.delete(requestId);
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
		const requestId = this.pending.keys().next().value as string | undefined;
		if (requestId) this.resolveConsentFor(requestId, "reject");
	}

	cancelAllPending(): void {
		for (const requestId of [...this.pending.keys()]) this.resolveConsentFor(requestId, "reject");
	}

	async requestApproval(tool: ToolDef, _args: unknown, executionMode: AgentExecutionMode = "ask", requestId = "default"): Promise<boolean> {
		const requiresApproval = tool.mutates || tool.requiresApproval === true || tool.category === "network_read" || tool.category === "external_write" || tool.category === "plugin_control";
		if (!requiresApproval) return true;
		if (executionMode === "full") return true;
		if (executionMode === "read") return false;

		const choice = await new Promise<ConsentChoice>((resolve) => {
			this.pending.set(requestId, { resolve, category: tool.category });
		});
		return choice === "approve" || choice === "approve-session" || choice === "approve-always";
	}
}
