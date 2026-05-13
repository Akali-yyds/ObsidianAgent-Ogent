import { describe, expect, it, vi } from "vitest";
import type { Agent } from "../../src/agents";
import { runPipeline } from "../../src/agents/orchestrator";
import type { ChatMessage, ModelProvider } from "../../src/types";

function createStructuredAgent(responses: string[]): Agent {
	let callCount = 0;
	return {
		run: async function* ({ messages }: { messages: ChatMessage[] }) {
			void messages;
			yield { kind: "text", text: responses[callCount] ?? "" };
			yield { kind: "done" };
			callCount += 1;
		},
	} as unknown as Agent;
}

const provider: ModelProvider = { stream: vi.fn() };

describe("runPipeline", () => {
	it("emits ordered events, forwards structured retries, and completes later steps", async () => {
		const events: Array<Record<string, unknown>> = [];
		const agent = createStructuredAgent(["not json", '{"value":"fixed"}']);

		const result = await runPipeline({
			initialContext: { value: "", order: [] as string[] },
			steps: [
				{
					id: "structured",
					label: "Structured",
					kind: "structured" as const,
					prepare: async () => ({
						agent,
						provider,
						messages: [{ role: "user", content: "hello" }],
						schema: {
							name: "value-v1",
							schema: {
								type: "object",
								properties: { value: { type: "string" } },
								required: ["value"],
								additionalProperties: false,
							},
						},
					}),
					apply: async (context, output) => ({
						...context,
						value: (output as { value: string }).value,
						order: [...context.order, "structured"],
					}),
				},
				{
					id: "task",
					label: "Task",
					run: async (context) => context.value.toUpperCase(),
					apply: async (context, output) => ({
						...context,
						value: output as string,
						order: [...context.order, "task"],
					}),
				},
			],
			onEvent: async (event) => {
				events.push(event as unknown as Record<string, unknown>);
			},
		});

		expect(result).toEqual({
			ok: true,
			context: { value: "FIXED", order: ["structured", "task"] },
		});
		expect(events).toEqual([
			{ kind: "step", stepId: "structured", label: "Structured", state: "pending" },
			{ kind: "step", stepId: "task", label: "Task", state: "pending" },
			{ kind: "step", stepId: "structured", label: "Structured", state: "running" },
			{
				kind: "structured_retry",
				stepId: "structured",
				label: "Structured",
				attempt: 1,
				maxAttempts: 1,
				reason: "Model did not return valid JSON",
			},
			{ kind: "step", stepId: "structured", label: "Structured", state: "complete" },
			{ kind: "step", stepId: "task", label: "Task", state: "running" },
			{ kind: "step", stepId: "task", label: "Task", state: "complete" },
		]);
	});

	it("fails fast after the first failed step and does not run later steps", async () => {
		const events: Array<Record<string, unknown>> = [];
		const ranLaterStep = vi.fn();

		const result = await runPipeline({
			initialContext: { value: "start" },
			steps: [
				{
					id: "first",
					label: "First",
					run: async () => {
						throw new Error("boom");
					},
					apply: async (context) => context,
				},
				{
					id: "later",
					label: "Later",
					run: async () => {
						ranLaterStep();
						return "never";
					},
					apply: async (context) => context,
				},
			],
			onEvent: async (event) => {
				events.push(event as unknown as Record<string, unknown>);
			},
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failedStepId).toBe("first");
		expect(result.error).toBeInstanceOf(Error);
		expect((result.error as Error).message).toBe("boom");
		expect(ranLaterStep).not.toHaveBeenCalled();
		expect(events).toEqual([
			{ kind: "step", stepId: "first", label: "First", state: "pending" },
			{ kind: "step", stepId: "later", label: "Later", state: "pending" },
			{ kind: "step", stepId: "first", label: "First", state: "running" },
			{ kind: "step", stepId: "first", label: "First", state: "failed", message: "boom" },
		]);
	});
});
