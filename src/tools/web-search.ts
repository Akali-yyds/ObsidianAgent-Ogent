import { requestUrl } from "obsidian";
import { defineTool, fail, ok } from "./define";

export type WebSearchProvider = "tavily" | "brave";

export interface WebSearchConfig {
	provider: WebSearchProvider;
	apiKey: string;
}

interface WebSearchArgs {
	query: string;
	limit?: number;
}

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	publishedDate?: string;
	domain: string;
}

const TAVILY_URL = "https://api.tavily.com/search";
const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";

export function webSearchTool(getConfig: () => WebSearchConfig) {
	return defineTool<WebSearchArgs>({
		name: "web_search",
		description:
			"Search the live web for current or time-sensitive information. Use this before answering about recent events, " +
			"software versions, current APIs, prices, releases, documentation changes, or facts that may have changed. " +
			"Use the returned URLs as sources in the final answer. This searches the public web and is separate from the Obsidian vault.",
		category: "network_read",
		requiresApproval: true,
		mutates: false,
		schema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "A focused web search query. Include the product, version, date, or region when relevant.",
					minLength: 1,
				},
				limit: {
					type: "integer",
					description: "Maximum number of results to return. Defaults to 5.",
					minimum: 1,
					maximum: 10,
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
		async run(args) {
			const query = args.query.trim();
			if (!query) return fail("Web search query is empty. Provide a focused query.");

			const config = getConfig();
			const apiKey = config.apiKey.trim();
			if (!apiKey) {
				return fail("Web search is not configured. Add a Tavily or Brave API key in OpenAgent settings.");
			}

			const limit = clampLimit(args.limit);
			try {
				const response = config.provider === "brave"
					? await searchBrave(query, limit, apiKey)
					: await searchTavily(query, limit, apiKey);
				if (response.status >= 400) {
					return fail(`Web search provider returned HTTP ${response.status}. Check the provider and API key.`);
				}
				const payload = parseResponse(response.text, response.json);
				const results = config.provider === "brave"
					? parseBraveResults(payload, limit)
					: parseTavilyResults(payload, limit);
				return ok({
					query,
					provider: config.provider,
					searchedAt: new Date().toISOString(),
					total: results.length,
					results,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return fail(`Web search failed: ${message}`);
			}
		},
	});
}

function clampLimit(value: number | undefined): number {
	if (!Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(10, Math.floor(value ?? 5)));
}

async function searchTavily(query: string, limit: number, apiKey: string): Promise<{ status: number; text: string; json?: unknown }> {
	return requestUrl({
		url: TAVILY_URL,
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			api_key: apiKey,
			query,
			search_depth: "basic",
			max_results: limit,
			include_answer: false,
			include_raw_content: false,
		}),
		throw: false,
	});
}

async function searchBrave(query: string, limit: number, apiKey: string): Promise<{ status: number; text: string; json?: unknown }> {
	const params = new URLSearchParams({ q: query, count: String(limit), safesearch: "moderate" });
	return requestUrl({
		url: `${BRAVE_URL}?${params.toString()}`,
		method: "GET",
		headers: {
			Accept: "application/json",
			"X-Subscription-Token": apiKey,
		},
		throw: false,
	});
}

function parseResponse(text: string, json: unknown): unknown {
	if (json && typeof json === "object") return json;
	return JSON.parse(text) as unknown;
}

function parseTavilyResults(payload: unknown, limit: number): SearchResult[] {
	if (!isRecord(payload) || !Array.isArray(payload.results)) return [];
	return payload.results
		.map((entry) => {
			if (!isRecord(entry) || typeof entry.title !== "string" || typeof entry.url !== "string") return null;
			return {
				title: entry.title,
				url: entry.url,
				snippet: typeof entry.content === "string" ? entry.content : "",
				...(typeof entry.published_date === "string" ? { publishedDate: entry.published_date } : {}),
				domain: getDomain(entry.url),
			} satisfies SearchResult;
		})
		.filter((entry): entry is SearchResult => entry !== null)
		.slice(0, limit);
}

function parseBraveResults(payload: unknown, limit: number): SearchResult[] {
	if (!isRecord(payload) || !isRecord(payload.web) || !Array.isArray(payload.web.results)) return [];
	return payload.web.results
		.map((entry) => {
			if (!isRecord(entry) || typeof entry.title !== "string" || typeof entry.url !== "string") return null;
			return {
				title: entry.title,
				url: entry.url,
				snippet: typeof entry.description === "string" ? entry.description : "",
				...(typeof entry.age === "string" ? { publishedDate: entry.age } : {}),
				domain: getDomain(entry.url),
			} satisfies SearchResult;
		})
		.filter((entry): entry is SearchResult => entry !== null)
		.slice(0, limit);
}

function getDomain(value: string): string {
	try {
		return new URL(value).hostname;
	} catch {
		return "";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
