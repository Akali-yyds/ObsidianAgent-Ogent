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
});
