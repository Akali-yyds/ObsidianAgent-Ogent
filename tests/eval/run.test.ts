import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runEvalHarness } from "../../hackathon/eval/run";
import type { ChatMessage, ModelProvider, StreamEvent } from "../../src/types";

const fixturesDir = fileURLToPath(new URL("../../hackathon/eval/fixtures", import.meta.url));
const tempDirs: string[] = [];

describe("runEvalHarness", () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map(async (dir) => {
				await rm(dir, { recursive: true, force: true });
			}),
		);
	});

	it("writes timestamped JSON and markdown reports with baseline-vs-verified metrics", async () => {
		const resultsDir = await mkdtemp(path.join(tmpdir(), "open-agent-eval-"));
		tempDirs.push(resultsDir);

		const run = await runEvalHarness({ fixturesDir, resultsDir });
		const outputFiles = await readdir(resultsDir);
		const json = JSON.parse(await readFile(run.jsonPath, "utf8")) as {
			packId: string;
			perQuery: unknown[];
			baselineHallucinationRate: number;
			verifiedHallucinationRate: number;
			hallucinationRateDelta: number;
			totalClaims: number;
			totalFlaggedClaims: number;
			claimBuckets: { verified: number; unsupported: number; quoteMissing: number };
			fixture: { queryCount: number };
		};
		const markdown = await readFile(run.markdownPath, "utf8");

		expect(run.report.packId).toBe("grounded-research");
		expect(run.report.fixture.queryCount).toBe(20);
		expect(run.report.perQuery).toHaveLength(20);
		expect(run.report.totalClaims).toBeGreaterThan(0);
		expect(run.report.totalFlaggedClaims).toBeGreaterThan(0);
		expect(run.report.claimBuckets.verified).toBeGreaterThan(0);
		expect(run.report.claimBuckets.unsupported).toBeGreaterThan(0);
		expect(run.report.claimBuckets.quoteMissing).toBeGreaterThan(0);
		expect(run.report.baselineHallucinationRate).toBeGreaterThanOrEqual(run.report.verifiedHallucinationRate);
		expect(json.packId).toBe("grounded-research");
		expect(json.fixture.queryCount).toBe(20);
		expect(json.perQuery).toHaveLength(20);
		expect(json.hallucinationRateDelta).toBe(
			Number((json.baselineHallucinationRate - json.verifiedHallucinationRate).toFixed(4)),
		);
		expect(outputFiles.filter((file) => file.endsWith(".json"))).toHaveLength(1);
		expect(outputFiles.filter((file) => file.endsWith(".md"))).toHaveLength(1);
		expect(markdown).toContain("# Eval report");
		expect(markdown).toContain("## Per-query breakdown");
	});

	it("runs the live benchmark mode against a real markdown vault with injected providers", async () => {
		const workspaceDir = await mkdtemp(path.join(tmpdir(), "open-agent-live-eval-"));
		tempDirs.push(workspaceDir);

		const vaultDir = path.join(workspaceDir, "vault");
		const resultsDir = path.join(workspaceDir, "results");
		const benchmarkPath = path.join(workspaceDir, "benchmark.json");
		await mkdir(path.join(vaultDir, "laureates"), { recursive: true });
		await mkdir(resultsDir, { recursive: true });

		await writeFile(
			path.join(vaultDir, "laureates", "albert-einstein.md"),
			[
				"---",
				'title: "Albert Einstein"',
				"---",
				"",
				"# Albert Einstein",
				"",
				'Albert Einstein received the 1921 Nobel Prize in Physics for "his services to theoretical physics, and especially for his discovery of the law of the photoelectric effect".',
				"",
			].join("\n"),
			"utf8",
		);
		await writeFile(
			benchmarkPath,
			`${JSON.stringify(
				{
					packId: "grounded-research",
					datasetId: "mini-nobel",
					datasetName: "Mini Nobel benchmark",
					queries: [
						{
							id: "einstein-photoelectric",
							category: "single-fact",
							query: "What specific discovery did Albert Einstein's 1921 Nobel Prize in Physics especially recognize?",
							notesExpected: ["laureates/albert-einstein.md"],
							expectedCitations: ["laureates/albert-einstein.md"],
							expectedOutcome: "supported",
							expectedClaims: [
								{
									source_note: "laureates/albert-einstein.md",
									source_quote:
										'Albert Einstein received the 1921 Nobel Prize in Physics for "his services to theoretical physics, and especially for his discovery of the law of the photoelectric effect".',
									required_phrases: ["Einstein", "1921", "photoelectric effect"],
								},
							],
						},
					],
				},
				null,
				2,
			)}\n`,
			"utf8",
		);

		const providerFactory = (_config: unknown, agentId: string): ModelProvider => ({
			async *stream(messages: ChatMessage[]): AsyncIterable<StreamEvent> {
				if (agentId === "retriever") {
					yield {
						kind: "text",
						text:
							'- laureates/albert-einstein.md: Albert Einstein received the 1921 Nobel Prize in Physics for "his services to theoretical physics, and especially for his discovery of the law of the photoelectric effect".',
					};
					yield { kind: "done", finishReason: "stop" };
					return;
				}
				if (agentId === "synthesizer") {
					yield {
						kind: "text",
						text: JSON.stringify({
							summary: "Einstein's Nobel citation especially recognized the photoelectric effect.",
							claims: [
								{
									id: "c1",
									text: "Albert Einstein's 1921 Nobel Prize in Physics especially recognized the photoelectric effect.",
									source_note: "laureates/albert-einstein.md",
									source_quote:
										'Albert Einstein received the 1921 Nobel Prize in Physics for "his services to theoretical physics, and especially for his discovery of the law of the photoelectric effect".',
									confidence: 0.98,
								},
							],
						}),
					};
					yield { kind: "done", finishReason: "stop" };
					return;
				}

				const prompt = messages.at(-1)?.content ?? "";
				yield {
					kind: "text",
					text: JSON.stringify({
						supports_claim: prompt.includes("photoelectric effect"),
						explanation: "The cited quote directly supports the benchmark claim.",
					}),
				};
				yield { kind: "done", finishReason: "stop" };
			},
		});

		const run = await runEvalHarness({
			live: true,
			benchmarkPath,
			vaultDir,
			resultsDir,
			providerFactory,
		});

		const outputFiles = await readdir(resultsDir);
		const markdown = await readFile(run.markdownPath, "utf8");

		expect(run.report.mode).toBe("live");
		expect(run.report.dataset?.id).toBe("mini-nobel");
		expect(run.report.fixture.queryCount).toBe(1);
		expect(run.report.baselineHallucinationRate).toBe(0);
		expect(run.report.verifiedHallucinationRate).toBe(0);
		expect(run.report.perQuery).toHaveLength(1);
		expect(outputFiles.filter((file) => file.endsWith(".json"))).toHaveLength(1);
		expect(outputFiles.filter((file) => file.endsWith(".md"))).toHaveLength(1);
		expect(markdown).toContain("- **Mode:** live");
		expect(markdown).toContain("- **Dataset:** Mini Nobel benchmark");
	});
});
