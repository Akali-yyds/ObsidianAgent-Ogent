import { describe, expect, it, vi } from "vitest";
import { loadStoredTurnsFile, SessionStore, type SessionFileAdapter, type StoredTurn } from "../src/sessions";

function memoryAdapter(initial: Record<string, string> = {}): SessionFileAdapter & { files: Map<string, string> } {
	const files = new Map(Object.entries(initial));
	return {
		files,
		exists: async (path) => files.has(path),
		read: async (path) => files.get(path) ?? "",
		write: async (path, data) => { files.set(path, data); },
		rename: async (path, nextPath) => {
			const data = files.get(path);
			files.delete(path);
			if (data !== undefined) files.set(nextPath, data);
		},
	};
}

describe("SessionStore", () => {
	it("creates, updates, and switches lightweight Agent sessions", async () => {
		const adapter = memoryAdapter();
		const persistIndex = vi.fn(async () => undefined);
		const store = new SessionStore({
			persistIndex,
			readTurns: async (id) => loadStoredTurnsFile({ adapter, path: `${id}.json` }),
			writeTurns: async (id, turns) => adapter.write(`${id}.json`, JSON.stringify({ turns })),
			deleteTurns: async (id) => { adapter.files.delete(`${id}.json`); },
		});

		await store.init([{ id: "a", title: "A", model: "model-a", createdAt: 1, updatedAt: 1 }], "a");
		const turns: StoredTurn[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi", segments: [{ kind: "text", text: "Hi" }] },
		];
		await store.updateTurns("a", turns);
		expect(store.getActive().turns).toEqual(turns);
		expect(JSON.parse(adapter.files.get("a.json") ?? "{}").turns).toEqual(turns);

		const forked = await store.fork("a");
		expect(forked?.turns).toEqual(turns);
		expect(store.getSessions()).toHaveLength(2);
		expect(persistIndex).toHaveBeenCalled();
	});

	it("keeps context attachments and ignores removed legacy metadata", async () => {
		const adapter = memoryAdapter({
			"a.json": JSON.stringify({ turns: [{ role: "assistant", content: "Answer", legacyResearch: { id: "removed" }, events: [{ sequence: 1, timestamp: 2, kind: "text" }] }] }),
		});
		const store = new SessionStore({
			persistIndex: async () => undefined,
			readTurns: async (id) => loadStoredTurnsFile({ adapter, path: `${id}.json` }),
			writeTurns: async (id, turns) => adapter.write(`${id}.json`, JSON.stringify({ turns })),
			deleteTurns: async () => undefined,
		});
		await store.init([{ id: "a", title: "A", model: "m", createdAt: 1, updatedAt: 1, attachedContextPaths: ["notes/a.md"] }], "a");
		expect(store.getActive().attachedContextPaths).toEqual(["notes/a.md"]);
		expect(store.getActive().turns).toEqual([{ role: "assistant", content: "Answer", events: [{ sequence: 1, timestamp: 2, kind: "text" }] }]);
	});
});

describe("loadStoredTurnsFile", () => {
	it("backs up malformed history and starts with an empty conversation", async () => {
		const adapter = memoryAdapter({ "chat.json": "not-json" });
		const result = await loadStoredTurnsFile({ adapter, path: "chat.json", now: () => 123 });
		expect(result.turns).toEqual([]);
		expect(result.recovery?.backupPath).toBe("chat.corrupt-123.json");
		expect(adapter.files.has("chat.corrupt-123.json")).toBe(true);
		expect(JSON.parse(adapter.files.get("chat.json") ?? "{}").turns).toEqual([]);
	});

	it("sanitizes ordinary event, tool, and segment data", async () => {
		const adapter = memoryAdapter({
			"chat.json": JSON.stringify({ turns: [{ role: "assistant", content: "", segments: [{ kind: "thinking", text: "work" }, { kind: "tool", id: "t1" }], toolCalls: [{ id: "t1", name: "vault_read", args: { path: "a.md" }, mutates: false, status: "ok", result: { ok: true, value: "x" } }] }] }),
		});
		const result = await loadStoredTurnsFile({ adapter, path: "chat.json" });
		expect(result.turns[0]).toMatchObject({ role: "assistant", segments: [{ kind: "thinking", text: "work" }, { kind: "tool", id: "t1" }] });
		expect(result.turns[0].toolCalls?.[0].result).toEqual({ ok: true, value: "x" });
	});
});
