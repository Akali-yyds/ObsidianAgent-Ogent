import { promises as fs } from "node:fs";
import path from "node:path";
import type { VaultAdapter, VaultFile, VaultFileCache } from "../../src/packs/vault-adapter";

export async function createMarkdownVaultAdapter(rootDir: string): Promise<VaultAdapter> {
	const fileEntries = await collectMarkdownFiles(rootDir);
	const files = new Map<string, VaultFile>();
	const contents = new Map<string, string>();
	for (const entry of fileEntries) {
		files.set(entry.path, entry.file);
		contents.set(entry.path, entry.content);
	}

	const caches = new Map<string, VaultFileCache>();
	const resolvedLinks: Record<string, Record<string, number>> = {};
	for (const entry of fileEntries) {
		const parsed = parseFixtureMetadata(entry.content);
		caches.set(entry.path, parsed.cache);
		resolvedLinks[entry.path] = {};
		for (const linkpath of parsed.links) {
			const target = resolveFixtureLink(files, linkpath);
			if (target) resolvedLinks[entry.path][target.path] = 1;
		}
	}

	return {
		listMarkdownFiles: () => [...files.values()].sort((left, right) => left.path.localeCompare(right.path)),
		getFile: (filePath) => files.get(filePath) ?? null,
		read: async (file) => {
			const content = contents.get(file.path);
			if (content == null) throw new Error(`Missing fixture file: ${file.path}`);
			return content;
		},
		resolveLink: (linkpath) => resolveFixtureLink(files, linkpath),
		getResolvedLinks: () => resolvedLinks,
		getFileCache: (file) => caches.get(file.path) ?? null,
	};
}

export const createFixtureVaultAdapter = createMarkdownVaultAdapter;

async function collectMarkdownFiles(
	rootDir: string,
	currentDir = rootDir,
): Promise<Array<{ path: string; file: VaultFile; content: string }>> {
	const entries = await fs.readdir(currentDir, { withFileTypes: true });
	const files: Array<{ path: string; file: VaultFile; content: string }> = [];
	for (const entry of entries) {
		const absolutePath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await collectMarkdownFiles(rootDir, absolutePath));
			continue;
		}
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, "/");
		const content = await fs.readFile(absolutePath, "utf8");
		files.push({
			path: relativePath,
			file: {
				path: relativePath,
				basename: entry.name.replace(/\.md$/i, ""),
			},
			content,
		});
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function parseFixtureMetadata(content: string): { cache: VaultFileCache; links: string[] } {
	const links = [...content.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)].map((match) => match[1].trim());
	const tags = [...content.matchAll(/#[A-Za-z0-9/_-]+/g)].map((match) => ({ tag: match[0] }));
	const frontmatter = parseFrontmatter(content);
	const cache: VaultFileCache = {};
	if (tags.length > 0) cache.tags = tags;
	if (frontmatter.tags !== undefined) cache.frontmatter = { tags: frontmatter.tags };
	return { cache, links };
}

function parseFrontmatter(content: string): { tags?: string | string[] } {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return {};
	const block = match[1];
	const arrayMatch = block.match(/(?:^|\n)tags:\s*\n((?:\s*-\s*.+\n?)*)/);
	if (arrayMatch) {
		const tags = arrayMatch[1]
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.startsWith("- "))
			.map((line) => line.slice(2).trim());
		return tags.length > 0 ? { tags } : {};
	}
	const scalarMatch = block.match(/(?:^|\n)tags:\s*(.+)/);
	if (!scalarMatch) return {};
	const value = scalarMatch[1].trim();
	return value.length > 0 ? { tags: value } : {};
}

function resolveFixtureLink(files: Map<string, VaultFile>, linkpath: string): VaultFile | null {
	const normalized = linkpath.replace(/\\/g, "/").replace(/\.md$/i, "");
	for (const file of files.values()) {
		const fileWithoutExtension = file.path.replace(/\.md$/i, "");
		if (fileWithoutExtension === normalized || fileWithoutExtension.endsWith(`/${normalized}`)) return file;
	}
	return null;
}
