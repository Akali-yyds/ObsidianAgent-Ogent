import { TFile, type App, type TAbstractFile } from "obsidian";
import type { VaultContext } from "../context";

export interface IndexedLink {
	target: string;
	embed: boolean;
	resolvedPath?: string;
}

export interface VaultRelationEntry {
	path: string;
	isFolder: boolean;
	basename: string;
	extension: string;
	tags: string[];
	frontmatter: Record<string, unknown>;
	links: IndexedLink[];
	headings: string[];
}

export class VaultRelationIndex {
	private readonly entries = new Map<string, VaultRelationEntry>();

	constructor(private readonly app: App) {}

	async initialize(): Promise<void> {
		this.entries.clear();
		const loaded = (this.app.vault as App["vault"] & { getAllLoadedFiles?: () => TAbstractFile[] }).getAllLoadedFiles?.() ?? this.app.vault.getFiles();
		for (const file of loaded) {
			if (file instanceof TFile) this.refreshFile(file);
			else this.addFolder(file);
		}
		this.refreshFolders();
	}

	refreshFile(file: TAbstractFile): void {
		if (!(file instanceof TFile)) {
			this.addFolder(file);
			return;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		const links = [
			...(cache?.links ?? []).map((link) => ({ target: link.link, embed: false })),
			...(cache?.embeds ?? []).map((link) => ({ target: link.link, embed: true })),
		].filter((link): link is IndexedLink => typeof link.target === "string" && link.target.length > 0);
		for (const link of links) {
			const resolved = this.app.metadataCache.getFirstLinkpathDest(link.target.split("#")[0].split("^")[0], file.path);
			if (resolved instanceof TFile) link.resolvedPath = resolved.path;
		}
		this.entries.set(file.path, {
			path: file.path,
			isFolder: false,
			basename: file.basename,
			extension: file.extension,
			tags: cache?.tags?.map((tag) => tag.tag).filter(Boolean) ?? [],
			frontmatter: cache?.frontmatter ?? {},
			links,
			headings: cache?.headings?.map((heading) => heading.heading).filter(Boolean) ?? [],
		});
	}

	private addFolder(folder: TAbstractFile): void {
		this.entries.set(folder.path, {
			path: folder.path,
			isFolder: true,
			basename: folder.name,
			extension: "",
			tags: [],
			frontmatter: {},
			links: [],
			headings: [],
		});
	}

	remove(path: string): void {
		for (const key of this.entries.keys()) {
			if (key === path || key.startsWith(`${path}/`)) this.entries.delete(key);
		}
	}

	refreshFolders(): void {
		for (const entry of [...this.entries.values()]) {
			let current = entry.path.slice(0, entry.path.lastIndexOf("/"));
			while (current) {
				if (!this.entries.has(current)) {
					this.entries.set(current, {
						path: current,
						isFolder: true,
						basename: current.slice(current.lastIndexOf("/") + 1),
						extension: "",
						tags: [],
						frontmatter: {},
						links: [],
						headings: [],
					});
				}
				current = current.slice(0, current.lastIndexOf("/"));
			}
		}
	}

	async rebuild(): Promise<void> {
		await this.initialize();
	}

	get(path: string): VaultRelationEntry | undefined {
		return this.entries.get(path);
	}

	all(): VaultRelationEntry[] {
		return [...this.entries.values()];
	}

	files(): VaultRelationEntry[] {
		return this.all().filter((entry) => !entry.isFolder);
	}

	findCandidates(query: string, kind?: "file" | "folder"): string[] {
		const normalized = query.trim().toLowerCase().replace(/\\/g, "/");
		const entries = this.all().filter((entry) => !kind || (kind === "folder" ? entry.isFolder : !entry.isFolder));
		const exact = entries.filter((entry) => entry.path.toLowerCase() === normalized).map((entry) => entry.path);
		if (exact.length > 0) return exact;
		const withoutExtension = normalized.endsWith(".md") ? normalized.slice(0, -3) : normalized;
		return entries
			.filter((entry) => entry.path.toLowerCase().replace(/\.md$/, "") === withoutExtension || entry.basename.toLowerCase() === withoutExtension)
			.map((entry) => entry.path)
			.sort();
	}

	resolveLinkCandidates(linkpath: string, sourcePath: string): string[] {
		const clean = linkpath.trim().replace(/^\//, "");
		const withoutSuffix = clean.split("#")[0].split("^")[0];
		const sourceDir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
		const relative = withoutSuffix.startsWith("./") || withoutSuffix.startsWith("../")
			? normalizeRelative(sourceDir, withoutSuffix)
			: withoutSuffix;
		const exact = this.files()
			.filter((entry) => entry.path === relative || entry.path === withoutSuffix || entry.path === `${relative}.md` || entry.path === `${withoutSuffix}.md`)
			.map((entry) => entry.path);
		const basename = withoutSuffix.slice(withoutSuffix.lastIndexOf("/") + 1).replace(/\.md$/, "").toLowerCase();
		const sameName = this.files()
			.filter((entry) => entry.basename.toLowerCase() === basename)
			.map((entry) => entry.path)
			.sort();
		if (withoutSuffix.includes("/")) return [...new Set(exact)].sort();
		if (sameName.length > 1) return sameName;
		if (exact.length > 0) return [...new Set(exact)].sort();
		return sameName;
	}

	getContext(context: VaultContext): VaultContext {
		return context;
	}
}

export function pathWithin(path: string, parent: string): boolean {
	return path === parent || path.startsWith(`${parent}/`);
}

function normalizeRelative(base: string, relative: string): string {
	const parts = [...(base ? base.split("/") : []), ...relative.split("/")];
	const result: string[] = [];
	for (const part of parts) {
		if (!part || part === ".") continue;
		if (part === "..") result.pop();
		else result.push(part);
	}
	return result.join("/");
}
