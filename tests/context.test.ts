import { describe, expect, it } from "vitest";
import { buildVaultContextPrompt, requestsVaultMutation } from "../src/context";

describe("vault context", () => {
	it("describes the active note and its directory", () => {
		const prompt = buildVaultContextPrompt({
			activeFilePath: "参与项目介绍/合规经营法律智能服务技术研发.md",
			activeFolderPath: "参与项目介绍",
			activeFileName: "合规经营法律智能服务技术研发.md",
		});

		expect(prompt).toContain("Current note: 参与项目介绍/合规经营法律智能服务技术研发.md");
		expect(prompt).toContain("Current directory: 参与项目介绍");
	});

	it("does not include note body or selected text in the lightweight prompt", () => {
		const prompt = buildVaultContextPrompt({
			activeFilePath: "Notes/current.md",
			activeFolderPath: "Notes",
			activeFileName: "current.md",
			selectionText: "selected note body that must not be sent automatically",
			properties: { status: "draft" },
		});

		expect(prompt).not.toContain("selected note body that must not be sent automatically");
		expect(prompt).toContain("Note contents are not automatically loaded");
	});

	it("bounds large metadata lists and properties", () => {
		const prompt = buildVaultContextPrompt({
			activeFilePath: "Notes/current.md",
			activeFolderPath: "Notes",
			activeFileName: "current.md",
			tags: Array.from({ length: 40 }, (_, index) => `#tag-${index}`),
			linkedNotes: Array.from({ length: 80 }, (_, index) => `Notes/link-${index}.md`),
			properties: { description: "x".repeat(10_000) },
		});

		expect(prompt).toContain("#tag-0");
		expect(prompt).toContain("#tag-31");
		expect(prompt).not.toContain("#tag-39");
		expect(prompt).toContain("8 more");
		expect(prompt).toContain("16 more");
		expect(prompt).toContain("truncated");
	});

	it("recognizes a request to create a note as a vault mutation", () => {
		expect(requestsVaultMutation("在当前目录下创建一份关键字段解析.md 文档")).toBe(true);
		expect(requestsVaultMutation("如何创建一份 Markdown 文档？")).toBe(false);
	});
});
