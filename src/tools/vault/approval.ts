import { TFile, TFolder, type App } from "obsidian";
import { PathError, safeVaultPath } from "./path-safe";

interface VaultPathSnapshot {
	path: string;
	kind: "missing" | "file" | "folder" | "other";
	fingerprint?: string;
}

export interface VaultApprovalSnapshot {
	paths: VaultPathSnapshot[];
}

export async function captureVaultApproval(app: App, paths: string[]): Promise<VaultApprovalSnapshot> {
	const snapshots: VaultPathSnapshot[] = [];
	for (const input of [...new Set(paths)]) {
		let path: string;
		try {
			path = safeVaultPath(input);
		} catch (error) {
			throw new Error(error instanceof PathError ? error.message : String(error));
		}
		const file = app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			snapshots.push({ path, kind: "file", fingerprint: contentFingerprint(await app.vault.read(file)) });
		} else if (file instanceof TFolder) {
			snapshots.push({ path, kind: "folder" });
		} else {
			snapshots.push({ path, kind: file ? "other" : "missing" });
		}
	}
	return { paths: snapshots };
}

export async function validateVaultApproval(app: App, snapshot: unknown): Promise<{ ok: boolean; error?: string }> {
	if (!isVaultApprovalSnapshot(snapshot)) return { ok: false, error: "Approval snapshot is missing or invalid." };
	for (const expected of snapshot.paths) {
		const current = await captureVaultApproval(app, [expected.path]);
		const actual = current.paths[0];
		if (!actual || actual.kind !== expected.kind || actual.fingerprint !== expected.fingerprint) {
			return { ok: false, error: `The approved target changed while waiting: ${expected.path}. Review the updated target and request approval again.` };
		}
	}
	return { ok: true };
}

function isVaultApprovalSnapshot(value: unknown): value is VaultApprovalSnapshot {
	if (!value || typeof value !== "object" || !Array.isArray((value as VaultApprovalSnapshot).paths)) return false;
	return (value as VaultApprovalSnapshot).paths.every((entry) =>
		entry && typeof entry.path === "string" && ["missing", "file", "folder", "other"].includes(entry.kind),
	);
}

function contentFingerprint(content: string): string {
	let hash = 2166136261;
	for (let index = 0; index < content.length; index++) {
		hash ^= content.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `${content.length}:${(hash >>> 0).toString(16)}`;
}
