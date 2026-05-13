import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runEvalHarness } from "../../hackathon/eval/run";

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
});
