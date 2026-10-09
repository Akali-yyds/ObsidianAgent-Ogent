import { describe, expect, it } from "vitest";
import { CompletedMarkdownCache, isCacheableStaticMarkdown } from "../src/markdown-cache";

describe("completed Markdown cache", () => {
	it("accepts only static Markdown that does not need Obsidian post-processing", () => {
		expect(isCacheableStaticMarkdown("A **stable** answer with _emphasis_.")).toBe(true);
		expect(isCacheableStaticMarkdown("[[Internal note]]")).toBe(false);
		expect(isCacheableStaticMarkdown("![[diagram.png]]")).toBe(false);
		expect(isCacheableStaticMarkdown("[external](https://example.com)")).toBe(false);
		expect(isCacheableStaticMarkdown("#tag")).toBe(false);
		expect(isCacheableStaticMarkdown("<span>HTML</span>")).toBe(false);
		expect(isCacheableStaticMarkdown("```ts\nconst x = 1;\n```")).toBe(false);
	});

	it("returns cached HTML only for eligible content", () => {
		const cache = new CompletedMarkdownCache();
		cache.set("**answer**", "<strong>answer</strong>");
		cache.set("[[note]]", "<a data-href=\"note\">note</a>");
		expect(cache.get("**answer**")).toBe("<strong>answer</strong>");
		expect(cache.get("[[note]]")).toBeUndefined();
	});
});
