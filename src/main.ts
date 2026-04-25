import { Plugin, WorkspaceLeaf } from "obsidian";
import { AiAgentSettingsTab, DEFAULT_SETTINGS, type PluginSettings } from "./settings";
import { CHAT_VIEW_TYPE, ChatView } from "./view";

const SETTINGS_CHANGED_EVENT = "ai-agent:settings-changed";

export default class AiAgentPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	private activeView: ChatView | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(CHAT_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			const view = new ChatView(
				leaf,
				() => this.settings,
				() => this.openSettings(),
			);
			this.activeView = view;
			return view;
		});

		this.addCommand({
			id: "open-ai-agent",
			name: "Open AI Agent",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new AiAgentSettingsTab(this.app, this));
	}

	onunload(): void {
		this.activeView?.cancelInFlight();
		this.activeView = null;
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<PluginSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
	}

	private async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
		workspace.revealLeaf(leaf);
	}

	private openSettings(): void {
		// Obsidian's Setting type isn't on the public typings; this is the documented escape hatch.
		const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(this.manifest.id);
	}
}
