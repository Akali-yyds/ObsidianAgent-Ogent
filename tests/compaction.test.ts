import { describe, expect, it } from "vitest";
import { compactMessages, estimateMessageTokens } from "../src/compaction";

describe("conversation compaction", () => {
	it("preserves system instructions and the latest exchange", () => {
		const messages = [
			{ role: "system" as const, content: "Always use vault-relative paths." },
			{ role: "user" as const, content: "Old request ".repeat(100) },
			{ role: "assistant" as const, content: "Old answer ".repeat(100) },
			{ role: "user" as const, content: "Latest request" },
		];

		const result = compactMessages(messages, 100);

		expect(result.compacted).toBe(true);
		expect(result.messages[0]?.content).toContain("vault-relative");
		expect(result.messages.at(-1)?.content).toBe("Latest request");
		expect(result.summary).toContain("Old request");
		expect(estimateMessageTokens(result.messages)).toBeGreaterThan(0);
	});
});
