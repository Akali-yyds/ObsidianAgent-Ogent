import { type App, TFile } from "obsidian";
import { defineTool, fail, ok } from "../define";
import { PathError, safeVaultPath } from "./path-safe";
import { splitFrontmatter } from "./frontmatter";

interface Args {
	path: string;
}

export function readTool(app: App) {
	return defineTool<Args>({
		name: "vault_read",
		description: "Read a vault file. Returns frontmatter and body separately.",
		category: "vault_read",
		mutates: false,
		schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Vault-relative path, e.g. 'Notes/foo.md'" },
			},
			required: ["path"],
		},
		async run(args) {
			let p: string;
			try {
				p = safeVaultPath(args.path);
			} catch (e) {
				if (e instanceof PathError) return fail(`PathError: ${e.message}`);
				throw e;
			}
			const file = app.vault.getAbstractFileByPath(p);
			if (!(file instanceof TFile)) return fail(`NotFound: ${p}`);

			const raw = await app.vault.cachedRead(file);
			const { frontmatter, body } = splitFrontmatter(raw);
			return ok({ path: p, frontmatter, body });
		},
	});
}
