export interface SessionMeta {
	id: string;
	title: string;
	model: string;
	createdAt: number;
	updatedAt: number;
}

export interface StoredTurn {
	role: "user" | "assistant";
	content: string;
}

export interface StoredSession extends SessionMeta {
	turns: StoredTurn[];
}

interface Callbacks {
	persistIndex(meta: SessionMeta[], activeId: string): Promise<void>;
	readTurns(id: string): Promise<StoredTurn[]>;
	writeTurns(id: string, turns: StoredTurn[]): Promise<void>;
	deleteTurns(id: string): Promise<void>;
}

function makeId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class SessionStore {
	private meta: SessionMeta[] = [];
	private activeId = "";
	private activeTurns: StoredTurn[] = [];
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
		const meta: SessionMeta[] = rawSessions.map(({ id, title, model, createdAt, updatedAt }) => ({
			id, title, model, createdAt, updatedAt,
		}));
		if (meta.length === 0) {
			const m = this.makeMeta();
			this.meta = [m];
			this.activeId = m.id;
			this.activeTurns = [];
		} else {
			this.meta = meta;
			this.activeId = meta.find((s) => s.id === activeId) ? activeId : meta[0].id;
			this.activeTurns = await this.cb.readTurns(this.activeId).catch(() => []);
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
		return { ...m, turns: this.activeTurns };
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
		this.activeTurns = await this.cb.readTurns(id).catch(() => []);
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
			m.updatedAt = Date.now();
			this.activeId = m.id;
			this.activeTurns = [];
			await Promise.all([
				this.cb.persistIndex(this.meta, this.activeId),
				this.cb.writeTurns(m.id, []),
			]);
		} else {
			const idx = this.meta.findIndex((s) => s.id === id);
			if (idx === -1) return;
			this.meta.splice(idx, 1);
			void this.cb.deleteTurns(id).catch(() => {});
			if (this.activeId === id) {
				const sorted = [...this.meta].sort((a, b) => b.updatedAt - a.updatedAt);
				this.activeId = sorted[0].id;
				this.activeTurns = await this.cb.readTurns(this.activeId).catch(() => []);
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
		m.updatedAt = Date.now();
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	toJSON(): { sessions: SessionMeta[]; activeSessionId: string } {
		return { sessions: this.meta, activeSessionId: this.activeId };
	}

	private makeMeta(): SessionMeta {
		const now = Date.now();
		return { id: makeId(), title: "New chat", model: "", createdAt: now, updatedAt: now };
	}
}
