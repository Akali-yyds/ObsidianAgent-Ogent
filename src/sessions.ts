import type { DiffRow } from "./consent/diff";
import type { AgentCommand, AgentExecutionMode, ChangeSet, ChangeSetResult, CommandResult, CommandRisk, ToolResult } from "./types";

export interface SessionMeta {
	id: string;
	title: string;
	model: string;
	createdAt: number;
	updatedAt: number;
	attachedContextPaths?: string[];
	access?: AgentExecutionMode;
	queuedMessages?: QueuedMessage[];
	interrupted?: boolean;
	runState?: "idle" | "running" | "awaiting-approval" | "failed" | "interrupted";
	queuePaused?: boolean;
}

export interface QueuedMessage {
	id: string;
	text: string;
	createdAt: number;
}

export type StoredAssistantSegment =
	| { kind: "thinking"; id: string; text: string }
	| { kind: "text"; id: string; text: string }
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
	commandPlan?: StoredCommandPlan;
	changeSet?: ChangeSet;
	changeSetResult?: ChangeSetResult;
}

export interface StoredCommand {
	id: string;
	domain: AgentCommand["domain"];
	action: string;
	args: Record<string, unknown>;
	risk: CommandRisk;
	status: "pending" | "running" | "awaiting-consent" | "ok" | "error" | "denied";
	result?: CommandResult;
	diffRows?: DiffRow[];
	warning?: string;
	changeSet?: ChangeSet;
	changeSetResult?: ChangeSetResult;
}

export interface StoredCommandPlan {
	id: string;
	commands: StoredCommand[];
	status: "running" | "ok" | "error" | "denied";
}

export interface StoredTurn {
	id: string;
	role: "user" | "assistant";
	content: string;
	segments?: StoredAssistantSegment[];
	toolCalls?: StoredToolCall[];
	commandPlans?: StoredCommandPlan[];
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
			message: `Saved chat history was unreadable. Ogent moved the original file to ${backupPath} and reset this chat to an empty history.`,
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
	const turns = sanitizeStoredTurns(parsed.turns);
	// Persist deterministic IDs for legacy conversations once, preserving the
	// original turn order, content, and tool references.
	if (JSON.stringify(parsed.turns) !== JSON.stringify(turns)) {
		await adapter.write(path, JSON.stringify({ turns }));
	}
	return { turns };
}

export class SessionStore {
	private meta: SessionMeta[] = [];
	private activeId = "";
	private activeTurns: StoredTurn[] = [];
	private readonly recoveryById = new Map<string, SessionRecoveryState>();

	constructor(private readonly cb: Callbacks) {}

	async init(rawSessions: (SessionMeta & { turns?: StoredTurn[] })[], activeId: string): Promise<void> {
		for (const session of rawSessions) {
			if (Array.isArray(session.turns) && session.turns.length > 0) await this.cb.writeTurns(session.id, sanitizeStoredTurns(session.turns)).catch(() => {});
		}
		let recoveredActiveRun = false;
	this.meta = rawSessions.map(({ id, title, model, createdAt, updatedAt, attachedContextPaths, access, queuedMessages, interrupted, runState, queuePaused }) => ({
			id,
			title,
			model,
			createdAt,
			updatedAt,
			...(Array.isArray(attachedContextPaths) && attachedContextPaths.length > 0 ? { attachedContextPaths: [...attachedContextPaths] } : {}),
			access: access === "read" || access === "full" ? access : "ask",
			...(Array.isArray(queuedMessages) ? { queuedMessages: sanitizeQueuedMessages(queuedMessages) } : {}),
			...(interrupted ? { interrupted: true } : {}),
			...(queuePaused || (Array.isArray(queuedMessages) && queuedMessages.length > 0) ? { queuePaused: true } : {}),
			runState: runState === "running" || runState === "awaiting-approval"
				? (recoveredActiveRun = true, "interrupted")
				: runState === "failed" || runState === "interrupted" ? runState : "idle",
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
		// Persist migration defaults (notably Ask before action) and recovered run
		// states so a restart does not repeat migration or imply active work.
		if (recoveredActiveRun || rawSessions.some((session) => session.access !== "read" && session.access !== "ask" && session.access !== "full")) {
			await this.cb.persistIndex(this.meta, this.activeId);
		}
	}

	getSessions(): SessionMeta[] { return this.meta; }
	getActiveId(): string { return this.activeId; }
	getMeta(id: string): SessionMeta | undefined { return this.meta.find((session) => session.id === id); }

	async getSession(id: string): Promise<StoredSession | null> {
		const meta = this.getMeta(id);
		if (!meta) return null;
		const turns = id === this.activeId ? this.activeTurns : await this.loadTurns(id);
		return { ...meta, turns, recovery: this.recoveryById.get(id) ?? null };
	}

	getActive(): StoredSession {
		const meta = this.meta.find((session) => session.id === this.activeId) ?? this.meta[0] ?? this.makeMeta();
		return { ...meta, turns: this.activeTurns, recovery: this.recoveryById.get(meta.id) ?? null };
	}

	getRecoveryIssues(): SessionRecoveryState[] { return [...this.recoveryById.values()]; }

	async create(model = ""): Promise<StoredSession> {
		const session = this.makeMeta(model);
		this.meta.push(session);
		this.activeId = session.id;
		this.activeTurns = [];
		await this.cb.persistIndex(this.meta, this.activeId);
		return { ...session, turns: [] };
	}

	/**
	 * Model ids belong to a provider endpoint. Clear per-session overrides when
	 * the endpoint changes so a session cannot silently send an old provider's
	 * model id to the new endpoint.
	 */
	async resetModels(): Promise<void> {
		const now = Date.now();
		let changed = false;
		for (const session of this.meta) {
			if (!session.model) continue;
			session.model = "";
			session.updatedAt = now;
			changed = true;
		}
		if (changed) await this.cb.persistIndex(this.meta, this.activeId);
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
			access: source.access ?? "ask",
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
			session.access = "ask";
			session.runState = "idle";
			delete session.queuedMessages;
			delete session.queuePaused;
			delete session.interrupted;
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
		const normalizedTurns = sanitizeStoredTurns(turns);
		session.updatedAt = Date.now();
		if (id === this.activeId) this.activeTurns = normalizedTurns;
		await Promise.all([this.cb.writeTurns(id, normalizedTurns), this.cb.persistIndex(this.meta, this.activeId)]);
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

	async updateAccess(id: string, access: AgentExecutionMode): Promise<void> {
		const session = this.meta.find((entry) => entry.id === id);
		if (!session) return;
		session.access = access;
		session.updatedAt = Date.now();
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	async updateQueuedMessages(id: string, messages: QueuedMessage[]): Promise<void> {
		const session = this.meta.find((entry) => entry.id === id);
		if (!session) return;
		const safe = sanitizeQueuedMessages(messages);
		if (safe.length > 0) session.queuedMessages = safe;
		else delete session.queuedMessages;
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	async setQueuePaused(id: string, paused: boolean): Promise<void> {
		const session = this.meta.find((entry) => entry.id === id);
		if (!session) return;
		if (paused) session.queuePaused = true;
		else delete session.queuePaused;
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	async setInterrupted(id: string, interrupted: boolean): Promise<void> {
		const session = this.meta.find((entry) => entry.id === id);
		if (!session) return;
		if (interrupted) session.interrupted = true;
		else delete session.interrupted;
		await this.cb.persistIndex(this.meta, this.activeId);
	}

	async updateRunState(id: string, runState: NonNullable<SessionMeta["runState"]>): Promise<void> {
		const session = this.meta.find((entry) => entry.id === id);
		if (!session) return;
		session.runState = runState;
		session.interrupted = runState === "interrupted";
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

	private makeMeta(model = ""): SessionMeta {
		const now = Date.now();
		return { id: makeId(), title: "New chat", model, createdAt: now, updatedAt: now, access: "ask" };
	}
}

function sanitizeStoredTurns(turns: unknown[]): StoredTurn[] {
	const usedIds = new Set<string>();
	return turns.map((value, index) => {
		const turn = sanitizeStoredTurn(value, index);
		if (!usedIds.has(turn.id)) {
			usedIds.add(turn.id);
			return turn;
		}
		let id = `${turn.id}-duplicate-${index}`;
		while (usedIds.has(id)) id += "-next";
		usedIds.add(id);
		return { ...turn, id };
	});
}

function sanitizeStoredTurn(value: unknown, index: number): StoredTurn {
	if (!isRecord(value)) return { id: `legacy-turn-${index}`, role: "assistant", content: "" };
	const role = value.role === "user" || value.role === "assistant" ? value.role : "assistant";
	const content = typeof value.content === "string" ? value.content : "";
	const turn: StoredTurn = { id: typeof value.id === "string" && value.id ? value.id : `legacy-turn-${index}`, role, content };
	const segments = sanitizeSegments(value.segments, turn.id);
	if (segments) turn.segments = segments;
	const toolCalls = sanitizeToolCalls(value.toolCalls);
	if (toolCalls) turn.toolCalls = toolCalls;
	const commandPlans = sanitizeCommandPlans(value.commandPlans);
	if (commandPlans) turn.commandPlans = commandPlans;
	const events = sanitizeEvents(value.events);
	if (events) turn.events = events;
	return turn;
}

function sanitizeCommandPlans(value: unknown): StoredCommandPlan[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) return undefined;
	const plans = value.map((plan) => {
		if (!isRecord(plan) || typeof plan.id !== "string" || !Array.isArray(plan.commands)) return null;
		if (plan.status !== "running" && plan.status !== "ok" && plan.status !== "error" && plan.status !== "denied") return null;
		const commands = plan.commands.map((command) => {
			if (!isRecord(command) || typeof command.id !== "string" || typeof command.domain !== "string" || typeof command.action !== "string" || !isRecord(command.args) || typeof command.risk !== "string") return null;
			if (!["vault", "git", "web", "plugin"].includes(command.domain)) return null;
			if (!["read", "vault_write", "external_write", "network_read", "plugin_control"].includes(command.risk)) return null;
			if (!["pending", "running", "awaiting-consent", "ok", "error", "denied"].includes(command.status as string)) return null;
			const result = command.result === undefined ? undefined : sanitizeCommandResult(command.result);
			if (command.result !== undefined && !result) return null;
			return {
				id: command.id,
				domain: command.domain as StoredCommand["domain"],
				action: command.action,
				args: command.args,
				risk: command.risk as StoredCommand["risk"],
				status: command.status as StoredCommand["status"],
				...(result ? { result } : {}),
				...(Array.isArray(command.diffRows) ? { diffRows: command.diffRows as DiffRow[] } : {}),
				...(typeof command.warning === "string" ? { warning: command.warning } : {}),
			...(sanitizeChangeSet(command.changeSet) ? { changeSet: sanitizeChangeSet(command.changeSet) } : {}),
			...(sanitizeChangeSetResult(command.changeSetResult) ? { changeSetResult: sanitizeChangeSetResult(command.changeSetResult) } : {}),
			} satisfies StoredCommand;
		});
		return commands.every((command): command is StoredCommand => command !== null) ? { id: plan.id, commands, status: plan.status } : null;
	});
	return plans.every((plan): plan is StoredCommandPlan => plan !== null) ? plans : undefined;
}

function sanitizeChangeSet(value: unknown): ChangeSet | undefined {
	if (!isRecord(value) || typeof value.id !== "string" || typeof value.intent !== "string" || !Array.isArray(value.operations) || !Array.isArray(value.affectedFiles) || !Array.isArray(value.blockers) || !Array.isArray(value.warnings) || typeof value.createdAt !== "number") return undefined;
	return value as unknown as ChangeSet;
}

function sanitizeChangeSetResult(value: unknown): ChangeSetResult | undefined {
	if (!isRecord(value) || typeof value.changeSetId !== "string") return undefined;
	if (value.status !== "applied" && value.status !== "rejected" && value.status !== "blocked" && value.status !== "rolled_back") return undefined;
	return {
		changeSetId: value.changeSetId,
		status: value.status,
		...(typeof value.restored === "boolean" ? { restored: value.restored } : {}),
		...(Array.isArray(value.recoveryItems) ? { recoveryItems: value.recoveryItems.filter((item): item is string => typeof item === "string") } : {}),
	};
}

function sanitizeCommandResult(value: unknown): CommandResult | undefined {
	if (!isRecord(value) || typeof value.id !== "string" || typeof value.ok !== "boolean" || typeof value.risk !== "string") return undefined;
	if (!["read", "vault_write", "external_write", "network_read", "plugin_control"].includes(value.risk)) return undefined;
	if (!value.ok && typeof value.error !== "string") return undefined;
	return {
		id: value.id,
		ok: value.ok,
		risk: value.risk as CommandRisk,
		...(value.ok ? { value: value.value } : { error: String(value.error), ...(value.details !== undefined ? { details: value.details } : {}) }),
	};
}

function sanitizeSegments(value: unknown, turnId: string): StoredAssistantSegment[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) return undefined;
	const segments = value.map((segment, index) => {
		if (!isRecord(segment)) return null;
		if ((segment.kind === "thinking" || segment.kind === "text") && typeof segment.text === "string") {
			const id = typeof segment.id === "string" && segment.id ? segment.id : `${turnId}-segment-${index}`;
			return { kind: segment.kind, id, text: segment.text } as StoredAssistantSegment;
		}
		if (segment.kind === "tool" && typeof segment.id === "string") {
			return { kind: "tool", id: segment.id } as StoredAssistantSegment;
		}
		return null;
	});
	return segments.every((segment): segment is StoredAssistantSegment => segment !== null) ? segments : undefined;
}

function sanitizeQueuedMessages(value: unknown[]): QueuedMessage[] {
	return value.flatMap((entry, index) => {
		if (!isRecord(entry) || typeof entry.text !== "string" || !entry.text.trim()) return [];
		return [{
			id: typeof entry.id === "string" && entry.id ? entry.id : `queued-${Date.now()}-${index}`,
			text: entry.text,
			createdAt: typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
		}];
	});
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
			...(sanitizeCommandPlan(call.commandPlan) ? { commandPlan: sanitizeCommandPlan(call.commandPlan) } : {}),
		} satisfies StoredToolCall;
	});
	return calls.every((call): call is StoredToolCall => call !== null) ? calls : undefined;
}

function sanitizeCommandPlan(value: unknown): StoredCommandPlan | undefined {
	const plans = sanitizeCommandPlans(value === undefined ? undefined : [value]);
	return plans?.[0];
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
