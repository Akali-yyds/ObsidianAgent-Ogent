import { type App, TFile } from "obsidian";
import { type UndoBuffer } from "../../consent/undo";
import { defineTool, fail, ok } from "../define";
import { PathError, safeVaultPath } from "./path-safe";

interface Args {
	path: string;
	oldString: string;
	newString: string;
	occurrences?: number;
}

export function editTool(app: App, undo: UndoBuffer) {
	return defineTool<Args>({
		name: "vault_edit",
		description:
			"Replace `oldString` with `newString` in a note. Counts matches first; rejects unless the actual count equals `occurrences` (default 1). Use a longer `oldString` (with surrounding context) to disambiguate.",
		category: "vault_write",
		mutates: true,
		schema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Vault-relative path" },
				oldString: { type: "string", description: "Exact text to find. Include surrounding lines for uniqueness." },
				newString: { type: "string", description: "Replacement text" },
				occurrences: {
					type: "integer",
					description: "Expected match count (default 1). Edit is rejected if the actual count differs.",
					minimum: 1,
				},
			},
			required: ["path", "oldString", "newString"],
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

			if (args.oldString.length === 0) return fail("oldString must be non-empty");

			const before = await app.vault.read(file);
			const expected = args.occurrences ?? 1;
			const count = countOccurrences(before, args.oldString);

			if (count === 0) return fail("NoMatchError: oldString not found");
			if (count !== expected) {
				return fail("AmbiguousEditError", { actual: count, expected });
			}

			const after = replaceAll(before, args.oldString, args.newString);
			await app.vault.modify(file, after);
			undo.record({ path: p, before, after });

			return ok({ path: p, replaced: count });
		},
	});
}

function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let idx = 0;
	while ((idx = haystack.indexOf(needle, idx)) !== -1) {
		count++;
		idx += needle.length;
	}
	return count;
}

function replaceAll(haystack: string, needle: string, replacement: string): string {
	const parts: string[] = [];
	let idx = 0;
	let prev = 0;
	while ((idx = haystack.indexOf(needle, prev)) !== -1) {
		parts.push(haystack.slice(prev, idx));
		parts.push(replacement);
		prev = idx + needle.length;
	}
	parts.push(haystack.slice(prev));
	return parts.join("");
}
