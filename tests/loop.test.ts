import { describe, expect, it, vi } from "vitest";
import { ConsentManager } from "../src/consent/manager";
import { runTurn } from "../src/loop";
import { ToolRegistry } from "../src/tools/registry";
import type { ChatMessage, ModelProvider, ToolDef } from "../src/types";

describe("runTurn", () => {
	it("keeps the Agent wrapper behavior-safe while delegating through the loop", async () => {
		const toolRun = vi.fn(async () => ({ ok: true as const, value: "Alpha body" }));
		const registry = new ToolRegistry();
		registry.register({
			name: "vault_read",
			description: "Read a note",
			schema: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
				additionalProperties: false,
			},
			category: "vault_read",
			mutates: false,
			run: toolRun,
		} satisfies ToolDef<{ path: string }>);

		const seenMessages: ChatMessage[][] = [];
		let streamCount = 0;
		const provider: ModelProvider = {
			stream: async function* (messages, opts) {
				seenMessages.push(messages.map((message) => ({ ...message })));
				if (streamCount === 0) {
					expect(opts?.tools?.map((tool) => tool.function.name)).toEqual(["vault_read"]);
					yield {
						kind: "tool_call_assembled" as const,
						calls: [
							{
								id: "call-1",
								name: "vault_read",
								arguments: { path: "Notes/alpha.md" },
								rawArguments: '{"path":"Notes/alpha.md"}',
							},
						],
					};
					yield { kind: "done" as const, finishReason: "tool_calls" as const };
				} else {
					expect(messages.at(-1)).toEqual({
						role: "tool",
						tool_call_id: "call-1",
						name: "vault_read",
						content: JSON.stringify({ ok: true, value: "Alpha body" }),
					});
					yield { kind: "text" as const, text: "Answer from Agent mode" };
					yield { kind: "done" as const, finishReason: "stop" as const };
				}
				streamCount += 1;
			},
		};

		const events = [];
		for await (const event of runTurn(
			[{ role: "user", content: "Tell me about Alpha" }],
			provider,
			{ systemPrompt: "Be concise", tools: registry },
		)) {
			events.push(event);
		}

		expect(toolRun).toHaveBeenCalledWith({ path: "Notes/alpha.md" }, { signal: undefined });
		expect(seenMessages[0]?.[0]).toEqual({
			role: "system",
			content: expect.stringContaining("Be concise"),
		});
		expect(seenMessages[0]?.[1]).toEqual({
			role: "user",
			content: "Tell me about Alpha",
		});
		expect(events).toEqual([
			{
				kind: "tool_call_started",
				id: "call-1",
				name: "vault_read",
				args: { path: "Notes/alpha.md" },
				mutates: false,
			},
			{
				kind: "tool_call_finished",
				id: "call-1",
				result: { ok: true, value: "Alpha body" },
			},
			{ kind: "text", text: "Answer from Agent mode", degraded: undefined },
			{ kind: "done" },
		]);
	});

	it("preserves consent-denial behavior for mutating tools", async () => {
		const registry = new ToolRegistry();
		registry.register({
			name: "vault_write",
			description: "Write a note",
			schema: {
				type: "object",
				properties: { path: { type: "string" }, content: { type: "string" } },
				required: ["path", "content"],
				additionalProperties: false,
			},
			category: "vault_write",
			mutates: true,
			run: vi.fn(async () => ({ ok: true as const, value: null })),
		} satisfies ToolDef<{ path: string; content: string }>);
		const consent = new ConsentManager(() => ({ vault_read: "always", vault_write: "ask" }));
		let streamCount = 0;
		const provider: ModelProvider = {
			stream: async function* () {
				if (streamCount === 0) {
					yield {
						kind: "tool_call_assembled" as const,
						calls: [
							{
								id: "call-1",
								name: "vault_write",
								arguments: { path: "Notes/a.md", content: "Alpha" },
								rawArguments: '{"path":"Notes/a.md","content":"Alpha"}',
							},
						],
					};
					yield { kind: "done" as const, finishReason: "tool_calls" as const };
				}
				streamCount += 1;
			},
		};

		const events = [];
		for await (const event of runTurn([{ role: "user", content: "Write this down" }], provider, { tools: registry, consent })) {
			events.push(event);
			if (event.kind === "consent_requested") {
				setTimeout(() => consent.resolveConsent("reject"), 0);
			}
		}

		expect(events).toEqual([
			{
				kind: "tool_call_started",
				id: "call-1",
				name: "vault_write",
				args: { path: "Notes/a.md", content: "Alpha" },
				mutates: true,
			},
			{ kind: "consent_requested", id: "call-1", name: "vault_write" },
			{
				kind: "tool_call_finished",
				id: "call-1",
				result: {
					ok: false,
					error: "ConsentDeniedError",
					details: "User rejected this operation.",
				},
			},
			{ kind: "done" },
		]);
	});

	it("blocks mutating tools in Read mode before they run", async () => {
		const toolRun = vi.fn(async () => ({ ok: true as const, value: null }));
		const registry = new ToolRegistry();
		registry.register({
			name: "vault_write",
			description: "Write a note",
			schema: {
				type: "object",
				properties: { path: { type: "string" }, content: { type: "string" } },
				required: ["path", "content"],
				additionalProperties: false,
			},
			category: "vault_write",
			mutates: true,
			run: toolRun,
		} satisfies ToolDef<{ path: string; content: string }>);

		let streamCount = 0;
		const provider: ModelProvider = {
			stream: async function* (messages) {
				if (streamCount === 0) {
					yield {
						kind: "tool_call_assembled" as const,
						calls: [{
							id: "call-read-write",
							name: "vault_write",
							arguments: { path: "Notes/a.md", content: "Alpha" },
							rawArguments: '{"path":"Notes/a.md","content":"Alpha"}',
						}],
					};
					yield { kind: "done" as const, finishReason: "tool_calls" as const };
				} else {
					expect(messages.at(-1)).toEqual({
						role: "tool",
						tool_call_id: "call-read-write",
						name: "vault_write",
						content: JSON.stringify({
							ok: false,
							error: "ReadOnlyMode",
							details: "Read-only scope allows low-risk inspection only. Switch to Ask or Full permission to run this command.",
						}),
					});
						yield { kind: "text" as const, text: "Read-only scope cannot modify the vault." };
					yield { kind: "done" as const, finishReason: "stop" as const };
				}
				streamCount += 1;
			},
		};

		const events = [];
		for await (const event of runTurn(
			[{ role: "user", content: "Write this down" }],
			provider,
			{ tools: registry, executionMode: "read" },
		)) {
			events.push(event);
		}

		expect(toolRun).not.toHaveBeenCalled();
		expect(events).toEqual([
			{
				kind: "tool_call_started",
				id: "call-read-write",
				name: "vault_write",
				args: { path: "Notes/a.md", content: "Alpha" },
				mutates: true,
			},
			{
				kind: "tool_call_finished",
				id: "call-read-write",
				result: {
					ok: false,
					error: "ReadOnlyMode",
				details: "Read-only scope allows low-risk inspection only. Switch to Ask or Full permission to run this command.",
				},
			},
			{ kind: "text", text: "Read-only scope cannot modify the vault." },
			{ kind: "done" },
		]);
	});

	it("recovers once when a required tool call is returned as prose", async () => {
		const toolRun = vi.fn(async () => ({ ok: true as const, value: "Alpha body" }));
		const registry = new ToolRegistry();
		registry.register({
			name: "vault_read",
			description: "Read a note",
			schema: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
				additionalProperties: false,
			},
			category: "vault_read",
			mutates: false,
			run: toolRun,
		} satisfies ToolDef<{ path: string }>);

		let streamCount = 0;
		const provider: ModelProvider = {
			stream: async function* (messages) {
				if (streamCount === 0) {
					yield { kind: "text" as const, text: "I will ask for approval in prose." };
				} else if (streamCount === 1) {
					expect(messages.at(-1)?.content).toContain("required execute_commands function call");
					yield {
						kind: "tool_call_assembled" as const,
						calls: [{
							id: "call-recovered",
							name: "vault_read",
							arguments: { path: "Notes/alpha.md" },
							rawArguments: '{"path":"Notes/alpha.md"}',
						}],
					};
				} else {
					yield { kind: "text" as const, text: "Recovered successfully." };
				}
				yield { kind: "done" as const, finishReason: streamCount === 1 ? "tool_calls" as const : "stop" as const };
				streamCount += 1;
			},
		};

		const events = [];
		for await (const event of runTurn(
			[{ role: "user", content: "Inspect Alpha" }],
			provider,
			{ tools: registry, requireToolCall: true },
		)) events.push(event);

		expect(toolRun).toHaveBeenCalledOnce();
		expect(events.some((event) => event.kind === "text" && event.text.includes("approval in prose"))).toBe(false);
		expect(events).toContainEqual({ kind: "text", text: "Recovered successfully.", degraded: undefined });
	});

	it("stops safely when required tool calling still fails after recovery", async () => {
		const registry = new ToolRegistry();
		let streamCount = 0;
		const provider: ModelProvider = {
			stream: async function* () {
				streamCount += 1;
				yield { kind: "text" as const, text: "I will execute this in prose." };
				yield { kind: "done" as const, finishReason: "stop" as const };
			},
		};

		const events = [];
		for await (const event of runTurn(
			[{ role: "user", content: "Pull the repository" }],
			provider,
			{ tools: registry, requireToolCall: true },
		)) events.push(event);

		expect(streamCount).toBe(2);
		expect(events).toContainEqual({
			kind: "tool_call_required",
			message: "The model did not return a structured execute_commands call. No command was executed. Retry the request or use a model/provider with tool-calling support.",
			attempts: 2,
		});
		expect(events.some((event) => event.kind === "text")).toBe(false);
	});
});
