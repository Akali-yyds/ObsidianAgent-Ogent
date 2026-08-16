import { normalizePath } from "obsidian";

export class PathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PathError";
	}
}

export function safeVaultPath(input: string): string {
	if (typeof input !== "string" || input.trim().length === 0) {
		throw new PathError("path must be a non-empty string");
	}
	if (input.includes("\0")) throw new PathError("path contains a null character");
	const normalized = normalizePath(input.trim());
	if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../") || normalized.endsWith("/..")) {
		throw new PathError("path escapes vault root");
	}
	if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
		throw new PathError("path must be vault-relative");
	}
	return normalized;
}
