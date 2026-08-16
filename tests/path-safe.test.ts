import { describe, expect, it } from "vitest";
import { PathError, safeVaultPath } from "../src/tools/vault/path-safe";

describe("safeVaultPath", () => {
	it("normalizes ordinary vault-relative paths", () => {
		expect(safeVaultPath(" Notes\\project.md ")).toBe("Notes/project.md");
	});

	it.each(["../outside.md", "Notes/../../outside.md", "/absolute.md", "C:/outside.md", ".", "Notes/\0bad.md"]) (
		"rejects unsafe path %j",
		(path) => {
			expect(() => safeVaultPath(path)).toThrow(PathError);
		},
	);
});
