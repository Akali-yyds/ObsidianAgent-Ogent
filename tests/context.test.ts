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

	it("recognizes a request to create a note as a vault mutation", () => {
		expect(requestsVaultMutation("在当前目录下创建一份关键字段解析.md 文档")).toBe(true);
		expect(requestsVaultMutation("如何创建一份 Markdown 文档？")).toBe(false);
	});
});
