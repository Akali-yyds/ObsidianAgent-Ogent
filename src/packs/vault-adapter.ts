import type { App, TFile } from "obsidian";

export interface VaultFile {
	path: string;
	basename: string;
}

export interface VaultFileCache {
	tags?: Array<{ tag: string }>;
	frontmatter?: {
		tags?: string | string[];
	};
}

export interface VaultAdapter {
	listMarkdownFiles(): VaultFile[];
	getFile(path: string): VaultFile | null;
	read(file: VaultFile): Promise<string>;
	resolveLink(linkpath: string, sourcePath: string): VaultFile | null;
	getResolvedLinks(): Record<string, Record<string, number>>;
	getFileCache(file: VaultFile): VaultFileCache | null;
}

export function createAppVaultAdapter(app: App): VaultAdapter {
	return {
		listMarkdownFiles: () => app.vault.getMarkdownFiles().map((file) => toVaultFile(file)),
		getFile: (filePath) => {
			const file = app.vault.getAbstractFileByPath(filePath);
			return isAppFile(file) ? toVaultFile(file) : null;
		},
		read: async (file) => {
			const target = app.vault.getAbstractFileByPath(file.path);
			if (!isAppFile(target)) throw new Error(`Missing vault file: ${file.path}`);
			return app.vault.cachedRead(target);
		},
		resolveLink: (linkpath, sourcePath) => {
			const resolved = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
			return isAppFile(resolved) ? toVaultFile(resolved) : null;
		},
		getResolvedLinks: () => app.metadataCache.resolvedLinks ?? {},
		getFileCache: (file) => {
			const target = app.vault.getAbstractFileByPath(file.path);
			return isAppFile(target) ? (app.metadataCache.getFileCache(target) as VaultFileCache | null) : null;
		},
	};
}

function toVaultFile(file: { path: string; basename?: string }): VaultFile {
	return {
		path: file.path,
		basename: file.basename ?? file.path.split("/").pop()?.replace(/\.md$/i, "") ?? file.path,
	};
}

function isAppFile(value: unknown): value is TFile & { path: string; basename: string } {
	return typeof value === "object" && value !== null && "path" in value && "basename" in value;
}
