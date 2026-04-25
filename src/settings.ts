import { App, PluginSettingTab, Setting } from "obsidian";
import type AiAgentPlugin from "./main";

export type ProviderId = "openai-compatible";

export interface PluginSettings {
	provider: ProviderId;
	baseUrl: string;
	apiKey: string;
	model: string;
	systemPrompt: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	provider: "openai-compatible",
	baseUrl: "https://api.openai.com/v1",
	apiKey: "",
	model: "gpt-4o-mini",
	systemPrompt: "",
};

export function isConfigured(s: PluginSettings): boolean {
	return s.baseUrl.trim().length > 0 && s.apiKey.trim().length > 0 && s.model.trim().length > 0;
}

export class AiAgentSettingsTab extends PluginSettingTab {
	private readonly plugin: AiAgentPlugin;

	constructor(app: App, plugin: AiAgentPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const notice = containerEl.createEl("div", { cls: "ai-agent-notice" });
		notice.createEl("strong", { text: "Key storage: " });
		notice.appendText(
			"your API key is stored in this plugin's data file (`.obsidian/plugins/ai-agent/data.json`). " +
				"If you sync that folder via Obsidian Sync or another sync tool, the key travels with it.",
		);

		new Setting(containerEl)
			.setName("Provider")
			.setDesc("M0 ships with a single OpenAI-compatible provider. More providers arrive in later milestones.")
			.addDropdown((drop) => {
				drop.addOption("openai-compatible", "OpenAI-compatible");
				drop.setValue(this.plugin.settings.provider);
				drop.onChange(async (v) => {
					this.plugin.settings.provider = v as ProviderId;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Base URL")
			.setDesc("e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1, http://192.168.x.x:11434/v1")
			.addText((txt) =>
				txt
					.setPlaceholder("https://api.openai.com/v1")
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (v) => {
						this.plugin.settings.baseUrl = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("API key")
			.setDesc("Bearer token. Stored in plugin data; never in localStorage or the vault.")
			.addText((txt) => {
				txt.setPlaceholder("sk-…")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (v) => {
						this.plugin.settings.apiKey = v;
						await this.plugin.saveSettings();
					});
				txt.inputEl.type = "password";
				txt.inputEl.autocomplete = "off";
			});

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Model name as accepted by your endpoint.")
			.addText((txt) =>
				txt
					.setPlaceholder("gpt-4o-mini")
					.setValue(this.plugin.settings.model)
					.onChange(async (v) => {
						this.plugin.settings.model = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("System prompt")
			.setDesc("Optional. Prepended to every conversation.")
			.addTextArea((txt) =>
				txt
					.setPlaceholder("You are a helpful assistant…")
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (v) => {
						this.plugin.settings.systemPrompt = v;
						await this.plugin.saveSettings();
					}),
			);
	}
}
