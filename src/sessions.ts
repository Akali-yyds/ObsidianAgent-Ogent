export interface SessionMeta {
	id: string;
	title: string;
	model: string;
	selectedPackId?: string | null;
	lastClassicModel?: string;
	createdAt: number;
	updatedAt: number;
}

export type StoredClaimStatus = "verified" | "unsupported" | "quote-missing";

export interface StoredPackProgressStep {
	id: string;
	label: string;
	state: "pending" | "running" | "complete" | "failed";
	message?: string;
}

export interface StoredPackClaim {
	id: string;
	text: string;
	sourceNote: string;
	sourceQuote: string;
	quotePresent: boolean;
	supportsClaim: boolean | null;
	supportExplanation: string;
	status: StoredClaimStatus;
}

export interface StoredPackTurnData {
	packId: string;
	packName: string;
	progressSteps?: StoredPackProgressStep[];
	retryingStepId?: string | null;
	error?: string;
	verifiedSummary?: string;
	claims?: StoredPackClaim[];
	modelsUsed?: {
		retriever: string;
		synthesizer: string;
		verifier: string;
	};
}

export interface StoredTurn {
	role: "user" | "assistant";
	content: string;
	packTurn?: StoredPackTurnData;
}

export interface SessionRecoveryState {
	reason: "turns-corrupt";
	message: string;
	backupPath: string;
	recoveredAt: number;
}

export interface StoredSession extends SessionMeta {
	turns: StoredTurn[];
	recovery?: SessionRecoveryState | null;
}

export interface SessionReadResult {
	turns: StoredTurn[];
	recovery?: SessionRecoveryState;
}

export interface SessionFileAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	rename(path: string, newPath: string): Promise<void>;
}

interface Callbacks {
	persistIndex(meta: SessionMeta[], activeId: string): Promise<void>;
	readTurns(id: string): Promise<SessionReadResult>;
	writeTurns(id: string, turns: StoredTurn[]): Promise<void>;
	deleteTurns(id: string): Promise<void>;
}

function makeId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeCorruptBackupPath(path: string, recoveredAt: number): string {
	const dotIndex = path.lastIndexOf(".");
	if (dotIndex === -1) return `${path}.corrupt-${recoveredAt}`;
	return `${path.slice(0, dotIndex)}.corrupt-${recoveredAt}${path.slice(dotIndex)}`;
}

async function recoverCorruptTurnsFile(
	adapter: SessionFileAdapter,
	path: string,
	recoveredAt: number,
): Promise<SessionReadResult> {
	const backupPath = makeCorruptBackupPath(path, recoveredAt);
	await adapter.rename(path, backupPath);
	await adapter.write(path, JSON.stringify({ turns: [] }));
	return {
		turns: [],
		recovery: {
			reason: "turns-corrupt",
			backupPath,
			recoveredAt,
			message: `Saved chat history was unreadable. OpenAgent moved the original file to ${backupPath} and reset this chat to an empty history.`,
		},
	};
}

export async function loadStoredTurnsFile({
	adapter,
	path,
	now = () => Date.now(),
}: {
	adapter: SessionFileAdapter;
	path: string;
	now?: () => number;
}): Promise<SessionReadResult> {
	if (!(await adapter.exists(path))) return { turns: [] };
	const rawText = await adapter.read(path);

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText) as unknown;
	} catch {
		return recoverCorruptTurnsFile(adapter, path, now());
	}

	if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { turns?: unknown }).turns)) {
		return recoverCorruptTurnsFile(adapter, path, now());
	}

	return { turns: (parsed as { turns: StoredTurn[] }).turns };
}

export class SessionStore {
	private meta: SessionMeta[] = [];
	private activeId = "";
	private activeTurns: StoredTurn[] = [];
	private readonly recoveryById = new Map<string, SessionRecoveryState>();
	private readonly cb: Callbacks;

	constructor(cb: Callbacks) {
		this.cb = cb;
	}

	// rawSessions may include embedded turns (old data.json format) — migrated to files automatically.
	async init(rawSessions: (SessionMeta & { turns?: StoredTurn[] })[], activeId: string): Promise<void> {
		for (const s of rawSessions) {
			if (Array.isArray(s.turns) && s.turns.length > 0) {
				await this.cb.writeTurns(s.id, s.turns).catch(() => {});
			}
		}
		const meta: SessionMeta[] = rawSessions.map(({ id, title, model, selectedPackId, lastClassicModel, createdAt, updatedAt }) => ({
			id,
			title,
			model,
			selectedPackId: selectedPackId ?? null,
			lastClassicModel: lastClassicModel ?? model,
			createdAt,
			updatedAt,
		}));
		if (meta.length === 0) {
			const m = this.makeMeta();
			this.meta = [m];
			this.activeId = m.id;
			this.activeTurns = [];
		} else {
			this.meta = meta;
			this.activeId = meta.find((s) => s.id === activeId) ? activeId : meta[0].id;
			this.activeTurns = await this.loadTurns(this.activeId);
		}
	}

	getSessions(): SessionMeta[] {
		return this.meta;
	}

	getActiveId(): string {
		return this.activeId;
	}

	getActive(): StoredSession {
		const m = this.meta.find((s) => s.id === this.activeId) ?? this.meta[0] ?? this.makeMeta();
		return { ...m, turns: this.activeTurns, recovery: this.recoveryById.get(m.id) ?? null };
	}

	getRecoveryIssues(): SessionRecoveryState[] {
		return [...this.recoveryById.values()];
	}

	async create(): Promise<StoredSession> {
		const m = this.makeMeta();
		this.meta.push(m);
		this.activeId = m.id;
		this.activeTurns = [];
		await this.cb.persistIndex(this.meta, this.activeId);
		return { ...m, turns: [] };
	}

	async switchTo(id: string): Promise<void> {
		if (!this.meta.find((s) => s.id === id)) return;
		this.activeId = id;
		this.activeTurns = await this.loadTurns(id);
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	async rename(id: string, title: string): Promise<void> {
		const m = this.meta.find((s) => s.id === id);
		if (!m) return;
		m.title = title;
		m.updatedAt = Date.now();
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	async delete(id: string): Promise<void> {
		if (this.meta.length <= 1) {
			const m = this.meta[0];
			m.title = "New chat";
			m.model = "";
			m.selectedPackId = null;
			m.lastClassicModel = "";
			m.updatedAt = Date.now();
			this.activeId = m.id;
			this.activeTurns = [];
			this.recoveryById.delete(m.id);
			await Promise.all([
				this.cb.persistIndex(this.meta, this.activeId),
				this.cb.writeTurns(m.id, []),
			]);
		} else {
			const idx = this.meta.findIndex((s) => s.id === id);
			if (idx === -1) return;
			this.meta.splice(idx, 1);
			this.recoveryById.delete(id);
			void this.cb.deleteTurns(id).catch(() => {});
			if (this.activeId === id) {
				const sorted = [...this.meta].sort((a, b) => b.updatedAt - a.updatedAt);
				this.activeId = sorted[0].id;
				this.activeTurns = await this.loadTurns(this.activeId);
			}
			await this.cb.persistIndex(this.meta, this.activeId);
		}
	}

	async updateTurns(id: string, turns: StoredTurn[]): Promise<void> {
		const m = this.meta.find((s) => s.id === id);
		if (!m) return;
		m.updatedAt = Date.now();
		if (id === this.activeId) this.activeTurns = turns;
		await Promise.all([
			this.cb.writeTurns(id, turns),
			this.cb.persistIndex(this.meta, this.activeId),
		]);
	}

	async updateModel(id: string, model: string): Promise<void> {
		const m = this.meta.find((s) => s.id === id);
		if (!m) return;
		m.model = model;
		m.lastClassicModel = model;
		m.updatedAt = Date.now();
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	async updateSelectedPack(id: string, selectedPackId: string | null, lastClassicModel?: string): Promise<void> {
		const m = this.meta.find((s) => s.id === id);
		if (!m) return;
		m.selectedPackId = selectedPackId;
		if (typeof lastClassicModel === "string") {
			m.lastClassicModel = lastClassicModel;
			if (lastClassicModel.trim().length > 0) m.model = lastClassicModel;
		}
		m.updatedAt = Date.now();
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	toJSON(): { sessions: SessionMeta[]; activeSessionId: string } {
		return { sessions: this.meta, activeSessionId: this.activeId };
	}

	private async loadTurns(id: string): Promise<StoredTurn[]> {
		const result = await this.cb.readTurns(id);
		if (result.recovery) this.recoveryById.set(id, result.recovery);
		else this.recoveryById.delete(id);
		return result.turns;
	}

	private makeMeta(): SessionMeta {
		const now = Date.now();
		return {
			id: makeId(),
			title: "New chat",
			model: "",
			selectedPackId: null,
			lastClassicModel: "",
			createdAt: now,
			updatedAt: now,
		};
	}
}
