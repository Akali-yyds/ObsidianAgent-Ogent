import { type App, TFile } from "obsidian";
import { type UndoBuffer } from "../../consent/undo";
import { defineTool, fail, ok } from "../define";
import { PathError, safeVaultPath } from "./path-safe";
import { mergeFrontmatter, splitFrontmatter, stitchFrontmatter } from "./frontmatter";

interface Args {
	path: string;
	body: string;
	frontmatter?: Record<string, unknown>;
}

export function writeTool(app: App, undo: UndoBuffer) {
	return defineTool<Args>({
		name: "vault_write",
		description:
			"Create or overwrite a note. If `frontmatter` is supplied, it merges into existing frontmatter (existing keys preserved unless overridden). Body is rewritten verbatim.",
		category: "vault_write",
		mutates: true,
		schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Vault-relative path" },
				body: { type: "string", description: "Full note body to write (without frontmatter)" },
				frontmatter: { type: "object", description: "Optional frontmatter object to merge" },
			},
			required: ["path", "body"],
		},
		async run(args) {
			let p: string;
			try {
				p = safeVaultPath(args.path);
			} catch (e) {
				if (e instanceof PathError) return fail(`PathError: ${e.message}`);
				throw e;
			}

			const existing = app.vault.getAbstractFileByPath(p);
			let before: string | null = null;
			let mergedFm: Record<string, unknown> = {};

			if (existing instanceof TFile) {
				before = await app.vault.read(existing);
				const split = splitFrontmatter(before);
				mergedFm = mergeFrontmatter(split.frontmatter ?? {}, args.frontmatter ?? {});
			} else if (args.frontmatter) {
				mergedFm = args.frontmatter;
			}

			const after = stitchFrontmatter(mergedFm, args.body);

			if (existing instanceof TFile) {
				await app.vault.modify(existing, after);
			} else {
				await ensureParentFolder(app, p);
				await app.vault.create(p, after);
			}

			undo.record({ path: p, before, after });

			return ok({
				path: p,
				created: before === null,
				bytesBefore: before?.length ?? 0,
				bytesAfter: after.length,
			});
		},
	});
}

async function ensureParentFolder(app: App, path: string): Promise<void> {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return;
	const parent = path.slice(0, slash);
	if (app.vault.getAbstractFileByPath(parent)) return;
	await app.vault.createFolder(parent);
}
