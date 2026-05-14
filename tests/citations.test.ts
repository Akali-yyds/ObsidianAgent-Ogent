import { describe, expect, it } from "vitest";
import type { ClaimVerification } from "../src/agents/verifier";
import { composeResearchResult, resolveCitationTarget } from "../src/citations";

function makeClaim(overrides: Partial<ClaimVerification> = {}): ClaimVerification {
	return {
		id: "claim-1",
		text: "Alpha shipped in 2024.",
		sourceNote: "notes/a.md",
		sourceQuote: "Alpha shipped in 2024.",
		quotePresent: true,
		supportsClaim: true,
		supportExplanation: "Supported",
		status: "verified",
		exactPhraseAnchor: {
			notePath: "notes/a.md",
			exactPhrase: "Alpha shipped in 2024.",
			startOffset: 0,
			endOffset: "Alpha shipped in 2024.".length,
			occurrenceIndex: 0,
		},
		...overrides,
	};
}

describe("composeResearchResult", () => {
	it("composes research markdown with ordered inline citations from anchored verified claims", () => {
		const result = composeResearchResult([
			makeClaim(),
			makeClaim({
				id: "claim-2",
				text: "Beta remained private.",
				sourceNote: "notes/b.md",
				sourceQuote: "Beta remained private.",
				exactPhraseAnchor: {
					notePath: "notes/b.md",
					exactPhrase: "Beta remained private.",
					startOffset: 5,
					endOffset: 27,
					occurrenceIndex: 0,
				},
			}),
		]);

		expect(result).toEqual({
			researchMarkdown:
				"Alpha shipped in 2024. [1](openagent://citation/1)\n\nBeta remained private. [2](openagent://citation/2)",
			citations: [
				{
					claimId: "claim-1",
					notePath: "notes/a.md",
					exactPhrase: "Alpha shipped in 2024.",
					startOffset: 0,
					endOffset: "Alpha shipped in 2024.".length,
					occurrenceIndex: 0,
				},
				{
					claimId: "claim-2",
					notePath: "notes/b.md",
					exactPhrase: "Beta remained private.",
					startOffset: 5,
					endOffset: 27,
					occurrenceIndex: 0,
				},
			],
		});
	});

	it("reuses the same citation label for the same anchored phrase occurrence", () => {
		const repeatedAnchor = {
			notePath: "notes/a.md",
			exactPhrase: "Alpha shipped in 2024.",
			startOffset: 0,
			endOffset: "Alpha shipped in 2024.".length,
			occurrenceIndex: 0,
		};

		const result = composeResearchResult([
			makeClaim({ id: "claim-1", exactPhraseAnchor: repeatedAnchor }),
			makeClaim({
				id: "claim-2",
				text: "The Alpha launch stayed on schedule.",
				exactPhraseAnchor: repeatedAnchor,
			}),
		]);

		expect(result?.researchMarkdown).toBe(
			"Alpha shipped in 2024. [1](openagent://citation/1)\n\nThe Alpha launch stayed on schedule. [1](openagent://citation/1)",
		);
		expect(result?.citations).toEqual([
			{
				claimId: "claim-1",
				...repeatedAnchor,
			},
		]);
	});

	it("allocates a new label when the phrase differs even within the same note", () => {
		const result = composeResearchResult([
			makeClaim(),
			makeClaim({
				id: "claim-2",
				text: "Alpha reached general availability.",
				exactPhraseAnchor: {
					notePath: "notes/a.md",
					exactPhrase: "general availability",
					startOffset: 32,
					endOffset: 52,
					occurrenceIndex: 0,
				},
			}),
		]);

		expect(result?.researchMarkdown).toBe(
			"Alpha shipped in 2024. [1](openagent://citation/1)\n\nAlpha reached general availability. [2](openagent://citation/2)",
		);
		expect(result?.citations).toHaveLength(2);
	});

	it("excludes unsupported, quote-missing, and fuzzy-only claims from inline citations", () => {
		const result = composeResearchResult([
			makeClaim(),
			makeClaim({
				id: "claim-2",
				text: "Unsupported claim",
				supportsClaim: false,
				status: "unsupported",
			}),
			makeClaim({
				id: "claim-3",
				text: "Missing quote claim",
				quotePresent: false,
				supportsClaim: null,
				status: "quote-missing",
				exactPhraseAnchor: undefined,
			}),
			makeClaim({
				id: "claim-4",
				text: "Fuzzy-only claim",
				exactPhraseAnchor: undefined,
			}),
		]);

		expect(result).toEqual({
			researchMarkdown: "Alpha shipped in 2024. [1](openagent://citation/1)",
			citations: [
				{
					claimId: "claim-1",
					notePath: "notes/a.md",
					exactPhrase: "Alpha shipped in 2024.",
					startOffset: 0,
					endOffset: "Alpha shipped in 2024.".length,
					occurrenceIndex: 0,
				},
			],
		});
	});
});

describe("resolveCitationTarget", () => {
	it("validates stored offsets, relocates by exact phrase and occurrence index, and falls back when unresolved", () => {
		const anchor = {
			notePath: "notes/a.md",
			exactPhrase: "Alpha shipped in 2024.",
			startOffset: 0,
			endOffset: "Alpha shipped in 2024.".length,
			occurrenceIndex: 1,
		};

		expect(resolveCitationTarget(anchor, "Alpha shipped in 2024.Alpha shipped in 2024.")).toEqual({
			kind: "resolved",
			matchType: "relocated",
			notePath: "notes/a.md",
			exactPhrase: "Alpha shipped in 2024.",
			startOffset: "Alpha shipped in 2024.".length,
			endOffset: "Alpha shipped in 2024.Alpha shipped in 2024.".length,
			occurrenceIndex: 1,
		});

		expect(
			resolveCitationTarget(
				{ ...anchor, startOffset: "Lead-in ".length, endOffset: "Lead-in Alpha shipped in 2024.".length, occurrenceIndex: 0 },
				"Lead-in Alpha shipped in 2024.",
			),
		).toEqual({
			kind: "resolved",
			matchType: "stored-offsets",
			notePath: "notes/a.md",
			exactPhrase: "Alpha shipped in 2024.",
			startOffset: "Lead-in ".length,
			endOffset: "Lead-in Alpha shipped in 2024.".length,
			occurrenceIndex: 0,
		});

		expect(resolveCitationTarget(anchor, "No matching text remains here.")).toEqual({
			kind: "fallback",
			reason: "unresolved",
			message: "Citation target no longer matches the live note.",
		});
	});
});
