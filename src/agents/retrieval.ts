import type { VaultAdapter, VaultFile } from "../packs/vault-adapter";

export interface RetrievalScope {
	notePaths: string[];
	folders: string[];
	tags: string[];
}

export interface RetrievedNote {
	path: string;
	title: string;
	content: string;
	excerpt: string;
	score: number;
}

export interface RetrievalResult {
	query: string;
	scope: RetrievalScope;
	notes: RetrievedNote[];
}

const DEFAULT_NOTE_LIMIT = 6;

export async function retrieveEvidence(
	vault: VaultAdapter,
	query: string,
	activeFilePath?: string | null,
	limit = DEFAULT_NOTE_LIMIT,
): Promise<RetrievalResult> {
	const scope = parseRetrievalScope(vault, query);
	const activeFile = activeFilePath ? vault.getFile(activeFilePath) : null;
	const activePath = activeFile?.path ?? null;
	const linkedNeighborhood = activePath ? collectLinkedNeighborhood(vault, activePath) : new Set<string>();

	let candidates = vault.listMarkdownFiles().filter((file) => matchesScope(vault, file, scope));
	if (scope.notePaths.length > 0) {
		const scoped = scope.notePaths
			.map((path) => vault.getFile(path))
			.filter((file): file is VaultFile => file !== null);
		candidates = dedupeFiles([...scoped, ...candidates]);
	}

	const scored: RetrievedNote[] = [];
	for (const file of candidates) {
		const content = await vault.read(file);
		const score = scoreFile(file, content, query, activePath, linkedNeighborhood, scope);
		if (score <= 0 && scope.notePaths.length === 0) continue;
		scored.push({
			path: file.path,
			title: file.basename,
			content,
			excerpt: pickExcerpt(content, query),
			score,
		});
	}

	scored.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
	return {
		query,
		scope,
		notes: scored.slice(0, Math.max(5, Math.min(8, limit))),
	};
}

export function parseRetrievalScope(vault: Pick<VaultAdapter, "resolveLink">, query: string): RetrievalScope {
	const notePaths = new Set<string>();
	const folders = new Set<string>();
	const tags = new Set<string>();

	for (const match of query.matchAll(/\[\[([^\]]+)\]\]/g)) {
		const resolved = vault.resolveLink(match[1], "");
		if (resolved) notePaths.add(resolved.path);
	}

	for (const match of query.matchAll(/(?:^|\s)(?:folder|in):([A-Za-z0-9_./-]+)/gi)) {
		folders.add(match[1]);
	}

	for (const match of query.matchAll(/#[A-Za-z0-9/_-]+/g)) {
		tags.add(match[0]);
	}

	return {
		notePaths: [...notePaths],
		folders: [...folders],
		tags: [...tags],
	};
}

export function formatRetrievedNotes(notes: RetrievedNote[]): string {
	return notes
		.map((note) => `## ${note.path}\n${note.content.slice(0, 1800)}`)
		.join("\n\n");
}

function matchesScope(vault: VaultAdapter, file: VaultFile, scope: RetrievalScope): boolean {
	if (scope.notePaths.length > 0 && scope.notePaths.includes(file.path)) return true;
	if (scope.folders.length > 0 && !scope.folders.some((folder) => inFolder(file.path, folder))) return false;
	if (scope.tags.length > 0 && !scope.tags.some((tag) => fileHasTag(vault, file, tag))) return false;
	return true;
}

function collectLinkedNeighborhood(vault: VaultAdapter, activePath: string): Set<string> {
	const resolvedLinks = vault.getResolvedLinks();
	const neighborhood = new Set<string>([activePath]);
	for (const outbound of Object.keys(resolvedLinks[activePath] ?? {})) neighborhood.add(outbound);
	for (const [source, targets] of Object.entries(resolvedLinks)) {
		if (activePath in targets) neighborhood.add(source);
	}
	return neighborhood;
}

function dedupeFiles(files: VaultFile[]): VaultFile[] {
	const seen = new Set<string>();
	return files.filter((file) => {
		if (seen.has(file.path)) return false;
		seen.add(file.path);
		return true;
	});
}

function scoreFile(
	file: VaultFile,
	content: string,
	query: string,
	activePath: string | null,
	linkedNeighborhood: Set<string>,
	scope: RetrievalScope,
): number {
	let score = 0;
	if (file.path === activePath) score += 10;
	if (linkedNeighborhood.has(file.path)) score += 5;
	if (scope.notePaths.includes(file.path)) score += 20;

	const normalizedQuery = query.toLowerCase();
	const queryTokens = normalizedQuery.split(/[^a-z0-9#/_-]+/i).filter((token) => token.length > 2 && !token.startsWith("#"));
	for (const token of queryTokens) {
		if (file.basename.toLowerCase().includes(token)) score += 3;
		const matches = content.toLowerCase().split(token).length - 1;
		score += Math.min(matches, 5);
	}

	return score;
}

function pickExcerpt(content: string, query: string): string {
	const lines = content.split("\n");
	const tokens = query.toLowerCase().split(/[^a-z0-9#/_-]+/i).filter((token) => token.length > 2);
	for (const line of lines) {
		if (tokens.some((token) => line.toLowerCase().includes(token))) {
			return line.slice(0, 220);
		}
	}
	return lines.find((line) => line.trim().length > 0)?.slice(0, 220) ?? "";
}

function inFolder(path: string, folder: string): boolean {
	const normalized = folder.endsWith("/") ? folder : `${folder}/`;
	return path.startsWith(normalized) || path === folder;
}

function fileHasTag(vault: VaultAdapter, file: VaultFile, tag: string): boolean {
	const cache = vault.getFileCache(file);
	if (!cache) return false;
	const normalizedTag = tag.startsWith("#") ? tag : `#${tag}`;
	const tags = cache.tags?.map((entry) => entry.tag) ?? [];
	const frontmatterTags = cache.frontmatter?.tags;
	if (typeof frontmatterTags === "string") tags.push(frontmatterTags.startsWith("#") ? frontmatterTags : `#${frontmatterTags}`);
	if (Array.isArray(frontmatterTags)) {
		for (const value of frontmatterTags) {
			if (typeof value === "string") tags.push(value.startsWith("#") ? value : `#${value}`);
		}
	}
	return tags.includes(normalizedTag);
}
