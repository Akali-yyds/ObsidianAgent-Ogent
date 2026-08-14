import { describe, expect, it } from "vitest";
import { UndoBuffer } from "../src/consent/undo";

describe("UndoBuffer checkpoints", () => {
	it("groups writes from one Agent turn for one-step rollback", () => {
		const undo = new UndoBuffer();
		undo.beginCheckpoint("turn");
		undo.record({ path: "a.md", before: null, after: "A" });
		undo.record({ path: "b.md", before: "B", after: "BB" });
		undo.endCheckpoint();

		const operations = undo.popLastCheckpoint();

		expect(operations.map((operation) => operation.path)).toEqual(["b.md", "a.md"]);
		expect(undo.size()).toBe(0);
	});
});
