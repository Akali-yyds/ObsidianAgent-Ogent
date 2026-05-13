import { describe, expect, it, vi } from "vitest";
import type { Agent } from "../../src/agents";
import { runStructuredStep } from "../../src/agents/structured-output";
import type { ChatMessage, ModelProvider } from "../../src/types";

function createAgent(responses: string[]): Agent {
	let callCount = 0;
	return {
		run: async function* () {
			const response = responses[callCount] ?? responses[responses.length - 1] ?? "";
			callCount += 1;
			yield { kind: "text", text: response };
			yield { kind: "done" };
		},
	} as unknown as Agent;
}

function createProvider(): ModelProvider {
	return {
		stream: vi.fn(),
	};
}

describe("runStructuredStep", () => {
	it("returns parsed JSON on the first successful attempt", async () => {
		const result = await runStructuredStep<{ answer: string }>({
			agent: createAgent(['{"answer":"ready"}']),
			provider: createProvider(),
			messages: [{ role: "user", content: "hello" }],
			schema: {
				name: "answer-v1",
				schema: {
					type: "object",
					properties: { answer: { type: "string" } },
					required: ["answer"],
					additionalProperties: false,
				},
			},
		});

		expect(result).toEqual({
			ok: true,
			attempts: 1,
			rawText: '{"answer":"ready"}',
			value: { answer: "ready" },
		});
	});

	it("retries once with repair messaging after invalid output", async () => {
		const onRetry = vi.fn();
		const seenMessages: ChatMessage[][] = [];
		const agent = {
			run: async function* ({ messages }: { messages: ChatMessage[] }) {
				seenMessages.push(messages);
				if (seenMessages.length === 1) {
					yield { kind: "text", text: "not json" };
				} else {
					yield { kind: "text", text: '{"answer":"fixed"}' };
				}
				yield { kind: "done" };
			},
		} as unknown as Agent;

		const result = await runStructuredStep<{ answer: string }>({
			agent,
			provider: createProvider(),
			messages: [{ role: "user", content: "hello" }],
			schema: {
				name: "answer-v1",
				schema: {
					type: "object",
					properties: { answer: { type: "string" } },
					required: ["answer"],
					additionalProperties: false,
				},
			},
			onRetry,
		});

		expect(result).toEqual({
			ok: true,
			attempts: 2,
			rawText: '{"answer":"fixed"}',
			value: { answer: "fixed" },
		});
		expect(onRetry).toHaveBeenCalledWith({
			attempt: 0,
			rawText: "not json",
			reason: "Model did not return valid JSON",
		});
		expect(seenMessages).toHaveLength(2);
		expect(seenMessages[1]).toEqual([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "not json" },
			{
				role: "user",
				content:
					"Your previous response failed answer-v1 validation.\n" +
					"Reason: Model did not return valid JSON\n" +
					"Return only valid JSON that satisfies the requested schema. Do not add markdown fences or commentary.",
			},
		]);
	});

	it("returns the terminal failure after schema validation still fails", async () => {
		const result = await runStructuredStep<{ answer: string }>({
			agent: createAgent(['{"nope":true}', '{"still":"wrong"}']),
			provider: createProvider(),
			messages: [{ role: "user", content: "hello" }],
			schema: {
				name: "answer-v1",
				schema: {
					type: "object",
					properties: { answer: { type: "string" } },
					required: ["answer"],
					additionalProperties: false,
				},
			},
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.attempts).toBe(2);
		expect(result.reason).toBe("Schema validation failed");
		expect(result.rawText).toBe('{"still":"wrong"}');
		expect(result.validationErrors).toEqual(expect.arrayContaining(["/ must have required property 'answer'"]));
	});
});
