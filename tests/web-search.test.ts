import { beforeEach, describe, expect, it } from "vitest";
import { webSearchTool } from "../src/tools/web-search";
import { requestUrlMock } from "./setup";

describe("web_search", () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
	});

	it("searches Tavily and returns source metadata", async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			text: JSON.stringify({
				results: [
					{
						title: "OpenAgent release notes",
						url: "https://example.com/releases",
						content: "The latest release adds live search.",
						published_date: "2026-08-14",
					},
				],
			}),
		});

		const tool = webSearchTool(() => ({ provider: "tavily", apiKey: "tavily-secret" }));
		const result = await tool.run({ query: "latest OpenAgent release", limit: 3 }, {});

		expect(result.ok).toBe(true);
		expect(requestUrlMock).toHaveBeenCalledWith(expect.objectContaining({
		url: "https://api.tavily.com/search",
		method: "POST",
		body: expect.stringContaining("latest OpenAgent release"),
		throw: false,
		}));
		if (!result.ok) return;
		const value = result.value as { results: Array<{ title: string; url: string; domain: string; publishedDate: string }> };
		expect(value.results).toEqual([{
			title: "OpenAgent release notes",
			url: "https://example.com/releases",
			snippet: "The latest release adds live search.",
			publishedDate: "2026-08-14",
			domain: "example.com",
		}]);
	});

	it("supports Brave Search response format", async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			text: JSON.stringify({
				web: {
					results: [{ title: "Brave result", url: "https://example.org/page", description: "A current result." }],
				},
			}),
		});

		const tool = webSearchTool(() => ({ provider: "brave", apiKey: "brave-secret" }));
		const result = await tool.run({ query: "current information" }, {});

		expect(result.ok).toBe(true);
		expect(requestUrlMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
			url: expect.stringContaining("https://api.search.brave.com/res/v1/web/search?"),
			headers: expect.objectContaining({ "X-Subscription-Token": "brave-secret" }),
		}));
	});

	it("fails clearly when no API key is configured", async () => {
		const tool = webSearchTool(() => ({ provider: "tavily", apiKey: "" }));
		const result = await tool.run({ query: "anything" }, {});

		expect(result).toEqual({
			ok: false,
			error: "Web search is not configured. Add a Tavily or Brave API key in OpenAgent settings.",
		});
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it("returns provider errors without exposing the API key", async () => {
		requestUrlMock.mockResolvedValue({ status: 401, text: "invalid key" });
		const tool = webSearchTool(() => ({ provider: "tavily", apiKey: "secret-value" }));
		const result = await tool.run({ query: "anything" }, {});

		expect(result).toEqual({
			ok: false,
			error: "Web search provider returned HTTP 401. Check the provider and API key.",
		});
	});
});
