import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestUrlMock } = vi.hoisted(() => ({
	requestUrlMock: vi.fn(),
}));

vi.mock("obsidian", () => ({
	requestUrl: requestUrlMock,
}));

import { OpenAICompatibleProvider } from "../src/provider";

describe("OpenAICompatibleProvider", () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		requestUrlMock.mockReset();
		fetchMock.mockReset();
		fetchMock.mockRejectedValue(new Error("fetch unavailable in requestUrl compatibility test"));
		vi.stubGlobal("fetch", fetchMock);
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
			{ kind: "text", text: "hello", degraded: true },
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
			{ kind: "text", text: '{"summary":"ok","claims":[]}', degraded: true },
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
				degraded: true,
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

	it("emits text incrementally from an SSE response", async () => {
		fetchMock.mockResolvedValue(streamingResponse([
			"data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n",
			"data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n",
			"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
			"data: [DONE]\n\n",
		]));

		const provider = new OpenAICompatibleProvider({
			baseUrl: "https://api.example.com",
			apiKey: "secret",
			model: "test-model",
		});
		const events = [];
		for await (const event of provider.stream([{ role: "user", content: "hi" }])) events.push(event);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.example.com/chat/completions",
			expect.objectContaining({ method: "POST", signal: undefined }),
		);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(expect.objectContaining({ stream: true }));
		expect(events).toEqual([
			{ kind: "text", text: "Hel" },
			{ kind: "text", text: "lo" },
			{ kind: "done", finishReason: "stop" },
		]);
	});

	it("passes required tool choice through the non-streaming fallback", async () => {
		requestUrlMock.mockResolvedValue({
			status: 200,
			text: JSON.stringify({
				choices: [{ message: { content: "created" }, finish_reason: "stop" }],
			}),
		});

		const provider = new OpenAICompatibleProvider({
			baseUrl: "https://api.example.com",
			apiKey: "secret",
			model: "test-model",
		});
		const tools = [{
			type: "function" as const,
			function: {
				name: "vault_write",
				description: "Write a note",
				parameters: { type: "object" as const, properties: {} },
			},
		}];

		for await (const event of provider.stream(
			[{ role: "user", content: "create a note" }],
			{ tools, toolChoice: "required" },
		)) {
			// Consume the stream so the fallback request completes.
			void event;
		}

		expect(JSON.parse(requestUrlMock.mock.calls[0][0].body)).toEqual(expect.objectContaining({
			tool_choice: "required",
		}));
	});

	it("retries thinking-mode tool choice errors without an explicit choice", async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(400, {
				error: { message: "Thinking mode does not support this tool_choice", code: "invalid_request_error" },
			}))
			.mockResolvedValueOnce(streamingResponse([
				sse({ choices: [{ delta: { content: "created" } }] }),
				sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
				"data: [DONE]\n\n",
			]));

		const provider = new OpenAICompatibleProvider({
			baseUrl: "https://api.example.com",
			apiKey: "secret",
			model: "thinking-model",
		});
		const tools = [{
			type: "function" as const,
			function: {
				name: "vault_write",
				description: "Write a note",
				parameters: { type: "object" as const, properties: {} },
			},
		}];
		const events = [];
		for await (const event of provider.stream(
			[{ role: "user", content: "create a note" }],
			{ tools, toolChoice: "required" },
		)) events.push(event);

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveProperty("tool_choice", "required");
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty("tool_choice");
		expect(events).toEqual([
			{ kind: "text", text: "created" },
			{ kind: "done", finishReason: "stop" },
		]);
	});

	it("assembles streamed tool call deltas and keeps think tags out of answer text", async () => {
		fetchMock.mockResolvedValue(streamingResponse([
			sse({ choices: [{ delta: { content: "<thi" } }] }),
			sse({ choices: [{ delta: { content: "nk>plan" } }] }),
			sse({ choices: [{ delta: { content: "</think>Answer" } }] }),
			sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "vault_", arguments: "{\u0022path\u0022:\u0022Notes/" } }] } }] }),
			sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "read", arguments: "test.md\u0022}" } }] }, finish_reason: "tool_calls" }] }),
			"data: [DONE]\n\n",
		]));

		const provider = new OpenAICompatibleProvider({
			baseUrl: "https://api.example.com",
			apiKey: "secret",
			model: "test-model",
		});
		const events = [];
		for await (const event of provider.stream([{ role: "user", content: "hi" }])) events.push(event);

		expect(events).toEqual([
			{ kind: "thinking_text", text: "plan" },
			{ kind: "text", text: "Answer" },
			{
				kind: "tool_call_assembled",
				calls: [{
					id: "call_1",
					name: "vault_read",
					arguments: { path: "Notes/test.md" },
					rawArguments: "{\"path\":\"Notes/test.md\"}",
				}],
			},
			{ kind: "done", finishReason: "tool_calls" },
		]);
	});
});

function streamingResponse(chunks: string[]): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
	return {
		status: 200,
		headers: new Headers({ "content-type": "text/event-stream" }),
		body,
		text: async () => "",
	} as Response;
}

function jsonResponse(status: number, value: unknown): Response {
	const text = JSON.stringify(value);
	return {
		status,
		headers: new Headers({ "content-type": "application/json" }),
		body: null,
		text: async () => text,
	} as Response;
}

function sse(payload: unknown): string {
	return "data: " + JSON.stringify(payload) + String.fromCharCode(10, 10);
}
