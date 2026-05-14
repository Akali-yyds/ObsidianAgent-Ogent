import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../../src/agents/agent";
import type { ClaimsV1 } from "../../src/agents/schemas/claims-v1";
import { verifyClaims } from "../../src/agents/verifier";
import type { VaultAdapter } from "../../src/packs/vault-adapter";
import type { ModelProvider } from "../../src/types";

const { runStructuredStepMock } = vi.hoisted(() => ({
	runStructuredStepMock: vi.fn(),
}));

vi.mock("../../src/agents/structured-output", () => ({
	runStructuredStep: runStructuredStepMock,
}));

function createVault(files: Record<string, string>): VaultAdapter {
	return {
		listMarkdownFiles: () => Object.keys(files).map((path) => ({ path, basename: path.split("/").pop()?.replace(/\.md$/i, "") ?? path })),
		getFile: (path) => (path in files ? { path, basename: path.split("/").pop()?.replace(/\.md$/i, "") ?? path } : null),
		read: async (file) => files[file.path] ?? "",
		resolveLink: () => null,
		getResolvedLinks: () => ({}),
		getFileCache: () => null,
	};
}

const provider: ModelProvider = { stream: vi.fn() };
const agent = {} as Agent;

describe("verifyClaims", () => {
	beforeEach(() => {
		runStructuredStepMock.mockReset();
	});

	it("returns quote-missing results without calling the verifier when the live note or quote is missing", async () => {
		const claims: ClaimsV1 = {
			summary: "Summary",
			claims: [
				{
					id: "missing-file",
					text: "Alpha",
					source_note: "notes/missing.md",
					source_quote: "Alpha",
				},
				{
					id: "missing-quote",
					text: "Beta",
					source_note: "notes/a.md",
					source_quote: "Beta quote",
				},
			],
		};

		const results = await verifyClaims({
			vault: createVault({ "notes/a.md": "Only Alpha appears here." }),
			claims,
			agent,
			provider,
		});

		expect(runStructuredStepMock).not.toHaveBeenCalled();
		expect(results).toEqual([
			{
				id: "missing-file",
				text: "Alpha",
				sourceNote: "notes/missing.md",
				sourceQuote: "Alpha",
				quotePresent: false,
				supportsClaim: null,
				supportExplanation: "Quoted text not found in the live note.",
				status: "quote-missing",
			},
			{
				id: "missing-quote",
				text: "Beta",
				sourceNote: "notes/a.md",
				sourceQuote: "Beta quote",
				quotePresent: false,
				supportsClaim: null,
				supportExplanation: "Quoted text not found in the live note.",
				status: "quote-missing",
			},
		]);
	});

	it("maps verifier decisions into verified and unsupported claims while preserving trace data", async () => {
		runStructuredStepMock
			.mockResolvedValueOnce({
				ok: true,
				attempts: 1,
				rawText: '{"supports_claim":true,"explanation":"Directly supported"}',
				value: { supports_claim: true, explanation: "Directly supported" },
			})
			.mockResolvedValueOnce({
				ok: true,
				attempts: 1,
				rawText: '{"supports_claim":false,"explanation":"The quote does not support the claim"}',
				value: { supports_claim: false, explanation: "The quote does not support the claim" },
			});

		const claims: ClaimsV1 = {
			summary: "Summary",
			claims: [
				{
					id: "claim-1",
					text: "Alpha is true",
					source_note: "notes/a.md",
					source_quote: "alpha is true.",
				},
				{
					id: "claim-2",
					text: "Beta is true",
					source_note: "notes/a.md",
					source_quote: "Beta is contested.",
				},
			],
		};

		const results = await verifyClaims({
			vault: createVault({
				"notes/a.md": "Alpha is true.\nBeta is contested.",
			}),
			claims,
			agent,
			provider,
		});

		expect(runStructuredStepMock).toHaveBeenCalledTimes(2);
		expect(runStructuredStepMock.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				provider,
				schema: expect.objectContaining({ name: "verifier-support-v1" }),
				messages: [
					{
						role: "user",
						content: expect.stringContaining("Claim: Alpha is true"),
					},
				],
			}),
		);
		expect(results).toEqual([
			{
				id: "claim-1",
				text: "Alpha is true",
				sourceNote: "notes/a.md",
				sourceQuote: "alpha is true.",
				quotePresent: true,
				supportsClaim: true,
				supportExplanation: "Directly supported",
				status: "verified",
				exactPhraseAnchor: {
					notePath: "notes/a.md",
					exactPhrase: "Alpha is true.",
					startOffset: 0,
					endOffset: "Alpha is true.".length,
					occurrenceIndex: 0,
				},
			},
			{
				id: "claim-2",
				text: "Beta is true",
				sourceNote: "notes/a.md",
				sourceQuote: "Beta is contested.",
				quotePresent: true,
				supportsClaim: false,
				supportExplanation: "The quote does not support the claim",
				status: "unsupported",
				exactPhraseAnchor: {
					notePath: "notes/a.md",
					exactPhrase: "Beta is contested.",
					startOffset: "Alpha is true.\n".length,
					endOffset: "Alpha is true.\nBeta is contested.".length,
					occurrenceIndex: 0,
				},
			},
		]);
	});

	it("keeps fuzzy-only matches quote-present but anchorless", async () => {
		runStructuredStepMock.mockResolvedValueOnce({
			ok: true,
			attempts: 1,
			rawText: '{"supports_claim":true,"explanation":"Supported despite punctuation drift"}',
			value: { supports_claim: true, explanation: "Supported despite punctuation drift" },
		});

		const results = await verifyClaims({
			vault: createVault({
				"notes/a.md": "**Alpha** launched — in 2024.",
			}),
			claims: {
				summary: "Summary",
				claims: [
					{
						id: "claim-1",
						text: "Alpha launched in 2024",
						source_note: "notes/a.md",
						source_quote: "Alpha launched in 2024",
					},
				],
			},
			agent,
			provider,
		});

		expect(results).toEqual([
			{
				id: "claim-1",
				text: "Alpha launched in 2024",
				sourceNote: "notes/a.md",
				sourceQuote: "Alpha launched in 2024",
				quotePresent: true,
				supportsClaim: true,
				supportExplanation: "Supported despite punctuation drift",
				status: "verified",
			},
		]);
		expect(results[0]?.exactPhraseAnchor).toBeUndefined();
	});
});
