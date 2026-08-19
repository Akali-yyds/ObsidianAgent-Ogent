import { MarkdownView, Notice, Platform, Plugin, TFile, Workspace, WorkspaceLeaf } from "obsidian";
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
const LEGACY_PLUGIN_DIRS = ["obsidian-agent-ogent", "open-agent"];

export default class OpenAgentPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	sessionStore!: SessionStore;
	private toolRegistry!: ToolRegistry;
	private undo!: UndoBuffer;
	private lastMarkdownPath: string | null = null;

	async onload(): Promise<void> {
		const pluginDir = this.manifest.dir ?? this.manifest.id;
		const sessionsDir = `${pluginDir}/sessions`;
		await this.migrateLegacyPluginData(pluginDir, sessionsDir);
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
		const rememberCurrentMarkdown = (file: TFile | null): void => {
			if (!file) return;
			this.lastMarkdownPath = file.path;
		};
		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
			rememberCurrentMarkdown(leaf ? this.fileFromLeaf(leaf) : null);
		}));
		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			rememberCurrentMarkdown(file);
		}));
		const recoveryIssues = this.sessionStore.getRecoveryIssues();
		if (recoveryIssues.length === 1) {
			new Notice(recoveryIssues[0].message);
		} else if (recoveryIssues.length > 1) {
			new Notice(`Recovered ${recoveryIssues.length} unreadable chat histories. Open Ogent to review the backup locations.`);
		}
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
				getCurrentContext: () => this.getCurrentContext(),
				getVaultRules: () => loadVaultRules(this.app),
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
			packProviderOverrides?: unknown;
		}) | null;
		const hadRemovedPackSettings = Boolean(data && Object.prototype.hasOwnProperty.call(data, "packProviderOverrides"));
		const settingsData = data ? { ...data } : {};
		delete settingsData.packProviderOverrides;
		this.settings = {
			...DEFAULT_SETTINGS,
			...settingsData,
			consent: { ...DEFAULT_SETTINGS.consent, ...(data?.consent ?? {}) },
		};
		const rawSessions = Array.isArray(data?.sessions)
			? (data.sessions as (SessionMeta & { turns?: StoredTurn[] })[])
			: [];
		const activeId = typeof data?.activeSessionId === "string" ? data.activeSessionId : "";
		await this.sessionStore.init(rawSessions, activeId);
		if (hadRemovedPackSettings) await this.saveData({ ...this.settings, ...this.sessionStore.toJSON() });
	}

	async saveSettings(): Promise<void> {
		await this.saveData({ ...this.settings, ...this.sessionStore.toJSON() });
		window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
	}

	/**
	 * The plugin was originally deployed as `open-agent`. Keep that installation
	 * intact, but import its settings and session files when the fork is first
	 * installed under its own community-plugin id.
	 */
	private async migrateLegacyPluginData(pluginDir: string, sessionsDir: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const configDir = this.app.vault.configDir;
		const currentDataPath = `${configDir}/plugins/${pluginDir}/data.json`;
		let importedSettings = false;
		let migratedSessions = 0;

		if (!(await adapter.exists(currentDataPath))) {
			for (const legacyDir of LEGACY_PLUGIN_DIRS) {
				const legacyDataPath = `${configDir}/plugins/${legacyDir}/data.json`;
				if (!(await adapter.exists(legacyDataPath))) continue;
				try {
					const parsed = JSON.parse(await adapter.read(legacyDataPath)) as unknown;
					if (isRecord(parsed)) {
						await adapter.write(currentDataPath, JSON.stringify(parsed));
						importedSettings = true;
						break;
					}
				} catch {
					// Try the next legacy location if this file is malformed.
				}
			}
		}

		for (const legacyDir of LEGACY_PLUGIN_DIRS) {
			const legacySessionsDir = `${configDir}/plugins/${legacyDir}/sessions`;
			if (!(await adapter.exists(legacySessionsDir))) continue;
			try {
				if (!(await adapter.exists(sessionsDir))) await adapter.mkdir(sessionsDir);
				const listing = await adapter.list(legacySessionsDir);
				for (const legacyPath of listing.files) {
					if (!legacyPath.startsWith(`${legacySessionsDir}/`)) continue;
					const fileName = legacyPath.slice(legacySessionsDir.length + 1);
					if (!fileName || fileName.includes("/")) continue;
					const newPath = `${sessionsDir}/${fileName}`;
					if (await adapter.exists(newPath)) continue;
					await adapter.write(newPath, await adapter.read(legacyPath));
					migratedSessions++;
				}
			} catch {
				// Session migration is best-effort; legacy installations remain intact.
			}
		}

		if (importedSettings || migratedSessions > 0) {
			const details = [
				importedSettings ? "settings" : "",
				migratedSessions > 0 ? `${migratedSessions} chat file${migratedSessions === 1 ? "" : "s"}` : "",
			].filter(Boolean).join(" and ");
			new Notice(`Migrated ${details} from the previous plugin installation. You can disable the old plugin now.`);
		}
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
			if (op.kind === "rename" && op.beforePath && op.afterPath) {
				const renamed = this.app.vault.getAbstractFileByPath(op.afterPath);
				if (!(renamed instanceof TFile)) throw new Error(`File not found: ${op.afterPath}`);
				if (this.app.vault.getAbstractFileByPath(op.beforePath)) throw new Error(`Destination already exists: ${op.beforePath}`);
				await this.app.vault.rename(renamed, op.beforePath);
				new Notice(`Reverted ${op.afterPath} to ${op.beforePath}`);
				return;
			}
			const file = this.app.vault.getAbstractFileByPath(op.path);
			if (op.before === null) {
				if (file instanceof TFile) await this.app.fileManager.trashFile(file);
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

	private async undoLastCheckpoint(): Promise<void> {
		const operations = this.undo.popLastCheckpoint();
		if (operations.length === 0) {
			new Notice("No Agent checkpoint to undo");
			return;
		}
		try {
			for (const op of operations) {
				if (op.kind === "rename" && op.beforePath && op.afterPath) {
					const renamed = this.app.vault.getAbstractFileByPath(op.afterPath);
					if (!(renamed instanceof TFile)) throw new Error(`File not found: ${op.afterPath}`);
					if (this.app.vault.getAbstractFileByPath(op.beforePath)) throw new Error(`Destination already exists: ${op.beforePath}`);
					await this.app.vault.rename(renamed, op.beforePath);
					continue;
				}
				const file = this.app.vault.getAbstractFileByPath(op.path);
				if (op.before === null) {
					if (file instanceof TFile) await this.app.fileManager.trashFile(file);
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
		return this.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function focusLeaf(workspace: Workspace, leaf: WorkspaceLeaf): void {
	workspace.setActiveLeaf(leaf, { focus: true });
}
