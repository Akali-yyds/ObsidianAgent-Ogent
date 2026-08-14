import { type App, requestUrl } from "obsidian";
import { defineTool, fail, ok } from "../define";

interface CommunityPlugin {
	id: string;
	name: string;
	author: string;
	description: string;
	repo: string;
}

interface Match {
	id: string;
	name: string;
	author: string;
	description: string;
	repo: string;
	url: string;
	matchedOn: string;
}

interface Args {
	query: string;
	limit?: number;
}

const LIST_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_LIST_BYTES = 8 * 1024 * 1024;

export interface CommunitySearchDeps {
	pluginDir: string;
}

export function communityPluginSearchTool(app: App, deps: CommunitySearchDeps) {
	const cachePath = `${deps.pluginDir}/community-plugins.json`;

	async function loadPlugins(): Promise<CommunityPlugin[]> {
		// Prefer a fresh-enough local cache; otherwise re-download.
		const cached = await readCache(cachePath, app);
		if (cached) return cached.plugins;

		const downloaded = await downloadList();
		if (downloaded) {
			await writeCache(cachePath, app, downloaded);
			return downloaded;
		}
		// Download failed — fall back to stale cache if present.
		const stale = await readCache(cachePath, app, true);
		if (stale) return stale.plugins;
		return [];
	}

	return defineTool<Args>({
		name: "community_plugin_search",
		description:
			"Search the official Obsidian community plugin marketplace by keyword or feature description. " +
			"Returns matching plugins (name, description, author, and a marketplace link) when the user wants to know " +
			"whether a community plugin already exists for a given capability. Does not install anything.",
		category: "vault_read",
		mutates: false,
		schema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Search keyword or feature description, e.g. 'table', 'git backup', 'draw diagrams'",
				},
				limit: { type: "integer", description: "Max results to return", minimum: 1, maximum: 20 },
			},
			required: ["query"],
		},
		async run(args) {
			const query = (args.query ?? "").trim().toLowerCase();
			if (!query) return fail("Query is empty. Provide a keyword or feature description to search the marketplace.");
			const limit = args.limit ?? 8;

			let plugins: CommunityPlugin[];
			try {
				plugins = await loadPlugins();
			} catch {
				plugins = [];
			}
			if (plugins.length === 0) {
				return fail("Could not load the community plugin marketplace. Check your network connection and try again.");
			}

			const terms = query.split(/\s+/).filter((t) => t.length > 0);
			const scored = plugins
				.map((p) => ({ p, result: scorePlugin(p, terms) }))
				.filter((entry) => entry.result.score > 0)
				.sort((a, b) => b.result.score - a.result.score)
				.slice(0, limit);

			const matches: Match[] = scored.map(({ p, result }) => ({
				id: p.id,
				name: p.name,
				author: p.author,
				description: p.description,
				repo: p.repo,
				url: `https://obsidian.md/plugins?id=${encodeURIComponent(p.id)}`,
				matchedOn: result.fields.join("/") || "description",
			}));

			return ok({
				matches,
				total: matches.length,
				truncated: scored.length >= limit,
				searching: query,
			});
		},
	});
}

function scorePlugin(p: CommunityPlugin, terms: string[]): { score: number; fields: string[] } {
	const name = p.name.toLowerCase();
	const id = p.id.toLowerCase();
	const desc = p.description.toLowerCase();
	const author = p.author.toLowerCase();
	const repo = p.repo.toLowerCase();

	let score = 0;
	const fields: string[] = [];
	for (const term of terms) {
		if (name.includes(term)) {
			score += 4;
			fields.push("name");
		}
		if (id.includes(term)) {
			score += 3;
			fields.push("id");
		}
		if (repo.includes(term)) {
			score += 3;
			fields.push("repo");
		}
		if (desc.includes(term)) {
			score += 2;
			fields.push("description");
		}
		if (author.includes(term)) {
			score += 1;
			fields.push("author");
		}
	}
	return { score, fields };
}

async function downloadList(): Promise<CommunityPlugin[] | null> {
	try {
		const res = await requestUrl({ url: LIST_URL, method: "GET", throw: false });
		if (res.status >= 400 || !res.text) return null;
		const parsed = parseList(res.text);
		return parsed.length > 0 ? parsed : null;
	} catch {
		return null;
	}
}

function parseList(text: string): CommunityPlugin[] {
	if (text.length > MAX_LIST_BYTES) return [];
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return [];
	}
	if (!Array.isArray(raw)) return [];
	const out: CommunityPlugin[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const e = entry as Record<string, unknown>;
		const id = typeof e.id === "string" ? e.id.trim() : "";
		const name = typeof e.name === "string" ? e.name.trim() : "";
		const author = typeof e.author === "string" ? e.author.trim() : "";
		const description = typeof e.description === "string" ? e.description.trim() : "";
		const repo = typeof e.repo === "string" ? e.repo.trim() : "";
		if (id && name) out.push({ id, name, author, description, repo });
	}
	return out;
}

async function readCache(
	path: string,
	app: App,
	allowStale = false,
): Promise<{ plugins: CommunityPlugin[] } | null> {
	try {
		if (!(await app.vault.adapter.exists(path))) return null;
		if (!allowStale) {
			const stat = await app.vault.adapter.stat(path).catch(() => null);
			if (stat && stat.mtime && Date.now() - stat.mtime > CACHE_TTL_MS) return null;
		}
		const text = await app.vault.adapter.read(path);
		const plugins = parseList(text);
		if (plugins.length === 0) return null;
		return { plugins };
	} catch {
		return null;
	}
}

async function writeCache(path: string, app: App, plugins: CommunityPlugin[]): Promise<void> {
	try {
		const dir = path.slice(0, path.lastIndexOf("/"));
		if (!(await app.vault.adapter.exists(dir))) {
			await app.vault.adapter.mkdir(dir);
		}
		await app.vault.adapter.write(path, JSON.stringify(plugins));
	} catch {
		// Cache write is best-effort; search still works for this run.
	}
}
