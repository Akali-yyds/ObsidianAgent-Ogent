import { describe, expect, it, beforeEach } from "vitest";
import { communityPluginSearchTool } from "../src/tools/community/search";
import { createMockApp, requestUrlMock } from "./setup";

const SAMPLE_PLUGINS = [
	{
		id: "obsidian-git",
		name: "Git",
		author: "Vinzent",
		description: "Integrate Git version control with automatic backup and other advanced features.",
		repo: "vinzent03/obsidian-git",
	},
	{
		id: "table-editor-obsidian",
		name: "Advanced Tables",
		author: "Tony Grosinger",
		description: "Improved table navigation, formatting, and manipulation.",
		repo: "tgrosinger/advanced-tables-obsidian",
	},
	{
		id: "obsidian-excalidraw-plugin",
		name: "Excalidraw",
		author: "Zsolt Viczian",
		description: "Edit and view Excalidraw drawings in your notes.",
		repo: "zsoltviczian/obsidian-excalidraw-plugin",
	},
];

function makeTool(overrides?: { pluginDir?: string }) {
	const app = createMockApp();
	const tool = communityPluginSearchTool(app, { pluginDir: overrides?.pluginDir ?? "/vault/.obsidian/plugins/open-agent" });
	return { app, tool };
}

describe("community_plugin_search", () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
		requestUrlMock.mockImplementation(async () => ({
			status: 200,
			text: JSON.stringify(SAMPLE_PLUGINS),
			json: { data: [] },
		}));
	});

	it("returns matching plugins with marketplace links", async () => {
		const { tool } = makeTool();
		const result = await tool.run({ query: "git" }, {});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const value = result.value as { matches: Array<{ id: string; url: string }> };
		expect(value.matches.length).toBeGreaterThan(0);
		const git = value.matches.find((m) => m.id === "obsidian-git");
		expect(git).toBeDefined();
		expect(git?.url).toBe("https://obsidian.md/plugins?id=obsidian-git");
	});

	it("is case-insensitive and matches descriptions", async () => {
		const { tool } = makeTool();
		const result = await tool.run({ query: "TABLE" }, {});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const value = result.value as { matches: Array<{ id: string }> };
		expect(value.matches.some((m) => m.id === "table-editor-obsidian")).toBe(true);
	});

	it("matches feature-description style queries across description field", async () => {
		const { tool } = makeTool();
		const result = await tool.run({ query: "draw diagrams" }, {});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const value = result.value as { matches: Array<{ id: string }> };
		expect(value.matches.some((m) => m.id === "obsidian-excalidraw-plugin")).toBe(true);
	});

	it("respects the limit argument", async () => {
		const { tool } = makeTool();
		const result = await tool.run({ query: "obsidian", limit: 1 }, {});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const value = result.value as { matches: unknown[] };
		expect(value.matches.length).toBe(1);
	});

	it("returns an empty match list (not an error) when nothing matches", async () => {
		const { tool } = makeTool();
		const result = await tool.run({ query: "zzz-no-such-plugin-xyz" }, {});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const value = result.value as { matches: unknown[]; total: number };
		expect(value.matches).toHaveLength(0);
		expect(value.total).toBe(0);
	});

	it("fails when the marketplace list cannot be loaded", async () => {
		requestUrlMock.mockImplementation(async () => {
			throw new Error("network down");
		});
		const { tool } = makeTool();
		const result = await tool.run({ query: "git" }, {});
		expect(result.ok).toBe(false);
	});

	it("fails on empty query", async () => {
		const { tool } = makeTool();
		const result = await tool.run({ query: "   " }, {});
		expect(result.ok).toBe(false);
	});

	it("uses the local cache and avoids re-downloading on subsequent calls", async () => {
		requestUrlMock.mockImplementation(async () => ({
			status: 200,
			text: JSON.stringify(SAMPLE_PLUGINS),
			json: { data: [] },
		}));
		const { app, tool } = makeTool();

		await tool.run({ query: "git" }, {});
		expect(requestUrlMock).toHaveBeenCalledTimes(1);

		// Second call should hit the cache written by the first call.
		await tool.run({ query: "git" }, {});
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
		expect(app.vault.adapter.exists).toHaveBeenCalled();
	});
});
