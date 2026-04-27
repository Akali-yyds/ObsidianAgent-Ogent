import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type { ConsentManager } from "./consent/manager";
import type { UndoBuffer } from "./consent/undo";
import { runTurn } from "./loop";
import { OpenAICompatibleProvider } from "./provider";
import { isConfigured, type PluginSettings } from "./settings";
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
}

export class ChatView extends ItemView {
	private readonly deps: ChatViewDeps;

	private transcriptEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtn!: HTMLButtonElement;
	private stopBtn!: HTMLButtonElement;
	private hintEl!: HTMLElement;

	private turns: UiTurn[] = [];
	private inFlight: AbortController | null = null;
	private boundOnSettingsChanged: () => void;

	constructor(leaf: WorkspaceLeaf, deps: ChatViewDeps) {
		super(leaf);
		this.deps = deps;
		this.boundOnSettingsChanged = () => this.refreshConfiguredState();
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}
	getDisplayText(): string {
		return "OpenAgent";
	}
	getIcon(): string {
		return "bot";
	}

	prefillInput(text: string): void {
		this.inputEl.value = text;
		this.inputEl.focus();
		this.inputEl.setSelectionRange(text.length, text.length);
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("open-agent-view");

		this.hintEl = root.createDiv({ cls: "open-agent-hint" });
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
		this.refreshConfiguredState();
		this.renderTranscript();
	}

	async onClose(): Promise<void> {
		window.removeEventListener("open-agent:settings-changed", this.boundOnSettingsChanged);
		this.cancelInFlight();
		this.deps.consent.resetSession();
		this.deps.undo.clear();
	}

	cancelInFlight(): void {
		this.inFlight?.abort();
		this.inFlight = null;
	}

	private refreshConfiguredState(): void {
		const ok = isConfigured(this.deps.getSettings());
		this.sendBtn.disabled = !ok || this.inFlight !== null;
		this.hintEl.empty();
		if (!ok) {
			this.hintEl.appendText("Provider not configured. ");
			const link = this.hintEl.createEl("a", { text: "Open settings", href: "#" });
			link.addEventListener("click", (e) => {
				e.preventDefault();
				this.deps.openSettings();
			});
		}
	}

	private async handleSend(): Promise<void> {
		const text = this.inputEl.value.trim();
		if (!text) return;
		const settings = this.deps.getSettings();
		if (!isConfigured(settings)) {
			this.refreshConfiguredState();
			return;
		}

		this.turns.push({ role: "user", content: text, segments: [], toolCallMap: {}, thinking: false });
		const assistantTurn: UiTurn = { role: "assistant", content: "", segments: [], toolCallMap: {}, thinking: true };
		this.turns.push(assistantTurn);
		this.inputEl.value = "";
		this.renderTranscript();

		const provider = new OpenAICompatibleProvider({
			baseUrl: settings.baseUrl,
			apiKey: settings.apiKey,
			model: settings.model,
		});

		// Build the message history from prior user/assistant exchanges (skip the placeholder assistantTurn).
		const messages: ChatMessage[] = [];
		for (const t of this.turns) {
			if (t === assistantTurn) continue;
			if (t.role === "user") {
				messages.push({ role: "user", content: t.content });
			} else if (t.role === "assistant") {
				const text = t.segments
					.filter((s): s is { kind: "text"; text: string } => s.kind === "text")
					.map((s) => s.text)
					.join("");
				if (text.length > 0) messages.push({ role: "assistant", content: text });
			}
		}

		const ctrl = new AbortController();
		this.inFlight = ctrl;
		this.setBusy(true);

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
					this.renderTranscript();
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
				} else if (ev.kind === "cap_hit") {
					assistantTurn.capHit = true;
				}
				this.renderTranscript();
			}
		} catch (err) {
			this.applyErrorToTurn(assistantTurn, err);
		} finally {
			if (ctrl.signal.aborted) {
				assistantTurn.interrupted = true;
				this.deps.consent.dismissActiveModal();
			}
			this.inFlight = null;
			this.setBusy(false);
			this.renderTranscript();
		}
	}

	private handleStop(): void {
		if (!this.inFlight) return;
		this.inFlight.abort();
		this.deps.consent.dismissActiveModal();
		new Notice("Stopped");
	}

	private setBusy(busy: boolean): void {
		this.stopBtn.disabled = !busy;
		this.sendBtn.disabled = busy || !isConfigured(this.deps.getSettings());
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
			const row = this.transcriptEl.createDiv({ cls: `open-agent-turn open-agent-turn-${turn.role}` });
			row.createEl("div", { cls: "open-agent-turn-role", text: turn.role === "user" ? "You" : "Assistant" });

			if (turn.role === "user") {
				if (turn.content.length > 0) {
					const body = row.createEl("div", { cls: "open-agent-turn-body" });
					body.setText(turn.content);
				}
			} else {
				if (turn.thinking) {
					row.createEl("div", { cls: "open-agent-turn-thinking" });
				}
				for (const seg of turn.segments) {
					if (seg.kind === "text") {
						if (seg.text.length > 0) {
							const body = row.createEl("div", { cls: "open-agent-turn-body" });
							body.setText(seg.text);
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
					text: "non-streaming response — your endpoint blocks browser CORS",
				});
			}
			if (turn.capHit) {
				row.createEl("div", {
					cls: "open-agent-turn-meta",
					text: "(stopped: hit max-steps cap)",
				});
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
					link.addEventListener("click", (e) => {
						e.preventDefault();
						this.deps.openSettings();
					});
				}
			}
		}
		this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
	}

	private renderToolCard(parent: HTMLElement, tc: ToolCallRecord): void {
		const cls = ["open-agent-tool-card"];
		if (tc.mutates) cls.push("open-agent-tool-mutates");
		if (tc.status === "ok") cls.push("open-agent-tool-ok");
		if (tc.status === "error") cls.push("open-agent-tool-error");
		if (tc.status === "denied") cls.push("open-agent-tool-denied");

		const card = parent.createEl("details", { cls: cls.join(" ") });
		const summary = card.createEl("summary", { cls: "open-agent-tool-summary" });
		summary.createEl("span", { cls: "open-agent-tool-name", text: tc.name });
		summary.createEl("span", { cls: "open-agent-tool-args", text: summarizeArgs(tc.args) });
		summary.createEl("span", { cls: "open-agent-tool-status", text: statusLabel(tc.status) });

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
