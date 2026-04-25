export interface WriteOp {
	id: string;
	path: string;
	before: string | null; // null = file didn't exist before
	after: string;
	timestamp: number;
}

export class UndoBuffer {
	private readonly capacity: number;
	private ops: WriteOp[] = [];

	constructor(capacity = 50) {
		this.capacity = capacity;
	}

	record(op: Omit<WriteOp, "id" | "timestamp">): WriteOp {
		const full: WriteOp = {
			id: crypto.randomUUID(),
			timestamp: Date.now(),
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
	}
}
