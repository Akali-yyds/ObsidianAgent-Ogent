import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/provider", () => {
	throw new Error("src/provider should not be imported by the eval harness");
});

const { runEvalHarness } = await import("../../hackathon/eval/run");

const fixturesDir = fileURLToPath(new URL("../../hackathon/eval/fixtures", import.meta.url));
const tempDirs: string[] = [];

describe("runEvalHarness provider seam", () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map(async (dir) => {
				await rm(dir, { recursive: true, force: true });
			}),
		);
	});

	it("does not load the obsidian-backed provider module when fixture providers are injected", async () => {
		const resultsDir = await mkdtemp(path.join(tmpdir(), "open-agent-eval-provider-seam-"));
		tempDirs.push(resultsDir);

		const run = await runEvalHarness({ fixturesDir, resultsDir });

		expect(run.report.packId).toBe("grounded-research");
		expect(run.report.perQuery).toHaveLength(20);
	});
});
