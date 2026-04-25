import type { App } from "obsidian";
import { defineTool, ok } from "../define";

interface Args {
	glob: string;
	limit?: number;
}

export function listTool(app: App) {
	return defineTool<Args>({
		name: "vault_list",
		description: "List files in the vault matching a glob pattern. Use **/*.md for recursive matches, Folder/*.md for top-level.",
		category: "vault_read",
		mutates: false,
		schema: {
			type: "object",
			properties: {
				glob: { type: "string", description: "Glob pattern, e.g. 'Daily/*.md' or '**/*.md'" },
				limit: { type: "integer", description: "Max entries (default 200)", minimum: 1, maximum: 2000 },
			},
			required: ["glob"],
		},
		async run(args) {
			const limit = args.limit ?? 200;
			const re = globToRegex(args.glob);
			const files = app.vault.getFiles();
			const matches: Array<{ path: string; size: number }> = [];
			for (const f of files) {
				if (re.test(f.path)) {
					matches.push({ path: f.path, size: f.stat?.size ?? 0 });
					if (matches.length >= limit) break;
				}
			}
			return ok({ entries: matches, count: matches.length, truncated: matches.length >= limit });
		},
	});
}

function globToRegex(glob: string): RegExp {
	let re = "^";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		const next = glob[i + 1];
		if (c === "*" && next === "*") {
			re += ".*";
			i++;
		} else if (c === "*") {
			re += "[^/]*";
		} else if (c === "?") {
			re += "[^/]";
		} else if (".+()|^$\\".includes(c)) {
			re += "\\" + c;
		} else {
			re += c;
		}
	}
	re += "$";
	return new RegExp(re);
}

export { globToRegex };
