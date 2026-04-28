import { type App, TFile } from "obsidian";
import { defineTool, fail, ok } from "../define";
import { PathError, safeVaultPath } from "./path-safe";

interface Args {
	path: string;
}

export function metadataTool(app: App) {
	return defineTool<Args>({
		name: "vault_metadata",
		description: "Get a note's frontmatter, tags, headings, and outbound link targets via Obsidian's metadata cache.",
		category: "vault_read",
		mutates: false,
		schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Vault-relative path" },
			},
			required: ["path"],
		},
		run(args) {
			let p: string;
			try {
				p = safeVaultPath(args.path);
			} catch (e) {
				if (e instanceof PathError) return Promise.resolve(fail(`PathError: ${e.message}`));
				throw e;
			}
			const file = app.vault.getAbstractFileByPath(p);
			if (!(file instanceof TFile)) return Promise.resolve(fail(`NotFound: ${p}`));

			const cache = app.metadataCache.getFileCache(file);
			return Promise.resolve(ok({
				path: p,
				frontmatter: cache?.frontmatter ?? null,
				tags: cache?.tags?.map((t) => t.tag) ?? [],
				headings: cache?.headings?.map((h) => ({ level: h.level, text: h.heading, line: h.position.start.line })) ?? [],
				outboundLinks: cache?.links?.map((l) => l.link) ?? [],
				embeds: cache?.embeds?.map((e) => e.link) ?? [],
			}));
		},
	});
}
