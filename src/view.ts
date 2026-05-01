import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type { ConsentChoice, ConsentManager } from "./consent/manager";
import type { UndoBuffer } from "./consent/undo";
import { diffLines, type DiffRow } from "./consent/diff";
import { renderRows } from "./consent/render-diff";
import { runTurn } from "./loop";
import { OpenAICompatibleProvider } from "./provider";
import { isConfigured, type PluginSettings } from "./settings";
import type { SessionStore, StoredTurn } from "./sessions";
import { splitFrontmatter, mergeFrontmatter, stitchFrontmatter } from "./tools/vault/frontmatter";
import type { ToolRegistry } from "./tools/registry";
import { AuthError, type ChatMessage, NetworkError, ProviderError, RateLimitError, type ToolResult } from "./types";

export const CHAT_VIEW_TYPE = "open-agent-chat";

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
}

export interface ChatViewDeps {
	getSettings: () => PluginSettings;
	openSettings: () => void;
	tools: ToolRegistry;
	consent: ConsentManager;
	undo: UndoBuffer;
	sessionStore: SessionStore;
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
		this.sessionRenameEl.style.display = "none";
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
		newBtn.addEventListener("click", async () => {
			await this.deps.sessionStore.create();
			this.turns = [];
			this.refreshHeader();
			this.renderTranscript();
		});

		// Delete session button
		const deleteBtn = sessionBar.createEl("button", { text: "Delete", cls: "open-agent-session-delete" });
		deleteBtn.addEventListener("click", async () => {
			if (!confirm("Delete this session?")) return;
			const id = this.deps.sessionStore.getActive().id;
			await this.deps.sessionStore.delete(id);
			const session = this.deps.sessionStore.getActive();
			this.turns = this.storedToUiTurns(session.turns);
			this.refreshHeader();
			this.renderTranscript();
		});

		// Sessions panel (hidden by default)
		this.sessionsPanelEl = header.createDiv({ cls: "open-agent-sessions-panel" });
		this.sessionsPanelEl.style.display = "none";

		this.sessionsSearchEl = this.sessionsPanelEl.createEl("input", {
			cls: "open-agent-sessions-search",
			attr: { type: "text", placeholder: "Search sessions…" },
		});
		this.sessionsSearchEl.addEventListener("input", () => {
			this.refreshSessionsList(this.sessionsSearchEl.value);
		});

		this.sessionsListEl = this.sessionsPanelEl.createDiv({ cls: "open-agent-sessions-list" });

		// Model bar
		const modelBar = header.createDiv({ cls: "open-agent-model-bar" });
		modelBar.createEl("span", { text: "Model:", cls: "open-agent-model-label" });

		const datalistId = "open-agent-model-list";
		this.modelInputEl = modelBar.createEl("input", {
			cls: "open-agent-model-input",
			attr: { type: "text", list: datalistId },
		});
		this.modelInputEl.addEventListener("change", async () => {
			const model = this.modelInputEl.value.trim();
			const session = this.deps.sessionStore.getActive();
			await this.deps.sessionStore.updateModel(session.id, model);
		});
		this.modelInputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.modelInputEl.blur();
		});

		this.modelDatalistEl = modelBar.createEl("datalist", { attr: { id: datalistId } });

		this.refreshHeader();
	}

	private refreshHeader(): void {
		const active = this.deps.sessionStore.getActive();
		const settings = this.deps.getSettings();
		this.sessionTitleEl.setText(active.title);
		this.modelInputEl.value = active.model.trim().length > 0 ? active.model : settings.model;
	}

	private toggleSessionsPanel(): void {
		this.sessionsPanelVisible = !this.sessionsPanelVisible;
		this.sessionsPanelEl.style.display = this.sessionsPanelVisible ? "" : "none";
		if (this.sessionsPanelVisible) {
			this.sessionsSearchEl.value = "";
			this.refreshSessionsList("");
			this.sessionsSearchEl.focus();
		}
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
			item.addEventListener("click", async () => {
				this.sessionsPanelVisible = false;
				this.sessionsPanelEl.style.display = "none";
				await this.deps.sessionStore.switchTo(s.id);
				const session = this.deps.sessionStore.getActive();
				// Prefer live in-memory turns (stream still running) over stale stored state
				this.turns = this.liveTurns.get(s.id) ?? this.storedToUiTurns(session.turns);
				this.refreshHeader();
				this.refreshBusyState();
				this.renderTranscript();
			});
		}

		if (filtered.length === 0) {
			this.sessionsListEl.createDiv({ cls: "open-agent-sessions-empty", text: "No sessions found" });
		}
	}

	private startRename(): void {
		if (this.isRenaming) return;
		this.isRenaming = true;
		const session = this.deps.sessionStore.getActive();
		this.preRenameTitle = session.title;
		this.sessionTitleEl.style.display = "none";
		this.sessionRenameEl.value = session.title;
		this.sessionRenameEl.style.display = "";
		this.sessionRenameEl.focus();
		this.sessionRenameEl.select();
	}

	private finishRename(): void {
		if (!this.isRenaming) return;
		this.isRenaming = false;
		const newTitle = this.sessionRenameEl.value.trim();
		const session = this.deps.sessionStore.getActive();
		const title = newTitle.length > 0 ? newTitle : this.preRenameTitle;
		this.sessionRenameEl.style.display = "none";
		this.sessionTitleEl.setText(title);
		this.sessionTitleEl.style.display = "";
		if (title !== session.title) {
			void this.deps.sessionStore.rename(session.id, title);
		}
	}

	private cancelRename(): void {
		if (!this.isRenaming) return;
		this.isRenaming = false;
		this.sessionRenameEl.style.display = "none";
		this.sessionTitleEl.style.display = "";
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
		const ok = isConfigured(this.deps.getSettings());
		this.hintEl.empty();
		if (!ok) {
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
		const ok = isConfigured(this.deps.getSettings());
		this.sendBtn.disabled = !ok || busy;
		this.stopBtn.disabled = !busy;
		this.inputEl.disabled = busy;
		if (this.sessionsPanelVisible) {
			this.refreshSessionsList(this.sessionsSearchEl.value);
		}
	}

	// ─── Send / stop ──────────────────────────────────────────────────────────

	private async handleSend(): Promise<void> {
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
		this.renderTranscript();

		if (isFirstMessage) {
			await this.deps.sessionStore.rename(sessionId, text.slice(0, 60));
			this.refreshHeader();
		}

		// Read model directly from input element to catch values not yet flushed via change event.
		const inputModel = this.modelInputEl.value.trim();
		const sessionModel = session.model.trim();
		const model = (inputModel.length > 0 ? inputModel : sessionModel) || settings.model;
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
		for (const t of this.turns) {
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

		const ctrl = new AbortController();
		this.inFlights.set(sessionId, ctrl);
		this.liveTurns.set(sessionId, turnSnapshot);
		this.refreshBusyState();

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
					await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
					requestAnimationFrame(() => {
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

				if (turn.thinking) {
					row.createEl("div", { cls: "open-agent-turn-thinking" });
				}
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
