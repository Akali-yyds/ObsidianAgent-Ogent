import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { ConsentManager } from "./consent/manager";
import { UndoBuffer } from "./consent/undo";
import { OpenAgentSettingsTab, DEFAULT_SETTINGS, type PluginSettings } from "./settings";
import { ToolRegistry } from "./tools/registry";
import { vaultTools } from "./tools/vault";
import { CHAT_VIEW_TYPE, ChatView } from "./view";

const SETTINGS_CHANGED_EVENT = "open-agent:settings-changed";

export default class OpenAgentPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	private toolRegistry!: ToolRegistry;
	private undo!: UndoBuffer;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.toolRegistry = new ToolRegistry();
		this.undo = new UndoBuffer(50);
		this.toolRegistry.registerAll(vaultTools(this.app, { undo: this.undo }));

		this.registerView(CHAT_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			// Per-view ConsentManager so session overrides reset with each new view instance.
			const consent = new ConsentManager(() => this.settings.consent);
			return new ChatView(leaf, {
				getSettings: () => this.settings,
				openSettings: () => this.openSettings(),
				tools: this.toolRegistry,
				consent,
				undo: this.undo,
			});
		});

		this.addRibbonIcon("bot", "OpenAgent", () => this.activateView());

		this.addCommand({
			id: "open-agent",
			name: "Open panel",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "ask-about-current-note",
			name: "Ask agent about current note",
			callback: () => this.askAboutCurrentNote(),
		});

		this.addCommand({
			id: "undo-last-tool-write",
			name: "Undo last tool write",
			callback: () => this.undoLastWrite(),
		});

		this.addSettingTab(new OpenAgentSettingsTab(this.app, this));
	}

	onunload(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)) {
			if (leaf.view instanceof ChatView) leaf.view.cancelInFlight();
		}
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<PluginSettings> | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...(data ?? {}),
			consent: { ...DEFAULT_SETTINGS.consent, ...(data?.consent ?? {}) },
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
	}

	private async activateView(): Promise<ChatView | null> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]);
			return existing[0].view instanceof ChatView ? (existing[0].view as ChatView) : null;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return null;
		await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
		workspace.revealLeaf(leaf);
		return leaf.view instanceof ChatView ? (leaf.view as ChatView) : null;
	}

	private async askAboutCurrentNote(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active note");
			return;
		}
		const view = await this.activateView();
		if (!view) return;
		view.prefillInput(`Tell me about [[${file.basename}]]`);
	}

	private async undoLastWrite(): Promise<void> {
		const op = this.undo.pop();
		if (!op) {
			new Notice("Nothing to undo");
			return;
		}
		try {
			const file = this.app.vault.getAbstractFileByPath(op.path);
			if (op.before === null) {
				if (file instanceof TFile) await this.app.vault.delete(file);
			} else if (file instanceof TFile) {
				await this.app.vault.modify(file, op.before);
			} else {
				await this.app.vault.create(op.path, op.before);
			}
			new Notice(`Reverted ${op.path}`);
		} catch (err) {
			new Notice(`Undo failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private openSettings(): void {
		const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(this.manifest.id);
	}
}
