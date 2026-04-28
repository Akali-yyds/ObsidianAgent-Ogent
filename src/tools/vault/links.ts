import { type App, TFile } from "obsidian";
import { defineTool, fail, ok } from "../define";
import { PathError, safeVaultPath } from "./path-safe";

interface Args {
	path: string;
}

export function linksTool(app: App) {
	return defineTool<Args>({
		name: "vault_links",
		description: "List inbound and outbound links for a note.",
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

			// Outbound: from resolvedLinks[source][target]
			const resolved = app.metadataCache.resolvedLinks ?? {};
			const outbound = Object.keys(resolved[p] ?? {});

			// Inbound: scan resolvedLinks for any source linking to p.
			const inbound: string[] = [];
			for (const [source, targets] of Object.entries(resolved)) {
				if (p in targets) inbound.push(source);
			}

			return Promise.resolve(ok({ path: p, inbound, outbound }));
		},
	});
}
