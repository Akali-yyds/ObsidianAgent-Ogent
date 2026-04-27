import { App, PluginSettingTab, Setting } from "obsidian";
import type OpenAgentPlugin from "./main";
import { DEFAULT_CONSENT, type ConsentSettings } from "./consent/manager";
import type { ConsentMode } from "./types";

export type ProviderId = "openai-compatible";

export interface PluginSettings {
	provider: ProviderId;
	baseUrl: string;
	apiKey: string;
	model: string;
	systemPrompt: string;
	consent: ConsentSettings;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	provider: "openai-compatible",
	baseUrl: "https://api.openai.com/v1",
	apiKey: "",
	model: "gpt-4o-mini",
	systemPrompt: "",
	consent: { ...DEFAULT_CONSENT },
};

export function isConfigured(s: PluginSettings): boolean {
	return s.baseUrl.trim().length > 0 && s.apiKey.trim().length > 0 && s.model.trim().length > 0;
}

export class OpenAgentSettingsTab extends PluginSettingTab {
	private readonly plugin: OpenAgentPlugin;

	constructor(app: App, plugin: OpenAgentPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const keyNotice = containerEl.createEl("div", { cls: "open-agent-notice" });
		keyNotice.createEl("strong", { text: "Key storage: " });
		keyNotice.appendText(
			"your API key is stored in this plugin's data file (`.obsidian/plugins/open-agent/data.json`). " +
				"If you sync that folder via Obsidian Sync or another sync tool, the key travels with it.",
		);

		const vaultNotice = containerEl.createEl("div", { cls: "open-agent-notice" });
		vaultNotice.createEl("strong", { text: "Data sent to model endpoint: " });
		vaultNotice.appendText(
			"with tools enabled, the agent may transmit note bodies, paths, frontmatter, and tags to the model endpoint you've configured. Choose endpoints you trust.",
		);

		new Setting(containerEl)
			.setName("Provider")
			.setDesc("M1 ships a single OpenAI-compatible provider. More providers arrive in later milestones.")
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

		containerEl.createEl("h3", { text: "Tool consent" });

		this.consentDropdown(containerEl, "Read tools", "vault_read");
		this.consentDropdown(containerEl, "Write tools", "vault_write");
	}

	private consentDropdown(parent: HTMLElement, label: string, key: keyof ConsentSettings): void {
		new Setting(parent)
			.setName(label)
			.setDesc(this.consentDesc(key))
			.addDropdown((drop) => {
				drop.addOption("always", "Always allow");
				drop.addOption("ask", "Ask each time");
				drop.addOption("never", "Never allow");
				drop.setValue(this.plugin.settings.consent[key]);
				drop.onChange(async (v) => {
					this.plugin.settings.consent[key] = v as ConsentMode;
					await this.plugin.saveSettings();
				});
			});
	}

	private consentDesc(key: keyof ConsentSettings): string {
		if (key === "vault_read") {
			return "Reads (list, read, search, metadata, links). Default: Always.";
		}
		return "Writes (write, append, edit). Default: Ask. Choose 'Never' to disable mutating tools entirely.";
	}
}
