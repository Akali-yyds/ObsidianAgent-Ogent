import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestUrlMock } = vi.hoisted(() => ({
	requestUrlMock: vi.fn(),
}));

vi.mock("obsidian", () => ({
	requestUrl: requestUrlMock,
}));

import { OpenAICompatibleProvider } from "../src/provider";

describe("OpenAICompatibleProvider", () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
	});

	it("emits assistant text from non-streaming completions", async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			text: JSON.stringify({
				choices: [
					{
						message: { content: "hello" },
						finish_reason: "stop",
					},
				],
			}),
		});

		const provider = new OpenAICompatibleProvider({
			baseUrl: "https://api.example.com",
			apiKey: "secret",
			model: "test-model",
		});

		const events = [];
		for await (const event of provider.stream([{ role: "user", content: "hi" }])) {
			events.push(event);
		}

		expect(requestUrlMock).toHaveBeenCalledWith(expect.objectContaining({
			url: "https://api.example.com/chat/completions",
			method: "POST",
			throw: false,
		}));
		expect(events).toEqual([
			{ kind: "text", text: "hello" },
			{ kind: "done", finishReason: "stop" },
		]);
	});

	it("includes response_format when provided", async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			text: JSON.stringify({
				choices: [
					{
						message: { content: '{"summary":"ok","claims":[]}' },
						finish_reason: "stop",
					},
				],
			}),
		});

		const provider = new OpenAICompatibleProvider({
			baseUrl: "https://api.example.com",
			apiKey: "secret",
			model: "test-model",
		});

		const events = [];
		for await (const event of provider.stream(
			[{ role: "user", content: "hi" }],
			{
				responseFormat: {
					type: "json_schema",
					json_schema: {
						name: "claims_v1",
						strict: true,
						schema: {
							type: "object",
							properties: {
								summary: { type: "string" },
								claims: { type: "array", items: { type: "string" } },
							},
							required: ["summary", "claims"],
							additionalProperties: false,
						},
					},
				},
			},
		)) {
			events.push(event);
		}

		expect(JSON.parse(requestUrlMock.mock.calls[0][0].body)).toEqual(expect.objectContaining({
			model: "test-model",
			response_format: {
				type: "json_schema",
				json_schema: expect.objectContaining({
					name: "claims_v1",
					strict: true,
				}),
			},
		}));
		expect(events).toEqual([
			{ kind: "text", text: '{"summary":"ok","claims":[]}' },
			{ kind: "done", finishReason: "stop" },
		]);
	});

	it("assembles tool calls from non-streaming completions", async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			text: JSON.stringify({
				choices: [
					{
						message: {
							tool_calls: [
								{
									id: "call_1",
									function: {
										name: "vault_read",
										arguments: '{"path":"Notes/test.md"}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			}),
		});

		const provider = new OpenAICompatibleProvider({
			baseUrl: "https://api.example.com",
			apiKey: "secret",
			model: "test-model",
		});

		const events = [];
		for await (const event of provider.stream([{ role: "user", content: "hi" }])) {
			events.push(event);
		}

		expect(events).toEqual([
			{
				kind: "tool_call_assembled",
				calls: [
					{
						id: "call_1",
						name: "vault_read",
						arguments: { path: "Notes/test.md" },
						rawArguments: '{"path":"Notes/test.md"}',
					},
				],
			},
			{ kind: "done", finishReason: "tool_calls" },
		]);
	});

	it("lists sorted models", async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			text: JSON.stringify({
				data: [
					{ id: "z-model" },
					{ id: "a-model" },
					{ nope: true },
				],
			}),
		});

		const provider = new OpenAICompatibleProvider({
			baseUrl: "https://api.example.com/",
			apiKey: "secret",
			model: "test-model",
		});

		await expect(provider.listModels()).resolves.toEqual(["a-model", "z-model"]);
		expect(requestUrlMock).toHaveBeenCalledWith(expect.objectContaining({
			url: "https://api.example.com/models",
			method: "GET",
			throw: false,
		}));
	});

	it("falls back when the endpoint rejects response_format", async () => {
		requestUrlMock
			.mockResolvedValueOnce({
				status: 400,
				text: JSON.stringify({
					error: {
						message: "response_format json_schema is not supported",
					},
				}),
			})
			.mockResolvedValueOnce({
				status: 200,
				text: JSON.stringify({
					choices: [
						{
							message: { content: '{"summary":"fallback","claims":[]}' },
							finish_reason: "stop",
						},
					],
				}),
			});

		const provider = new OpenAICompatibleProvider({
			baseUrl: "https://api.example.com",
			apiKey: "secret",
			model: "test-model",
		});

		const events = [];
		for await (const event of provider.stream(
			[{ role: "user", content: "hi" }],
			{
				responseFormat: {
					type: "json_schema",
					json_schema: {
						name: "claims_v1",
						strict: true,
						schema: {
							type: "object",
							properties: {
								summary: { type: "string" },
								claims: { type: "array", items: { type: "string" } },
							},
							required: ["summary", "claims"],
							additionalProperties: false,
						},
					},
				},
			},
		)) {
			events.push(event);
		}

		expect(requestUrlMock).toHaveBeenCalledTimes(2);
		expect(JSON.parse(requestUrlMock.mock.calls[0][0].body)).toHaveProperty("response_format");
		expect(JSON.parse(requestUrlMock.mock.calls[1][0].body)).not.toHaveProperty("response_format");
		expect(events).toEqual([
			{ kind: "text", text: '{"summary":"fallback","claims":[]}', degraded: true },
			{ kind: "done", finishReason: "stop" },
		]);
	});
});
