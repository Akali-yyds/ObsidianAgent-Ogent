import { getFrontMatterInfo, parseYaml, stringifyYaml } from "obsidian";

export interface FrontmatterSplit {
	frontmatter: Record<string, unknown> | null;
	body: string;
}

export function splitFrontmatter(text: string): FrontmatterSplit {
	const info = getFrontMatterInfo(text);
	if (!info.exists) return { frontmatter: null, body: text };
	let fm: Record<string, unknown> | null = null;
	try {
		const parsed = parseYaml(info.frontmatter);
		fm = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
	} catch {
		fm = null;
	}
	return { frontmatter: fm, body: text.slice(info.contentStart) };
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
