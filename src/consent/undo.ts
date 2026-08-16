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
}

export interface UndoCheckpoint {
	id: string;
	label: string;
	startedAt: number;
}

export class UndoBuffer {
	private readonly capacity: number;
	private ops: WriteOp[] = [];
	private activeCheckpoint: UndoCheckpoint | null = null;
	private lastCheckpointId: string | null = null;

	constructor(capacity = 50) {
		this.capacity = capacity;
	}

	record(op: Omit<WriteOp, "id" | "timestamp">): WriteOp {
		const full: WriteOp = {
			id: crypto.randomUUID(),
			timestamp: Date.now(),
			...(this.activeCheckpoint ? { checkpointId: this.activeCheckpoint.id } : {}),
			...op,
		};
		this.ops.push(full);
		if (this.ops.length > this.capacity) this.ops.shift();
		return full;
	}

	pop(): WriteOp | undefined {
		return this.ops.pop();
	}

	peek(): WriteOp | undefined {
		return this.ops[this.ops.length - 1];
	}

	size(): number {
		return this.ops.length;
	}

	clear(): void {
		this.ops = [];
		this.activeCheckpoint = null;
		this.lastCheckpointId = null;
	}

	beginCheckpoint(label: string): UndoCheckpoint {
		const checkpoint = { id: crypto.randomUUID(), label, startedAt: Date.now() };
		this.activeCheckpoint = checkpoint;
		this.lastCheckpointId = checkpoint.id;
		return checkpoint;
	}

	endCheckpoint(): void {
		this.activeCheckpoint = null;
	}

	popLastCheckpoint(): WriteOp[] {
		if (!this.lastCheckpointId) return [];
		const id = this.lastCheckpointId;
		const selected = this.ops.filter((op) => op.checkpointId === id);
		this.ops = this.ops.filter((op) => op.checkpointId !== id);
		this.lastCheckpointId = null;
		return selected.reverse();
	}

	findLatest(path: string, kind?: WriteOp["kind"]): WriteOp | undefined {
		return [...this.ops].reverse().find((op) => op.path === path && (!kind || (op.kind ?? "write") === kind));
	}

	remove(id: string): WriteOp | undefined {
		const index = this.ops.findIndex((op) => op.id === id);
		if (index < 0) return undefined;
		return this.ops.splice(index, 1)[0];
	}
}
