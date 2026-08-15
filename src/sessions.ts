import type { DiffRow } from "./consent/diff";
import type { ToolResult } from "./types";

export interface SessionMeta {
	id: string;
	title: string;
	model: string;
	createdAt: number;
	updatedAt: number;
	attachedContextPaths?: string[];
}

export type StoredAssistantSegment =
	| { kind: "thinking"; text: string }
	| { kind: "text"; text: string }
	| { kind: "tool"; id: string };

export interface StoredAgentEvent {
	sequence: number;
	timestamp: number;
	kind: string;
	data?: unknown;
}

export interface StoredToolCall {
	id: string;
	name: string;
	args: unknown;
	mutates: boolean;
	status: "running" | "awaiting-consent" | "ok" | "error" | "denied";
	result?: ToolResult;
	diffRows?: DiffRow[];
	planPreview?: boolean;
}

export interface StoredTurn {
	role: "user" | "assistant";
	content: string;
	segments?: StoredAssistantSegment[];
	toolCalls?: StoredToolCall[];
	events?: StoredAgentEvent[];
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
	return dotIndex === -1
		? `${path}.corrupt-${recoveredAt}`
		: `${path.slice(0, dotIndex)}.corrupt-${recoveredAt}${path.slice(dotIndex)}`;
}

async function recoverCorruptTurnsFile(adapter: SessionFileAdapter, path: string, recoveredAt: number): Promise<SessionReadResult> {
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
	if (!isRecord(parsed) || !Array.isArray(parsed.turns)) return recoverCorruptTurnsFile(adapter, path, now());
	return { turns: sanitizeStoredTurns(parsed.turns) };
}

export class SessionStore {
	private meta: SessionMeta[] = [];
	private activeId = "";
	private activeTurns: StoredTurn[] = [];
	private readonly recoveryById = new Map<string, SessionRecoveryState>();

	constructor(private readonly cb: Callbacks) {}

	async init(rawSessions: (SessionMeta & { turns?: StoredTurn[] })[], activeId: string): Promise<void> {
		for (const session of rawSessions) {
			if (Array.isArray(session.turns) && session.turns.length > 0) await this.cb.writeTurns(session.id, session.turns).catch(() => {});
		}
		this.meta = rawSessions.map(({ id, title, model, createdAt, updatedAt, attachedContextPaths }) => ({
			id,
			title,
			model,
			createdAt,
			updatedAt,
			...(Array.isArray(attachedContextPaths) && attachedContextPaths.length > 0 ? { attachedContextPaths: [...attachedContextPaths] } : {}),
		}));
		if (this.meta.length === 0) {
			const session = this.makeMeta();
			this.meta = [session];
			this.activeId = session.id;
			this.activeTurns = [];
			return;
		}
		this.activeId = this.meta.some((session) => session.id === activeId) ? activeId : this.meta[0].id;
		this.activeTurns = await this.loadTurns(this.activeId);
	}

	getSessions(): SessionMeta[] { return this.meta; }
	getActiveId(): string { return this.activeId; }

	getActive(): StoredSession {
		const meta = this.meta.find((session) => session.id === this.activeId) ?? this.meta[0] ?? this.makeMeta();
		return { ...meta, turns: this.activeTurns, recovery: this.recoveryById.get(meta.id) ?? null };
	}

	getRecoveryIssues(): SessionRecoveryState[] { return [...this.recoveryById.values()]; }

	async create(): Promise<StoredSession> {
		const session = this.makeMeta();
		this.meta.push(session);
		this.activeId = session.id;
		this.activeTurns = [];
		await this.cb.persistIndex(this.meta, this.activeId);
		return { ...session, turns: [] };
	}

	async fork(id: string): Promise<StoredSession | null> {
		const source = this.meta.find((session) => session.id === id);
		if (!source) return null;
		const sourceTurns = id === this.activeId ? this.activeTurns : await this.loadTurns(id);
		const now = Date.now();
		const forked: SessionMeta = {
			id: makeId(),
			title: `${source.title} (fork)`,
			model: source.model,
			createdAt: now,
			updatedAt: now,
			...(source.attachedContextPaths ? { attachedContextPaths: [...source.attachedContextPaths] } : {}),
		};
		const turns = JSON.parse(JSON.stringify(sourceTurns)) as StoredTurn[];
		this.meta.push(forked);
		this.activeId = forked.id;
		this.activeTurns = turns;
		await Promise.all([this.cb.writeTurns(forked.id, turns), this.cb.persistIndex(this.meta, this.activeId)]);
		return { ...forked, turns };
	}

	async switchTo(id: string): Promise<void> {
		if (!this.meta.some((session) => session.id === id)) return;
		this.activeId = id;
		this.activeTurns = await this.loadTurns(id);
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	async rename(id: string, title: string): Promise<void> {
		const session = this.meta.find((entry) => entry.id === id);
		if (!session) return;
		session.title = title;
		session.updatedAt = Date.now();
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	async delete(id: string): Promise<void> {
		if (this.meta.length <= 1) {
			const session = this.meta[0];
			session.title = "New chat";
			session.model = "";
			session.updatedAt = Date.now();
			delete session.attachedContextPaths;
			this.activeId = session.id;
			this.activeTurns = [];
			this.recoveryById.delete(session.id);
			await Promise.all([this.cb.persistIndex(this.meta, this.activeId), this.cb.writeTurns(session.id, [])]);
			return;
		}
		const index = this.meta.findIndex((session) => session.id === id);
		if (index === -1) return;
		this.meta.splice(index, 1);
		this.recoveryById.delete(id);
		void this.cb.deleteTurns(id).catch(() => {});
		if (this.activeId === id) {
			this.activeId = [...this.meta].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
			this.activeTurns = await this.loadTurns(this.activeId);
		}
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	async updateTurns(id: string, turns: StoredTurn[]): Promise<void> {
		const session = this.meta.find((entry) => entry.id === id);
		if (!session) return;
		session.updatedAt = Date.now();
		if (id === this.activeId) this.activeTurns = turns;
		await Promise.all([this.cb.writeTurns(id, turns), this.cb.persistIndex(this.meta, this.activeId)]);
	}

	async updateModel(id: string, model: string): Promise<void> {
		const session = this.meta.find((entry) => entry.id === id);
		if (!session) return;
		session.model = model;
		session.updatedAt = Date.now();
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	async updateAttachedContext(id: string, paths: string[]): Promise<void> {
		const session = this.meta.find((entry) => entry.id === id);
		if (!session) return;
		const uniquePaths = [...new Set(paths.filter((path) => path.trim().length > 0))];
		if (uniquePaths.length > 0) session.attachedContextPaths = uniquePaths;
		else delete session.attachedContextPaths;
		session.updatedAt = Date.now();
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
		return { id: makeId(), title: "New chat", model: "", createdAt: now, updatedAt: now };
	}
}

function sanitizeStoredTurns(turns: unknown[]): StoredTurn[] {
	return turns.map((turn) => sanitizeStoredTurn(turn));
}

function sanitizeStoredTurn(value: unknown): StoredTurn {
	if (!isRecord(value)) return { role: "assistant", content: "" };
	const role = value.role === "user" || value.role === "assistant" ? value.role : "assistant";
	const content = typeof value.content === "string" ? value.content : "";
	const turn: StoredTurn = { role, content };
	const segments = sanitizeSegments(value.segments);
	if (segments) turn.segments = segments;
	const toolCalls = sanitizeToolCalls(value.toolCalls);
	if (toolCalls) turn.toolCalls = toolCalls;
	const events = sanitizeEvents(value.events);
	if (events) turn.events = events;
	return turn;
}

function sanitizeSegments(value: unknown): StoredAssistantSegment[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) return undefined;
	const segments = value.map((segment) => {
		if (!isRecord(segment)) return null;
		if ((segment.kind === "thinking" || segment.kind === "text") && typeof segment.text === "string") return { kind: segment.kind, text: segment.text } as StoredAssistantSegment;
		if (segment.kind === "tool" && typeof segment.id === "string") return { kind: "tool", id: segment.id } as StoredAssistantSegment;
		return null;
	});
	return segments.every((segment): segment is StoredAssistantSegment => segment !== null) ? segments : undefined;
}

function sanitizeEvents(value: unknown): StoredAgentEvent[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) return undefined;
	const events = value.map((event) => {
		if (!isRecord(event) || typeof event.kind !== "string" || typeof event.sequence !== "number" || typeof event.timestamp !== "number") return null;
		if (!Number.isFinite(event.sequence) || event.sequence < 0 || !Number.isFinite(event.timestamp) || event.timestamp < 0) return null;
		return { sequence: event.sequence, timestamp: event.timestamp, kind: event.kind.slice(0, 80), ...(event.data !== undefined ? { data: event.data } : {}) };
	});
	return events.every((event): event is StoredAgentEvent => event !== null) ? events : undefined;
}

function sanitizeToolCalls(value: unknown): StoredToolCall[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) return undefined;
	const calls = value.map((call) => {
		if (!isRecord(call) || typeof call.id !== "string" || typeof call.name !== "string" || typeof call.mutates !== "boolean") return null;
		const status = sanitizeToolCallStatus(call.status);
		if (!status) return null;
		const result = call.result === undefined ? undefined : sanitizeToolResult(call.result);
		if (call.result !== undefined && !result) return null;
		return {
			id: call.id,
			name: call.name,
			args: call.args,
			mutates: call.mutates,
			status,
			...(result ? { result } : {}),
			...(Array.isArray(call.diffRows) ? { diffRows: call.diffRows as DiffRow[] } : {}),
			...(call.planPreview === true ? { planPreview: true as boolean } : {}),
		} satisfies StoredToolCall;
	});
	return calls.every((call): call is StoredToolCall => call !== null) ? calls : undefined;
}

function sanitizeToolCallStatus(value: unknown): StoredToolCall["status"] | null {
	return value === "running" || value === "awaiting-consent" || value === "ok" || value === "error" || value === "denied" ? value : null;
}

function sanitizeToolResult(value: unknown): ToolResult | undefined {
	if (!isRecord(value) || typeof value.ok !== "boolean") return undefined;
	if (value.ok) return { ok: true, value: value.value };
	if (typeof value.error !== "string") return undefined;
	return { ok: false, error: value.error, ...(value.details !== undefined ? { details: value.details } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
