import { parseYaml, stringifyYaml } from "obsidian";

const FRONTMATTER_PATTERN = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export interface FrontmatterSplit {
	frontmatter: Record<string, unknown> | null;
	body: string;
}

export function splitFrontmatter(text: string): FrontmatterSplit {
	const info = getFrontmatterInfoCompat(text);
	if (!info.exists) return { frontmatter: null, body: text };
	return {
		frontmatter: parseFrontmatterObject(info.frontmatter),
		body: text.slice(info.contentStart),
	};
}

export function mergeFrontmatter(
	existing: Record<string, unknown>,
	incoming: Record<string, unknown>,
): Record<string, unknown> {
	return { ...existing, ...incoming };
}

export function stitchFrontmatter(frontmatter: Record<string, unknown> | null | undefined, body: string): string {
	if (!frontmatter || Object.keys(frontmatter).length === 0) return body;
	const yaml = stringifyYaml(frontmatter).trim();
	const bodyClean = body.startsWith("\n") ? body : "\n" + body;
	return `---\n${yaml}\n---${bodyClean}`;
}

function parseFrontmatterObject(text: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = parseYaml(text);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function getFrontmatterInfoCompat(text: string): { exists: boolean; frontmatter: string; contentStart: number } {
	const match = text.match(FRONTMATTER_PATTERN);
	if (!match) {
		return {
			exists: false,
			frontmatter: "",
			contentStart: 0,
		};
	}
	return {
		exists: true,
		frontmatter: match[1] ?? "",
		contentStart: match[0].length,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
