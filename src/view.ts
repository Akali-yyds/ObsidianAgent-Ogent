import { type App, ItemView, MarkdownRenderer, Modal, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type { ConsentChoice, ConsentManager } from "./consent/manager";
import type { UndoBuffer } from "./consent/undo";
import { diffLines, type DiffRow } from "./consent/diff";
import { renderRows } from "./consent/render-diff";
import { runTurn } from "./loop";
import { isMobile } from "./platform";
import { OpenAICompatibleProvider } from "./provider";
import { PackConfigError, PackRunError, type PackRuntimeEvent, type PackRunResult, type PackRunTransparency } from "./packs/runtime";
import type { AgentPack } from "./packs/types";
import { isConfigured, type PluginSettings } from "./settings";
import type {
	SessionStore,
	StoredPackClaim,
	StoredPackProgressStep,
	StoredPackTurnData,
	StoredTurn,
} from "./sessions";
import { splitFrontmatter, mergeFrontmatter, stitchFrontmatter } from "./tools/vault/frontmatter";
import type { ToolRegistry } from "./tools/registry";
import { AuthError, type ChatMessage, NetworkError, ProviderError, RateLimitError, type ToolResult } from "./types";

export const CHAT_VIEW_TYPE = "open-agent-chat";

class ConfirmActionModal extends Modal {
	private resolvePrompt: (confirmed: boolean) => void = () => undefined;
	private decided = false;

	constructor(
		app: App,
		private readonly titleText: string,
		private readonly message: string,
		private readonly confirmText: string,
	) {
		super(app);
	}

	prompt(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			this.resolvePrompt = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.titleText });
		contentEl.createEl("p", { text: this.message });

		const buttons = contentEl.createDiv({ cls: "open-agent-edit-buttons" });
		buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.decide(false));
		buttons.createEl("button", { text: this.confirmText, cls: "mod-warning" })
			.addEventListener("click", () => this.decide(true));
	}

	onClose(): void {
		if (!this.decided) this.resolvePrompt(false);
		this.contentEl.empty();
	}

	private decide(confirmed: boolean): void {
		this.decided = true;
		this.resolvePrompt(confirmed);
		this.close();
	}
}

interface ToolCallRecord {
	id: string;
	name: string;
	args: unknown;
	mutates: boolean;
	status: "running" | "awaiting-consent" | "ok" | "error" | "denied";
	result?: ToolResult;
	diffRows?: DiffRow[]; // undefined = not yet computed; [] = computed, nothing to show
}

type AssistantSegment = { kind: "text"; text: string } | { kind: "tool"; id: string };

interface UiTurn {
	role: "user" | "assistant";
	content: string; // user turns only
	segments: AssistantSegment[]; // assistant turns: text and tool cards in order
	toolCallMap: Record<string, ToolCallRecord>; // assistant turns: looked up by id
	thinking: boolean; // true until first content arrives
	interrupted?: boolean;
	degraded?: boolean;
	error?: string;
	authError?: boolean;
	capHit?: boolean;
	packTurn?: StoredPackTurnData;
}

export interface ChatViewDeps {
	getSettings: () => PluginSettings;
	openSettings: () => void;
	tools: ToolRegistry;
	consent: ConsentManager;
	undo: UndoBuffer;
	sessionStore: SessionStore;
	getPacks: () => Promise<AgentPack[]>;
	runPack: (
		pack: AgentPack,
		query: string,
		signal?: AbortSignal,
		onEvent?: (event: PackRuntimeEvent) => void | Promise<void>,
	) => Promise<PackRunResult>;
}

export class ChatView extends ItemView {
	private readonly deps: ChatViewDeps;

	private transcriptEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private stopBtn!: HTMLButtonElement;
	private hintEl!: HTMLElement;

	// Header elements
	private sessionTitleEl!: HTMLElement;
	private sessionRenameEl!: HTMLInputElement;
	private sessionsPanelEl!: HTMLElement;
	private sessionsListEl!: HTMLElement;
	private sessionsSearchEl!: HTMLInputElement;
	private modelInputEl!: HTMLInputElement;
	private modelDatalistEl!: HTMLElement;
	private modeSelectEl!: HTMLSelectElement;
	private packSummaryEl!: HTMLElement;
	private packHintEl!: HTMLElement;
	private packRecoveryEl!: HTMLElement;
	private packMobileBannerEl!: HTMLElement;
	private sessionRecoveryEl!: HTMLElement;

	private turns: UiTurn[] = [];
	private readonly inFlights = new Map<string, AbortController>();
	// Live in-memory turns for sessions currently streaming (so switching back restores them)
	private readonly liveTurns = new Map<string, UiTurn[]>();
	private boundOnSettingsChanged: () => void;
	private readonly diffComputedIds = new Set<string>();

	// Render debounce state
	private renderDebounceTimer: number | null = null;
	private lastRenderTime = 0;

	// Panel state
	private sessionsPanelVisible = false;
	private availablePacks: AgentPack[] = [];
	private activePackError: string | null = null;
	private readonly agentWorkExpandedCard = new WeakMap<StoredPackTurnData, string | null>();

	// Rename state
	private isRenaming = false;
	private preRenameTitle = "";

	// Edit state
	private editingTurnIndex: number | null = null;
	private editingText = "";

	constructor(leaf: WorkspaceLeaf, deps: ChatViewDeps) {
		super(leaf);
		this.deps = deps;
		this.boundOnSettingsChanged = () => {
			this.refreshConfiguredState();
			void this.populateModelDatalist();
		};
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}
	getDisplayText(): string {
		return "Open agent";
	}
	getIcon(): string {
		return "bot";
	}

	prefillInput(text: string): void {
		this.inputEl.value = text;
		this.inputEl.focus();
		this.inputEl.setSelectionRange(text.length, text.length);
	}

	onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("open-agent-view");

		this.hintEl = root.createDiv({ cls: "open-agent-hint" });
		this.buildHeader(root);
		this.transcriptEl = root.createDiv({ cls: "open-agent-transcript" });

		const composer = root.createDiv({ cls: "open-agent-composer" });
		this.inputEl = composer.createEl("textarea", {
			cls: "open-agent-input",
			attr: { rows: "3", placeholder: "Ask the agent…" },
		});
		this.inputEl.addEventListener("keydown", (e) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				e.preventDefault();
				void this.handleSend();
			}
		});

		const buttons = composer.createDiv({ cls: "open-agent-buttons" });
		this.sendBtn = buttons.createEl("button", { text: "Send", cls: "mod-cta" });
		this.sendBtn.addEventListener("click", () => void this.handleSend());
		this.stopBtn = buttons.createEl("button", { text: "Stop" });
		this.stopBtn.addEventListener("click", () => this.handleStop());
		this.stopBtn.disabled = true;

		window.addEventListener("open-agent:settings-changed", this.boundOnSettingsChanged);

		// Load active session turns
		const session = this.deps.sessionStore.getActive();
		this.turns = this.storedToUiTurns(session.turns);

		this.refreshConfiguredState();
		void this.populateModelDatalist();
		void this.refreshPacks();
		this.renderTranscript();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		window.removeEventListener("open-agent:settings-changed", this.boundOnSettingsChanged);
		this.cancelInFlight();
		this.deps.consent.resetSession();
		this.deps.undo.clear();
		return Promise.resolve();
	}

	cancelInFlight(): void {
		for (const ctrl of this.inFlights.values()) ctrl.abort();
		this.inFlights.clear();
	}

	// ─── Header ──────────────────────────────────────────────────────────────

	private buildHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: "open-agent-header" });

		// Session bar
		const sessionBar = header.createDiv({ cls: "open-agent-session-bar" });

		// Clickable title → inline rename
		this.sessionTitleEl = sessionBar.createEl("span", { cls: "open-agent-session-title" });
		this.sessionTitleEl.addEventListener("click", () => this.startRename());

		// Rename input (hidden by default)
		this.sessionRenameEl = sessionBar.createEl("input", {
			cls: "open-agent-session-rename",
			attr: { type: "text" },
		});
		this.sessionRenameEl.addClass("is-hidden");
		this.sessionRenameEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.finishRename();
			if (e.key === "Escape") this.cancelRename();
		});
		this.sessionRenameEl.addEventListener("blur", () => this.finishRename());

		// Sessions toggle button
		const sessionsToggle = sessionBar.createEl("button", { text: "≡", cls: "open-agent-sessions-toggle" });
		sessionsToggle.setAttribute("aria-label", "Browse sessions");
		sessionsToggle.addEventListener("click", () => this.toggleSessionsPanel());

		// New session button
		const newBtn = sessionBar.createEl("button", { text: "+ New", cls: "open-agent-session-new" });
		newBtn.addEventListener("click", () => { void this.createSession(); });

		// Delete session button
		const deleteBtn = sessionBar.createEl("button", { text: "Delete", cls: "open-agent-session-delete" });
		deleteBtn.addEventListener("click", () => { void this.deleteActiveSession(); });

		// Sessions panel (hidden by default)
		this.sessionsPanelEl = header.createDiv({ cls: "open-agent-sessions-panel" });
		this.sessionsPanelEl.addClass("is-hidden");

		this.sessionsSearchEl = this.sessionsPanelEl.createEl("input", {
			cls: "open-agent-sessions-search",
			attr: { type: "text", placeholder: "Search sessions…" },
		});
		this.sessionsSearchEl.addEventListener("input", () => {
			this.refreshSessionsList(this.sessionsSearchEl.value);
		});

		this.sessionsListEl = this.sessionsPanelEl.createDiv({ cls: "open-agent-sessions-list" });

		const modeBar = header.createDiv({ cls: "open-agent-mode-bar" });
		modeBar.createEl("span", { text: "Mode:", cls: "open-agent-model-label" });
		this.modeSelectEl = modeBar.createEl("select", { cls: "open-agent-mode-select" });
		this.modeSelectEl.addEventListener("change", () => { void this.handleModeChange(); });

		// Model bar
		const modelBar = header.createDiv({ cls: "open-agent-model-bar" });
		modelBar.createEl("span", { text: "Model:", cls: "open-agent-model-label" });

		const datalistId = "open-agent-model-list";
		this.modelInputEl = modelBar.createEl("input", {
			cls: "open-agent-model-input",
			attr: { type: "text", list: datalistId },
		});
		this.modelInputEl.addEventListener("change", () => { void this.handleModelChange(); });
		this.modelInputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.modelInputEl.blur();
		});

		this.modelDatalistEl = modelBar.createEl("datalist", { attr: { id: datalistId } });
		this.packSummaryEl = header.createDiv({ cls: "open-agent-pack-summary" });
		this.packHintEl = header.createDiv({ cls: "open-agent-pack-hint", text: "Applies to future turns in this chat." });
		this.packRecoveryEl = header.createDiv({ cls: "open-agent-pack-recovery" });
		this.packMobileBannerEl = header.createDiv({ cls: "open-agent-pack-mobile-banner" });
		this.sessionRecoveryEl = header.createDiv({ cls: "open-agent-session-recovery" });

		this.refreshHeader();
	}

	private refreshHeader(): void {
		const active = this.deps.sessionStore.getActive();
		const settings = this.deps.getSettings();
		this.sessionTitleEl.setText(active.title);
		this.modelInputEl.value = active.lastClassicModel?.trim().length ? active.lastClassicModel : (active.model.trim().length > 0 ? active.model : settings.model);

		this.modeSelectEl.empty();
		this.modeSelectEl.createEl("option", { value: "", text: "Classic" });
		for (const pack of this.getSelectablePacks()) {
			this.modeSelectEl.createEl("option", { value: pack.id, text: pack.name });
		}
		this.modeSelectEl.value = active.selectedPackId ?? "";

		const activePack = this.getActivePack();
		const packMode = Boolean(active.selectedPackId);
		const mobileBlocked = packMode && this.isMobileBlockedPack();
		const sessionRecovery = active.recovery;
		this.packSummaryEl.empty();
		this.packRecoveryEl.empty();
		this.packMobileBannerEl.empty();
		this.sessionRecoveryEl.empty();

		if (this.modelInputEl.parentElement) {
			this.modelInputEl.parentElement.classList.toggle("is-hidden", packMode);
		}
		this.packSummaryEl.classList.toggle("is-hidden", !packMode);
		this.packHintEl.classList.toggle("is-hidden", !packMode);

		if (activePack) {
			this.packSummaryEl.createEl("div", { cls: "open-agent-pack-name", text: activePack.name });
			this.packSummaryEl.createEl("div", {
				cls: "open-agent-pack-models",
				text:
					`Retriever — ${activePack.providers.retriever?.model ?? "n/a"}; ` +
					`Synthesizer — ${activePack.providers.synthesizer?.model ?? "n/a"}; ` +
					`Verifier — ${activePack.providers.verifier?.model ?? "n/a"}`,
			});
		}

		if (mobileBlocked) {
			this.packMobileBannerEl.createEl("div", {
				cls: "open-agent-pack-banner",
				text: "Grounded Research is available on desktop only for now.",
			});
			const classicBtn = this.packMobileBannerEl.createEl("button", { text: "Use Classic mode" });
			classicBtn.addEventListener("click", () => {
				void this.switchToClassicMode();
			});
		}

		if (this.activePackError) {
			this.packRecoveryEl.createEl("div", { cls: "open-agent-pack-banner open-agent-pack-banner-error", text: this.activePackError });
			const classicBtn = this.packRecoveryEl.createEl("button", { text: "Use Classic mode" });
			classicBtn.addEventListener("click", () => {
				void this.switchToClassicMode();
			});
			if (this.getSelectablePacks().length > 0) {
				const chooseBtn = this.packRecoveryEl.createEl("button", { text: "Choose another pack" });
				chooseBtn.addEventListener("click", () => {
					this.modeSelectEl.focus();
				});
			}
		}

		if (sessionRecovery) {
			this.sessionRecoveryEl.createEl("div", {
				cls: "open-agent-pack-banner open-agent-pack-banner-error",
				text: sessionRecovery.message,
			});
		}
	}

	private async createSession(): Promise<void> {
		await this.deps.sessionStore.create();
		this.turns = [];
		this.deps.undo.clear();
		this.refreshHeader();
		this.renderTranscript();
	}

	private async deleteActiveSession(): Promise<void> {
		const confirmed = await new ConfirmActionModal(
			this.app,
			"Delete session?",
			"This will permanently remove the current session history.",
			"Delete",
		).prompt();
		if (!confirmed) return;
		const id = this.deps.sessionStore.getActive().id;
		await this.deps.sessionStore.delete(id);
		const session = this.deps.sessionStore.getActive();
		this.turns = this.storedToUiTurns(session.turns);
		this.deps.undo.clear();
		this.refreshHeader();
		this.renderTranscript();
	}

	private async handleModeChange(): Promise<void> {
		const session = this.deps.sessionStore.getActive();
		const nextPackId = this.modeSelectEl.value || null;
		const currentClassicModel = this.modelInputEl.value.trim() || session.lastClassicModel || session.model;
		this.activePackError = null;
		await this.deps.sessionStore.updateSelectedPack(session.id, nextPackId, currentClassicModel);
		this.refreshHeader();
		this.refreshConfiguredState();
	}

	private async handleModelChange(): Promise<void> {
		const model = this.modelInputEl.value.trim();
		const session = this.deps.sessionStore.getActive();
		await this.deps.sessionStore.updateModel(session.id, model);
	}

	private async refreshPacks(): Promise<void> {
		try {
			this.availablePacks = await this.deps.getPacks();
		} catch (error) {
			this.availablePacks = [];
			this.activePackError = error instanceof Error ? error.message : String(error);
		}
		this.refreshHeader();
		this.refreshConfiguredState();
	}

	private getSelectablePacks(): AgentPack[] {
		return this.availablePacks.filter((pack) => !isMobile() || pack.support.mobile);
	}

	private getActivePack(): AgentPack | null {
		const selectedPackId = this.deps.sessionStore.getActive().selectedPackId;
		if (!selectedPackId) return null;
		return this.availablePacks.find((pack) => pack.id === selectedPackId) ?? null;
	}

	private isMobileBlockedPack(): boolean {
		const activePack = this.getActivePack();
		return Boolean(activePack && isMobile() && !activePack.support.mobile);
	}

	private async switchToClassicMode(): Promise<void> {
		const session = this.deps.sessionStore.getActive();
		await this.deps.sessionStore.updateSelectedPack(
			session.id,
			null,
			this.modelInputEl.value.trim() || session.lastClassicModel || session.model,
		);
		this.activePackError = null;
		this.refreshHeader();
		this.refreshConfiguredState();
	}

	private toggleSessionsPanel(): void {
		this.setSessionsPanelVisible(!this.sessionsPanelVisible);
		if (this.sessionsPanelVisible) {
			this.sessionsSearchEl.value = "";
			this.refreshSessionsList("");
			this.sessionsSearchEl.focus();
		}
	}

	private setSessionsPanelVisible(visible: boolean): void {
		this.sessionsPanelVisible = visible;
		this.sessionsPanelEl.classList.toggle("is-hidden", !visible);
	}

	private refreshSessionsList(filter: string): void {
		this.sessionsListEl.empty();
		const sessions = this.deps.sessionStore.getSessions()
			.slice()
			.sort((a, b) => b.updatedAt - a.updatedAt);
		const q = filter.trim().toLowerCase();
		const filtered = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions;
		const activeId = this.deps.sessionStore.getActive().id;

		for (const s of filtered) {
			const isBusySession = this.inFlights.has(s.id);
			const item = this.sessionsListEl.createDiv({
				cls: "open-agent-session-item" +
					(s.id === activeId ? " open-agent-session-item-active" : "") +
					(isBusySession ? " open-agent-session-item-busy" : ""),
			});
			item.createEl("span", { text: s.title, cls: "open-agent-session-item-title" });
			if (isBusySession) {
				item.createEl("span", { cls: "open-agent-session-activity" });
			}
			item.addEventListener("click", () => { void this.switchToSession(s.id); });
		}

		if (filtered.length === 0) {
			this.sessionsListEl.createDiv({ cls: "open-agent-sessions-empty", text: "No sessions found" });
		}
	}

	private startRename(): void {
		if (this.isRenaming) return;
		const session = this.deps.sessionStore.getActive();
		this.preRenameTitle = session.title;
		this.sessionRenameEl.value = session.title;
		this.setRenameMode(true);
		this.sessionRenameEl.focus();
		this.sessionRenameEl.select();
	}

	private finishRename(): void {
		if (!this.isRenaming) return;
		const newTitle = this.sessionRenameEl.value.trim();
		const session = this.deps.sessionStore.getActive();
		const title = newTitle.length > 0 ? newTitle : this.preRenameTitle;
		this.sessionTitleEl.setText(title);
		this.setRenameMode(false);
		if (title !== session.title) {
			void this.deps.sessionStore.rename(session.id, title);
		}
	}

	private cancelRename(): void {
		if (!this.isRenaming) return;
		this.sessionRenameEl.value = this.preRenameTitle;
		this.setRenameMode(false);
	}

	private setRenameMode(enabled: boolean): void {
		this.isRenaming = enabled;
		this.sessionTitleEl.classList.toggle("is-hidden", enabled);
		this.sessionRenameEl.classList.toggle("is-hidden", !enabled);
	}

	private async switchToSession(sessionId: string): Promise<void> {
		this.setSessionsPanelVisible(false);
		await this.deps.sessionStore.switchTo(sessionId);
		const session = this.deps.sessionStore.getActive();
		// Prefer live in-memory turns (stream still running) over stale stored state
		this.turns = this.liveTurns.get(sessionId) ?? this.storedToUiTurns(session.turns);
		this.deps.undo.clear();
		this.refreshHeader();
		this.refreshBusyState();
		this.renderTranscript();
	}

	private async populateModelDatalist(): Promise<void> {
		const settings = this.deps.getSettings();
		if (!isConfigured(settings)) return;
		const provider = new OpenAICompatibleProvider({
			baseUrl: settings.baseUrl,
			apiKey: settings.apiKey,
			model: settings.model,
		});
		const models = await provider.listModels();
		this.modelDatalistEl.empty();
		for (const m of models) {
			this.modelDatalistEl.createEl("option", { attr: { value: m } });
		}
	}

	// ─── Render debounce ─────────────────────────────────────────────────────

	private scheduleRender(): void {
		const now = Date.now();
		const elapsed = now - this.lastRenderTime;
		if (elapsed >= 50) {
			this.lastRenderTime = now;
			this.renderTranscript();
			return;
		}
		if (this.renderDebounceTimer !== null) return;
		this.renderDebounceTimer = window.setTimeout(() => {
			this.renderDebounceTimer = null;
			this.lastRenderTime = Date.now();
			this.renderTranscript();
		}, 50 - elapsed);
	}

	// ─── Session helpers ──────────────────────────────────────────────────────

	private storedToUiTurns(stored: StoredTurn[]): UiTurn[] {
		return stored.map((st) => {
			if (st.role === "user") {
				return { role: "user", content: st.content, segments: [], toolCallMap: {}, thinking: false } as UiTurn;
			}
			if (st.packTurn) {
				return {
					role: "assistant",
					content: "",
					segments: [],
					toolCallMap: {},
					thinking: false,
					packTurn: st.packTurn,
					error: st.packTurn.error,
				} as UiTurn;
			}
			return {
				role: "assistant",
				content: "",
				segments: [{ kind: "text" as const, text: st.content }],
				toolCallMap: {},
				thinking: false,
			} as UiTurn;
		});
	}

	private uiToStoredTurns(turns: UiTurn[]): StoredTurn[] {
		const result: StoredTurn[] = [];
		for (const t of turns) {
			if (t.role === "user" && t.content.length > 0) {
				result.push({ role: "user", content: t.content });
			} else if (t.role === "assistant") {
				if (t.packTurn) {
					result.push({ role: "assistant", content: "", packTurn: t.packTurn });
					continue;
				}
				const text = t.segments
					.filter((s): s is { kind: "text"; text: string } => s.kind === "text")
					.map((s) => s.text)
					.join("");
				if (text.length > 0) result.push({ role: "assistant", content: text });
			}
		}
		return result;
	}

	// ─── Configured / busy state ──────────────────────────────────────────────

	private refreshConfiguredState(): void {
		this.hintEl.empty();
		const classicConfigured = isConfigured(this.deps.getSettings());
		const packMode = Boolean(this.deps.sessionStore.getActive().selectedPackId);
		if (!packMode && !classicConfigured) {
			this.hintEl.appendText("Provider not configured. ");
			const link = this.hintEl.createEl("a", { text: "Open settings", href: "#" });
			link.addEventListener("click", (e) => {
				e.preventDefault();
				this.deps.openSettings();
			});
		}
		if (this.modelInputEl) this.refreshHeader();
		this.refreshBusyState();
	}

	private refreshBusyState(): void {
		const activeId = this.deps.sessionStore.getActive().id;
		const busy = this.inFlights.has(activeId);
		const packMode = Boolean(this.deps.sessionStore.getActive().selectedPackId);
		const activePack = this.getActivePack();
		const classicOk = isConfigured(this.deps.getSettings());
		const packOk = packMode ? Boolean(activePack) && !this.isMobileBlockedPack() : false;
		this.sendBtn.disabled = !(packMode ? packOk : classicOk) || busy;
		this.stopBtn.disabled = !busy;
		this.inputEl.disabled = busy;
		this.sendBtn.textContent = packMode ? "Run research" : "Send";
		if (this.sessionsPanelVisible) {
			this.refreshSessionsList(this.sessionsSearchEl.value);
		}
	}

	// ─── Send / stop ──────────────────────────────────────────────────────────

	private async handleSend(): Promise<void> {
		if (this.deps.sessionStore.getActive().selectedPackId) {
			await this.handlePackSend();
			return;
		}
		await this.handleClassicSend();
	}

	private async handleClassicSend(): Promise<void> {
		const text = this.inputEl.value.trim();
		if (!text) return;
		const settings = this.deps.getSettings();
		if (!isConfigured(settings)) {
			this.refreshConfiguredState();
			return;
		}

		const session = this.deps.sessionStore.getActive();
		const sessionId = session.id;
		const isFirstMessage = session.turns.length === 0 && session.title === "New chat";

		this.turns.push({ role: "user", content: text, segments: [], toolCallMap: {}, thinking: false });
		const assistantTurn: UiTurn = { role: "assistant", content: "", segments: [], toolCallMap: {}, thinking: true };
		this.turns.push(assistantTurn);
		// Snapshot the turns array reference so the finally block always saves to the right session
		// even if this.turns is replaced by a session switch mid-flight.
		const turnSnapshot = this.turns;
		this.inputEl.value = "";

		// Mark session busy immediately — before any awaits — so the input is disabled and
		// a second Send press cannot race with the in-progress request.
		const ctrl = new AbortController();
		this.inFlights.set(sessionId, ctrl);
		this.liveTurns.set(sessionId, turnSnapshot);
		this.refreshBusyState();
		this.renderTranscript();

		// Read model directly from input element to catch values not yet flushed via change event.
		const inputModel = this.modelInputEl.value.trim();
		const sessionModel = session.model.trim();
		const model = (inputModel.length > 0 ? inputModel : sessionModel) || settings.model;

		// Fire-and-forget housekeeping that runs before the loop but doesn't block the busy state.
		if (isFirstMessage) {
			await this.deps.sessionStore.rename(sessionId, text.slice(0, 60));
			this.refreshHeader();
		}
		if (inputModel.length > 0 && inputModel !== sessionModel) {
			await this.deps.sessionStore.updateModel(sessionId, inputModel);
		}

		const provider = new OpenAICompatibleProvider({
			baseUrl: settings.baseUrl,
			apiKey: settings.apiKey,
			model,
		});

		// Build the message history from prior user/assistant exchanges (skip the placeholder assistantTurn).
		const messages: ChatMessage[] = [];
		for (const t of turnSnapshot) {
			if (t === assistantTurn) continue;
			if (t.role === "user") {
				messages.push({ role: "user", content: t.content });
			} else if (t.role === "assistant") {
				const assistantText = t.segments
					.filter((s): s is { kind: "text"; text: string } => s.kind === "text")
					.map((s) => s.text)
					.join("");
				if (assistantText.length > 0) messages.push({ role: "assistant", content: assistantText });
			}
		}

		// Persist the user message immediately so switching back to this session
		// shows the question even while the stream is still in-flight.
		await this.deps.sessionStore.updateTurns(
			sessionId,
			this.uiToStoredTurns(turnSnapshot.filter((t) => t !== assistantTurn)),
		);

		try {
			for await (const ev of runTurn(messages, provider, {
				signal: ctrl.signal,
				systemPrompt: settings.systemPrompt,
				tools: this.deps.tools,
				consent: this.deps.consent,
			})) {
				if (ev.kind === "text") {
					if (ev.degraded) assistantTurn.degraded = true;
					assistantTurn.thinking = false;
					const lastSeg = assistantTurn.segments[assistantTurn.segments.length - 1];
					if (lastSeg?.kind === "text") {
						lastSeg.text += ev.text;
					} else {
						assistantTurn.segments.push({ kind: "text", text: ev.text });
					}
					// Only update the UI if the user is still viewing this session's turns.
					if (this.turns.includes(assistantTurn)) this.scheduleRender();
					// Yield to the browser so it can repaint between token chunks.
					await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
					continue;
				} else if (ev.kind === "tool_call_started") {
					assistantTurn.thinking = false;
					const record: ToolCallRecord = {
						id: ev.id,
						name: ev.name,
						args: ev.args,
						mutates: ev.mutates,
						status: "running",
					};
					assistantTurn.toolCallMap[ev.id] = record;
					assistantTurn.segments.push({ kind: "tool", id: ev.id });
				} else if (ev.kind === "consent_requested") {
					const tc = assistantTurn.toolCallMap[ev.id];
					if (tc) tc.status = "awaiting-consent";
				} else if (ev.kind === "tool_call_finished") {
					const tc = assistantTurn.toolCallMap[ev.id];
					if (tc) {
						tc.result = ev.result;
						if (ev.result.ok) tc.status = "ok";
						else if (ev.result.error.startsWith("ConsentDeniedError")) tc.status = "denied";
						else tc.status = "error";
					}
					// Show thinking indicator while the model processes tool results.
					assistantTurn.thinking = true;
				} else if (ev.kind === "cap_hit") {
					assistantTurn.capHit = true;
				}
				if (this.turns.includes(assistantTurn)) this.scheduleRender();
			}
		} catch (err) {
			this.applyErrorToTurn(assistantTurn, err);
		} finally {
			if (this.renderDebounceTimer !== null) {
				window.clearTimeout(this.renderDebounceTimer);
				this.renderDebounceTimer = null;
			}
			if (ctrl.signal.aborted) {
				assistantTurn.interrupted = true;
				this.deps.consent.cancelPendingConsent();
			}
			this.inFlights.delete(sessionId);
			this.liveTurns.delete(sessionId);
			this.refreshBusyState();
			// Only re-render if the user is still viewing this session; otherwise leave the
			// active session's transcript undisturbed.
			if (this.turns.includes(assistantTurn)) this.renderTranscript();
			// Always persist — uses turnSnapshot so session switches don't corrupt the wrong session.
			await this.deps.sessionStore.updateTurns(sessionId, this.uiToStoredTurns(turnSnapshot));
		}
	}

	private async handlePackSend(): Promise<void> {
		const text = this.inputEl.value.trim();
		if (!text) return;
		const pack = this.getActivePack();
		if (!pack) {
			this.activePackError = "Selected pack could not be loaded. Choose another pack or use Classic mode.";
			this.refreshHeader();
			this.refreshBusyState();
			return;
		}
		if (this.isMobileBlockedPack()) {
			this.refreshHeader();
			this.refreshBusyState();
			return;
		}

		const session = this.deps.sessionStore.getActive();
		const sessionId = session.id;
		const isFirstMessage = session.turns.length === 0 && session.title === "New chat";
		this.activePackError = null;

		this.turns.push({ role: "user", content: text, segments: [], toolCallMap: {}, thinking: false });
		const assistantTurn: UiTurn = {
			role: "assistant",
			content: "",
			segments: [],
			toolCallMap: {},
			thinking: false,
			packTurn: {
				packId: pack.id,
				packName: pack.name,
				progressSteps: pack.steps.map((step) => ({
					id: step.id,
					label: step.label,
					state: "pending",
				})),
				retryingStepId: null,
			},
		};
		this.turns.push(assistantTurn);
		const turnSnapshot = this.turns;
		this.inputEl.value = "";

		const ctrl = new AbortController();
		this.inFlights.set(sessionId, ctrl);
		this.liveTurns.set(sessionId, turnSnapshot);
		this.refreshBusyState();
		this.renderTranscript();

		if (isFirstMessage) {
			await this.deps.sessionStore.rename(sessionId, text.slice(0, 60));
			this.refreshHeader();
		}

		await this.deps.sessionStore.updateTurns(
			sessionId,
			this.uiToStoredTurns(turnSnapshot.filter((turn) => turn !== assistantTurn)),
		);

		try {
			const result = await this.deps.runPack(pack, text, ctrl.signal, async (event) => {
				if (!assistantTurn.packTurn) return;
				this.applyPackEvent(assistantTurn.packTurn, event);
				if (this.turns.includes(assistantTurn)) this.scheduleRender();
			});
			if (assistantTurn.packTurn) {
				assistantTurn.packTurn.verifiedSummary = result.verifiedSummary;
				assistantTurn.packTurn.claims = result.claims.map((claim) => ({
					id: claim.id,
					text: claim.text,
					sourceNote: claim.sourceNote,
					sourceQuote: claim.sourceQuote,
					quotePresent: claim.quotePresent,
					supportsClaim: claim.supportsClaim,
					supportExplanation: claim.supportExplanation,
					status: claim.status,
				}));
				assistantTurn.packTurn.agentWork = result.transparency;
				assistantTurn.packTurn.modelsUsed = result.modelsUsed;
				assistantTurn.error = undefined;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (assistantTurn.packTurn) {
				assistantTurn.packTurn.error = message;
				if (error instanceof PackRunError) {
					assistantTurn.packTurn.agentWork = error.failure.transparency;
					assistantTurn.packTurn.modelsUsed = error.failure.modelsUsed;
					if (error.failure.artifacts.verifications) {
						assistantTurn.packTurn.claims = error.failure.artifacts.verifications.map((claim) => ({
							id: claim.id,
							text: claim.text,
							sourceNote: claim.sourceNote,
							sourceQuote: claim.sourceQuote,
							quotePresent: claim.quotePresent,
							supportsClaim: claim.supportsClaim,
							supportExplanation: claim.supportExplanation,
							status: claim.status,
						}));
					}
				}
				markPackFailed(assistantTurn.packTurn.progressSteps ?? []);
			}
			assistantTurn.error = message;
			this.activePackError = this.formatPackRecoveryMessage(pack.name, error);
			this.refreshHeader();
		} finally {
			if (this.renderDebounceTimer !== null) {
				window.clearTimeout(this.renderDebounceTimer);
				this.renderDebounceTimer = null;
			}
			if (ctrl.signal.aborted) {
				assistantTurn.interrupted = true;
			}
			this.inFlights.delete(sessionId);
			this.liveTurns.delete(sessionId);
			this.refreshBusyState();
			if (this.turns.includes(assistantTurn)) this.renderTranscript();
			await this.deps.sessionStore.updateTurns(sessionId, this.uiToStoredTurns(turnSnapshot));
		}
	}

	private handleStop(): void {
		const activeId = this.deps.sessionStore.getActive().id;
		const ctrl = this.inFlights.get(activeId);
		if (!ctrl) return;
		ctrl.abort();
		this.deps.consent.cancelPendingConsent();
		new Notice("Stopped");
	}

	private applyErrorToTurn(turn: UiTurn, err: unknown): void {
		turn.thinking = false;
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

	private applyPackEvent(packTurn: StoredPackTurnData, event: PackRuntimeEvent): void {
		if (event.kind === "step") {
			packTurn.progressSteps = updatePackProgress(packTurn.progressSteps ?? [], event.step);
			if (event.step.state !== "running") packTurn.retryingStepId = null;
			if (event.step.state === "failed" && event.step.message) {
				packTurn.error = event.step.message;
			}
			if (event.agentWork) {
				packTurn.agentWork = event.agentWork;
			}
			return;
		}
		packTurn.retryingStepId = event.stepId;
	}

	private formatPackRecoveryMessage(packName: string, error: unknown): string {
		if (error instanceof PackConfigError) {
			return `${packName} couldn’t start. Check the pack’s provider and model settings, then retry or switch to Classic mode. (${error.message})`;
		}
		if (error instanceof AuthError) {
			return `${packName} couldn’t authenticate. Check the pack’s API key, then retry or switch to Classic mode.`;
		}
		if (error instanceof RateLimitError) {
			return `${packName} hit the provider rate limit. Wait a moment, then retry or switch to Classic mode.`;
		}
		if (error instanceof NetworkError) {
			return `${packName} couldn’t reach its provider. Check the endpoint or local model server, then retry or switch to Classic mode.`;
		}
		if (error instanceof ProviderError) {
			return `${packName} failed in the provider. Check the pack’s endpoint or model settings, then retry or switch to Classic mode. (${error.message})`;
		}
		const message = error instanceof Error ? error.message : String(error);
		return `${packName} couldn’t finish. Retry, choose another pack, or switch to Classic mode. (${message})`;
	}

	// ─── Transcript ───────────────────────────────────────────────────────────

	private renderTranscript(): void {
		const activeId = this.deps.sessionStore.getActive().id;
		const busy = this.inFlights.has(activeId);

		this.transcriptEl.empty();
		for (let i = 0; i < this.turns.length; i++) {
			const turn = this.turns[i];
			const row = this.transcriptEl.createDiv({ cls: `open-agent-turn open-agent-turn-${turn.role}` });

			if (turn.role === "user") {
				// Header row: "You" label + pencil edit button on right
				const headerRow = row.createDiv({ cls: "open-agent-turn-header-row" });
				headerRow.createEl("div", { cls: "open-agent-turn-role", text: "You" });
				if (!busy && i !== this.editingTurnIndex) {
					const pencilBtn = headerRow.createEl("button", { text: "✏", cls: "open-agent-turn-edit-btn" });
					pencilBtn.setAttribute("aria-label", "Edit message");
					pencilBtn.addEventListener("click", () => {
						this.editingTurnIndex = i;
						this.editingText = turn.content;
						this.renderTranscript();
					});
				}

				if (i === this.editingTurnIndex) {
					// Inline edit mode
					const editArea = row.createEl("textarea", {
						cls: "open-agent-turn-edit-area",
						attr: { rows: "3" },
					});
					editArea.value = this.editingText;
					editArea.addEventListener("input", () => { this.editingText = editArea.value; });
					editArea.addEventListener("keydown", (e) => {
						if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
							e.preventDefault();
							void this.submitEdit(i);
						}
						if (e.key === "Escape") {
							this.editingTurnIndex = null;
							this.renderTranscript();
						}
					});
					const editBtns = row.createDiv({ cls: "open-agent-edit-buttons" });
					editBtns.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
						this.editingTurnIndex = null;
						this.renderTranscript();
					});
					editBtns.createEl("button", { text: "Send", cls: "mod-cta" })
						.addEventListener("click", () => void this.submitEdit(i));
					window.requestAnimationFrame(() => {
						editArea.focus();
						editArea.setSelectionRange(editArea.value.length, editArea.value.length);
					});
				} else {
					if (turn.content.length > 0) {
						const body = row.createEl("div", { cls: "open-agent-turn-body" });
						body.setText(turn.content);
					}
				}
			} else {
				// Find preceding user turn index (needed for retry button)
				let userTurnIdx = -1;
				for (let j = i - 1; j >= 0; j--) {
					if (this.turns[j].role === "user") { userTurnIdx = j; break; }
				}

				// Header row: "Assistant" label + retry icon on right (when errored)
				const aHeaderRow = row.createDiv({ cls: "open-agent-turn-header-row" });
				aHeaderRow.createEl("div", { cls: "open-agent-turn-role", text: "Assistant" });
				if (!busy && turn.error && userTurnIdx >= 0) {
					const retryBtn = aHeaderRow.createEl("button", { text: "↺", cls: "open-agent-turn-edit-btn" });
					retryBtn.setAttribute("aria-label", "Retry");
					retryBtn.addEventListener("click", () => {
						const retryText = this.turns[userTurnIdx].content;
						this.turns = this.turns.slice(0, userTurnIdx);
						this.inputEl.value = retryText;
						void this.handleSend();
					});
				}

				if (turn.packTurn) {
					this.renderPackTurn(row, turn.packTurn);
				} else if (turn.thinking) {
					row.createEl("div", { cls: "open-agent-turn-thinking" });
				}
				if (!turn.packTurn) {
					for (const seg of turn.segments) {
						if (seg.kind === "text") {
							if (seg.text.length > 0) {
								const body = row.createEl("div", { cls: "open-agent-turn-body" });
								if (busy) {
									// Plain text during streaming to avoid flicker from async MarkdownRenderer
									body.setText(seg.text);
								} else {
									void MarkdownRenderer.render(this.app, seg.text, body, "", this);
								}
							}
						} else {
							const record = turn.toolCallMap[seg.id];
							if (record) this.renderToolCard(row, record);
						}
					}
				}
			}

			if (turn.degraded) {
				row.createEl("div", {
					cls: "open-agent-turn-meta",
					text: "Non-streaming response — your endpoint does not support streaming.",
				});
			}
			if (turn.capHit) {
				row.createEl("div", { cls: "open-agent-turn-meta", text: "(stopped: hit max-steps cap)" });
			}
			if (turn.interrupted) {
				row.createEl("div", { cls: "open-agent-turn-meta", text: "(interrupted)" });
			}
			if (turn.error) {
				const errEl = row.createEl("div", { cls: "open-agent-turn-error" });
				errEl.setText(turn.error);
				if (turn.authError) {
					errEl.appendText(" ");
					const link = errEl.createEl("a", { text: "Open settings", href: "#" });
					link.addEventListener("click", (e) => { e.preventDefault(); this.deps.openSettings(); });
				}
			}
		}
		this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
	}

	private async submitEdit(turnIndex: number): Promise<void> {
		const text = this.editingText.trim();
		if (!text) return;
		this.editingTurnIndex = null;
		this.turns = this.turns.slice(0, turnIndex);
		this.inputEl.value = text;
		await this.handleSend();
	}

	private renderToolCard(parent: HTMLElement, tc: ToolCallRecord): void {
		const cls = ["open-agent-tool-card"];
		if (tc.mutates) cls.push("open-agent-tool-mutates");
		if (tc.status === "ok") cls.push("open-agent-tool-ok");
		if (tc.status === "error") cls.push("open-agent-tool-error");
		if (tc.status === "denied") cls.push("open-agent-tool-denied");
		if (tc.status === "awaiting-consent") cls.push("open-agent-tool-consent");

		const card = parent.createEl("details", { cls: cls.join(" ") });
		if (tc.status === "awaiting-consent") card.setAttribute("open", "");

		const summary = card.createEl("summary", { cls: "open-agent-tool-summary" });
		summary.createEl("span", { cls: "open-agent-tool-name", text: tc.name });
		summary.createEl("span", { cls: "open-agent-tool-args", text: summarizeArgs(tc.args) });
		summary.createEl("span", { cls: "open-agent-tool-status", text: statusLabel(tc.status) });

		if (tc.status === "awaiting-consent") {
			const diffArea = card.createDiv({ cls: "open-agent-consent-diff-area" });
			if (tc.diffRows === undefined) {
				diffArea.createEl("div", { cls: "open-agent-consent-computing", text: "Computing diff…" });
				this.scheduleDiffComputation(tc);
			} else if (tc.diffRows.length > 0) {
				renderRows(diffArea, tc.diffRows);
			} else {
				diffArea.createEl("div", { cls: "open-agent-consent-computing", text: "(no preview)" });
			}
			const btns = card.createDiv({ cls: "open-agent-consent-inline-buttons" });
			btns.createEl("button", { text: "Reject" })
				.addEventListener("click", () => this.deps.consent.resolveConsent("reject" as ConsentChoice));
			btns.createEl("button", { text: "Approve all this session" })
				.addEventListener("click", () => this.deps.consent.resolveConsent("approve-session" as ConsentChoice));
			btns.createEl("button", { text: "Approve", cls: "mod-cta" })
				.addEventListener("click", () => this.deps.consent.resolveConsent("approve" as ConsentChoice));
			return;
		}

		const argsEl = card.createEl("pre", { cls: "open-agent-tool-args-full" });
		argsEl.setText(safeStringify(tc.args));

		if (tc.result) {
			const resEl = card.createEl("div", { cls: "open-agent-tool-result" });
			const value = tc.result.ok ? tc.result.value : { error: tc.result.error, details: tc.result.details };
			const stringified = safeStringify(value);
			const preview = stringified.slice(0, 2048);
			const pre = resEl.createEl("pre");
			pre.setText(preview);
			if (stringified.length > preview.length) {
				const more = resEl.createEl("button", {
					cls: "open-agent-tool-more",
					text: `Show ${stringified.length - preview.length} more chars`,
				});
				more.addEventListener("click", () => {
					pre.setText(stringified);
					more.remove();
				});
			}
			const path = extractPath(value);
			if (path) {
				const open = resEl.createEl("button", { cls: "open-agent-tool-open", text: `Open ${path}` });
				open.addEventListener("click", () => {
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						const leaf = this.app.workspace.getLeaf(false);
						void leaf.openFile(file);
					} else {
						new Notice(`Not found: ${path}`);
					}
				});
			}
		}
	}

	private renderPackTurn(parent: HTMLElement, packTurn: StoredPackTurnData): void {
			const progress = parent.createDiv({ cls: "open-agent-pack-progress" });
			for (const step of packTurn.progressSteps ?? []) {
				const stepEl = progress.createDiv({ cls: `open-agent-pack-step open-agent-pack-step-${step.state}` });
				stepEl.createEl("div", { cls: "open-agent-pack-step-label", text: step.label });
				if (packTurn.retryingStepId === step.id) {
					stepEl.createEl("div", {
						cls: "open-agent-pack-retry",
						text: "Retrying structured output (1/1)…",
					});
				}
				if (step.state === "failed" && step.message) {
					stepEl.createEl("div", { cls: "open-agent-pack-step-message", text: step.message });
				}
			}

			if (packTurn.verifiedSummary && packTurn.verifiedSummary.trim().length > 0) {
				parent.createEl("div", { cls: "open-agent-pack-section-title", text: "Verified summary" });
				const summaryBody = parent.createDiv({ cls: "open-agent-turn-body" });
				void MarkdownRenderer.render(this.app, packTurn.verifiedSummary, summaryBody, "", this);
			} else if (packTurn.claims && packTurn.claims.length > 0 && packTurn.claims.every((claim) => claim.status !== "verified")) {
				parent.createEl("div", { cls: "open-agent-pack-section-title", text: "Verification failed" });
				parent.createEl("div", {
					cls: "open-agent-pack-step-message",
					text: "No claims could be verified against your notes.",
				});
			}

			if (packTurn.agentWork) {
				this.renderAgentWorkSection(parent, packTurn, packTurn.agentWork);
			}

			const verifiedClaims = (packTurn.claims ?? []).filter((claim) => claim.status === "verified");
			for (const claim of verifiedClaims) {
				this.renderPackClaim(parent, claim);
			}

			const flaggedClaims = (packTurn.claims ?? []).filter((claim) => claim.status !== "verified");
			if (flaggedClaims.length > 0) {
				parent.createEl("div", { cls: "open-agent-pack-section-title", text: "Flagged claims" });
			}
			for (const claim of flaggedClaims) {
				this.renderPackClaim(parent, claim);
			}

			if (packTurn.modelsUsed) {
				parent.createEl("div", {
					cls: "open-agent-pack-model-footer",
					text:
						`Models used: Retriever — ${packTurn.modelsUsed.retriever}; ` +
						`Synthesizer — ${packTurn.modelsUsed.synthesizer}; ` +
						`Verifier — ${packTurn.modelsUsed.verifier}`,
				});
			}
		}

		private renderAgentWorkSection(
			parent: HTMLElement,
			packTurn: StoredPackTurnData,
			agentWork: PackRunTransparency,
		): void {
			parent.createEl("div", { cls: "open-agent-pack-section-title", text: "Agent work" });
			const section = parent.createDiv({ cls: "open-agent-work-section" });
			const cards: Array<{
				id: string;
				toggle: HTMLButtonElement;
				details: HTMLElement;
				interactive: boolean;
			}> = [];
			let expandedCardId = this.agentWorkExpandedCard.get(packTurn);
			if (expandedCardId === undefined) {
				expandedCardId = defaultExpandedAgentWorkCard(agentWork);
				this.agentWorkExpandedCard.set(packTurn, expandedCardId);
			}
			const renderCard = (
				id: string,
				title: string,
				summaryRenderer: (summary: HTMLElement) => boolean,
				detailsRenderer: (details: HTMLElement) => void,
			): void => {
				const card = section.createDiv({ cls: "open-agent-work-card" });
				const header = card.createDiv({ cls: "open-agent-work-header" });
				header.createEl("div", { cls: "open-agent-work-card-title", text: title });
				const summary = header.createDiv({ cls: "open-agent-work-summary" });
				const interactive = summaryRenderer(summary);
				const toggle = header.createEl("button", {
					cls: "open-agent-work-toggle",
					text: interactive && expandedCardId === id ? "Hide details" : "Show details",
				});
				if (!interactive) toggle.disabled = true;
				const details = card.createDiv({ cls: "open-agent-work-details" });
				detailsRenderer(details);
				cards.push({
					id,
					toggle,
					details,
					interactive,
				});
			};

			renderCard(
				"retriever",
				"Retriever",
				(summary) => this.renderRetrieverSummary(summary, packTurn, agentWork),
				(details) => this.renderRetrieverDetails(details, agentWork),
			);
			renderCard(
				"synthesizer",
				"Synthesizer",
				(summary) => this.renderSynthesizerSummary(summary, agentWork),
				(details) => this.renderSynthesizerDetails(details, agentWork),
			);
			renderCard(
				"verifier",
				"Verifier",
				(summary) => this.renderVerifierSummary(summary, agentWork),
				(details) => this.renderVerifierDetails(details, agentWork),
			);
			renderCard(
				"run",
				"Run metadata",
				(summary) => this.renderRunSummary(summary, agentWork),
				(details) => this.renderRunDetails(details, agentWork),
			);

			const setExpanded = (nextId: string | null): void => {
				this.agentWorkExpandedCard.set(packTurn, nextId);
				for (const card of cards) {
					const open = card.interactive && card.id === nextId;
					card.details.classList.toggle("is-hidden", !open);
					card.toggle.textContent = open ? "Hide details" : "Show details";
					card.toggle.classList.toggle("is-active", open);
					card.toggle.disabled = !card.interactive;
				}
			};

			for (const card of cards) {
				card.toggle.addEventListener("click", () => {
					if (!card.interactive) return;
					setExpanded(this.agentWorkExpandedCard.get(packTurn) === card.id ? null : card.id);
				});
			}
			setExpanded(expandedCardId ?? null);
		}

		private renderRetrieverSummary(
			summary: HTMLElement,
			_packTurn: StoredPackTurnData,
			agentWork: PackRunTransparency,
		): boolean {
			const retriever = agentWork.retriever;
			if (!isAgentWorkCardInteractive(retriever.status, agentWork.run.state)) {
				summary.createEl("span", {
					cls: "open-agent-work-muted",
					text: retriever.status === "pending" ? "Waiting for step to finish." : "No data captured",
				});
				return false;
			}
			summary.createEl("span", {
				cls: "open-agent-work-summary-text",
				text: `${retriever.notesFoundCount ?? 0} notes found`,
			});
			for (const path of retriever.topNotePaths ?? []) {
				const button = summary.createEl("button", {
					cls: "open-agent-work-note-path",
					text: path,
				});
				button.addEventListener("click", () => this.openStoredNote(path));
			}
			const extraCount = Math.max(0, (retriever.notesFoundCount ?? 0) - (retriever.topNotePaths?.length ?? 0));
			if (extraCount > 0) {
				summary.createEl("span", {
					cls: "open-agent-work-summary-text open-agent-work-muted",
					text: `+${extraCount} more`,
				});
			}
			return true;
		}

		private renderRetrieverDetails(details: HTMLElement, agentWork: PackRunTransparency): void {
			const retriever = agentWork.retriever;
			if (retriever.status !== "ready") {
				details.createEl("div", {
					cls: "open-agent-work-empty",
					text: retriever.status === "pending" ? "Waiting for step to finish." : "No data captured",
				});
				return;
			}
			details.createEl("div", {
				cls: "open-agent-work-brief",
				text: retriever.brief ?? "",
			});
		}

		private renderSynthesizerSummary(summary: HTMLElement, agentWork: PackRunTransparency): boolean {
			const synthesizer = agentWork.synthesizer;
			if (!isAgentWorkCardInteractive(synthesizer.status, agentWork.run.state)) {
				summary.createEl("span", {
					cls: "open-agent-work-muted",
					text: synthesizer.status === "pending" ? "Waiting for step to finish." : "No data captured",
				});
				return false;
			}
			summary.createEl("span", {
				cls: "open-agent-work-summary-text",
				text: `${synthesizer.claimCount ?? 0} draft claims`,
			});
			summary.createEl("span", {
				cls: "open-agent-work-summary-text",
				text: truncateAgentWorkPreview(synthesizer.summary ?? ""),
			});
			return true;
		}

		private renderSynthesizerDetails(details: HTMLElement, agentWork: PackRunTransparency): void {
			const synthesizer = agentWork.synthesizer;
			if (synthesizer.status !== "ready") {
				details.createEl("div", {
					cls: "open-agent-work-empty",
					text: synthesizer.status === "pending" ? "Waiting for step to finish." : "No data captured",
				});
				return;
			}
			details.createEl("div", { cls: "open-agent-work-raw-json-label", text: "Raw JSON" });
			const rawJson = details.createEl("pre", { cls: "open-agent-work-raw-json" });
			rawJson.setText(safeStringify(synthesizer.rawJson ?? {}));
		}

		private renderVerifierSummary(summary: HTMLElement, agentWork: PackRunTransparency): boolean {
			const verifier = agentWork.verifier;
			if (!isAgentWorkCardInteractive(verifier.status, agentWork.run.state)) {
				summary.createEl("span", {
					cls: "open-agent-work-muted",
					text: verifier.status === "pending" ? "Waiting for step to finish." : "No data captured",
				});
				return false;
			}
			const counts = verifier.counts ?? {
				verified: 0,
				unsupported: 0,
				quoteMissing: 0,
			};
			summary.createEl("span", {
				cls: "open-agent-work-chip open-agent-work-chip-verified",
				text: `Verified ${counts.verified}`,
			});
			summary.createEl("span", {
				cls: "open-agent-work-chip open-agent-work-chip-unsupported",
				text: `Unsupported ${counts.unsupported}`,
			});
			summary.createEl("span", {
				cls: "open-agent-work-chip open-agent-work-chip-quote-missing",
				text: `Quote missing ${counts.quoteMissing}`,
			});
			return true;
		}

		private renderVerifierDetails(details: HTMLElement, agentWork: PackRunTransparency): void {
			const verifier = agentWork.verifier;
			if (verifier.status !== "ready") {
				details.createEl("div", {
					cls: "open-agent-work-empty",
					text: verifier.status === "pending" ? "Waiting for step to finish." : "No data captured",
				});
				return;
			}
			for (const reason of verifier.reasons ?? []) {
				const row = details.createDiv({ cls: "open-agent-work-verifier-row" });
				row.createEl("span", {
					cls: `open-agent-work-chip open-agent-work-chip-${reason.status}`,
					text: claimStatusLabel(reason.status),
				});
				row.createEl("span", {
					cls: "open-agent-work-verifier-claim",
					text: truncateAgentWorkLine(reason.claimText),
				});
				row.createEl("span", {
					cls: "open-agent-work-verifier-source",
					text: sourceNoteLabel(reason.sourceNote),
				});
				row.createEl("span", {
					cls: "open-agent-work-verifier-explanation",
					text: reason.explanation,
				});
			}
		}

		private renderRunSummary(summary: HTMLElement, agentWork: PackRunTransparency): boolean {
			summary.createEl("span", {
				cls: "open-agent-work-summary-text",
				text: `Total ${formatDuration(agentWork.run.elapsedMs)}`,
			});
			summary.createEl("span", {
				cls: "open-agent-work-summary-text",
				text: `Retriever ${formatDuration(agentWork.run.stepElapsedMs.retriever)}`,
			});
			summary.createEl("span", {
				cls: "open-agent-work-summary-text",
				text: `Synthesizer ${formatDuration(agentWork.run.stepElapsedMs.synthesizer)}`,
			});
			summary.createEl("span", {
				cls: "open-agent-work-summary-text",
				text: `Verifier ${formatDuration(agentWork.run.stepElapsedMs.verifier)}`,
			});
			return true;
		}

		private renderRunDetails(details: HTMLElement, agentWork: PackRunTransparency): void {
			const rows: Array<[string, number | undefined]> = [
				["Total", agentWork.run.elapsedMs],
				["Retriever", agentWork.run.stepElapsedMs.retriever],
				["Synthesizer", agentWork.run.stepElapsedMs.synthesizer],
				["Verifier", agentWork.run.stepElapsedMs.verifier],
			];
			for (const [label, value] of rows) {
				const row = details.createDiv({ cls: "open-agent-work-run-row" });
				row.createEl("span", { cls: "open-agent-work-run-label", text: label });
				row.createEl("span", { cls: "open-agent-work-run-value", text: formatDuration(value) });
			}
			details.createEl("div", {
				cls: "open-agent-work-run-state",
				text: runStateLabel(agentWork.run.state),
			});
		}

		private openStoredNote(path: string): void {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				void this.app.workspace.getLeaf(false).openFile(file);
			} else {
				new Notice(`Not found: ${path}`);
			}
		}

		private renderPackClaim(parent: HTMLElement, claim: StoredPackClaim): void {
			const card = parent.createDiv({ cls: `open-agent-claim open-agent-claim-${claim.status}` });
			const header = card.createDiv({ cls: "open-agent-claim-header" });
			header.createEl("span", { cls: "open-agent-claim-badge", text: claimStatusLabel(claim.status) });
			header.createEl("div", { cls: "open-agent-claim-text", text: claim.text });

			const meta = card.createDiv({ cls: "open-agent-claim-meta" });
			const sourceBtn = meta.createEl("button", { text: "Open source note", cls: "open-agent-claim-open" });
			sourceBtn.addEventListener("click", () => {
				this.openStoredNote(claim.sourceNote);
			});
			meta.createEl("span", { cls: "open-agent-claim-source", text: sourceNoteLabel(claim.sourceNote) });

			const details = card.createDiv({ cls: "open-agent-claim-details" });
			const shouldExpand = claim.status !== "verified";
			const toggle = card.createEl("button", {
				text: shouldExpand ? "Hide details" : "Show details",
				cls: "open-agent-claim-toggle",
			});
			details.classList.toggle("is-hidden", !shouldExpand);
			toggle.addEventListener("click", () => {
				const open = details.classList.contains("is-hidden");
				details.classList.toggle("is-hidden", !open);
				toggle.textContent = open ? "Hide details" : "Show details";
			});

			details.createEl("div", {
				cls: "open-agent-claim-quote",
				text: claim.quotePresent ? claim.sourceQuote : "Quoted text not found in the live note.",
			});
			if (claim.status !== "verified") {
				details.createEl("div", { cls: "open-agent-claim-explanation", text: claim.supportExplanation });
			}
		}

		private scheduleDiffComputation(tc: ToolCallRecord): void {
		if (this.diffComputedIds.has(tc.id)) return;
		this.diffComputedIds.add(tc.id);
		void this.computeAndStoreDiff(tc);
	}

	private async computeAndStoreDiff(tc: ToolCallRecord): Promise<void> {
		tc.diffRows = await this.buildDiffRows(tc);
		this.renderTranscript();
	}

	private async buildDiffRows(tc: ToolCallRecord): Promise<DiffRow[]> {
		try {
			const args = tc.args as Record<string, unknown>;
			const path = typeof args.path === "string" ? args.path : null;
			const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
			const existing = file instanceof TFile ? await this.app.vault.read(file) : "";

			if (tc.name === "vault_edit") {
				const oldString = typeof args.oldString === "string" ? args.oldString : "";
				const newString = typeof args.newString === "string" ? args.newString : "";
				return diffLines(existing, existing.split(oldString).join(newString));
			}
			if (tc.name === "vault_append") {
				const content = typeof args.content === "string" ? args.content : "";
				const ensureNewline = args.ensureNewline !== false;
				const sep = ensureNewline && existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
				return diffLines(existing, existing + sep + content);
			}
			if (tc.name === "vault_write") {
				const body = typeof args.body === "string" ? args.body : "";
				const fm = args.frontmatter && typeof args.frontmatter === "object" ? args.frontmatter as Record<string, unknown> : undefined;
				const split = splitFrontmatter(existing);
				const afterFm = fm ? mergeFrontmatter(split.frontmatter ?? {}, fm) : split.frontmatter;
				return diffLines(existing, stitchFrontmatter(afterFm, body));
			}
		} catch {
			// fall through
		}
		return [];
	}
}

function summarizeArgs(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const entries = Object.entries(args as Record<string, unknown>).slice(0, 3);
	const parts = entries.map(([k, v]) => `${k}=${shortValue(v)}`);
	return `(${parts.join(", ")}${Object.keys(args).length > 3 ? ", …" : ""})`;
}

function shortValue(v: unknown): string {
	if (typeof v === "string") return v.length > 40 ? `"${v.slice(0, 37)}…"` : `"${v}"`;
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	if (v === null) return "null";
	if (Array.isArray(v)) return `[${v.length}]`;
	return "{…}";
}

function statusLabel(s: ToolCallRecord["status"]): string {
	switch (s) {
		case "running":
			return "running…";
		case "awaiting-consent":
			return "awaiting consent…";
		case "ok":
			return "ok";
		case "error":
			return "error";
		case "denied":
			return "denied";
	}
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function extractPath(value: unknown): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const p = (value as Record<string, unknown>).path;
	return typeof p === "string" ? p : null;
}

function updatePackProgress(
	steps: StoredPackProgressStep[],
	nextStep: StoredPackProgressStep,
): StoredPackProgressStep[] {
	const updated = steps.map((step) => (step.id === nextStep.id ? nextStep : step));
	if (updated.some((step) => step.id === nextStep.id)) return updated;
	return [...updated, nextStep];
}

function markPackFailed(steps: StoredPackProgressStep[]): void {
	const running = steps.find((step) => step.state === "running");
	if (running) running.state = "failed";
}

function claimStatusLabel(status: StoredPackClaim["status"]): string {
	switch (status) {
		case "verified":
			return "Verified";
		case "unsupported":
			return "Unsupported";
		case "quote-missing":
			return "Quote missing";
	}
}

function sourceNoteLabel(path: string): string {
	const parts = path.split("/");
	return parts[parts.length - 1] || path;
}

function defaultExpandedAgentWorkCard(agentWork: PackRunTransparency): string | null {
	if (agentWork.run.state !== "failed") return null;
	if (agentWork.run.failedStepId && cardShouldAutoExpand(agentWork, agentWork.run.failedStepId)) {
		return agentWork.run.failedStepId;
	}
	for (const id of ["retriever", "synthesizer", "verifier"] as const) {
		if (cardShouldAutoExpand(agentWork, id)) return id;
	}
	return null;
}

function cardShouldAutoExpand(agentWork: PackRunTransparency, id: "retriever" | "synthesizer" | "verifier"): boolean {
	return agentWork[id].status !== "ready";
}

function isAgentWorkCardInteractive(
	status: PackRunTransparency["retriever"]["status"],
	runState: PackRunTransparency["run"]["state"],
): boolean {
	return status === "ready" || (status === "absent" && runState !== "running");
}

function truncateAgentWorkPreview(text: string): string {
	const normalized = text.replace(/\r\n/g, "\n").trim();
	if (!normalized) return "";
	const twoLines = normalized.split("\n").slice(0, 2).join(" ");
	if (twoLines.length <= 140 && twoLines === normalized.replace(/\n/g, " ")) return twoLines;
	const truncated = twoLines.slice(0, 140).trimEnd();
	return `${truncated.replace(/[.,;:!?-]$/, "")}…`;
}

function truncateAgentWorkLine(text: string, maxLength = 80): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxLength) return trimmed;
	return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatDuration(ms: number | undefined): string {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
		return "Timing unavailable";
	}
	if (ms < 10_000) {
		return `${(ms / 1000).toFixed(1)}s`;
	}
	const roundedSeconds = Math.round(ms / 1000);
	if (roundedSeconds < 60) {
		return `${roundedSeconds}s`;
	}
	const minutes = Math.floor(roundedSeconds / 60);
	const seconds = roundedSeconds % 60;
	return `${minutes}m ${seconds}s`;
}

function runStateLabel(state: PackRunTransparency["run"]["state"]): string {
	switch (state) {
		case "completed":
			return "Completed";
		case "failed":
			return "Failed";
		case "stopped":
			return "Stopped";
		case "running":
			return "Running";
	}
}
