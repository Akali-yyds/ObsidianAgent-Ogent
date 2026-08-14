import { describe, expect, it } from "vitest";
import { loadVaultRules } from "../src/rules";

describe("vault rules", () => {
	it("loads root and directory rules in a bounded deterministic prompt", async () => {
		const files: Record<string, string> = {
			"OpenAgent.md": "Use concise bilingual explanations.",
			".open-agent/rules/writing.md": "Prefer Markdown headings.",
		};
		const app = {
			vault: {
				adapter: {
					exists: async (path: string) => path in files || path === ".open-agent/rules",
					read: async (path: string) => files[path] ?? "",
					list: async () => ({ files: [".open-agent/rules/writing.md"], folders: [] }),
				},
			},
		};

		const prompt = await loadVaultRules(app);

		expect(prompt).toContain("OpenAgent.md");
		expect(prompt).toContain("Prefer Markdown headings");
		expect(prompt).toContain("untrusted reference material");
	});
});
