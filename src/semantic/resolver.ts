import type { App } from "obsidian";
import type { VaultRelationIndex } from "./index";
import type { VaultContext } from "../context";
import { PathError, safeVaultPath } from "../tools/vault/path-safe";

export interface PathResolution {
	path?: string;
	candidates: string[];
	error?: string;
}

export class ContextResolver {
	constructor(
		private readonly app: App,
		private readonly index: VaultRelationIndex,
		private readonly getContext?: () => VaultContext,
	) {}

	resolveExisting(input: string, kind?: "file" | "folder"): PathResolution {
		const contextPath = this.contextPath(input);
		if (contextPath) return { path: contextPath, candidates: [contextPath] };
		let normalized: string;
		try {
			normalized = safeVaultPath(input);
		} catch (error) {
			return { candidates: [], error: error instanceof PathError ? `PathError: ${error.message}` : String(error) };
		}
		const exact = this.app.vault.getAbstractFileByPath(normalized);
		if (exact && (!kind || (kind === "file" ? this.isFile(exact) : !this.isFile(exact)))) return { path: normalized, candidates: [normalized] };
		const candidates = this.index.findCandidates(normalized, kind);
		if (candidates.length === 1) return { path: candidates[0], candidates };
		if (candidates.length > 1) return { candidates, error: `AmbiguousPath: ${input}` };
		return { candidates: [], error: `NotFound: ${normalized}` };
	}

	resolveDestination(input: string, sourcePath: string, action: "rename" | "move"): PathResolution {
		const contextPath = this.contextPath(input);
		if (contextPath) input = contextPath;
		let normalized: string;
		try {
			normalized = safeVaultPath(input);
		} catch (error) {
			return { candidates: [], error: error instanceof PathError ? `PathError: ${error.message}` : String(error) };
		}
		const target = this.app.vault.getAbstractFileByPath(normalized);
		const source = this.app.vault.getAbstractFileByPath(sourcePath);
		if (action === "move" && target && !this.isFile(target)) {
			return { path: `${normalized}/${basename(sourcePath)}`, candidates: [normalized] };
		}
		if (action === "rename" && source && this.isFile(source) && !normalized.includes(".")) normalized += `.${extension(sourcePath)}`;
		return { path: normalized, candidates: [normalized] };
	}

	private isFile(value: unknown): boolean {
		return Boolean(value && typeof value === "object" && "extension" in value && "basename" in value);
	}

	private contextPath(input: string): string | undefined {
		const normalized = input.trim().toLowerCase();
		const context = this.getContext?.();
		if (!context) return undefined;
		if (["当前笔记", "当前文件", "current note", "current file", "this note", "this file"].includes(normalized)) return context.activeFilePath ?? undefined;
		if (["当前目录", "当前文件夹", "current directory", "current folder", "this folder"].includes(normalized)) return context.activeFolderPath || undefined;
		return undefined;
	}
}

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function extension(path: string): string {
	const name = basename(path);
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1) : "md";
}
