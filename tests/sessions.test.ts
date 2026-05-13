import { describe, expect, it, vi } from "vitest";
import { SessionStore, loadStoredTurnsFile, type StoredTurn } from "../src/sessions";
import { createMockAdapter } from "./setup";

describe("SessionStore", () => {
	it("migrates embedded turns and falls back to the first session when active id is invalid", async () => {
		const persistIndex = vi.fn(async () => undefined);
		const readTurns = vi.fn(async (id: string) => ({ turns: [{ role: "assistant", content: `loaded:${id}` } satisfies StoredTurn] }));
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
		const readTurns = vi.fn(async () => ({ turns: [] }));
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

	it("surfaces recovery metadata when turn reads recover from corrupt data", async () => {
		const persistIndex = vi.fn(async () => undefined);
		const recovery = {
			reason: "turns-corrupt" as const,
			message: "Saved chat history was unreadable. OpenAgent moved the original file to sessions/session-a.corrupt-1.json and reset this chat to an empty history.",
			backupPath: "sessions/session-a.corrupt-1.json",
			recoveredAt: 1,
		};
		const readTurns = vi.fn()
			.mockResolvedValueOnce({ turns: [], recovery })
			.mockResolvedValueOnce({ turns: [{ role: "assistant", content: "healthy again" } satisfies StoredTurn] });
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
		expect(store.getActive().recovery).toEqual(recovery);

		await store.switchTo("session-a");
		expect(store.getActive().turns).toEqual([{ role: "assistant", content: "healthy again" }]);
		expect(store.getActive().recovery).toBeNull();
	});
});

describe("loadStoredTurnsFile", () => {
	it("loads valid turn files without recovery metadata", async () => {
		const adapter = createMockAdapter({
			"sessions/session-a.json": JSON.stringify({
				turns: [{ role: "assistant", content: "loaded" } satisfies StoredTurn],
			}),
		});

		const result = await loadStoredTurnsFile({
			adapter,
			path: "sessions/session-a.json",
			now: () => 123,
		});

		expect(result).toEqual({
			turns: [{ role: "assistant", content: "loaded" }],
		});
		expect(adapter.rename).not.toHaveBeenCalled();
		expect(adapter.write).not.toHaveBeenCalled();
	});

	it("backs up corrupt turn files and resets the active file to empty turns", async () => {
		const adapter = createMockAdapter({
			"sessions/session-a.json": "{not valid json",
		});

		const result = await loadStoredTurnsFile({
			adapter,
			path: "sessions/session-a.json",
			now: () => 123,
		});

		expect(result.recovery).toEqual({
			reason: "turns-corrupt",
			backupPath: "sessions/session-a.corrupt-123.json",
			recoveredAt: 123,
			message: "Saved chat history was unreadable. OpenAgent moved the original file to sessions/session-a.corrupt-123.json and reset this chat to an empty history.",
		});
		expect(result.turns).toEqual([]);
		expect(adapter.rename).toHaveBeenCalledWith(
			"sessions/session-a.json",
			"sessions/session-a.corrupt-123.json",
		);
		expect(adapter.write).toHaveBeenCalledWith(
			"sessions/session-a.json",
			JSON.stringify({ turns: [] }),
		);
		expect(await adapter.read("sessions/session-a.corrupt-123.json")).toBe("{not valid json");
		expect(await adapter.read("sessions/session-a.json")).toBe(JSON.stringify({ turns: [] }));
	});

	it("treats non-array turn payloads as corrupt and recovers visibly", async () => {
		const adapter = createMockAdapter({
			"sessions/session-a.json": JSON.stringify({ turns: null }),
		});

		const result = await loadStoredTurnsFile({
			adapter,
			path: "sessions/session-a.json",
			now: () => 456,
		});

		expect(result.recovery?.backupPath).toBe("sessions/session-a.corrupt-456.json");
		expect(await adapter.read("sessions/session-a.corrupt-456.json")).toBe(JSON.stringify({ turns: null }));
		expect(await adapter.read("sessions/session-a.json")).toBe(JSON.stringify({ turns: [] }));
	});
});
