import { App, Notice, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type OpenAgentPlugin from "./main";
import { DEFAULT_CONSENT, type ConsentSettings } from "./consent/manager";
import { loadPacks } from "./packs/loader";
import type { AgentPack } from "./packs/types";
import type { OpenAICompatibleConfig } from "./provider-config";
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
	packProviderOverrides: Record<string, Record<string, Partial<OpenAICompatibleConfig>>>;
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
	packProviderOverrides: {},
};

export function isConfigured(s: PluginSettings): boolean {
	return s.baseUrl.trim().length > 0 && s.apiKey.trim().length > 0 && s.model.trim().length > 0;
}

async function fetchModelList(baseUrl: string, apiKey: string): Promise<string[]> {
	if (!baseUrl.trim()) return [];
	try {
		const base = baseUrl.replace(/\/$/, "");
		const res = await requestUrl({
			url: `${base}/models`,
			method: "GET",
			headers: { Authorization: `Bearer ${apiKey}` },
			throw: false,
		});
		if (res.status >= 400) return [];
		const parsed = JSON.parse(res.text) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
		const data = (parsed as Record<string, unknown>).data;
		if (!Array.isArray(data)) return [];
		return (data as unknown[])
			.filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && !Array.isArray(e))
			.map((e) => e.id)
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

		const keyNotice = containerEl.createEl("div", { cls: "open-agent-notice" });
		keyNotice.createEl("strong", { text: "Key storage: " });
		keyNotice.appendText(
			`Your API key is stored in this plugin's data file (${this.app.vault.configDir}/plugins/open-agent/data.json). ` +
				"If you sync that folder via Obsidian Sync or another sync tool, the key travels with it.",
		);

		const vaultNotice = containerEl.createEl("div", { cls: "open-agent-notice" });
		vaultNotice.createEl("strong", { text: "Data sent to model endpoint: " });
		vaultNotice.appendText(
			"with tools enabled, the agent may transmit note bodies, paths, frontmatter, and tags to the model endpoint you've configured. Choose endpoints you trust.",
		);

		new Setting(containerEl)
			.setName("Provider")
			.setDesc("any compatible API endpoint (more providers coming soon).")
			.addDropdown((drop) => {
				drop.addOption("openai-compatible", "OpenAI compatible");
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
			.setDesc("bearer token stored in plugin data, never in local storage or the vault.")
			.addText((txt) => {
				txt.setPlaceholder("")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (v) => {
						this.plugin.settings.apiKey = v;
						await this.plugin.saveSettings();
					});
				txt.inputEl.type = "password";
				txt.inputEl.autocomplete = "off";
			});

		new Setting(containerEl)
			.setName("Web search provider")
			.setDesc("Used for current and time-sensitive information. Tavily is selected by default.")
			.addDropdown((drop) => {
				drop.addOption("tavily", "Tavily");
				drop.addOption("brave", "Brave Search");
				drop.setValue(this.plugin.settings.webSearchProvider);
				drop.onChange(async (v) => {
					this.plugin.settings.webSearchProvider = v as WebSearchProvider;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Web search API key")
			.setDesc("Optional. Required to use web_search; stored in the plugin data file.")
			.addText((txt) => {
				txt.setPlaceholder("Paste Tavily or Brave API key")
					.setValue(this.plugin.settings.webSearchApiKey)
					.onChange(async (v) => {
						this.plugin.settings.webSearchApiKey = v.trim();
						await this.plugin.saveSettings();
					});
				txt.inputEl.type = "password";
				txt.inputEl.autocomplete = "off";
			});

		const modelContainer = containerEl.createDiv();
		this.renderModelSetting(
			modelContainer,
			"Model",
			"Model name as accepted by your endpoint.",
			() => this.plugin.settings.model,
			async (v) => {
				this.plugin.settings.model = v;
				await this.plugin.saveSettings();
			},
			() => this.plugin.settings.baseUrl,
			() => this.plugin.settings.apiKey,
		);

		new Setting(containerEl)
			.setName("Provider health")
			.setDesc("Check model discovery and the capabilities used by the Agent loop.")
			.addButton((button) => {
				button.setButtonText("Test connection").onClick(async () => {
					button.setButtonText("Testing…").setDisabled(true);
					const result = await new OpenAICompatibleProvider({
						baseUrl: this.plugin.settings.baseUrl,
						apiKey: this.plugin.settings.apiKey,
						model: this.plugin.settings.model,
					}).healthCheck();
					button.setButtonText("Test connection").setDisabled(false);
					new Notice(result.ok ? `Provider is reachable (${result.modelCount} models).` : "Provider check failed. Verify URL, API key, and endpoint compatibility.");
				});
			});

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

		new Setting(containerEl)
			.setName("Agent memory")
			.setDesc("Optional plugin-local memory. Do not store API keys or secrets here.")
			.addTextArea((txt) =>
				txt
					.setPlaceholder("Stable preferences and decisions for this Agent")
					.setValue(this.plugin.settings.agentMemory)
					.onChange(async (v) => {
						this.plugin.settings.agentMemory = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Tool consent").setHeading();

		this.consentDropdown(containerEl, "Read tools", "vault_read");
		this.consentDropdown(containerEl, "Write tools", "vault_write");
		this.consentDropdown(containerEl, "Network access", "network_read");

		new Setting(containerEl).setName("Enabled tools").setHeading();
		const toolList = this.plugin.getToolNames();
		if (toolList.length === 0) {
			containerEl.createEl("p", { text: "Tools are not loaded yet.", cls: "open-agent-notice" });
		} else {
			for (const toolName of toolList) {
				new Setting(containerEl)
					.setName(toolName)
					.setDesc(this.plugin.isToolEnabled(toolName) ? "Enabled for Agent calls." : "Disabled for Agent calls.")
					.addToggle((toggle) => {
						toggle.setValue(this.plugin.isToolEnabled(toolName));
						toggle.onChange(async (enabled) => {
							await this.plugin.setToolEnabled(toolName, enabled);
						});
					});
			}
		}

		new Setting(containerEl).setName("Pack models").setHeading();

		const packSectionEl = containerEl.createDiv();
		const loadingEl = packSectionEl.createEl("p", { text: "Loading packs…", cls: "open-agent-notice" });

		void loadPacks(this.app, this.plugin.manifest.dir ?? this.plugin.manifest.id).then((packs) => {
			loadingEl.remove();
			this.renderPackProviderOverrides(packSectionEl, packs);
		});
	}

	private renderPackProviderOverrides(containerEl: HTMLElement, packs: AgentPack[]): void {
		if (packs.length === 0) {
			containerEl.createEl("p", { text: "No packs installed.", cls: "open-agent-notice" });
			return;
		}
		for (const pack of packs) {
			containerEl.createEl("strong", { text: pack.name });
			for (const providerName of Object.keys(pack.providers)) {
				const jsonConfig = pack.providers[providerName];
				const label = providerName.charAt(0).toUpperCase() + providerName.slice(1);

				new Setting(containerEl)
					.setName(`${label} — Base URL`)
					.setDesc(`Default: ${jsonConfig?.baseUrl ?? ""}`)
					.addText((txt) =>
						txt
							.setPlaceholder(jsonConfig?.baseUrl ?? "")
							.setValue(this.plugin.settings.packProviderOverrides[pack.id]?.[providerName]?.baseUrl ?? "")
							.onChange(async (v) => {
								this.savePackProviderField(pack.id, providerName, "baseUrl", v.trim());
								await this.plugin.saveSettings();
							}),
					);

				new Setting(containerEl)
					.setName(`${label} — API key`)
					.setDesc("Leave blank to use the value from the pack config file.")
					.addText((txt) => {
						txt
							.setPlaceholder("")
							.setValue(this.plugin.settings.packProviderOverrides[pack.id]?.[providerName]?.apiKey ?? "")
							.onChange(async (v) => {
								this.savePackProviderField(pack.id, providerName, "apiKey", v);
								await this.plugin.saveSettings();
							});
						txt.inputEl.type = "password";
						txt.inputEl.autocomplete = "off";
					});

				const packModelContainer = containerEl.createDiv();
				this.renderModelSetting(
					packModelContainer,
					`${label} — Model`,
					`Default: ${jsonConfig?.model ?? ""}`,
					() => this.plugin.settings.packProviderOverrides[pack.id]?.[providerName]?.model ?? "",
					async (v) => {
						this.savePackProviderField(pack.id, providerName, "model", v);
						await this.plugin.saveSettings();
					},
					() =>
						this.plugin.settings.packProviderOverrides[pack.id]?.[providerName]?.baseUrl ??
						jsonConfig?.baseUrl ??
						"",
					() =>
						this.plugin.settings.packProviderOverrides[pack.id]?.[providerName]?.apiKey ??
						jsonConfig?.apiKey ??
						"",
				);
			}
		}
	}

	private savePackProviderField(
		packId: string,
		providerName: string,
		field: keyof OpenAICompatibleConfig,
		value: string,
	): void {
		if (!this.plugin.settings.packProviderOverrides[packId]) {
			this.plugin.settings.packProviderOverrides[packId] = {};
		}
		if (!this.plugin.settings.packProviderOverrides[packId][providerName]) {
			this.plugin.settings.packProviderOverrides[packId][providerName] = {};
		}
		if (value) {
			this.plugin.settings.packProviderOverrides[packId][providerName][field] = value;
		} else {
			delete this.plugin.settings.packProviderOverrides[packId][providerName][field];
		}
	}

	private renderModelSetting(
		container: HTMLElement,
		name: string,
		desc: string,
		getValue: () => string,
		onSave: (v: string) => Promise<void>,
		getBaseUrl: () => string,
		getApiKey: () => string,
	): void {
		container.empty();
		const saved = getValue();

		if (!getBaseUrl().trim()) {
			new Setting(container)
				.setName(name)
				.setDesc(desc)
				.addText((txt) =>
					txt
						.setPlaceholder("")
						.setValue(saved)
						.onChange(async (v) => {
							await onSave(v.trim());
						}),
				);
			return;
		}

		let selectEl: HTMLSelectElement | null = null;

		new Setting(container)
			.setName(name)
			.setDesc(desc)
			.addDropdown((drop) => {
				selectEl = drop.selectEl;
				if (saved) {
					drop.addOption(saved, saved);
					drop.setValue(saved);
				} else {
					drop.addOption("", "— click Fetch to select —");
					drop.setValue("");
				}
				drop.onChange(async (v) => {
					if (v) await onSave(v);
				});
			})
			.addButton((btn) => {
				btn.setButtonText("Fetch models").onClick(async () => {
					btn.setButtonText("Fetching…").setDisabled(true);
					const models = await fetchModelList(getBaseUrl(), getApiKey());

					if (models.length === 0) {
						container.empty();
						new Setting(container)
							.setName(name)
							.setDesc(desc)
							.addText((txt) =>
								txt
									.setPlaceholder("")
									.setValue(getValue())
									.onChange(async (v) => {
										await onSave(v.trim());
									}),
							);
						container.createEl("p", {
							text: "Could not fetch models — check URL and API key.",
							cls: "open-agent-notice",
						});
						return;
					}

					btn.setButtonText("Fetch models").setDisabled(false);
					if (selectEl) {
						const current = getValue();
						while (selectEl.options.length > 0) selectEl.remove(0);
						const allModels =
							current && !models.includes(current) ? [current, ...models] : models;
						for (const m of allModels) {
							selectEl.add(new Option(m, m));
						}
						const toSelect = current && allModels.includes(current) ? current : (allModels[0] ?? "");
						selectEl.value = toSelect;
						await onSave(toSelect);
					}
				});
			});
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
		if (key === "network_read") {
			return "Public web search and page fetching. Default: Ask before the first network operation.";
		}
		return "Writes (write, append, edit). Default: Ask. Choose 'Never' to disable mutating tools entirely.";
	}
}
