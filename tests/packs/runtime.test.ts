import { beforeEach, describe, expect, it, vi } from "vitest";
import groundedResearchDefault from "../../src/packs/defaults/grounded-research.json";
import groundedResearchOpenAiDefault from "../../src/packs/defaults/grounded-research.openai.json";
import { createMockApp } from "../setup";

const retrieveEvidenceMock = vi.fn();
const verifyClaimsMock = vi.fn();
const providerStreams: string[] = [];

vi.mock("../../src/agents/retrieval", async () => {
	const actual = await vi.importActual<typeof import("../../src/agents/retrieval")>("../../src/agents/retrieval");
	return {
		...actual,
		retrieveEvidence: retrieveEvidenceMock,
	};
});

vi.mock("../../src/agents/verifier", () => ({
	verifyClaims: verifyClaimsMock,
}));

vi.mock("../../src/provider", () => ({
	OpenAICompatibleProvider: class {
		config: { model: string };

		constructor(config: { model: string }) {
			this.config = config;
		}

		async *stream() {
			yield { kind: "text", text: providerStreams.shift() ?? "" };
			yield { kind: "done", finishReason: "stop" };
		}
	},
}));

describe("runPack", () => {
	beforeEach(() => {
		providerStreams.length = 0;
		retrieveEvidenceMock.mockReset();
		verifyClaimsMock.mockReset();
	});

	it("runs shared runtime logic for verified and verifier-disabled eval paths", async () => {
		retrieveEvidenceMock.mockResolvedValue({
			query: "What happened?",
			scope: { notePaths: [], folders: [], tags: [] },
			notes: [
				{
					path: "notes/a.md",
					title: "a",
					content: "Alpha fact",
					excerpt: "Alpha fact",
					score: 5,
				},
			],
		});
		verifyClaimsMock.mockResolvedValue([
			{
				id: "claim-1",
				text: "Alpha fact",
				sourceNote: "notes/a.md",
				sourceQuote: "Alpha fact",
				quotePresent: true,
				supportsClaim: true,
				supportExplanation: "Matches note text",
				status: "verified",
			},
			{
				id: "claim-2",
				text: "Missing fact",
				sourceNote: "notes/a.md",
				sourceQuote: "Missing fact",
				quotePresent: false,
				supportsClaim: null,
				supportExplanation: "Quote missing",
				status: "quote-missing",
			},
		]);
		providerStreams.push(
			"- Alpha fact (notes/a.md)",
			JSON.stringify({
				summary: "Alpha summary",
				claims: [
					{
						id: "claim-1",
						text: "Alpha fact",
						source_note: "notes/a.md",
						source_quote: "Alpha fact",
						confidence: 0.9,
					},
					{
						id: "claim-2",
						text: "Missing fact",
						source_note: "notes/a.md",
						source_quote: "Missing fact",
						confidence: 0.2,
					},
				],
			}),
		);

		const { runPack, runPackForEval } = await import("../../src/packs/runtime");
		const events: Array<Record<string, unknown>> = [];
		const app = createMockApp({
			files: {
				"notes/a.md": "Alpha fact",
			},
		});

		const result = await runPack({
			app: app as never,
			pack: groundedResearchDefault,
			query: "What happened?",
			onEvent: async (event) => {
				events.push(event as unknown as Record<string, unknown>);
			},
		});
		expect(result.artifacts).toEqual({
			verifierEnabled: true,
			retrieval: {
				brief: "- Alpha fact (notes/a.md)",
				notes: [
					{
						path: "notes/a.md",
						title: "a",
						content: "Alpha fact",
						excerpt: "Alpha fact",
						score: 5,
					},
				],
			},
			draftClaims: {
				summary: "Alpha summary",
				claims: [
					{
						id: "claim-1",
						text: "Alpha fact",
						source_note: "notes/a.md",
						source_quote: "Alpha fact",
						confidence: 0.9,
					},
					{
						id: "claim-2",
						text: "Missing fact",
						source_note: "notes/a.md",
						source_quote: "Missing fact",
						confidence: 0.2,
					},
				],
			},
			verifications: result.claims,
		});
		expect(retrieveEvidenceMock).toHaveBeenCalledOnce();
		expect(verifyClaimsMock).toHaveBeenCalledOnce();
		expect(result).toEqual({
			packId: "grounded-research",
			packName: "Grounded Research",
			verifiedSummary: "- Alpha fact",
			claims: [
				{
					id: "claim-1",
					text: "Alpha fact",
					sourceNote: "notes/a.md",
					sourceQuote: "Alpha fact",
					quotePresent: true,
					supportsClaim: true,
					supportExplanation: "Matches note text",
					status: "verified",
				},
				{
					id: "claim-2",
					text: "Missing fact",
					sourceNote: "notes/a.md",
					sourceQuote: "Missing fact",
					quotePresent: false,
					supportsClaim: null,
					supportExplanation: "Quote missing",
					status: "quote-missing",
				},
			],
			modelsUsed: {
				retriever: "gemma-4-4b-it",
				synthesizer: "gemma-4-31b-it",
				verifier: "gemma-4-4b-it",
			},
			artifacts: expect.any(Object),
		});
		expect(events).toEqual([
			{ kind: "step", step: { id: "retriever", label: "Retrieving notes", state: "pending", message: undefined } },
			{ kind: "step", step: { id: "synthesizer", label: "Drafting claims", state: "pending", message: undefined } },
			{ kind: "step", step: { id: "verifier", label: "Verifying claims", state: "pending", message: undefined } },
			{ kind: "step", step: { id: "retriever", label: "Retrieving notes", state: "running", message: undefined } },
			{ kind: "step", step: { id: "retriever", label: "Retrieving notes", state: "complete", message: undefined } },
			{ kind: "step", step: { id: "synthesizer", label: "Drafting claims", state: "running", message: undefined } },
			{ kind: "step", step: { id: "synthesizer", label: "Drafting claims", state: "complete", message: undefined } },
			{ kind: "step", step: { id: "verifier", label: "Verifying claims", state: "running", message: undefined } },
			{ kind: "step", step: { id: "verifier", label: "Verifying claims", state: "complete", message: undefined } },
		]);

		verifyClaimsMock.mockClear();
		providerStreams.push(
			"- Alpha fact (notes/a.md)",
			JSON.stringify({
				summary: "Alpha summary",
				claims: [
					{
						id: "claim-1",
						text: "Alpha fact",
						source_note: "notes/a.md",
						source_quote: "Alpha fact",
						confidence: 0.9,
					},
				],
			}),
		);

		const baseline = await runPackForEval({
			app: app as never,
			pack: groundedResearchDefault,
			query: "What happened?",
			verifierEnabled: false,
		});

		expect(verifyClaimsMock).not.toHaveBeenCalled();
		expect(baseline.claims).toEqual([]);
		expect(baseline.verifiedSummary).toBe("Alpha summary");
		expect(baseline.artifacts).toEqual({
			verifierEnabled: false,
			retrieval: {
				brief: "- Alpha fact (notes/a.md)",
				notes: [
					{
						path: "notes/a.md",
						title: "a",
						content: "Alpha fact",
						excerpt: "Alpha fact",
						score: 5,
					},
				],
			},
			draftClaims: {
				summary: "Alpha summary",
				claims: [
					{
						id: "claim-1",
						text: "Alpha fact",
						source_note: "notes/a.md",
						source_quote: "Alpha fact",
						confidence: 0.9,
					},
				],
			},
			verifications: null,
		});
	});

	it("rejects placeholder provider credentials before pack execution begins", async () => {
		const { runPack, PackConfigError } = await import("../../src/packs/runtime");
		const app = createMockApp({
			files: {
				"notes/a.md": "Alpha fact",
			},
		});

		await expect(
			runPack({
				app: app as never,
				pack: groundedResearchOpenAiDefault,
				query: "What happened?",
			}),
		).rejects.toThrow(PackConfigError);
		await expect(
			runPack({
				app: app as never,
				pack: groundedResearchOpenAiDefault,
				query: "What happened?",
			}),
		).rejects.toThrow(
			'Pack grounded-research.openai provider retriever still uses the placeholder API key "replace-me"',
		);
		expect(retrieveEvidenceMock).not.toHaveBeenCalled();
	});

	it("resolves provider mappings from pack json without requiring hardcoded provider ids", async () => {
		retrieveEvidenceMock.mockResolvedValue({
			query: "What happened?",
			scope: { notePaths: [], folders: [], tags: [] },
			notes: [
				{
					path: "notes/a.md",
					title: "a",
					content: "Alpha fact",
					excerpt: "Alpha fact",
					score: 5,
				},
			],
		});
		verifyClaimsMock.mockResolvedValue([
			{
				id: "claim-1",
				text: "Alpha fact",
				sourceNote: "notes/a.md",
				sourceQuote: "Alpha fact",
				quotePresent: true,
				supportsClaim: true,
				supportExplanation: "Matches note text",
				status: "verified",
			},
		]);
		providerStreams.push(
			"- Alpha fact (notes/a.md)",
			JSON.stringify({
				summary: "Alpha summary",
				claims: [
					{
						id: "claim-1",
						text: "Alpha fact",
						source_note: "notes/a.md",
						source_quote: "Alpha fact",
						confidence: 0.9,
					},
				],
			}),
		);

		const customPack = structuredClone(groundedResearchDefault);
		customPack.providers = {
			fast: {
				baseUrl: "http://retriever.local/v1",
				apiKey: "mlx-local",
				model: "retriever-model",
			},
			deep: {
				baseUrl: "http://synth.local/v1",
				apiKey: "mlx-local",
				model: "synth-model",
			},
			judge: {
				baseUrl: "http://verifier.local/v1",
				apiKey: "mlx-local",
				model: "verifier-model",
			},
		};
		customPack.agents.retriever.provider = "fast";
		customPack.agents.synthesizer.provider = "deep";
		customPack.agents.verifier.provider = "judge";

		const providerFactory = vi.fn((config: { model: string }, _agentId: string) => ({
			stream: async function* () {
				yield { kind: "text" as const, text: providerStreams.shift() ?? "" };
				yield { kind: "done" as const, finishReason: "stop" as const };
			},
			config,
		}));

		const { runPack } = await import("../../src/packs/runtime");
		const app = createMockApp({
			files: {
				"notes/a.md": "Alpha fact",
			},
		});

		const result = await runPack({
			app: app as never,
			pack: customPack,
			query: "What happened?",
			providerFactory,
		});

		expect(providerFactory.mock.calls.map(([config, agentId]) => [agentId, config.model])).toEqual([
			["retriever", "retriever-model"],
			["synthesizer", "synth-model"],
			["verifier", "verifier-model"],
		]);
		expect(result.modelsUsed).toEqual({
			retriever: "retriever-model",
			synthesizer: "synth-model",
			verifier: "verifier-model",
		});
		expect(Object.values(groundedResearchDefault.agents).every((agent) => !agent.toolAllowlist || agent.toolAllowlist.length === 0)).toBe(true);
	});
});
