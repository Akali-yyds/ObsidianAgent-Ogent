import { describe, expect, it, vi } from "vitest";
import { SemanticVaultOperations } from "../src/semantic/changeset";
import { UndoBuffer } from "../src/consent/undo";
import { MockTFile } from "./setup";
import { ToolRegistry } from "../src/tools/registry";
import { renameTool } from "../src/tools/vault/path-ops";
import { CommandExecutor } from "../src/commands/executor";
import { ConsentManager } from "../src/consent/manager";

function createSemanticApp(initial: Record<string, string>) {
	const files = new Map(Object.entries(initial));
	const folderPaths = () => [...files.keys()].flatMap((path) => {
		const parts = path.split("/");
		return parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join("/"));
	});
	const file = (path: string): MockTFile | { path: string; name: string; children: unknown[] } | null => {
		if (files.has(path)) return new MockTFile(path);
		if (folderPaths().includes(path)) return { path, name: path.slice(path.lastIndexOf("/") + 1), children: [] };
		return null;
	};
	const allFiles = () => [...files.keys()].map((path) => new MockTFile(path));
	const resolve = (link: string, source: string): MockTFile | null => {
		const normalized = link.replace(/^\.\//, "");
		const sourceDir = source.includes("/") ? source.slice(0, source.lastIndexOf("/")) : "";
		const candidate = normalized.startsWith("../") ? normalized : (sourceDir ? `${sourceDir}/${normalized}` : normalized);
		const candidates = [candidate, normalized, `${candidate}.md`, `${normalized}.md`];
		const found = [...files.keys()].find((path) => candidates.includes(path) || path.replace(/\.md$/, "") === normalized);
		return found ? new MockTFile(found) : null;
	};
	const app = {
		vault: {
			getFiles: vi.fn(allFiles),
			getMarkdownFiles: vi.fn(() => allFiles().filter((entry) => entry.extension === "md")),
			getAbstractFileByPath: vi.fn(file),
			cachedRead: vi.fn(async (entry: MockTFile) => files.get(entry.path) ?? ""),
			read: vi.fn(async (entry: MockTFile) => files.get(entry.path) ?? ""),
			modify: vi.fn(async (entry: MockTFile, text: string) => files.set(entry.path, text)),
			rename: vi.fn(async (entry: { path: string }, next: string) => {
				const entries = [...files.entries()].filter(([path]) => path === entry.path || path.startsWith(`${entry.path}/`));
				for (const [path, value] of entries) {
					files.delete(path);
					files.set(path === entry.path ? next : `${next}${path.slice(entry.path.length)}`, value);
				}
			}),
			createFolder: vi.fn(async () => undefined),
		},
		metadataCache: {
			getFileCache: vi.fn((entry: MockTFile) => {
				const text = files.get(entry.path) ?? "";
				const links = [...text.matchAll(/!?\[\[([^\]|#^]+)/g)].map((match) => ({ link: match[1] }));
				const embeds = [...text.matchAll(/!\[\[([^\]|#^]+)/g)].map((match) => ({ link: match[1] }));
				return { links, embeds, tags: [], headings: [], frontmatter: {} };
			}),
			getFirstLinkpathDest: vi.fn(resolve),
		},
		__files: files,
	};
	return app;
}

describe("Vault semantic ChangeSets", () => {
	it("discovers a note and rewrites inbound wikilinks while preserving aliases and headings", async () => {
		const app = createSemanticApp({
			"Notes/old.md": "# Old",
			"Index.md": "See [[Notes/old#Intro|the old note]]",
		});
		const operations = new SemanticVaultOperations(app as never, new UndoBuffer());
		await operations.initialize();
		const prepared = await operations.prepare("rename", { oldPath: "old", newPath: "Notes/new" });

		expect(prepared.sourcePath).toBe("Notes/old.md");
		expect(prepared.targetPath).toBe("Notes/new.md");
		expect(prepared.changeSet.blockers).toEqual([]);
		expect(prepared.changeSet.operations.some((operation) => operation.after?.includes("[[Notes/new#Intro|the old note]]"))).toBe(true);

		const applied = await operations.apply(prepared);
		expect(applied.result.status).toBe("applied");
		expect(app.__files.get("Notes/new.md")).toBe("# Old");
		expect(app.__files.get("Index.md")).toBe("See [[Notes/new#Intro|the old note]]");
	});

	it("preserves heading suffixes in confirmed internal Markdown links", async () => {
		const app = createSemanticApp({ "a.md": "A", "index.md": "[A](a.md#heading)" });
		const operations = new SemanticVaultOperations(app as never);
		await operations.initialize();
		const prepared = await operations.prepare("rename", { oldPath: "a.md", newPath: "b.md" });

		expect(prepared.changeSet.operations.some((operation) => operation.after === "[A](b.md#heading)")).toBe(true);
	});

	it("blocks an existing destination before any write", async () => {
		const app = createSemanticApp({ "a.md": "A", "b.md": "B" });
		const operations = new SemanticVaultOperations(app as never);
		await operations.initialize();
		const prepared = await operations.prepare("rename", { oldPath: "a.md", newPath: "b.md" });

		expect(prepared.changeSet.blockers.map((blocker) => blocker.code)).toContain("target_exists");
		const result = await operations.apply(prepared);
		expect(result.result.status).toBe("blocked");
		expect(app.vault.rename).not.toHaveBeenCalled();
	});

	it("rejects a stale linked note before moving the source", async () => {
		const app = createSemanticApp({ "a.md": "A", "index.md": "[[a]]" });
		const operations = new SemanticVaultOperations(app as never);
		await operations.initialize();
		const prepared = await operations.prepare("rename", { oldPath: "a.md", newPath: "b.md" });
		app.__files.set("index.md", "changed");

		const result = await operations.apply(prepared);
		expect(result.error).toContain("StaleChangeSet");
		expect(app.__files.has("a.md")).toBe(true);
		expect(app.__files.has("b.md")).toBe(false);
	});

	it("does not rewrite links inside fenced or inline code", async () => {
		const app = createSemanticApp({
			"a.md": "A",
			"index.md": "`[[a]]`\n\n```md\n[[a]]\n```\n\n[[a]]",
		});
		const operations = new SemanticVaultOperations(app as never);
		await operations.initialize();
		const prepared = await operations.prepare("rename", { oldPath: "a.md", newPath: "b.md" });

		const patch = prepared.changeSet.operations.find((operation) => operation.kind === "content_patch");
		expect(patch?.after).toContain("`[[a]]`");
		expect(patch?.after).toContain("[[a]]\n```");
		expect(patch?.after).toContain("[[b]]");
	});

	it("blocks an ambiguous link instead of choosing the first same-named note", async () => {
		const app = createSemanticApp({ "a.md": "A", "Other/a.md": "A2", "index.md": "[[a]]" });
		const operations = new SemanticVaultOperations(app as never);
		await operations.initialize();
		const prepared = await operations.prepare("rename", { oldPath: "a.md", newPath: "b.md" });

		expect(prepared.changeSet.blockers.map((blocker) => blocker.code)).toContain("ambiguous_link");
	});

	it("rolls back the path when a generated content patch fails", async () => {
		const app = createSemanticApp({ "a.md": "A", "index.md": "[[a]]" });
		app.vault.modify.mockRejectedValueOnce(new Error("write failed"));
		const undo = new UndoBuffer();
		const operations = new SemanticVaultOperations(app as never, undo);
		await operations.initialize();
		const prepared = await operations.prepare("rename", { oldPath: "a.md", newPath: "b.md" });

		const result = await operations.apply(prepared);
		expect(result.result).toMatchObject({ status: "rolled_back", restored: true });
		expect(app.__files.has("a.md")).toBe(true);
		expect(app.__files.has("b.md")).toBe(false);
		expect(undo.size()).toBe(0);
	});

	it("routes execute_commands rename through one semantic approval", async () => {
		const app = createSemanticApp({ "a.md": "A", "index.md": "[[a]]" });
		const undo = new UndoBuffer();
		const semantic = new SemanticVaultOperations(app as never, undo);
		await semantic.initialize();
		const registry = new ToolRegistry();
		registry.register(renameTool(app as never, undo));
		const executor = new CommandExecutor(registry, semantic);
		const consent = new ConsentManager(() => ({ vault_read: "always", vault_write: "ask", network_read: "ask", external_write: "ask", plugin_control: "ask" }));
		const iterator = executor.executePlan({ commands: [{ id: "rename", domain: "vault", action: "rename", args: { oldPath: "a.md", newPath: "b.md" } }] }, { consent });

		expect((await iterator.next()).value).toMatchObject({ kind: "started" });
		expect((await iterator.next()).value).toMatchObject({ kind: "change_set_created" });
		expect((await iterator.next()).value).toMatchObject({ kind: "change_set_approval_required" });
		expect((await iterator.next()).value).toMatchObject({ kind: "consent_requested" });
		consent.resolveConsent("approve");
		const events = [];
		let next = await iterator.next();
		while (!next.done) {
			events.push(next.value);
			next = await iterator.next();
		}

		expect(events.map((event) => event.kind)).toEqual(["change_set_started", "change_set_completed", "finished"]);
		expect(next.value).toMatchObject({ ok: true });
		expect(app.__files.get("index.md")).toBe("[[b]]");
	});

	it("moves a folder and repairs links to descendants", async () => {
		const app = createSemanticApp({ "Folder/a.md": "A", "Index.md": "[[Folder/a]]" });
		const operations = new SemanticVaultOperations(app as never);
		await operations.initialize();
		const prepared = await operations.prepare("move", { oldPath: "Folder", newPath: "Archive" });

		expect(prepared.changeSet.blockers).toEqual([]);
		expect(prepared.changeSet.operations.some((operation) => operation.after === "[[Archive/a]]")).toBe(true);
		const result = await operations.apply(prepared);
		expect(result.result.status).toBe("applied");
		expect(app.__files.has("Folder/a.md")).toBe(false);
		expect(app.__files.has("Archive/a.md")).toBe(true);
		expect(app.__files.get("Index.md")).toBe("[[Archive/a]]");
	});

	it("resolves current-note aliases through the authoritative Obsidian context", async () => {
		const app = createSemanticApp({ "Notes/current.md": "A" });
		const operations = new SemanticVaultOperations(app as never, undefined, () => ({
			activeFilePath: "Notes/current.md",
			activeFolderPath: "Notes",
			activeFileName: "current.md",
		}));
		await operations.initialize();
		const prepared = await operations.prepare("rename", { oldPath: "当前笔记", newPath: "Notes/renamed" });

		expect(prepared.sourcePath).toBe("Notes/current.md");
		expect(prepared.targetPath).toBe("Notes/renamed.md");
	});
});
