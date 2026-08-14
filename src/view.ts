import { type App, ItemView, MarkdownRenderer, Modal, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type { ConsentChoice, ConsentManager } from "./consent/manager";
import type { UndoBuffer } from "./consent/undo";
import { diffLines, type DiffRow } from "./consent/diff";
import { renderRows } from "./consent/render-diff";
import { runTurn } from "./loop";
import { buildVaultContextPrompt, requestsVaultMutation, type VaultContext } from "./context";
import { isMobile } from "./platform";
import { OpenAICompatibleProvider } from "./provider";
import { resolveCitationTarget } from "./citations";
import type { ExactPhraseAnchor } from "./agents/verifier";
import { PackConfigError, PackRunError, type PackRuntimeEvent, type PackRunResult, type PackRunTransparency } from "./packs/runtime";
import type { AgentPack } from "./packs/types";
import { isConfigured, type PluginSettings } from "./settings";
import type {
	SessionStore,
	StoredPackClaim,
	StoredPackProgressStep,
	StoredPackTurnData,
	StoredAssistantSegment,
	StoredToolCall,
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

type AssistantSegment =
	| { kind: "thinking"; text: string }
	| { kind: "text"; text: string }
	| { kind: "tool"; id: string };

interface UiTurn {
	role: "user" | "assistant";
	content: string; // user turns only
	segments: AssistantSegment[]; // assistant turns: text and tool cards in order
	toolCallMap: Record<string, ToolCallRecord>; // assistant turns: looked up by id
	thinking: boolean; // true until first content arrives
	thinkingLabel?: string; // optional context label shown inside the thinking indicator
	thinkingContent?: string; // model reasoning/thoughts extracted from response
	thinkingElapsedMs?: number; // cumulative elapsed thinking time once complete
	thinkingPhaseStartedAt?: number; // start of the current active thinking phase
	thinkingExpanded?: boolean; // per-turn override of the global collapse state for completed thinking
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
	getCurrentContext: () => VaultContext;
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
	private modelInputEl!: HTMLSelectElement;
	private modeSelectEl!: HTMLSelectElement;
	private packSummaryEl!: HTMLElement;
	private packHintEl!: HTMLElement;
	private packRecoveryEl!: HTMLElement;
	private packMobileBannerEl!: HTMLElement;
	private sessionRecoveryEl!: HTMLElement;

	private turns: UiTurn[] = [];
	private readonly inFlights = new Map<string, AbortController>();
	private readonly stoppingSessions = new Set<string>();
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
	private readonly packExpandedStepId = new WeakMap<StoredPackTurnData, string | null>();

	// Redesigned layout
	private composerEl!: HTMLElement;
	private statusBarEl!: HTMLElement;
	private permissionSelectEl!: HTMLSelectElement;
	private menuEl!: HTMLElement;
	private menuBtnEl!: HTMLButtonElement;
	private boundOnDocClick: (e: MouseEvent) => void;

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
		this.boundOnDocClick = (e) => this.handleDocClick(e);
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
		this.buildComposer(root);
		this.buildStatusBar(root);

		window.addEventListener("open-agent:settings-changed", this.boundOnSettingsChanged);
		document.addEventListener("click", this.boundOnDocClick);

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
		document.removeEventListener("click", this.boundOnDocClick);
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

		// Compact toolbar: title + icon buttons
		const toolbar = header.createDiv({ cls: "open-agent-toolbar" });

		this.sessionTitleEl = toolbar.createEl("span", { cls: "open-agent-session-title" });
		this.sessionTitleEl.addEventListener("click", () => this.startRename());

		this.sessionRenameEl = toolbar.createEl("input", {
			cls: "open-agent-session-rename",
			attr: { type: "text" },
		});
		this.sessionRenameEl.addClass("is-hidden");
		this.sessionRenameEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.finishRename();
			if (e.key === "Escape") this.cancelRename();
		});
		this.sessionRenameEl.addEventListener("blur", () => this.finishRename());

		toolbar.createEl("span", { cls: "open-agent-toolbar-spacer" });

		const newBtn = toolbar.createEl("button", { text: "+", cls: "open-agent-icon-btn" });
		newBtn.setAttribute("aria-label", "New chat");
		newBtn.addEventListener("click", () => { void this.createSession(); });

		const sessionsToggle = toolbar.createEl("button", { text: "≡", cls: "open-agent-icon-btn open-agent-sessions-toggle" });
		sessionsToggle.setAttribute("aria-label", "Browse sessions");
		sessionsToggle.addEventListener("click", () => this.toggleSessionsPanel());

		this.menuBtnEl = toolbar.createEl("button", { text: "⋯", cls: "open-agent-icon-btn open-agent-menu-btn" });
		this.menuBtnEl.setAttribute("aria-label", "Session menu");
		this.menuBtnEl.addEventListener("click", () => this.toggleMenu());

		// Session menu (hidden by default)
		this.menuEl = header.createDiv({ cls: "open-agent-menu" });
		this.menuEl.addClass("is-hidden");
		this.buildMenuItems(this.menuEl);

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

		this.packSummaryEl = header.createDiv({ cls: "open-agent-pack-summary" });
		this.packHintEl = header.createDiv({ cls: "open-agent-pack-hint", text: "Applies to future turns in this chat." });
		this.packRecoveryEl = header.createDiv({ cls: "open-agent-pack-recovery" });
		this.packMobileBannerEl = header.createDiv({ cls: "open-agent-pack-mobile-banner" });
		this.sessionRecoveryEl = header.createDiv({ cls: "open-agent-session-recovery" });
	}

	private buildMenuItems(menu: HTMLElement): void {
		const renameItem = menu.createEl("button", { text: "Rename", cls: "open-agent-menu-item" });
		renameItem.addEventListener("click", () => {
			this.setMenuVisible(false);
			this.startRename();
		});
		const deleteItem = menu.createEl("button", { text: "Delete", cls: "open-agent-menu-item open-agent-menu-item-danger" });
		deleteItem.addEventListener("click", () => {
			this.setMenuVisible(false);
			void this.deleteActiveSession();
		});
	}

	private toggleMenu(): void {
		this.setMenuVisible(this.menuEl.classList.contains("is-hidden"));
	}

	private setMenuVisible(visible: boolean): void {
		this.menuEl.classList.toggle("is-hidden", !visible);
	}

	private handleDocClick(e: MouseEvent): void {
		const target = e.target as Node | null;
		if (!target || !this.menuEl) return;
		if (this.menuEl.contains(target) || this.menuBtnEl.contains(target)) return;
		this.setMenuVisible(false);
	}

	private buildComposer(root: HTMLElement): void {
		this.composerEl = root.createDiv({ cls: "open-agent-composer" });

		const inputShell = this.composerEl.createDiv({ cls: "open-agent-input-shell" });
		this.inputEl = inputShell.createEl("textarea", {
			cls: "open-agent-input",
			attr: { rows: "2", placeholder: "Ask the agent…" },
		});
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
			const wantsNewline = e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;
			if (wantsNewline) return; // 让浏览器默认插入换行
			e.preventDefault();
			void this.handleSend();
		});

		const toolbar = this.composerEl.createDiv({ cls: "open-agent-composer-toolbar" });

		// Left: mode + model selectors (small)
		const selectors = toolbar.createDiv({ cls: "open-agent-composer-selectors" });
		const modeWrap = selectors.createDiv({ cls: "open-agent-selector-pill open-agent-mode-wrap" });
		modeWrap.createEl("span", { cls: "open-agent-selector-icon", text: "✦" });
		this.modeSelectEl = modeWrap.createEl("select", { cls: "open-agent-mode-select" });
		this.modeSelectEl.addEventListener("change", () => { void this.handleModeChange(); });

		const modelWrap = selectors.createDiv({ cls: "open-agent-selector-pill open-agent-model-wrap" });
		modelWrap.createEl("span", { cls: "open-agent-selector-icon open-agent-model-icon", text: "◈" });
		this.modelInputEl = modelWrap.createEl("select", { cls: "open-agent-model-input" });
		this.modelInputEl.addEventListener("change", () => { void this.handleModelChange(); });

		// Right: send / stop buttons
		const actions = toolbar.createDiv({ cls: "open-agent-composer-actions" });
		this.sendBtn = actions.createEl("button", { text: "↑", cls: "open-agent-icon-btn open-agent-send-btn mod-cta" });
		this.sendBtn.setAttribute("aria-label", "Send");
		this.sendBtn.addEventListener("click", () => void this.handleSend());
		this.stopBtn = actions.createEl("button", { text: "■", cls: "open-agent-icon-btn open-agent-stop-btn" });
		this.stopBtn.setAttribute("aria-label", "Stop");
		this.stopBtn.addEventListener("click", () => this.handleStop());
		this.stopBtn.disabled = true;
	}

	private buildStatusBar(root: HTMLElement): void {
		this.statusBarEl = root.createDiv({ cls: "open-agent-statusbar" });

		const contextChip = this.statusBarEl.createEl("span", {
			cls: "open-agent-status-chip open-agent-context-chip",
			text: "Local",
		});
		contextChip.setAttribute("aria-label", "Context: Local vault");
		contextChip.setAttribute("title", "OpenAgent uses the current local vault as context");

		this.statusBarEl.createEl("span", {
			cls: "open-agent-status-separator",
			text: "·",
			attr: { "aria-hidden": "true" },
		});

		const permissionWrap = this.statusBarEl.createDiv({ cls: "open-agent-status-control" });
		permissionWrap.createEl("span", {
			cls: "open-agent-status-control-label",
			text: "Permissions",
		});
		this.permissionSelectEl = permissionWrap.createEl("select", {
			cls: "open-agent-permission-select",
			attr: { "aria-label": "Write permission mode" },
		});
		this.permissionSelectEl.createEl("option", { value: "ask", text: "Ask" });
		this.permissionSelectEl.createEl("option", { value: "always", text: "Full access" });
		this.permissionSelectEl.addEventListener("change", () => {
			const mode = this.permissionSelectEl.value === "always"
				? "always"
				: this.permissionSelectEl.value === "never" ? "never" : "ask";
			this.deps.consent.setSessionMode("vault_write", mode);
			this.updateStatusBar();
		});
	}

	private updateStatusBar(): void {
		if (!this.statusBarEl || !this.permissionSelectEl) return;
		const writeMode = this.deps.consent.getMode("vault_write");
		if (writeMode === "never" && !Array.from(this.permissionSelectEl.options).some((option) => option.value === "never")) {
			this.permissionSelectEl.add(new Option("Read-only", "never"));
		}
		this.permissionSelectEl.value = writeMode;
	}

	private refreshHeader(): void {
		const active = this.deps.sessionStore.getActive();
		const settings = this.deps.getSettings();
		this.sessionTitleEl.setText(active.title);
		const currentModel = active.lastClassicModel?.trim() || active.model.trim() || settings.model;
		const modelOptions = this.modelInputEl?.options;
		if (currentModel && modelOptions && !Array.from(modelOptions).some((o) => o.value === currentModel)) {
			this.modelInputEl.add(new Option(currentModel, currentModel), 0);
		}
		if (this.modelInputEl) this.modelInputEl.value = currentModel;

		this.modeSelectEl.empty();
		this.modeSelectEl.createEl("option", { value: "", text: "Agent" });
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
			const overrides = settings.packProviderOverrides[activePack.id] ?? {};
			const effectiveModel = (providerName: string): string => {
				return overrides[providerName]?.model?.trim() || activePack.providers[providerName]?.model || "n/a";
			};
			this.packSummaryEl.createEl("div", { cls: "open-agent-pack-name", text: activePack.name });
			this.packSummaryEl.createEl("div", {
				cls: "open-agent-pack-models",
				text:
					`Retriever — ${effectiveModel("retriever")}; ` +
					`Synthesizer — ${effectiveModel("synthesizer")}; ` +
					`Verifier — ${effectiveModel("verifier")}`,
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
		this.updateStatusBar();
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
		if (models.length === 0) return;
		const current = this.modelInputEl.value;
		while (this.modelInputEl.options.length > 0) this.modelInputEl.remove(0);
		const allModels = current && !models.includes(current) ? [current, ...models] : models;
		for (const m of allModels) {
			this.modelInputEl.add(new Option(m, m));
		}
		this.modelInputEl.value = current || allModels[0] || "";
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
			const segments: AssistantSegment[] = (st.segments ?? []).map((segment) => ({ ...segment }));
			if (segments.length === 0 && st.content.length > 0) {
				segments.push({ kind: "text", text: st.content });
			}
			const toolCallMap: Record<string, ToolCallRecord> = {};
			for (const toolCall of st.toolCalls ?? []) {
				toolCallMap[toolCall.id] = { ...toolCall };
			}
			return {
				role: "assistant",
				content: "",
				segments,
				toolCallMap,
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
				const segments = t.segments
					.filter((segment): segment is StoredAssistantSegment =>
						(segment.kind === "thinking" || segment.kind === "text") && segment.text.length > 0 ||
						segment.kind === "tool" && segment.id.length > 0,
					)
					.map((segment) => ({ ...segment }));
				const toolCalls = Object.values(t.toolCallMap).map((toolCall): StoredToolCall => ({ ...toolCall }));
				if (text.length > 0 || segments.length > 0 || toolCalls.length > 0) {
					result.push({
						role: "assistant",
						content: text,
						...(segments.length > 0 ? { segments } : {}),
						...(toolCalls.length > 0 ? { toolCalls } : {}),
					});
				}
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
		const stopping = this.stoppingSessions.has(activeId);
		const packMode = Boolean(this.deps.sessionStore.getActive().selectedPackId);
		const activePack = this.getActivePack();
		const classicOk = isConfigured(this.deps.getSettings());
		const packOk = packMode ? Boolean(activePack) && !this.isMobileBlockedPack() : false;
		this.sendBtn.disabled = !(packMode ? packOk : classicOk) || busy;
		this.stopBtn.disabled = !busy || stopping;
		this.inputEl.disabled = busy;
		this.sendBtn.textContent = "↑";
		this.stopBtn.textContent = stopping ? "Stopping..." : "■";
		if (this.composerEl) {
			this.composerEl.classList.toggle("is-busy", busy);
		}
		if (this.sessionsPanelVisible) {
			this.refreshSessionsList(this.sessionsSearchEl.value);
		}
		this.updateStatusBar();
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
		const assistantTurn: UiTurn = { role: "assistant", content: "", segments: [], toolCallMap: {}, thinking: true, thinkingElapsedMs: 0, thinkingPhaseStartedAt: Date.now() };
		this.turns.push(assistantTurn);
		// Snapshot the turns array reference so the finally block always saves to the right session
		// even if this.turns is replaced by a session switch mid-flight.
		const turnSnapshot = this.turns;
		this.inputEl.value = "";

		// Mark session busy immediately — before any awaits — so the input is disabled and
		// a second Send press cannot race with the in-progress request.
		const ctrl = new AbortController();
		this.stoppingSessions.delete(sessionId);
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
				systemPrompt: [settings.systemPrompt, buildVaultContextPrompt(this.deps.getCurrentContext())]
					.filter((part) => part.trim().length > 0)
					.join("\n\n"),
				tools: this.deps.tools,
				consent: this.deps.consent,
				requireToolCall: requestsVaultMutation(text),
			})) {
				if (ev.kind === "thinking_text") {
					assistantTurn.thinkingContent = (assistantTurn.thinkingContent ?? "") + ev.text;
					const lastSegment = assistantTurn.segments[assistantTurn.segments.length - 1];
					if (lastSegment?.kind === "thinking") {
						lastSegment.text += ev.text;
					} else {
						assistantTurn.segments.push({ kind: "thinking", text: ev.text });
					}
					if (this.turns.includes(assistantTurn)) this.scheduleRender();
					continue;
				} else if (ev.kind === "text") {
					if (ev.degraded) assistantTurn.degraded = true;
					if (assistantTurn.thinking) {
						// First content: freeze the cumulative thinking time and stop the active timer.
						assistantTurn.thinkingElapsedMs = this.accumulateThinkingElapsed(assistantTurn);
						assistantTurn.thinkingPhaseStartedAt = undefined;
					}
					assistantTurn.thinking = false;
					assistantTurn.thinkingLabel = undefined;
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
					assistantTurn.thinkingLabel = tc ? `Processing ${tc.name}…` : undefined;
					assistantTurn.thinkingPhaseStartedAt = Date.now();
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
				assistantTurn.packTurn.researchMarkdown = result.researchMarkdown;
				assistantTurn.packTurn.citations = result.citations;
				assistantTurn.packTurn.claims = result.claims.map((claim) => ({
					id: claim.id,
					text: claim.text,
					sourceNote: claim.sourceNote,
					sourceQuote: claim.sourceQuote,
					quotePresent: claim.quotePresent,
					supportsClaim: claim.supportsClaim,
					supportExplanation: claim.supportExplanation,
					status: claim.status,
					exactPhraseAnchor: claim.exactPhraseAnchor,
				}));
				assistantTurn.packTurn.agentWork = result.transparency;
				assistantTurn.packTurn.modelsUsed = result.modelsUsed;
				assistantTurn.error = undefined;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const interrupted = ctrl.signal.aborted;
			if (assistantTurn.packTurn) {
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
							exactPhraseAnchor: claim.exactPhraseAnchor,
						}));
					}
				}
				if (interrupted) {
					assistantTurn.packTurn.error = undefined;
					markPackStopped(assistantTurn.packTurn.progressSteps ?? []);
				} else {
					assistantTurn.packTurn.error = message;
					markPackFailed(assistantTurn.packTurn.progressSteps ?? []);
				}
			}
			if (interrupted) {
				assistantTurn.error = undefined;
				this.activePackError = null;
			} else {
				assistantTurn.error = message;
				this.activePackError = this.formatPackRecoveryMessage(pack.name, error);
				this.refreshHeader();
			}
		} finally {
			if (this.renderDebounceTimer !== null) {
				window.clearTimeout(this.renderDebounceTimer);
				this.renderDebounceTimer = null;
			}
			if (ctrl.signal.aborted) {
				assistantTurn.interrupted = true;
			}
			this.stoppingSessions.delete(sessionId);
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
		if (this.stoppingSessions.has(activeId)) return;
		this.stoppingSessions.add(activeId);
		this.refreshBusyState();
		this.renderTranscript();
		ctrl.abort();
		this.deps.consent.cancelPendingConsent();
		new Notice("Stopping...");
	}

	private accumulateThinkingElapsed(turn: UiTurn): number {
		const base = turn.thinkingElapsedMs ?? 0;
		if (typeof turn.thinkingPhaseStartedAt === "number") {
			return base + Math.max(0, Date.now() - turn.thinkingPhaseStartedAt);
		}
		return base;
	}

	private currentThinkingElapsed(turn: UiTurn): number {
		if (turn.thinking && typeof turn.thinkingPhaseStartedAt === "number") {
			return (turn.thinkingElapsedMs ?? 0) + Math.max(0, Date.now() - turn.thinkingPhaseStartedAt);
		}
		return turn.thinkingElapsedMs ?? 0;
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
		const previousScrollTop = this.transcriptEl.scrollTop || 0;
		const previousScrollHeight = this.transcriptEl.scrollHeight || 0;
		const viewportHeight = this.transcriptEl.clientHeight || 0;
		const wasNearBottom =
			viewportHeight <= 0 ||
			previousScrollHeight <= 0 ||
			previousScrollHeight - previousScrollTop - viewportHeight < 80;

		this.transcriptEl.empty();
		if (this.turns.length === 0 && isConfigured(this.deps.getSettings())) {
			this.transcriptEl.createDiv({
				cls: "open-agent-empty-hint",
				text: "Ask the agent to inspect, edit, or explain your vault.",
			});
		}
		for (let i = 0; i < this.turns.length; i++) {
			const turn = this.turns[i];
			const row = this.transcriptEl.createDiv({ cls: `open-agent-turn open-agent-turn-${turn.role}` });

			if (turn.role === "user") {
				// No persistent role label — the right-aligned bubble communicates "you".
				// The pencil edit button is hidden by default and revealed on hover (CSS).
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
					if (!busy && i !== this.editingTurnIndex) {
						const pencilBtn = row.createEl("button", { text: "✎", cls: "open-agent-turn-edit-btn" });
						pencilBtn.setAttribute("aria-label", "Edit message");
						pencilBtn.addEventListener("click", () => {
							this.editingTurnIndex = i;
							this.editingText = turn.content;
							this.renderTranscript();
						});
					}
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

				// Retry icon on the right when this turn errored
				if (!busy && turn.error && userTurnIdx >= 0) {
					const retryBtn = row.createEl("button", { text: "↺", cls: "open-agent-turn-edit-btn open-agent-turn-retry-btn" });
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
				} else {
					for (const seg of turn.segments) {
						if (seg.kind === "thinking" && seg.text.length > 0) {
							this.renderThinkingSegment(row, seg.text, turn);
						} else if (seg.kind === "tool") {
							const toolCall = turn.toolCallMap[seg.id];
							if (toolCall) this.renderToolCard(row, toolCall);
						} else if (seg.kind === "text" && seg.text.length > 0) {
							// One renderer for both streaming and completed states: always go
							// through MarkdownRenderer so the DOM (lists, bold, inline code,
							// paragraphs) is identical before and after the turn finishes.
							// Previously the streaming path used plain setText() which produced
							// a different DOM (raw markdown symbols), so the final transition
							// re-laid out the message and visibly jumped.
							const body = row.createDiv({ cls: "open-agent-turn-body" });
							void MarkdownRenderer.render(this.app, seg.text, body, "", this);
						}
					}
					const lastSegment = turn.segments[turn.segments.length - 1];
					if (turn.thinking && lastSegment?.kind !== "thinking") this.renderThinkingStatus(row, turn);
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
				errEl.createEl("span", { cls: "open-agent-turn-error-icon", text: "ⓧ" });
				const errText = errEl.createEl("span", { cls: "open-agent-turn-error-text" });
				errText.setText(turn.error);
				if (turn.authError) {
					errText.appendText(" ");
					const link = errText.createEl("a", { text: "Open settings", href: "#" });
					link.addEventListener("click", (e) => { e.preventDefault(); this.deps.openSettings(); });
				}
				const errActions = errEl.createDiv({ cls: "open-agent-turn-error-actions" });
				const copyBtn = errActions.createEl("button", { text: "Copy", cls: "open-agent-icon-btn" });
				copyBtn.setAttribute("aria-label", "Copy error message");
				copyBtn.addEventListener("click", () => {
					void navigator.clipboard.writeText(turn.error ?? "").then(() => {
						new Notice("Copied");
					}).catch(() => undefined);
				});
			}
		}
		if (wasNearBottom) {
			this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
		} else {
			this.transcriptEl.scrollTop = previousScrollTop;
		}
	}

	private async submitEdit(turnIndex: number): Promise<void> {
		const text = this.editingText.trim();
		if (!text) return;
		this.editingTurnIndex = null;
		this.turns = this.turns.slice(0, turnIndex);
		this.inputEl.value = text;
		await this.handleSend();
	}

	// ─── Reasoning block ─────────────────────────────────────────────────────

	private renderThinkingStatus(parent: HTMLElement, turn: UiTurn): void {
		const elapsed = this.currentThinkingElapsed(turn);
		const card = parent.createDiv({ cls: "open-agent-thinking-segment open-agent-thinking-surface open-agent-thinking-surface-active" });
		card.createDiv({ cls: "open-agent-thinking-spinner" });
		card.createEl("span", { cls: "open-agent-thinking-label", text: turn.thinkingLabel ?? "Thinking" });
		if (elapsed > 0) {
			card.createEl("span", { cls: "open-agent-thinking-meta", text: formatDuration(elapsed) });
		}
	}

	private renderThinkingSegment(parent: HTMLElement, text: string, turn: UiTurn): void {
		const lastSegment = turn.segments[turn.segments.length - 1];
		const active = turn.thinking && lastSegment?.kind === "thinking" && lastSegment.text === text;
		const card = parent.createEl("details", { cls: "open-agent-thinking-segment open-agent-thinking-surface" });
		if (active) {
			card.classList.add("open-agent-thinking-surface-active");
			card.setAttribute("open", "");
		}
		const summary = card.createEl("summary", { cls: "open-agent-thinking-segment-summary" });
		if (active) summary.createDiv({ cls: "open-agent-thinking-spinner" });
		else summary.createEl("span", { cls: "open-agent-thinking-card-icon", text: "✓" });
		summary.createEl("span", {
			cls: "open-agent-thinking-label",
			text: active ? (turn.thinkingLabel ?? "Thinking") : "Thought process",
		});
		if (active) summary.createEl("span", { cls: "open-agent-thinking-meta", text: "live" });
		const content = card.createDiv({ cls: "open-agent-thinking-segment-content" });
		content.setText(text || "Thinking…");
	}

	private renderToolCard(parent: HTMLElement, tc: ToolCallRecord): void {
		const cls = ["open-agent-tool-card"];
		if (tc.mutates) cls.push("open-agent-tool-mutates");
		if (tc.status === "ok") cls.push("open-agent-tool-ok");
		if (tc.status === "running") cls.push("open-agent-tool-running");
		if (tc.status === "error") cls.push("open-agent-tool-error");
		if (tc.status === "denied") cls.push("open-agent-tool-denied");
		if (tc.status === "awaiting-consent") cls.push("open-agent-tool-consent");

		const card = parent.createEl("details", { cls: cls.join(" ") });
		if (tc.status === "awaiting-consent") card.setAttribute("open", "");

		const summary = card.createEl("summary", { cls: "open-agent-tool-summary" });
		summary.createEl("span", { cls: "open-agent-tool-status-icon", text: toolStatusIcon(tc.status) });
		summary.createEl("span", { cls: "open-agent-tool-name", text: tc.name });
		summary.createEl("span", { cls: "open-agent-tool-args", text: summarizeArgs(tc.args) });
		if (tc.status === "awaiting-consent") {
			summary.createEl("span", { cls: "open-agent-tool-status", text: "approval required" });
		}

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
			if (this.shouldUsePackTranscriptRedesign(packTurn)) {
				this.renderRedesignedPackTurn(parent, packTurn);
				return;
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

		private shouldUsePackTranscriptRedesign(packTurn: StoredPackTurnData): boolean {
			if ((packTurn.progressSteps?.length ?? 0) === 0) return false;
			return Boolean(
				packTurn.agentWork ||
				packTurn.researchMarkdown !== undefined ||
				packTurn.citations !== undefined ||
				"retryingStepId" in packTurn,
			);
		}

		private renderRedesignedPackTurn(parent: HTMLElement, packTurn: StoredPackTurnData): void {
			const agentWork = packTurn.agentWork;
			const runState = agentWork?.run.state ?? "running";
			const researchMarkdown = packTurn.researchMarkdown?.trim() ?? "";
			const isStopping = runState === "running" && this.stoppingSessions.has(this.deps.sessionStore.getActive().id);
			const isStopped = runState === "stopped";

			if (runState !== "running") {
				const resultSection = parent.createDiv({ cls: "open-agent-pack-result" });
				resultSection.createEl("div", {
					cls: "open-agent-pack-section-title",
					text: isStopped ? "Research stopped" : researchMarkdown ? "Research result" : "Research result unavailable",
				});
				resultSection.createEl("div", {
					cls: "open-agent-pack-result-meta",
					text: formatDuration(agentWork.run.elapsedMs),
				});
				const resultBody = resultSection.createDiv({
					cls: "open-agent-turn-body open-agent-pack-result-body",
				});
				if (isStopped) {
					resultBody.setText(
						"This run was stopped before it finished. Any completed step output remains available below.",
					);
				} else if (researchMarkdown) {
					this.renderResearchMarkdown(resultBody, researchMarkdown, packTurn.citations ?? []);
				} else {
					resultBody.setText(
						"This run did not produce a citation-ready research answer. Review the completed steps and claim details below, then rerun research if needed.",
					);
				}
			}

			parent.createEl("div", {
				cls: `open-agent-pack-progress-title${isStopping ? " is-stopping" : ""}`,
				text: isStopping
					? "Stopping research..."
					: isStopped
						? "Progress before stop"
						: runState === "running"
							? "Agent steps"
							: "How this answer was built",
			});
			const progress = parent.createDiv({ cls: "open-agent-pack-progress" });
			const expandedStepSetters: Array<(open: boolean) => void> = [];
			let expandedStepId = this.getInitialExpandedPackStep(packTurn, agentWork);

			for (const step of packTurn.progressSteps ?? []) {
				const stepId = step.id;
				const details = this.getPackStepDetails(stepId, agentWork);
				const readyDetails = details?.status === "ready" ? details : null;
				const expandable = Boolean(details || step.message);
				const stepDuration = formatDuration(agentWork?.run.stepElapsedMs[toPackRunStepId(step.id)]);
				const showStepDuration = stepDuration !== "Timing unavailable";
				const isStoppingStep = isStopping && step.state === "running";
				const isStoppedStep = isStopped && step.message === "Stopped by user.";
				const stepEl = progress.createDiv({
					cls: `open-agent-pack-step open-agent-pack-step-${step.state}`,
				});
				stepEl.classList.toggle("is-expandable", expandable);
				stepEl.classList.toggle("is-static", !expandable);
				stepEl.classList.toggle("is-expanded", expandable && expandedStepId === stepId);
				stepEl.classList.toggle("is-stopping", isStoppingStep);
				stepEl.classList.toggle("is-stopped", isStoppedStep);
				if (expandable) {
					stepEl.setAttribute("role", "button");
					stepEl.setAttribute("tabindex", "0");
					stepEl.setAttribute("aria-expanded", String(expandedStepId === stepId));
				}

				const header = stepEl.createDiv({ cls: "open-agent-pack-step-header" });
				const heading = header.createDiv({ cls: "open-agent-pack-step-heading" });
				heading.createEl("div", {
					cls: "open-agent-pack-step-label",
					text: packStepTitle(step),
				});
				const meta = header.createDiv({ cls: "open-agent-pack-step-meta" });
				meta.createEl("span", {
					cls: `open-agent-pack-step-state open-agent-pack-step-state-${isStoppingStep ? "stopping" : isStoppedStep ? "stopped" : step.state}`,
					text: isStoppingStep ? "Stopping" : isStoppedStep ? "Stopped" : packStepStateLabel(step.state),
				});
				if (showStepDuration) {
					meta.createEl("span", {
						cls: "open-agent-pack-step-duration",
						text: stepDuration,
					});
				}
				let disclosure: HTMLElement | null = null;
				if (expandable) {
					disclosure = meta.createEl("span", {
						cls: "open-agent-pack-step-disclosure",
						text: expandedStepId === stepId ? "▾" : "▸",
					});
				}

				this.renderPackStepSummary(stepEl, stepId, readyDetails);
				if (packTurn.retryingStepId === step.id) {
					stepEl.createEl("div", {
						cls: "open-agent-pack-retry",
						text: "Retrying structured output (1/1)…",
					});
				}
				if (step.state === "failed" && step.message) {
					stepEl.createEl("div", { cls: "open-agent-pack-step-message", text: step.message });
				}

				const detailEl = stepEl.createDiv({ cls: "open-agent-pack-step-details" });
				if (readyDetails) {
					this.renderPackStepDetails(detailEl, stepId, readyDetails);
				} else {
					detailEl.createEl("div", {
						cls: "open-agent-pack-step-empty",
						text: details?.status === "pending" ? "Waiting for step to finish." : "No details captured.",
					});
				}

				const setExpanded = (open: boolean): void => {
					detailEl.classList.toggle("is-hidden", !open);
					if (expandable) {
						stepEl.setAttribute("aria-expanded", String(open));
						stepEl.classList.toggle("is-expanded", open);
						disclosure?.setText(open ? "▾" : "▸");
					}
				};
				expandedStepSetters.push(setExpanded);
				setExpanded(expandedStepId === stepId);

				if (expandable) {
					stepEl.addEventListener("click", () => {
						expandedStepId = expandedStepId === stepId ? null : stepId;
						this.packExpandedStepId.set(packTurn, expandedStepId);
						for (let index = 0; index < expandedStepSetters.length; index += 1) {
							const targetStep = packTurn.progressSteps?.[index];
							expandedStepSetters[index]?.(targetStep?.id === expandedStepId);
						}
					});
					stepEl.addEventListener("keydown", (event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						stepEl.click();
					});
				}
			}

			for (const claim of packTurn.claims ?? []) {
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

		private getInitialExpandedPackStep(
			packTurn: StoredPackTurnData,
			agentWork: PackRunTransparency | undefined,
		): string | null {
			const existing = this.packExpandedStepId.get(packTurn);
			if (existing !== undefined) return existing;
			const initial = agentWork?.run.state === "failed" ? agentWork.run.failedStepId ?? null : null;
			this.packExpandedStepId.set(packTurn, initial);
			return initial;
		}

		private renderPackStepSummary(
			parent: HTMLElement,
			stepId: string,
			details:
				| PackRunTransparency["retriever"]
				| PackRunTransparency["synthesizer"]
				| PackRunTransparency["verifier"]
				| null,
		): void {
			if (!details) return;
			const summary = parent.createDiv({ cls: "open-agent-pack-step-summary" });
			if (stepId === "retriever" && "notesFoundCount" in details) {
				summary.createEl("span", {
					cls: "open-agent-work-summary-text",
					text: `${details.notesFoundCount ?? 0} notes`,
				});
				for (const path of details.topNotePaths ?? []) {
					this.renderNotePathChip(summary, path);
				}
				const extraCount = Math.max(0, (details.notesFoundCount ?? 0) - (details.topNotePaths?.length ?? 0));
				if (extraCount > 0) {
					summary.createEl("span", {
						cls: "open-agent-work-summary-text open-agent-work-muted",
						text: `+${extraCount} more`,
					});
				}
				return;
			}
			if (stepId === "synthesizer" && "claimCount" in details) {
				summary.createEl("span", {
					cls: "open-agent-work-summary-text",
					text: `${details.claimCount ?? 0} draft claims`,
				});
				summary.createEl("span", {
					cls: "open-agent-work-summary-text",
					text: truncateAgentWorkPreview(details.summary ?? ""),
				});
				return;
			}
			if (stepId === "verifier" && "counts" in details) {
				const counts = details.counts ?? { verified: 0, unsupported: 0, quoteMissing: 0 };
				summary.createEl("span", { cls: "open-agent-work-chip open-agent-work-chip-verified", text: `Verified ${counts.verified}` });
				summary.createEl("span", { cls: "open-agent-work-chip open-agent-work-chip-unsupported", text: `Unsupported ${counts.unsupported}` });
				summary.createEl("span", {
					cls: "open-agent-work-chip open-agent-work-chip-quote-missing",
					text: `Quote missing ${counts.quoteMissing}`,
				});
			}
		}

		private renderPackStepDetails(
			parent: HTMLElement,
			stepId: string,
			details:
				| PackRunTransparency["retriever"]
				| PackRunTransparency["synthesizer"]
				| PackRunTransparency["verifier"],
		): void {
			if (stepId === "retriever" && "notesFoundCount" in details) {
				parent.createEl("div", {
					cls: "open-agent-work-brief",
					text: details.brief ?? "No details captured.",
				});
				return;
			}
			if (stepId === "synthesizer" && "claimCount" in details) {
				parent.createEl("div", {
					cls: "open-agent-work-brief",
					text: truncateAgentWorkPreview(details.summary ?? ""),
				});
				parent.createEl("div", { cls: "open-agent-work-raw-json-label", text: "Raw JSON" });
				const rawJson = parent.createEl("pre", { cls: "open-agent-work-raw-json" });
				rawJson.setText(safeStringify(details.rawJson ?? {}));
				return;
			}
			if (stepId === "verifier" && "reasons" in details) {
				for (const reason of details.reasons ?? []) {
					const row = parent.createDiv({ cls: "open-agent-work-verifier-row" });
					row.createEl("span", {
						cls: verifierReasonStatusClass(reason.status),
						text: claimStatusLabel(reason.status),
					});
					row.createEl("span", {
						cls: "open-agent-work-verifier-claim",
						text: truncateClaimPreview(reason.claimText),
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
		}

		private renderNotePathChip(parent: HTMLElement, path: string): void {
			const chip = parent.createEl("span", {
				cls: "open-agent-work-note-path",
				text: path,
			});
			chip.addEventListener("click", (event) => {
				(event as MouseEvent & { stopPropagation?: () => void }).stopPropagation?.();
				this.openStoredNote(path);
			});
		}

		private renderResearchMarkdown(parent: HTMLElement, markdown: string, citations: NonNullable<StoredPackTurnData["citations"]>): void {
			for (const paragraph of markdown.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean)) {
				const paragraphEl = parent.createEl("p");
				this.renderResearchParagraph(paragraphEl, paragraph, citations);
			}
		}

		private renderResearchParagraph(
			parent: HTMLElement,
			paragraph: string,
			citations: NonNullable<StoredPackTurnData["citations"]>,
		): void {
			const citationPattern = /\[(\d+)\]\(openagent:\/\/citation\/\1\)/g;
			let cursor = 0;
			for (const match of paragraph.matchAll(citationPattern)) {
				const index = match.index ?? 0;
				if (index > cursor) {
					parent.appendText(paragraph.slice(cursor, index));
				}
				const citationIndex = Number(match[1]) - 1;
				const citation = citations[citationIndex];
				if (!citation) {
					parent.appendText(match[0]);
				} else {
					const link = parent.createEl("button", {
						cls: "open-agent-citation-link",
						text: `[${citationIndex + 1}]`,
					});
					link.setAttribute("type", "button");
					link.addEventListener("click", (event) => {
						event.preventDefault();
						void this.openCitationTarget(citation);
					});
				}
				cursor = index + match[0].length;
			}
			if (cursor < paragraph.length) {
				parent.appendText(paragraph.slice(cursor));
			}
		}

		private async openCitationTarget(citation: ExactPhraseAnchor): Promise<void> {
			const file = this.app.vault.getAbstractFileByPath(citation.notePath);
			if (!(file instanceof TFile)) {
				new Notice(`Not found: ${citation.notePath}`);
				return;
			}
			const leaf = this.app.workspace.getLeaf(false);
			const noteBody = await this.app.vault.cachedRead(file);
			const resolution = resolveCitationTarget(citation, noteBody);
			if (resolution.kind === "fallback") {
				await leaf.openFile(file);
				new Notice(resolution.message);
				return;
			}
			await leaf.openFile(file, {
				active: true,
				eState: {
					selection: {
						from: offsetToEditorPosition(noteBody, resolution.startOffset),
						to: offsetToEditorPosition(noteBody, resolution.endOffset),
					},
				},
			});
		}

		private getPackStepDetails(
			stepId: string,
			agentWork: PackRunTransparency | undefined,
		):
			| PackRunTransparency["retriever"]
			| PackRunTransparency["synthesizer"]
			| PackRunTransparency["verifier"]
			| null {
			if (!agentWork) return null;
			switch (stepId) {
				case "retriever":
					return agentWork.retriever;
				case "synthesizer":
					return agentWork.synthesizer;
				case "verifier":
					return agentWork.verifier;
				default:
					return null;
			}
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
				if (claim.exactPhraseAnchor) {
					void this.openCitationTarget(claim.exactPhraseAnchor);
				} else {
					this.openStoredNote(claim.sourceNote);
				}
			});
			meta.createEl("span", { cls: "open-agent-claim-source", text: sourceNoteLabel(claim.sourceNote) });

			const details = card.createDiv({ cls: "open-agent-claim-details" });
			const shouldExpand = claim.status !== "verified";
			const toggle = meta.createEl("button", {
				text: shouldExpand ? "Hide evidence" : "Show evidence",
				cls: "open-agent-claim-toggle",
			});
			details.classList.toggle("is-hidden", !shouldExpand);
			toggle.addEventListener("click", () => {
				const open = details.classList.contains("is-hidden");
				details.classList.toggle("is-hidden", !open);
				toggle.textContent = open ? "Hide evidence" : "Show evidence";
			});

			details.createEl("div", {
				cls: "open-agent-claim-quote",
				text: claim.quotePresent ? claim.sourceQuote : "Quoted text not found in the live note.",
			});
			if (claim.supportExplanation.trim().length > 0) {
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

function toolStatusIcon(s: ToolCallRecord["status"]): string {
	switch (s) {
		case "running":
			return "◌";
		case "awaiting-consent":
			return "⚠";
		case "ok":
			return "✓";
		case "error":
			return "ⓧ";
		case "denied":
			return "ⓧ";
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

function markPackStopped(steps: StoredPackProgressStep[]): void {
	const running = steps.find((step) => step.state === "running");
	if (!running) return;
	running.state = "failed";
	running.message = "Stopped by user.";
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

function truncateAgentWorkPreview(text: string): string {
	const normalized = text.replace(/\r\n/g, "\n").trim();
	if (!normalized) return "";
	const twoLines = normalized.split("\n").slice(0, 2).join(" ");
	if (twoLines.length <= 140 && twoLines === normalized.replace(/\n/g, " ")) return twoLines;
	const truncated = twoLines.slice(0, 140).trimEnd();
	return `${truncated.replace(/[.,;:!?-]$/, "")}…`;
}

function truncateClaimPreview(text: string): string {
	const normalized = text.trim();
	if (normalized.length <= 96) return normalized;
	return `${normalized.slice(0, 96).trimEnd()}…`;
}

function packStepTitle(step: StoredPackProgressStep): string {
	switch (step.id) {
		case "retriever":
			return "Retriever";
		case "synthesizer":
			return "Synthesizer";
		case "verifier":
			return "Verifier";
		default:
			return step.label;
	}
}

function packStepStateLabel(state: StoredPackProgressStep["state"]): string {
	switch (state) {
		case "pending":
			return "Pending";
		case "running":
			return "Running";
		case "complete":
			return "Complete";
		case "failed":
			return "Failed";
	}
}

function toPackRunStepId(stepId: string): "retriever" | "synthesizer" | "verifier" {
	switch (stepId) {
		case "retriever":
		case "synthesizer":
		case "verifier":
			return stepId;
		default:
			return "verifier";
	}
}

function verifierReasonStatusClass(status: StoredPackClaim["status"]): string {
	switch (status) {
		case "verified":
			return "open-agent-work-chip open-agent-work-chip-verified";
		case "unsupported":
			return "open-agent-work-chip open-agent-work-chip-unsupported";
		case "quote-missing":
			return "open-agent-work-chip open-agent-work-chip-quote-missing";
	}
}

function offsetToEditorPosition(text: string, offset: number): { line: number; ch: number } {
	const boundedOffset = Math.max(0, Math.min(offset, text.length));
	const preceding = text.slice(0, boundedOffset).split("\n");
	const line = preceding.length - 1;
	const ch = preceding[preceding.length - 1]?.length ?? 0;
	return { line, ch };
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
