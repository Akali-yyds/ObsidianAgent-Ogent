import { type App, TFile } from "obsidian";
import { defineTool, ok } from "../define";

interface Args {
	query: string;
	scope?: { folder?: string; tag?: string; limit?: number };
}

interface Match {
	path: string;
	line: number;
	excerpt: string;
}

const BYTE_BUDGET = 5 * 1024 * 1024;

export function searchTool(app: App) {
	return defineTool<Args>({
		name: "vault_search",
		description:
			"Search the vault. Resolves exact filenames or [[wikilinks]] via the metadata cache, otherwise scopes by tag or folder, otherwise does a bounded full-text scan.",
		category: "vault_read",
		mutates: false,
		schema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query, exact filename, or [[wikilink]]" },
				scope: {
					type: "object",
					description: "Optional scoping",
					properties: {
						folder: { type: "string", description: "Restrict to files under this folder (e.g. 'Notes/')" },
						tag: { type: "string", description: "Restrict to notes with this tag (e.g. '#work' or 'work')" },
						limit: { type: "integer", description: "Max matches", minimum: 1, maximum: 100 },
					},
				},
			},
			required: ["query"],
		},
		async run(args) {
			const limit = args.scope?.limit ?? 20;
			const matches: Match[] = [];

			// 1. Linkpath / exact-name resolution — only for explicit [[wikilink]] syntax.
			const wikilinkMatch = /^\[\[([^\]]+)\]\]$/.exec(args.query.trim());
			if (wikilinkMatch) {
				const resolved = app.metadataCache.getFirstLinkpathDest(wikilinkMatch[1], "");
				if (resolved instanceof TFile) {
					return ok({
						matches: [{ path: resolved.path, line: 0, excerpt: "(exact match)" }],
						strategy: "linkpath",
						truncated: false,
					});
				}
			}

			// 2. Tag-scoped iteration
			if (args.scope?.tag) {
				const tag = args.scope.tag.startsWith("#") ? args.scope.tag : `#${args.scope.tag}`;
				const candidates = app.vault
					.getMarkdownFiles()
					.filter((f) => fileHasTag(app, f, tag))
					.filter((f) => inFolder(f, args.scope?.folder));
				await scanFiles(app, candidates, args.query, matches, limit, BYTE_BUDGET);
				return ok({ matches, strategy: "tag", truncated: matches.length >= limit });
			}

			// 3. Bounded full-text — byte budget is the only cap.
			const all = app.vault.getMarkdownFiles().filter((f) => inFolder(f, args.scope?.folder));
			const scanned = await scanFiles(app, all, args.query, matches, limit, BYTE_BUDGET);
			return ok({
				matches,
				strategy: "fulltext",
				truncated: scanned.bytesHit || matches.length >= limit,
				bytesScanned: scanned.bytesScanned,
			});
		},
	});
}

function inFolder(f: TFile, folder?: string): boolean {
	if (!folder) return true;
	const norm = folder.endsWith("/") ? folder : folder + "/";
	return f.path.startsWith(norm) || f.path === folder;
}

function fileHasTag(app: App, f: TFile, tag: string): boolean {
	const cache = app.metadataCache.getFileCache(f);
	if (!cache) return false;
	const tags = cache.tags?.map((t) => t.tag) ?? [];
	const fmTags = (cache.frontmatter?.tags as unknown) ?? [];
	const fmList = Array.isArray(fmTags) ? fmTags.map(String) : typeof fmTags === "string" ? [fmTags] : [];
	const fmNormalized = fmList.map((t) => (t.startsWith("#") ? t : `#${t}`));
	return tags.includes(tag) || fmNormalized.includes(tag);
}

async function scanFiles(
	app: App,
	files: TFile[],
	query: string,
	out: Match[],
	limit: number,
	byteBudget: number,
): Promise<{ bytesScanned: number; bytesHit: boolean }> {
	let bytesScanned = 0;
	const needle = query.toLowerCase();
	for (const f of files) {
		if (out.length >= limit) break;
		if (bytesScanned >= byteBudget) return { bytesScanned, bytesHit: true };
		const text = await app.vault.cachedRead(f);
		bytesScanned += text.length;
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].toLowerCase().includes(needle)) {
				out.push({ path: f.path, line: i + 1, excerpt: lines[i].slice(0, 200) });
				if (out.length >= limit) break;
			}
		}
	}
	return { bytesScanned, bytesHit: false };
}
