import { describe, expect, it, vi } from "vitest";
import { SessionStore, type StoredTurn } from "../src/sessions";

describe("SessionStore", () => {
	it("migrates embedded turns and falls back to the first session when active id is invalid", async () => {
		const persistIndex = vi.fn(async () => undefined);
		const readTurns = vi.fn(async (id: string) => [{ role: "assistant", content: `loaded:${id}` } satisfies StoredTurn]);
		const writeTurns = vi.fn(async () => undefined);
		const deleteTurns = vi.fn(async () => undefined);
		const store = new SessionStore({ persistIndex, readTurns, writeTurns, deleteTurns });

		await store.init(
			[
				{
					id: "session-a",
					title: "A",
					model: "classic",
					selectedPackId: null,
					lastClassicModel: "classic",
					createdAt: 1,
					updatedAt: 2,
					turns: [{ role: "user", content: "embedded" }],
				},
				{
					id: "session-b",
					title: "B",
					model: "pack",
					selectedPackId: "grounded-research",
					lastClassicModel: "classic",
					createdAt: 3,
					updatedAt: 4,
					turns: [],
				},
			],
			"missing-id",
		);

		expect(writeTurns).toHaveBeenCalledWith("session-a", [{ role: "user", content: "embedded" }]);
		expect(store.getActiveId()).toBe("session-a");
		expect(readTurns).toHaveBeenCalledWith("session-a");
		expect(store.getActive().turns).toEqual([{ role: "assistant", content: "loaded:session-a" }]);
	});

	it("persists turns and index together so pack metadata is retained", async () => {
		const persistIndex = vi.fn(async () => undefined);
		const readTurns = vi.fn(async () => []);
		const writeTurns = vi.fn(async () => undefined);
		const deleteTurns = vi.fn(async () => undefined);
		const store = new SessionStore({ persistIndex, readTurns, writeTurns, deleteTurns });

		await store.init(
			[
				{
					id: "session-a",
					title: "A",
					model: "classic",
					selectedPackId: "grounded-research",
					lastClassicModel: "classic",
					createdAt: 1,
					updatedAt: 2,
				},
			],
			"session-a",
		);

		const turns: StoredTurn[] = [
			{ role: "user", content: "Question" },
			{
				role: "assistant",
				content: "",
				packTurn: {
					packId: "grounded-research",
					packName: "Grounded Research",
					verifiedSummary: "- Answer",
					claims: [
						{
							id: "claim-1",
							text: "Answer",
							sourceNote: "notes/a.md",
							sourceQuote: "Answer",
							quotePresent: true,
							supportsClaim: true,
							supportExplanation: "Supported",
							status: "verified",
						},
					],
				},
			},
		];

		await store.updateTurns("session-a", turns);

		expect(writeTurns).toHaveBeenCalledWith("session-a", turns);
		expect(persistIndex).toHaveBeenCalledTimes(1);
		expect(store.getActive().turns).toEqual(turns);
		expect(store.toJSON()).toEqual({
			sessions: [
				expect.objectContaining({
					id: "session-a",
					selectedPackId: "grounded-research",
					lastClassicModel: "classic",
				}),
			],
			activeSessionId: "session-a",
		});
	});

	it("falls back to an empty turn list when turn reads fail", async () => {
		const persistIndex = vi.fn(async () => undefined);
		const readTurns = vi.fn(async () => {
			throw new Error("corrupt json");
		});
		const writeTurns = vi.fn(async () => undefined);
		const deleteTurns = vi.fn(async () => undefined);
		const store = new SessionStore({ persistIndex, readTurns, writeTurns, deleteTurns });

		await store.init(
			[
				{
					id: "session-a",
					title: "A",
					model: "classic",
					selectedPackId: null,
					lastClassicModel: "classic",
					createdAt: 1,
					updatedAt: 2,
				},
			],
			"session-a",
		);

		expect(store.getActive().turns).toEqual([]);

		await store.switchTo("session-a");
		expect(store.getActive().turns).toEqual([]);
	});
});
