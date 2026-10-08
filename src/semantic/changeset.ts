import { TFile, type App, type TAbstractFile } from "obsidian";
import type { UndoBuffer } from "../consent/undo";
import type {
	AffectedFile,
	ChangeBlocker,
	ChangeOperation,
	ChangeSet,
	ChangeSetResult,
	ChangeWarning,
} from "../types";
import { ContextResolver } from "./resolver";
import { VaultRelationIndex, pathWithin } from "./index";
import type { VaultContext } from "../context";

export interface SemanticPreparation {
	changeSet: ChangeSet;
	sourcePath?: string;
	targetPath?: string;
}

interface FileSnapshot {
	path: string;
	content: string;
	fingerprint: string;
}

interface PathMapping {
	from: string;
	to: string;
}

export class SemanticVaultOperations {
	readonly index: VaultRelationIndex;
	readonly resolver: ContextResolver;

	constructor(
		private readonly app: App,
		private readonly undo?: UndoBuffer,
		getContext?: () => VaultContext,
	) {
		this.index = new VaultRelationIndex(app);
		this.resolver = new ContextResolver(app, this.index, getContext);
	}

	async initialize(): Promise<void> {
		await this.index.initialize();
	}

	async refresh(): Promise<void> {
		await this.index.rebuild();
	}

	refreshFile(file: TAbstractFile): void {
		this.index.refreshFile(file);
		this.index.refreshFolders();
	}

	removePath(path: string): void {
		this.index.remove(path);
	}

	async prepare(action: "rename" | "move", args: { oldPath: string; newPath: string }): Promise<SemanticPreparation> {
		const blockers: ChangeBlocker[] = [];
		const warnings: ChangeWarning[] = [];
		const sourceResolution = this.resolver.resolveExisting(args.oldPath);
		if (!sourceResolution.path) {
			blockers.push({ code: "source_unresolved", message: sourceResolution.error ?? `Could not resolve ${args.oldPath}`, paths: sourceResolution.candidates });
			return this.emptyPreparation(action, args, blockers, warnings);
		}

		const sourcePath = sourceResolution.path;
		const source = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!isAbstractFile(source)) {
			blockers.push({ code: "source_missing", message: `Source does not exist: ${sourcePath}`, paths: [sourcePath] });
			return this.emptyPreparation(action, args, blockers, warnings);
		}

		const destinationResolution = this.resolver.resolveDestination(args.newPath, sourcePath, action);
		const targetPath = destinationResolution.path;
		if (!targetPath) {
			blockers.push({ code: "destination_invalid", message: destinationResolution.error ?? `Could not resolve ${args.newPath}`, paths: destinationResolution.candidates });
			return this.emptyPreparation(action, args, blockers, warnings, sourcePath);
		}
		if (sourcePath === targetPath) {
			blockers.push({ code: "no_op", message: "The source and destination are the same path.", paths: [sourcePath] });
		}
		const existingTarget = this.app.vault.getAbstractFileByPath(targetPath);
		if (existingTarget && targetPath !== sourcePath) {
			blockers.push({ code: "target_exists", message: `Destination already exists: ${targetPath}`, paths: [targetPath] });
		}
		if (pathWithin(targetPath, sourcePath)) {
			blockers.push({ code: "destination_inside_source", message: "A folder cannot be moved inside itself.", paths: [sourcePath, targetPath] });
		}

		const mappings = this.buildMappings(sourcePath, targetPath);
		const operations: ChangeOperation[] = [{
			kind: action,
			sourcePath,
			targetPath,
			reason: action === "move" ? "Move the requested Vault object." : "Rename the requested Vault object.",
		}];
		const affectedFiles: AffectedFile[] = [];
		const snapshots = new Map<string, FileSnapshot>();

		for (const entry of this.index.files()) {
			const mapped = mapPath(entry.path, mappings);
			if (mapped !== entry.path) {
				const indexedFile = this.app.vault.getAbstractFileByPath(entry.path);
				const content = entry.extension.toLowerCase() === "md" && indexedFile instanceof TFile
					? await this.app.vault.cachedRead(indexedFile)
					: undefined;
				affectedFiles.push({
					path: entry.path,
					kind: "move",
					summary: `${entry.path} → ${mapped}`,
					...(content !== undefined ? { bytesBefore: content.length, fingerprint: fingerprint(content) } : {}),
				});
			}
		}

		const markdownFiles = this.app.vault.getMarkdownFiles();
		for (const file of markdownFiles) {
			const before = await this.app.vault.cachedRead(file);
			const sourceAfterPath = mapPath(file.path, mappings);
			const rewritten = rewriteInternalLinks(this.app, this.index, file.path, sourceAfterPath, before, mappings, blockers);
			if (rewritten === before) continue;
			const snapshot = { path: file.path, content: before, fingerprint: fingerprint(before) };
			snapshots.set(file.path, snapshot);
			const afterPath = sourceAfterPath;
			operations.push({
				kind: "content_patch",
				sourcePath: file.path,
				targetPath: afterPath,
				path: afterPath,
				before,
				after: rewritten,
				reason: "Update an internal Vault link after the path change.",
			});
			affectedFiles.push({
				path: file.path,
				kind: "patch",
				bytesBefore: before.length,
				bytesAfter: rewritten.length,
				summary: `${file.path} · update internal references`,
				fingerprint: snapshot.fingerprint,
			});
		}

		for (const file of markdownFiles) {
			if (!snapshots.has(file.path) && mapPath(file.path, mappings) !== file.path) {
				const content = await this.app.vault.cachedRead(file);
				snapshots.set(file.path, { path: file.path, content, fingerprint: fingerprint(content) });
			}
		}

		const changeSet: ChangeSet = {
			id: randomId("changeset"),
			intent: `${action} ${sourcePath} → ${targetPath}`,
			operations,
			affectedFiles: dedupeAffectedFiles(affectedFiles),
			blockers: dedupeProblems(blockers),
			warnings: dedupeProblems(warnings),
			createdAt: Date.now(),
		};
		return { changeSet, sourcePath, targetPath };
	}

	async apply(preparation: SemanticPreparation, signal?: AbortSignal): Promise<{ result: ChangeSetResult; error?: string }> {
		const { changeSet } = preparation;
		if (changeSet.blockers.length > 0) return { result: { changeSetId: changeSet.id, status: "blocked" }, error: "ChangeSetBlocked" };
		const pathOperation = changeSet.operations.find((operation) => operation.kind === "move" || operation.kind === "rename");
		if (!pathOperation?.sourcePath || !pathOperation.targetPath) {
			return { result: { changeSetId: changeSet.id, status: "blocked" }, error: "ChangeSetError: missing path operation" };
		}
		const stale = await this.findStaleOperations(changeSet);
		if (stale.length > 0) {
			changeSet.blockers.push({ code: "stale_plan", message: "Affected files changed after this plan was created. Re-analyze before applying.", paths: stale });
			return {
				result: { changeSetId: changeSet.id, status: "blocked", recoveryItems: stale },
				error: `StaleChangeSet: ${stale.join(", ")}`,
			};
		}

		const recorded: string[] = [];
		const ownCheckpoint = Boolean(this.undo && !this.undo.isCheckpointActive());
		if (ownCheckpoint) this.undo?.beginCheckpoint(`Semantic change: ${changeSet.intent}`);
		try {
			if (signal?.aborted) throw new Error("CommandCancelled");
			const source = this.app.vault.getAbstractFileByPath(pathOperation.sourcePath);
			if (!isAbstractFile(source)) throw new Error(`NotFound: ${pathOperation.sourcePath}`);
			if (this.app.vault.getAbstractFileByPath(pathOperation.targetPath)) throw new Error(`AlreadyExists: ${pathOperation.targetPath}`);
			await ensureParentFolder(this.app, pathOperation.targetPath);
			await this.app.vault.rename(source, pathOperation.targetPath);
			const renameRecord = this.undo?.record({
				path: pathOperation.targetPath,
				before: "",
				after: "",
				kind: "rename",
				beforePath: pathOperation.sourcePath,
				afterPath: pathOperation.targetPath,
			});
			if (renameRecord) recorded.push(renameRecord.id);

			for (const operation of changeSet.operations.filter((entry) => entry.kind === "content_patch")) {
				if (signal?.aborted) throw new Error("CommandCancelled");
				if (!operation.targetPath || operation.before === undefined || operation.after === undefined) throw new Error("ChangeSetError: malformed content patch");
				const file = this.app.vault.getAbstractFileByPath(operation.targetPath);
				if (!(file instanceof TFile)) throw new Error(`NotFound: ${operation.targetPath}`);
				const current = await this.app.vault.read(file);
				if (current !== operation.before) throw new Error(`StaleChangeSet: ${operation.targetPath}`);
				await this.app.vault.modify(file, operation.after);
				const writeRecord = this.undo?.record({ path: operation.targetPath, before: operation.before, after: operation.after });
				if (writeRecord) recorded.push(writeRecord.id);
			}
			if (ownCheckpoint) this.undo?.endCheckpoint();
			return { result: { changeSetId: changeSet.id, status: "applied" } };
		} catch (error) {
			const recoveryItems = await this.rollback(changeSet, recorded);
			if (ownCheckpoint) this.undo?.endCheckpoint();
			return {
				result: {
					changeSetId: changeSet.id,
					status: recoveryItems.length === 0 ? "rolled_back" : "rolled_back",
					restored: recoveryItems.length === 0,
					recoveryItems: recoveryItems.length > 0 ? recoveryItems : undefined,
				},
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async rollback(changeSet: ChangeSet, recorded: string[]): Promise<string[]> {
		const recoveryItems: string[] = [];
		for (const operation of [...changeSet.operations].reverse()) {
			try {
				if (operation.kind === "content_patch" && operation.targetPath !== undefined && operation.before !== undefined) {
					const file = this.app.vault.getAbstractFileByPath(operation.targetPath);
					if (file instanceof TFile) await this.app.vault.modify(file, operation.before);
				} else if ((operation.kind === "move" || operation.kind === "rename") && operation.targetPath && operation.sourcePath) {
					const file = this.app.vault.getAbstractFileByPath(operation.targetPath);
					if (isAbstractFile(file) && !this.app.vault.getAbstractFileByPath(operation.sourcePath)) await this.app.vault.rename(file, operation.sourcePath);
				}
			} catch {
				recoveryItems.push(operation.targetPath ?? operation.path ?? "unknown operation");
			}
		}
		for (const id of recorded) this.undo?.remove(id);
		return recoveryItems;
	}

	private async findStaleOperations(changeSet: ChangeSet): Promise<string[]> {
		const stale: string[] = [];
		for (const file of changeSet.affectedFiles.filter((entry) => entry.fingerprint)) {
			const patchOperation = changeSet.operations.find((operation) => operation.sourcePath === file.path && operation.kind === "content_patch");
			const currentPath = patchOperation?.sourcePath ?? file.path;
			const current = this.app.vault.getAbstractFileByPath(currentPath);
			if (!(current instanceof TFile)) {
				stale.push(file.path);
				continue;
			}
			const content = await this.app.vault.read(current);
			if (fingerprint(content) !== file.fingerprint) stale.push(file.path);
		}
		return stale;
	}

	private buildMappings(sourcePath: string, targetPath: string): PathMapping[] {
		return [{ from: sourcePath, to: targetPath }];
	}

	private emptyPreparation(action: "rename" | "move", args: { oldPath: string; newPath: string }, blockers: ChangeBlocker[], warnings: ChangeWarning[], sourcePath?: string): SemanticPreparation {
		return {
			changeSet: {
				id: randomId("changeset"),
				intent: `${action} ${args.oldPath} → ${args.newPath}`,
				operations: [],
				affectedFiles: [],
				blockers,
				warnings,
				createdAt: Date.now(),
			},
			sourcePath,
		};
	}
}

function mapPath(path: string, mappings: PathMapping[]): string {
		for (const mapping of mappings) {
			if (path === mapping.from) return mapping.to;
			if (path.startsWith(`${mapping.from}/`)) return `${mapping.to}${path.slice(mapping.from.length)}`;
		}
		return path;
}

function rewriteInternalLinks(
	app: App,
	index: VaultRelationIndex,
	sourcePath: string,
	sourceAfterPath: string,
	content: string,
	mappings: PathMapping[],
	blockers: ChangeBlocker[],
): string {
	const lines = content.split("\n");
	let fenced = false;
	return lines.map((line) => {
		if (/^\s*```/.test(line)) {
			fenced = !fenced;
			return line;
		}
		if (fenced) return line;
		let next = line.replace(/(!?)\[\[([^\]\n]+)\]\]/g, (full, bang: string, targetWithSuffix: string, offset: number) => {
			if (isInsideInlineCode(line, offset)) return full;
			const separator = targetWithSuffix.search(/[|]/);
			const targetAndSuffix = separator >= 0 ? targetWithSuffix.slice(0, separator) : targetWithSuffix;
			const suffix = separator >= 0 ? targetWithSuffix.slice(separator) : "";
			const targetPart = splitLinkSuffix(targetAndSuffix);
			const resolvedPath = resolveReference(app, index, targetPart.target, sourcePath, blockers);
			if (!resolvedPath) {
				if (looksLikeMovedTarget(targetPart.target, mappings)) blockers.push({ code: "unresolved_link", message: `Could not safely resolve internal link '${targetPart.target}' in ${sourcePath}`, paths: [sourcePath] });
				return full;
			}
			const mapped = mapPath(resolvedPath, mappings);
			if (mapped === resolvedPath) return full;
			return `${bang}[[${stripMd(mapped)}${targetPart.suffix}${suffix}]]`;
		});
		next = rewriteMarkdownLinks(app, index, sourcePath, sourceAfterPath, next, mappings, blockers);
		return next;
	}).join("\n");
}

function rewriteMarkdownLinks(app: App, index: VaultRelationIndex, sourcePath: string, sourceAfterPath: string, line: string, mappings: PathMapping[], blockers: ChangeBlocker[]): string {
	return line.replace(/(!?\[[^\]]*\])\(([^)\s]+)([^)]*)\)/g, (full, label: string, rawTarget: string, rest: string, offset: number) => {
		if (isInsideInlineCode(line, offset)) return full;
		if (/^(?:[a-z]+:|\/|#|\\)/i.test(rawTarget) || rawTarget.startsWith("<")) return full;
		let target: string;
		try { target = decodeURIComponent(rawTarget); } catch { return full; }
		const targetPart = splitLinkSuffix(target);
		const resolvedPath = resolveReference(app, index, targetPart.target, sourcePath, blockers);
		if (!resolvedPath) return full;
		const mapped = mapPath(resolvedPath, mappings);
		if (mapped === resolvedPath) return full;
		const relative = relativePath(dirname(sourceAfterPath), mapped);
		return `${label}(${relative}${targetPart.suffix}${rest})`;
	});
}

function resolveReference(app: App, index: VaultRelationIndex, target: string, sourcePath: string, blockers: ChangeBlocker[]): string | undefined {
	const candidates = index.resolveLinkCandidates(target, sourcePath);
	if (candidates.length > 1) {
		blockers.push({ code: "ambiguous_link", message: `Could not safely resolve internal link '${target}' in ${sourcePath}`, paths: [sourcePath, ...candidates] });
		return undefined;
	}
	if (candidates.length === 1) return candidates[0];
	const resolved = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
	return resolved instanceof TFile ? resolved.path : undefined;
}

function splitLinkSuffix(value: string): { target: string; suffix: string } {
	const index = value.search(/[#^]/);
	return index < 0 ? { target: value, suffix: "" } : { target: value.slice(0, index), suffix: value.slice(index) };
}

function looksLikeMovedTarget(target: string, mappings: PathMapping[]): boolean {
	const normalized = target.replace(/^\.\//, "").replace(/\.md$/, "");
	return mappings.some((mapping) => normalized === mapping.from.replace(/\.md$/, "") || normalized === basename(mapping.from).replace(/\.md$/, ""));
}

function stripMd(path: string): string {
	return path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
}

function dirname(path: string): string {
	const index = path.lastIndexOf("/");
	return index < 0 ? "" : path.slice(0, index);
}

function relativePath(from: string, target: string): string {
	const fromParts = from ? from.split("/").filter(Boolean) : [];
	const targetParts = target.split("/").filter(Boolean);
	while (fromParts.length > 0 && targetParts.length > 0 && fromParts[0] === targetParts[0]) {
		fromParts.shift();
		targetParts.shift();
	}
	const result = [...fromParts.map(() => ".."), ...targetParts].join("/");
	return result || ".";
}

function isInsideInlineCode(line: string, offset: number): boolean {
	let ticks = 0;
	for (let index = 0; index < offset; index++) {
		if (line[index] === "`" && (index === 0 || line[index - 1] !== "\\")) ticks++;
	}
	return ticks % 2 === 1;
}

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function fingerprint(content: string): string {
	let hash = 2166136261;
	for (let i = 0; i < content.length; i++) {
		hash ^= content.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16);
}

function randomId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isAbstractFile(value: unknown): value is TAbstractFile {
	return Boolean(value && typeof value === "object" && typeof (value as { path?: unknown }).path === "string");
}

async function ensureParentFolder(app: App, path: string): Promise<void> {
	const slash = path.lastIndexOf("/");
	if (slash <= 0) return;
	const parent = path.slice(0, slash);
	if (app.vault.getAbstractFileByPath(parent)) return;
	await app.vault.createFolder(parent);
}

function dedupeAffectedFiles(files: AffectedFile[]): AffectedFile[] {
	const map = new Map<string, AffectedFile>();
	for (const file of files) map.set(`${file.kind}:${file.path}`, file);
	return [...map.values()];
}

function dedupeProblems<T extends ChangeBlocker | ChangeWarning>(items: T[]): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		const key = `${item.code}:${item.message}:${(item.paths ?? []).join(",")}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export { fingerprint, mapPath, relativePath, rewriteInternalLinks };
