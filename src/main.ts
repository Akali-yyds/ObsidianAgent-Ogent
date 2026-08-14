import { Notice, Platform, Plugin, TFile, Workspace, WorkspaceLeaf } from "obsidian";
import { ensureDefaultPacks, loadPacks } from "./packs/loader";
import { runPack, type PackRuntimeEvent, type PackRunResult } from "./packs/runtime";
import type { AgentPack } from "./packs/types";
import { ConsentManager } from "./consent/manager";
import { UndoBuffer } from "./consent/undo";
import { OpenAgentSettingsTab, DEFAULT_SETTINGS, type PluginSettings } from "./settings";
import { SessionStore, loadStoredTurnsFile, type SessionMeta, type StoredTurn } from "./sessions";
import { ToolRegistry } from "./tools/registry";
import { vaultTools } from "./tools/vault";
import { communityPluginSearchTool } from "./tools/community/search";
import { webSearchTool } from "./tools/web-search";
import { webFetchTool } from "./tools/web-fetch";
import type { VaultContext } from "./context";
import { loadVaultRules } from "./rules";
import { CHAT_VIEW_TYPE, ChatView } from "./view";

const SETTINGS_CHANGED_EVENT = "open-agent:settings-changed";
const CONTEXT_CHANGED_EVENT = "open-agent:context-changed";

export default class OpenAgentPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	sessionStore!: SessionStore;
	private toolRegistry!: ToolRegistry;
	private undo!: UndoBuffer;
	private lastMarkdownPath: string | null = null;

	async onload(): Promise<void> {
		const pluginDir = this.manifest.dir ?? this.manifest.id;
		const sessionsDir = `${pluginDir}/sessions`;
		let sessionsDirEnsured = false;
		const ensureSessionsDir = async () => {
			if (sessionsDirEnsured) return;
			if (!(await this.app.vault.adapter.exists(sessionsDir))) {
				await this.app.vault.adapter.mkdir(sessionsDir);
			}
			sessionsDirEnsured = true;
		};

		this.sessionStore = new SessionStore({
			persistIndex: async (meta, activeId) => {
				await this.saveData({ ...this.settings, sessions: meta, activeSessionId: activeId });
			},
			readTurns: async (id) => loadStoredTurnsFile({
				adapter: this.app.vault.adapter,
				path: `${sessionsDir}/${id}.json`,
			}),
			writeTurns: async (id, turns) => {
				await ensureSessionsDir();
				await this.app.vault.adapter.write(
					`${sessionsDir}/${id}.json`,
					JSON.stringify({ turns }),
				);
			},
			deleteTurns: async (id) => {
				const path = `${sessionsDir}/${id}.json`;
				if (await this.app.vault.adapter.exists(path)) {
					await this.app.vault.adapter.remove(path);
				}
			},
		});

		await this.loadSettings();
		this.lastMarkdownPath = this.findCurrentMarkdownFile()?.path ?? null;
		const publishContextChanged = (file: TFile | null): void => {
			if (!file) return;
			this.lastMarkdownPath = file.path;
			window.dispatchEvent(new CustomEvent(CONTEXT_CHANGED_EVENT, { detail: { path: file.path } }));
		};
		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
			publishContextChanged(leaf ? this.fileFromLeaf(leaf) : null);
		}));
		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			publishContextChanged(file);
		}));
		const recoveryIssues = this.sessionStore.getRecoveryIssues();
		if (recoveryIssues.length === 1) {
			new Notice(recoveryIssues[0].message);
		} else if (recoveryIssues.length > 1) {
			new Notice(`Recovered ${recoveryIssues.length} unreadable chat histories. Open OpenAgent to review the backup locations.`);
		}
		await ensureDefaultPacks(this.app, pluginDir);

		this.toolRegistry = new ToolRegistry();
		this.undo = new UndoBuffer(50);
		this.toolRegistry.registerAll(vaultTools(this.app, { undo: this.undo }));
		this.toolRegistry.register(communityPluginSearchTool(this.app, { pluginDir }));
		this.toolRegistry.register(webSearchTool(() => ({
			provider: this.settings.webSearchProvider,
			apiKey: this.settings.webSearchApiKey,
		})));
		this.toolRegistry.register(webFetchTool());
		for (const toolName of this.settings.disabledTools ?? []) this.toolRegistry.setEnabled(toolName, false);

		this.registerView(CHAT_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			const consent = new ConsentManager(() => this.settings.consent);
			return new ChatView(leaf, {
				getSettings: () => this.settings,
				openSettings: () => this.openSettings(),
				tools: this.toolRegistry,
				consent,
				undo: this.undo,
				sessionStore: this.sessionStore,
				getPacks: () => this.getPacks(),
				getCurrentContext: () => this.getCurrentContext(),
				getVaultRules: () => loadVaultRules(this.app),
				loadDocumentContent: async (path: string) => {
					const file = this.app.vault.getAbstractFileByPath(path);
					return file instanceof TFile ? this.app.vault.cachedRead(file) : null;
				},
				runPack: (pack, query, signal, onEvent) => this.runPack(pack, query, signal, onEvent),
			});
		});

		this.addRibbonIcon("bot", "Open agent", () => this.activateView());

		this.addCommand({
			id: "open-panel",
			name: "Open panel",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "ask-about-current-note",
			name: "Ask agent about current note",
			callback: () => this.askAboutCurrentNote(),
		});

		this.addCommand({
			id: "undo-last-tool-write",
			name: "Undo last tool write",
			callback: () => this.undoLastWrite(),
		});

		this.addCommand({
			id: "undo-last-agent-checkpoint",
			name: "Undo last Agent checkpoint",
			callback: () => this.undoLastCheckpoint(),
		});

		this.addSettingTab(new OpenAgentSettingsTab(this.app, this));
	}

	onunload(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)) {
			if (leaf.view instanceof ChatView) leaf.view.cancelInFlight();
		}
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as (Partial<PluginSettings> & {
			sessions?: unknown;
			activeSessionId?: unknown;
		}) | null;
		this.settings = {
			...DEFAULT_SETTINGS,
			...(data ?? {}),
			consent: { ...DEFAULT_SETTINGS.consent, ...(data?.consent ?? {}) },
		};
		const rawSessions = Array.isArray(data?.sessions)
			? (data.sessions as (SessionMeta & { turns?: StoredTurn[] })[])
			: [];
		const activeId = typeof data?.activeSessionId === "string" ? data.activeSessionId : "";
		await this.sessionStore.init(rawSessions, activeId);
	}

	async saveSettings(): Promise<void> {
		await this.saveData({ ...this.settings, ...this.sessionStore.toJSON() });
		window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
	}

	private async activateView(): Promise<ChatView | null> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		if (existing.length > 0) {
			focusLeaf(workspace, existing[0]);
			return existing[0].view instanceof ChatView ? existing[0].view : null;
		}
		const leaf = Platform.isMobile ? workspace.getLeaf("tab") : workspace.getRightLeaf(false);
		if (!leaf) return null;
		await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
		focusLeaf(workspace, leaf);
		return leaf.view instanceof ChatView ? leaf.view : null;
	}

	private async askAboutCurrentNote(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active note");
			return;
		}
		const view = await this.activateView();
		if (!view) return;
		view.prefillInput(`Tell me about [[${file.basename}]]`);
	}

	private async undoLastWrite(): Promise<void> {
		const op = this.undo.pop();
		if (!op) {
			new Notice("Nothing to undo");
			return;
		}
		try {
			const file = this.app.vault.getAbstractFileByPath(op.path);
			if (op.before === null) {
				if (file instanceof TFile) await this.app.vault.trash(file, true);
			} else if (file instanceof TFile) {
				await this.app.vault.modify(file, op.before);
			} else {
				await this.app.vault.create(op.path, op.before);
			}
			new Notice(`Reverted ${op.path}`);
		} catch (err) {
			new Notice(`Undo failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private openSettings(): void {
		const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(this.manifest.id);
	}

	private async getPacks(): Promise<AgentPack[]> {
		return loadPacks(this.app, this.manifest.dir ?? this.manifest.id);
	}

	private async runPack(
		pack: AgentPack,
		query: string,
		signal?: AbortSignal,
		onEvent?: (event: PackRuntimeEvent) => void | Promise<void>,
	): Promise<PackRunResult> {
		return runPack({
			app: this.app,
			pack,
			query,
			activeFilePath: this.getCurrentContext().activeFilePath,
			signal,
			onEvent,
			providerOverrides: this.settings.packProviderOverrides[pack.id],
		});
	}

	private async undoLastCheckpoint(): Promise<void> {
		const operations = this.undo.popLastCheckpoint();
		if (operations.length === 0) {
			new Notice("No Agent checkpoint to undo");
			return;
		}
		try {
			for (const op of operations) {
				const file = this.app.vault.getAbstractFileByPath(op.path);
				if (op.before === null) {
					if (file instanceof TFile) await this.app.vault.trash(file, true);
				} else if (file instanceof TFile) {
					await this.app.vault.modify(file, op.before);
				} else {
					await this.app.vault.create(op.path, op.before);
				}
			}
			new Notice(`Reverted ${operations.length} Agent change${operations.length === 1 ? "" : "s"}`);
		} catch (err) {
			new Notice(`Checkpoint undo failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	getToolNames(): string[] {
		return this.toolRegistry?.listAll().map((tool) => tool.name) ?? [];
	}

	isToolEnabled(name: string): boolean {
		return this.toolRegistry?.isEnabled(name) ?? false;
	}

	async setToolEnabled(name: string, enabled: boolean): Promise<void> {
		this.toolRegistry?.setEnabled(name, enabled);
		const disabled = new Set(this.settings.disabledTools ?? []);
		if (enabled) disabled.delete(name);
		else disabled.add(name);
		this.settings.disabledTools = [...disabled].sort();
		await this.saveSettings();
	}

	private getCurrentContext(): VaultContext {
		const file = this.findCurrentMarkdownFile();
		if (!file) return { activeFilePath: null, activeFolderPath: null, activeFileName: null };
		const slash = file.path.lastIndexOf("/");
		const cache = this.app.metadataCache.getFileCache(file) as {
			tags?: Array<{ tag?: string }>;
			frontmatter?: Record<string, unknown>;
			links?: Array<{ link?: string }>;
			headings?: Array<{ heading?: string; position?: { start?: { line?: number } } }>;
		} | null;
		const editor = this.getActiveEditor();
		const selectionText = editor?.getSelection?.() ?? "";
		const cursorLine = editor?.getCursor?.()?.line;
		const currentHeading = typeof cursorLine === "number"
			? cache?.headings?.slice().reverse().find((heading) =>
				typeof heading.position?.start?.line === "number" && heading.position.start.line <= cursorLine,
			)?.heading ?? null
			: null;
		return {
			activeFilePath: file.path,
			activeFolderPath: slash > 0 ? file.path.slice(0, slash) : null,
			activeFileName: file.name,
			selectionText: selectionText.trim() || null,
			currentHeading,
			tags: cache?.tags?.map((entry) => entry.tag).filter((tag): tag is string => Boolean(tag)) ?? [],
			properties: cache?.frontmatter ?? {},
			linkedNotes: cache?.links?.map((entry) => entry.link).filter((link): link is string => Boolean(link)) ?? [],
		};
	}

	private getActiveEditor(): {
		getSelection?: () => string;
		getCursor?: () => { line: number; ch: number };
	} | null {
		const activeLeaf = this.app.workspace.activeLeaf;
		const view = activeLeaf?.view as unknown as { editor?: {
			getSelection?: () => string;
			getCursor?: () => { line: number; ch: number };
		} } | undefined;
		return view?.editor ?? null;
	}

	private findCurrentMarkdownFile(): TFile | null {
		const active = this.app.workspace.getActiveFile();
		if (active) return active;
		if (this.lastMarkdownPath) {
			const remembered = this.app.vault.getAbstractFileByPath(this.lastMarkdownPath);
			if (remembered instanceof TFile) return remembered;
		}
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const file = this.fileFromLeaf(leaf);
			if (file) return file;
		}
		return null;
	}

	private fileFromLeaf(leaf: WorkspaceLeaf): TFile | null {
		const file = (leaf.view as unknown as { file?: unknown }).file;
		return file instanceof TFile ? file : null;
	}
}

function focusLeaf(workspace: Workspace, leaf: WorkspaceLeaf): void {
	workspace.setActiveLeaf(leaf, { focus: true });
}
