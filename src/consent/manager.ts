import type { App } from "obsidian";
import type { ConsentMode, ToolCategory, ToolDef } from "../types";
import { ConsentModal } from "./modal";

export interface ConsentSettings {
	vault_read: ConsentMode;
	vault_write: ConsentMode;
}

export const DEFAULT_CONSENT: ConsentSettings = {
	vault_read: "always",
	vault_write: "ask",
};

export class ConsentManager {
	private readonly app: App;
	private settings: ConsentSettings;
	private sessionOverrides: Partial<Record<ToolCategory, ConsentMode>> = {};
	private currentModal: ConsentModal | null = null;

	constructor(app: App, settings: ConsentSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: ConsentSettings): void {
		this.settings = settings;
	}

	resetSession(): void {
		this.sessionOverrides = {};
	}

	getMode(category: ToolCategory): ConsentMode {
		return this.sessionOverrides[category] ?? this.settings[category];
	}

	dismissActiveModal(): void {
		this.currentModal?.rejectExternally();
		this.currentModal = null;
	}

	async requestApproval(tool: ToolDef, args: unknown): Promise<boolean> {
		if (!tool.mutates) return true;
		const mode = this.getMode(tool.category);
		if (mode === "always") return true;
		if (mode === "never") return false;

		const modal = new ConsentModal(this.app, tool, args);
		this.currentModal = modal;
		modal.open();
		try {
			const choice = await modal.prompt();
			if (choice === "approve") return true;
			if (choice === "approve-session") {
				this.sessionOverrides[tool.category] = "always";
				return true;
			}
			return false;
		} finally {
			if (this.currentModal === modal) this.currentModal = null;
		}
	}
}
