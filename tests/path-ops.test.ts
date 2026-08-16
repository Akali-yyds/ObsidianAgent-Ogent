import { describe, expect, it, vi } from "vitest";
import { MockTFile } from "./setup";
import { UndoBuffer } from "../src/consent/undo";
import { renameTool } from "../src/tools/vault/path-ops";

describe("vault path operations", () => {
	it("records rename metadata so the operation can be undone", async () => {
		let currentPath = "Notes/a.md";
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => path === currentPath ? new MockTFile(path) : null),
				createFolder: vi.fn(async () => undefined),
				rename: vi.fn(async (_file: MockTFile, nextPath: string) => { currentPath = nextPath; }),
			},
		};
		const undo = new UndoBuffer();
		const tool = renameTool(app as never, undo);

		await expect(tool.run({ oldPath: "Notes/a.md", newPath: "Archive/a.md" }, {})).resolves.toEqual({
			ok: true,
			value: { oldPath: "Notes/a.md", newPath: "Archive/a.md" },
		});
		expect(currentPath).toBe("Archive/a.md");
		expect(undo.peek()).toMatchObject({
			kind: "rename",
			beforePath: "Notes/a.md",
			afterPath: "Archive/a.md",
		});
	});
});
