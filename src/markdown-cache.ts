const MAX_ENTRIES = 100;
const MAX_CHARS = 2_000_000;

/**
 * Cache only static CommonMark fragments. Obsidian links, embeds, tags, HTML,
 * code blocks, and Markdown links rely on renderer/postprocessor behavior and
 * must go through MarkdownRenderer every time a row is mounted.
 */
export function isCacheableStaticMarkdown(markdown: string): boolean {
	return !["!", "<", ">", "[", "]", "(", ")", "`", "#"].some((token) => markdown.includes(token));
}

export class CompletedMarkdownCache {
	private readonly entries = new Map<string, string>();
	private totalChars = 0;

	get(markdown: string): string | undefined {
		if (!isCacheableStaticMarkdown(markdown)) return undefined;
		const html = this.entries.get(markdown);
		if (html === undefined) return undefined;
		this.entries.delete(markdown);
		this.entries.set(markdown, html);
		return html;
	}

	set(markdown: string, html: string): void {
		if (!isCacheableStaticMarkdown(markdown) || markdown.length + html.length > MAX_CHARS) return;
		const previous = this.entries.get(markdown);
		if (previous !== undefined) this.totalChars -= markdown.length + previous.length;
		this.entries.delete(markdown);
		this.entries.set(markdown, html);
		this.totalChars += markdown.length + html.length;
		while (this.entries.size > MAX_ENTRIES || this.totalChars > MAX_CHARS) {
			const oldest = this.entries.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			const removed = this.entries.get(oldest) ?? "";
			this.totalChars -= oldest.length + removed.length;
			this.entries.delete(oldest);
		}
	}
}
