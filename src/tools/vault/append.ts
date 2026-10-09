import { type App, TFile } from "obsidian";
import { type UndoBuffer } from "../../consent/undo";
import { defineTool, fail, ok } from "../define";
import { PathError, safeVaultPath } from "./path-safe";
import { captureVaultApproval, validateVaultApproval } from "./approval";

interface Args {
	path: string;
	content: string;
	ensureNewline?: boolean;
}

export function appendTool(app: App, undo: UndoBuffer) {
	return defineTool<Args>({
		name: "vault_append",
		description: "Append content to an existing note. Refuses to create new files. Ensures a newline separator by default.",
		category: "vault_write",
		mutates: true,
		schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Vault-relative path of an existing file" },
				content: { type: "string", description: "Text to append" },
				ensureNewline: { type: "boolean", description: "Prepend newline if file doesn't end with one (default true)" },
			},
			required: ["path", "content"],
		},
		prepareApproval: (args) => captureVaultApproval(app, [args.path]),
		validateApproval: (_args, snapshot) => validateVaultApproval(app, snapshot),
		async run(args, ctx) {
			let p: string;
			try {
				p = safeVaultPath(args.path);
			} catch (e) {
				if (e instanceof PathError) return fail(`PathError: ${e.message}`);
				throw e;
			}
			const file = app.vault.getAbstractFileByPath(p);
			if (!(file instanceof TFile)) return fail(`NotFound: ${p}`);

			const before = await app.vault.read(file);
			const ensureNewline = args.ensureNewline ?? true;
			const sep = ensureNewline && before.length > 0 && !before.endsWith("\n") ? "\n" : "";
			const after = before + sep + args.content;

			await app.vault.modify(file, after);
			undo.record({ path: p, before, after }, ctx.sessionId);

			return ok({ path: p, bytesAppended: after.length - before.length });
		},
	});
}
