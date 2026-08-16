import { type App, TFile } from "obsidian";
import type { UndoBuffer } from "../../consent/undo";
import { defineTool, fail, ok } from "../define";
import { PathError, safeVaultPath } from "./path-safe";

interface RenameArgs {
	oldPath: string;
	newPath: string;
}

interface DeleteArgs {
	path: string;
}

interface RestoreArgs {
	path: string;
}

export function renameTool(app: App, undo?: UndoBuffer) {
	return defineTool<RenameArgs>({
		name: "vault_rename",
		description: "Rename a vault note without changing its content. Both paths must be vault-relative.",
		category: "vault_write",
		mutates: true,
		schema: renameSchema(),
		async run(args) {
			return renamePath(app, args.oldPath, args.newPath, undo);
		},
	});
}

export function moveTool(app: App, undo?: UndoBuffer) {
	return defineTool<RenameArgs>({
		name: "vault_move",
		description: "Move a vault note to another folder. This is equivalent to a safe vault-relative rename.",
		category: "vault_write",
		mutates: true,
		schema: renameSchema(),
		async run(args) {
			return renamePath(app, args.oldPath, args.newPath, undo);
		},
	});
}

export function deleteTool(app: App, undo: UndoBuffer) {
	return defineTool<DeleteArgs>({
		name: "vault_delete",
		description: "Move a note to the Obsidian system trash. The content is snapshotted so vault_restore can recover it during this session.",
		category: "vault_write",
		mutates: true,
		schema: {
			type: "object",
			properties: { path: { type: "string", description: "Vault-relative path of an existing note" } },
			required: ["path"],
			additionalProperties: false,
		},
		async run(args) {
			let path: string;
			try { path = safeVaultPath(args.path); } catch (error) {
				if (error instanceof PathError) return fail(`PathError: ${error.message}`);
				throw error;
			}
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) return fail(`NotFound: ${path}`);
			const before = await app.vault.read(file);
			await app.fileManager.trashFile(file);
			undo.record({ path, before, after: "", kind: "delete" });
			return ok({ path, trashed: true, recoverableThisSession: true });
		},
	});
}

export function restoreTool(app: App, undo: UndoBuffer) {
	return defineTool<RestoreArgs>({
		name: "vault_restore",
		description: "Restore the latest note deleted by vault_delete during this session.",
		category: "vault_write",
		mutates: true,
		schema: {
			type: "object",
			properties: { path: { type: "string", description: "Vault-relative path to restore" } },
			required: ["path"],
			additionalProperties: false,
		},
		async run(args) {
			let path: string;
			try { path = safeVaultPath(args.path); } catch (error) {
				if (error instanceof PathError) return fail(`PathError: ${error.message}`);
				throw error;
			}
			if (app.vault.getAbstractFileByPath(path)) return fail(`AlreadyExists: ${path}`);
			const snapshot = undo.findLatest(path, "delete");
			if (!snapshot || snapshot.before === null) return fail(`No session snapshot exists for deleted note: ${path}`);
			await ensureParentFolder(app, path);
			await app.vault.create(path, snapshot.before);
			undo.remove(snapshot.id);
			return ok({ path, restored: true });
		},
	});
}

function renameSchema() {
	return {
		type: "object" as const,
		properties: {
			oldPath: { type: "string" as const, description: "Existing vault-relative path" },
			newPath: { type: "string" as const, description: "New vault-relative path" },
		},
		required: ["oldPath", "newPath"],
		additionalProperties: false,
	};
}

async function renamePath(app: App, oldInput: string, newInput: string, undo?: UndoBuffer) {
	let oldPath: string;
	let newPath: string;
	try {
		oldPath = safeVaultPath(oldInput);
		newPath = safeVaultPath(newInput);
	} catch (error) {
		if (error instanceof PathError) return fail(`PathError: ${error.message}`);
		throw error;
	}
	const file = app.vault.getAbstractFileByPath(oldPath);
	if (!(file instanceof TFile)) return fail(`NotFound: ${oldPath}`);
	if (app.vault.getAbstractFileByPath(newPath)) return fail(`AlreadyExists: ${newPath}`);
	await ensureParentFolder(app, newPath);
	await app.vault.rename(file, newPath);
	undo?.record({
		path: newPath,
		before: "",
		after: "",
		kind: "rename",
		beforePath: oldPath,
		afterPath: newPath,
	});
	return ok({ oldPath, newPath });
}

async function ensureParentFolder(app: App, path: string): Promise<void> {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return;
	const parent = path.slice(0, slash);
	if (app.vault.getAbstractFileByPath(parent)) return;
	await app.vault.createFolder(parent);
}
