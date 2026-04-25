import { normalizePath } from "obsidian";

export class PathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PathError";
	}
}

export function safeVaultPath(input: string): string {
	if (typeof input !== "string" || input.length === 0) {
		throw new PathError("path must be a non-empty string");
	}
	const normalized = normalizePath(input);
	if (normalized.startsWith("..") || normalized.includes("/../") || normalized.endsWith("/..") || normalized === "..") {
		throw new PathError("path escapes vault root");
	}
	if (normalized.startsWith("/")) {
		throw new PathError("path must be vault-relative");
	}
	return normalized;
}
