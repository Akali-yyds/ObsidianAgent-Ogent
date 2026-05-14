import { describe, expect, it } from "vitest";
import { normalizeWhitespace, quotePresent } from "../../src/agents/quote-match";

describe("quotePresent", () => {
	it("collapses whitespace for matching", () => {
		expect(normalizeWhitespace("hello\n  there\tfriend")).toBe("hello there friend");
		expect(quotePresent("Alpha\n\nBeta   Gamma", "Alpha Beta Gamma")).toBe(true);
	});

	it("rejects empty or whitespace-only quotes", () => {
		expect(quotePresent("Some note body", "")).toBe(false);
		expect(quotePresent("Some note body", "   \n\t  ")).toBe(false);
	});

	it("distinguishes near matches from exact normalized matches", () => {
		expect(quotePresent("Quarterly revenue reached 12 million dollars.", "12 million dollars")).toBe(true);
		expect(quotePresent("Quarterly revenue reached 12 million dollars.", "12 billion dollars")).toBe(false);
	});

	it("matches punctuation and markdown formatting drift", () => {
		expect(quotePresent("**Alpha** launched — in 2024.", "Alpha launched in 2024")).toBe(true);
		expect(quotePresent("[Alpha](note.md) launched in 2024.", "Alpha launched in 2024")).toBe(true);
	});

	it("allows small wording drift while preserving phrase order", () => {
		expect(
			quotePresent(
				"Alpha launched in 2024 and reached beta users in May.",
				"Alpha launched in 2024 reached beta users in May",
			),
		).toBe(true);
	});

	it("rejects looser paraphrases that change order or wording too much", () => {
		expect(
			quotePresent(
				"Alpha launched in 2024 and reached beta users in May.",
				"In May beta users saw Alpha after its 2024 launch",
			),
		).toBe(false);
	});
});
