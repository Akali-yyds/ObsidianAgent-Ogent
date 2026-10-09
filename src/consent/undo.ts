export interface WriteOp {
	id: string;
	path: string;
	before: string | null; // null = file didn't exist before
	after: string;
	timestamp: number;
	kind?: "write" | "delete" | "rename";
	/** Original path for a rename/move operation. */
	beforePath?: string;
	/** Destination path for a rename/move operation. */
	afterPath?: string;
	checkpointId?: string;
	sessionId?: string;
	/** Expected content/path state after this operation, used to reject stale undo. */
	afterFingerprint?: string | null;
}

export function contentFingerprint(content: string): string {
	let hash = 2166136261;
	for (let index = 0; index < content.length; index++) {
		hash ^= content.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `file:${content.length}:${(hash >>> 0).toString(16)}`;
}

export interface UndoCheckpoint {
	id: string;
	label: string;
	startedAt: number;
}

export class UndoBuffer {
	private readonly capacity: number;
	private ops: WriteOp[] = [];
	private readonly activeCheckpoints = new Map<string, UndoCheckpoint>();
	private readonly lastCheckpointIds = new Map<string, string>();

	constructor(capacity = 50) {
		this.capacity = capacity;
	}

	record(op: Omit<WriteOp, "id" | "timestamp">, sessionId = "default"): WriteOp {
		const full: WriteOp = {
			id: crypto.randomUUID(),
			timestamp: Date.now(),
			sessionId,
			...(this.activeCheckpoints.has(sessionId) ? { checkpointId: this.activeCheckpoints.get(sessionId)!.id } : {}),
			...op,
			afterFingerprint: op.afterFingerprint !== undefined
				? op.afterFingerprint
				: op.kind === "delete" ? null : op.kind === "rename" ? undefined : contentFingerprint(op.after),
		};
		this.ops.push(full);
		if (this.ops.length > this.capacity) this.ops.shift();
		return full;
	}

	pop(sessionId = "default"): WriteOp | undefined {
		const index = this.ops.map((op) => op.sessionId ?? "default").lastIndexOf(sessionId);
		return index < 0 ? undefined : this.ops.splice(index, 1)[0];
	}

	peek(sessionId = "default"): WriteOp | undefined {
		return [...this.ops].reverse().find((op) => (op.sessionId ?? "default") === sessionId);
	}

	size(sessionId?: string): number {
		return sessionId === undefined ? this.ops.length : this.ops.filter((op) => (op.sessionId ?? "default") === sessionId).length;
	}

	isCheckpointActive(sessionId = "default"): boolean {
		return this.activeCheckpoints.has(sessionId);
	}

	clear(): void {
		this.ops = [];
		this.activeCheckpoints.clear();
		this.lastCheckpointIds.clear();
	}

	beginCheckpoint(label: string, sessionId = "default"): UndoCheckpoint {
		const checkpoint = { id: crypto.randomUUID(), label, startedAt: Date.now() };
		this.activeCheckpoints.set(sessionId, checkpoint);
		this.lastCheckpointIds.set(sessionId, checkpoint.id);
		return checkpoint;
	}

	endCheckpoint(sessionId = "default"): void {
		this.activeCheckpoints.delete(sessionId);
	}

	popLastCheckpoint(sessionId = "default"): WriteOp[] {
		const selected = this.peekLastCheckpoint(sessionId);
		this.removeOperations(selected.map((op) => op.id));
		return selected;
	}

	peekLastCheckpoint(sessionId = "default"): WriteOp[] {
		const id = this.lastCheckpointIds.get(sessionId);
		if (!id) return [];
		return this.ops.filter((op) => op.checkpointId === id && (op.sessionId ?? "default") === sessionId).reverse();
	}

	removeOperations(ids: string[]): void {
		const removed = new Set(ids);
		const removedOps = this.ops.filter((op) => removed.has(op.id));
		this.ops = this.ops.filter((op) => !removed.has(op.id));
		for (const [sessionId, checkpointId] of this.lastCheckpointIds) {
			if (removedOps.some((op) => op.checkpointId === checkpointId && (op.sessionId ?? "default") === sessionId)) {
				this.lastCheckpointIds.delete(sessionId);
			}
		}
	}

	findLatest(path: string, kind?: WriteOp["kind"], sessionId = "default"): WriteOp | undefined {
		return [...this.ops].reverse().find((op) => (op.sessionId ?? "default") === sessionId && op.path === path && (!kind || (op.kind ?? "write") === kind));
	}

	remove(id: string): WriteOp | undefined {
		const index = this.ops.findIndex((op) => op.id === id);
		if (index < 0) return undefined;
		return this.ops.splice(index, 1)[0];
	}
}
