import { App, Notice, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type OpenAgentPlugin from "./main";
import { DEFAULT_CONSENT, type ConsentSettings } from "./consent/manager";
import type { ConsentMode } from "./types";
import type { WebSearchProvider } from "./tools/web-search";
import { OpenAICompatibleProvider } from "./provider";

export type ProviderId = "openai-compatible";

export interface PluginSettings {
	provider: ProviderId;
	baseUrl: string;
	apiKey: string;
	model: string;
	systemPrompt: string;
	agentMemory: string;
	webSearchProvider: WebSearchProvider;
	webSearchApiKey: string;
	consent: ConsentSettings;
	disabledTools: string[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
	provider: "openai-compatible",
	baseUrl: "https://api.openai.com/v1",
	apiKey: "",
	model: "gpt-4o-mini",
	systemPrompt: "",
	agentMemory: "",
	webSearchProvider: "tavily",
	webSearchApiKey: "",
	consent: { ...DEFAULT_CONSENT },
	disabledTools: [],
};

export function isConfigured(settings: PluginSettings): boolean {
	return settings.baseUrl.trim().length > 0 && settings.apiKey.trim().length > 0 && settings.model.trim().length > 0;
}

async function fetchModelList(baseUrl: string, apiKey: string): Promise<string[]> {
	if (!baseUrl.trim()) return [];
	try {
		const response = await requestUrl({
			url: `${baseUrl.replace(/\/$/, "")}/models`,
			method: "GET",
			headers: { Authorization: `Bearer ${apiKey}` },
			throw: false,
		});
		if (response.status >= 400) return [];
		const parsed = JSON.parse(response.text) as { data?: unknown };
		if (!Array.isArray(parsed.data)) return [];
		return parsed.data
			.filter((entry): entry is { id?: unknown } => typeof entry === "object" && entry !== null)
			.map((entry) => entry.id)
			.filter((id): id is string => typeof id === "string" && id.length > 0)
			.sort();
	} catch {
		return [];
	}
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

		const keyNotice = containerEl.createDiv({ cls: "open-agent-notice" });
		keyNotice.createEl("strong", { text: "Key storage: " });
		keyNotice.appendText(`Your API key is stored in ${this.app.vault.configDir}/plugins/open-agent/data.json. Keep this file private.`);

		new Setting(containerEl)
			.setName("Provider")
			.setDesc("Any OpenAI-compatible API endpoint.")
			.addDropdown((drop) => {
				drop.addOption("openai-compatible", "OpenAI compatible");
				drop.setValue(this.plugin.settings.provider);
				drop.onChange(async (value) => {
					this.plugin.settings.provider = value as ProviderId;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Base URL")
			.setDesc("For example https://api.openai.com/v1 or a local OpenAI-compatible endpoint.")
			.addText((text) => text.setPlaceholder("https://api.openai.com/v1").setValue(this.plugin.settings.baseUrl).onChange(async (value) => {
				this.plugin.settings.baseUrl = value.trim();
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName("API key")
			.setDesc("Stored in the plugin data file, not in the vault.")
			.addText((text) => {
				text.setValue(this.plugin.settings.apiKey).onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				});
				text.inputEl.type = "password";
				text.inputEl.autocomplete = "off";
			});

		new Setting(containerEl)
			.setName("Web search provider")
			.setDesc("Used for current and time-sensitive information.")
			.addDropdown((drop) => {
				drop.addOption("tavily", "Tavily");
				drop.addOption("brave", "Brave Search");
				drop.setValue(this.plugin.settings.webSearchProvider);
				drop.onChange(async (value) => {
					this.plugin.settings.webSearchProvider = value as WebSearchProvider;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Web search API key")
			.setDesc("Optional; required by web_search.")
			.addText((text) => {
				text.setValue(this.plugin.settings.webSearchApiKey).onChange(async (value) => {
					this.plugin.settings.webSearchApiKey = value.trim();
					await this.plugin.saveSettings();
				});
				text.inputEl.type = "password";
				text.inputEl.autocomplete = "off";
			});

		const modelContainer = containerEl.createDiv();
		this.renderModelSetting(modelContainer, "Model", "Model name accepted by your endpoint.", () => this.plugin.settings.model, async (value) => {
			this.plugin.settings.model = value;
			await this.plugin.saveSettings();
		}, () => this.plugin.settings.baseUrl, () => this.plugin.settings.apiKey);

		new Setting(containerEl)
			.setName("Provider health")
			.setDesc("Check endpoint reachability and model discovery.")
			.addButton((button) => button.setButtonText("Test connection").onClick(async () => {
				button.setButtonText("Testing…").setDisabled(true);
				const result = await new OpenAICompatibleProvider({ baseUrl: this.plugin.settings.baseUrl, apiKey: this.plugin.settings.apiKey, model: this.plugin.settings.model }).healthCheck();
				button.setButtonText("Test connection").setDisabled(false);
				new Notice(result.ok ? `Provider is reachable (${result.modelCount} models).` : "Provider check failed. Verify URL, API key, and endpoint compatibility.");
			}));

		new Setting(containerEl).setName("System prompt").setDesc("Optional prompt prepended to every conversation.").addTextArea((text) => text.setValue(this.plugin.settings.systemPrompt).onChange(async (value) => {
			this.plugin.settings.systemPrompt = value;
			await this.plugin.saveSettings();
		}));

		new Setting(containerEl).setName("Agent memory").setDesc("Optional plugin-local preferences. Do not store secrets.").addTextArea((text) => text.setValue(this.plugin.settings.agentMemory).onChange(async (value) => {
			this.plugin.settings.agentMemory = value;
			await this.plugin.saveSettings();
		}));

		new Setting(containerEl).setName("Tool consent").setHeading();
		this.consentDropdown(containerEl, "Read tools", "vault_read");
		this.consentDropdown(containerEl, "Write tools", "vault_write");
		this.consentDropdown(containerEl, "Network access", "network_read");

		new Setting(containerEl).setName("Enabled tools").setHeading();
		const toolNames = this.plugin.getToolNames();
		if (toolNames.length === 0) {
			containerEl.createEl("p", { text: "Tools are not loaded yet.", cls: "open-agent-notice" });
		} else {
			for (const name of toolNames) {
				new Setting(containerEl).setName(name).setDesc(this.plugin.isToolEnabled(name) ? "Enabled for Agent calls." : "Disabled for Agent calls.").addToggle((toggle) => {
					toggle.setValue(this.plugin.isToolEnabled(name));
					toggle.onChange(async (enabled) => this.plugin.setToolEnabled(name, enabled));
				});
			}
		}
	}

	private renderModelSetting(container: HTMLElement, name: string, desc: string, getValue: () => string, onSave: (value: string) => Promise<void>, getBaseUrl: () => string, getApiKey: () => string): void {
		container.empty();
		const saved = getValue();
		let select: HTMLSelectElement | null = null;
		new Setting(container).setName(name).setDesc(desc)
			.addDropdown((drop) => {
				select = drop.selectEl;
				if (saved) drop.addOption(saved, saved);
				else drop.addOption("", "Fetch models to select");
				drop.setValue(saved);
				drop.onChange(async (value) => { if (value) await onSave(value); });
			})
			.addButton((button) => button.setButtonText("Fetch models").onClick(async () => {
				button.setButtonText("Fetching…").setDisabled(true);
				const models = await fetchModelList(getBaseUrl(), getApiKey());
				button.setButtonText("Fetch models").setDisabled(false);
				if (models.length === 0) {
					new Notice("Could not fetch models. You can type a model name in the provider settings or check the URL and API key.");
					return;
				}
				if (!select) return;
				const current = getValue();
				while (select.options.length > 0) select.remove(0);
				for (const model of current && !models.includes(current) ? [current, ...models] : models) select.add(new Option(model, model));
				select.value = current && models.includes(current) ? current : models[0];
				await onSave(select.value);
			}));
	}

	private consentDropdown(parent: HTMLElement, label: string, key: keyof ConsentSettings): void {
		new Setting(parent).setName(label).setDesc(this.consentDesc(key)).addDropdown((drop) => {
			drop.addOption("always", "Always allow");
			drop.addOption("ask", "Ask each time");
			drop.addOption("never", "Never allow");
			drop.setValue(this.plugin.settings.consent[key]);
			drop.onChange(async (value) => {
				this.plugin.settings.consent[key] = value as ConsentMode;
				await this.plugin.saveSettings();
			});
		});
	}

	private consentDesc(key: keyof ConsentSettings): string {
		if (key === "vault_read") return "Reads notes, metadata, links, and search results.";
		if (key === "network_read") return "Public web search and page fetching.";
		return "Writes to the vault. Choose Never to disable mutating tools.";
	}
}
