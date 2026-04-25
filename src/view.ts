import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { runTurn } from "./loop";
import { OpenAICompatibleProvider } from "./provider";
import { isConfigured, type PluginSettings } from "./settings";
import { AuthError, type ChatMessage, NetworkError, ProviderError, RateLimitError } from "./types";

export const CHAT_VIEW_TYPE = "ai-agent-chat";

interface UiTurn {
	role: "user" | "assistant";
	content: string;
	interrupted?: boolean;
	degraded?: boolean;
	error?: string;
	authError?: boolean;
}

export class ChatView extends ItemView {
	private readonly getSettings: () => PluginSettings;
	private readonly openSettingsTab: () => void;

	private transcriptEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private stopBtn!: HTMLButtonElement;
	private hintEl!: HTMLElement;

	private turns: UiTurn[] = [];
	private inFlight: AbortController | null = null;
	private boundOnSettingsChanged: () => void;

	constructor(leaf: WorkspaceLeaf, getSettings: () => PluginSettings, openSettingsTab: () => void) {
		super(leaf);
		this.getSettings = getSettings;
		this.openSettingsTab = openSettingsTab;
		this.boundOnSettingsChanged = () => this.refreshConfiguredState();
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}
	getDisplayText(): string {
		return "AI Agent";
	}
	getIcon(): string {
		return "bot";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("ai-agent-view");

		this.hintEl = root.createDiv({ cls: "ai-agent-hint" });
		this.transcriptEl = root.createDiv({ cls: "ai-agent-transcript" });

		const composer = root.createDiv({ cls: "ai-agent-composer" });
		this.inputEl = composer.createEl("textarea", {
			cls: "ai-agent-input",
			attr: { rows: "3", placeholder: "Ask the agent…" },
		});
		this.inputEl.addEventListener("keydown", (e) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				e.preventDefault();
				void this.handleSend();
			}
		});

		const buttons = composer.createDiv({ cls: "ai-agent-buttons" });
		this.sendBtn = buttons.createEl("button", { text: "Send", cls: "mod-cta" });
		this.sendBtn.addEventListener("click", () => void this.handleSend());
		this.stopBtn = buttons.createEl("button", { text: "Stop" });
		this.stopBtn.addEventListener("click", () => this.handleStop());
		this.stopBtn.disabled = true;

		window.addEventListener("ai-agent:settings-changed", this.boundOnSettingsChanged);
		this.refreshConfiguredState();
		this.renderTranscript();
	}

	async onClose(): Promise<void> {
		window.removeEventListener("ai-agent:settings-changed", this.boundOnSettingsChanged);
		this.cancelInFlight();
	}

	cancelInFlight(): void {
		this.inFlight?.abort();
		this.inFlight = null;
	}

	private refreshConfiguredState(): void {
		const ok = isConfigured(this.getSettings());
		this.sendBtn.disabled = !ok || this.inFlight !== null;
		this.hintEl.empty();
		if (!ok) {
			this.hintEl.appendText("Provider not configured. ");
			const link = this.hintEl.createEl("a", { text: "Open settings", href: "#" });
			link.addEventListener("click", (e) => {
				e.preventDefault();
				this.openSettingsTab();
			});
		}
	}

	private async handleSend(): Promise<void> {
		const text = this.inputEl.value.trim();
		if (!text) return;
		const settings = this.getSettings();
		if (!isConfigured(settings)) {
			this.refreshConfiguredState();
			return;
		}

		this.turns.push({ role: "user", content: text });
		const assistantTurn: UiTurn = { role: "assistant", content: "" };
		this.turns.push(assistantTurn);
		this.inputEl.value = "";
		this.renderTranscript();

		const provider = new OpenAICompatibleProvider({
			baseUrl: settings.baseUrl,
			apiKey: settings.apiKey,
			model: settings.model,
		});

		const messages: ChatMessage[] = this.turns
			.filter((t) => !(t === assistantTurn))
			.map((t) => ({ role: t.role, content: t.content }));

		const ctrl = new AbortController();
		this.inFlight = ctrl;
		this.setBusy(true);

		try {
			for await (const delta of runTurn(messages, provider, {
				signal: ctrl.signal,
				systemPrompt: settings.systemPrompt,
			})) {
				if (delta.degraded) assistantTurn.degraded = true;
				assistantTurn.content += delta.text;
				this.renderTranscript();
			}
		} catch (err) {
			this.applyErrorToTurn(assistantTurn, err);
		} finally {
			if (ctrl.signal.aborted) assistantTurn.interrupted = true;
			this.inFlight = null;
			this.setBusy(false);
			this.renderTranscript();
		}
	}

	private handleStop(): void {
		if (!this.inFlight) return;
		this.inFlight.abort();
		new Notice("Stopped");
	}

	private setBusy(busy: boolean): void {
		this.stopBtn.disabled = !busy;
		this.sendBtn.disabled = busy || !isConfigured(this.getSettings());
		this.inputEl.disabled = busy;
	}

	private applyErrorToTurn(turn: UiTurn, err: unknown): void {
		if (err instanceof AuthError) {
			turn.error = "Authentication failed — check your API key.";
			turn.authError = true;
			return;
		}
		if (err instanceof RateLimitError) {
			turn.error = "Rate-limited by the provider. Try again shortly.";
			return;
		}
		if (err instanceof NetworkError) {
			turn.error = "Network error. Check your connection or endpoint and retry.";
			return;
		}
		if (err instanceof ProviderError) {
			turn.error = `Provider error: ${err.message}`;
			return;
		}
		turn.error = err instanceof Error ? err.message : "Unknown error.";
	}

	private renderTranscript(): void {
		this.transcriptEl.empty();
		for (const turn of this.turns) {
			const row = this.transcriptEl.createDiv({ cls: `ai-agent-turn ai-agent-turn-${turn.role}` });
			row.createEl("div", { cls: "ai-agent-turn-role", text: turn.role === "user" ? "You" : "Assistant" });
			const body = row.createEl("div", { cls: "ai-agent-turn-body" });
			body.setText(turn.content);
			if (turn.degraded) {
				row.createEl("div", {
					cls: "ai-agent-turn-meta",
					text: "non-streaming response — your endpoint blocks browser CORS",
				});
			}
			if (turn.interrupted) {
				row.createEl("div", { cls: "ai-agent-turn-meta", text: "(interrupted)" });
			}
			if (turn.error) {
				const errEl = row.createEl("div", { cls: "ai-agent-turn-error" });
				errEl.setText(turn.error);
				if (turn.authError) {
					errEl.appendText(" ");
					const link = errEl.createEl("a", { text: "Open settings", href: "#" });
					link.addEventListener("click", (e) => {
						e.preventDefault();
						this.openSettingsTab();
					});
				}
			}
		}
		this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
	}
}
