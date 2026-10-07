import { describe, expect, it, vi } from "vitest";
import { ConsentManager } from "../src/consent/manager";
import { CommandExecutor } from "../src/commands/executor";
import { executeCommandsTool } from "../src/commands/tool";
import { runTurn } from "../src/loop";
import { ToolRegistry } from "../src/tools/registry";
import type { ModelProvider, ToolDef } from "../src/types";

function fakeTool(name: string, category: ToolDef["category"], run: ToolDef["run"], mutates = false): ToolDef {
	return {
		name,
		description: name,
		schema: { type: "object", properties: { value: { type: "string" } }, additionalProperties: false },
		category,
		mutates,
		run,
	};
}

describe("command-driven Agent", () => {
	it("keeps the model on the command dispatcher when an executor is present", async () => {
		const registry = new ToolRegistry();
		registry.register(fakeTool("vault_read", "vault_read", vi.fn(async () => ({ ok: true as const, value: "read" }))));
		registry.register(executeCommandsTool());
		const executor = new CommandExecutor(registry);
		let firstRequest = true;
		const provider: ModelProvider = {
			stream: async function* (_messages, opts) {
				if (firstRequest) {
					firstRequest = false;
					expect(opts?.tools?.map((tool) => tool.function.name)).toEqual(["execute_commands"]);
					yield { kind: "text" as const, text: "ready" };
					yield { kind: "done" as const, finishReason: "stop" as const };
				}
			},
		};

		for await (const _event of runTurn([{ role: "user", content: "hello" }], provider, { tools: registry, commandExecutor: executor })) {
			// Exhaust the Agent stream.
			void _event;
		}
	});

	it("validates command arguments against the selected action schema", async () => {
		const registry = new ToolRegistry();
		registry.register({
			name: "git_status",
			description: "status",
			schema: { type: "object", properties: { path: { type: "string", minLength: 1 } }, additionalProperties: false },
			category: "vault_read",
			mutates: false,
			run: vi.fn(async () => ({ ok: true as const, value: null })),
		});
		const executor = new CommandExecutor(registry);
		const iterator = executor.executePlan({ commands: [{ id: "status", domain: "git", action: "status", args: { path: "Projects/Alpha" } }] }, {});
		const started = await iterator.next();
		expect(started.value).toMatchObject({ kind: "started", command: { args: { path: "Projects/Alpha" } } });
		const finished = await iterator.next();
		expect(finished.value).toMatchObject({ kind: "finished", result: { ok: true } });
	});

	it("rejects unknown actions before any implementation runs", async () => {
		const registry = new ToolRegistry();
		const executor = new CommandExecutor(registry);
		const iterator = executor.executePlan({ commands: [{ id: "unknown", domain: "vault", action: "shell", args: {} }] }, {});
		await iterator.next();
		const failed = await iterator.next();
		expect(failed.value).toMatchObject({ kind: "finished", result: { error: "UnsupportedCommand: vault.shell" } });
	});

	it("exposes only execute_commands and executes read commands in order", async () => {
		const calls: string[] = [];
		const registry = new ToolRegistry();
		registry.register(fakeTool("vault_read", "vault_read", vi.fn(async (args) => {
			calls.push(String((args as { value: string }).value));
			return { ok: true as const, value: `read:${(args as { value: string }).value}` };
		})));
		registry.register(executeCommandsTool());
		const executor = new CommandExecutor(registry);
		let streamCount = 0;
		const provider: ModelProvider = {
			stream: async function* (_messages, opts) {
				if (streamCount++ === 0) {
					expect(opts?.tools?.map((tool) => tool.function.name)).toEqual(["execute_commands"]);
					yield {
						kind: "tool_call_assembled" as const,
						calls: [{
							id: "plan-1",
							name: "execute_commands",
							arguments: { commands: [
								{ id: "read-1", domain: "vault", action: "read", args: { value: "a" } },
								{ id: "read-2", domain: "vault", action: "read", args: { value: "b" } },
							] },
							rawArguments: "{}",
						}],
					};
					yield { kind: "done" as const, finishReason: "tool_calls" as const };
				} else {
					yield { kind: "text" as const, text: "done" };
					yield { kind: "done" as const, finishReason: "stop" as const };
				}
			},
		};

		const events = [];
		for await (const event of runTurn([{ role: "user", content: "read" }], provider, {
			tools: registry,
			commandExecutor: executor,
			toolAllowlist: ["execute_commands"],
		})) events.push(event);

		expect(calls).toEqual(["a", "b"]);
		expect(events.map((event) => event.kind)).toEqual([
			"tool_call_started",
			"command_plan_started",
			"command_started",
			"command_finished",
			"command_started",
			"command_finished",
			"command_plan_finished",
			"tool_call_finished",
			"text",
			"done",
		]);
	});

	it("stops the plan after the first failed command", async () => {
		const second = vi.fn(async () => ({ ok: true as const, value: "should not run" }));
		const registry = new ToolRegistry();
		registry.register(fakeTool("vault_read", "vault_read", vi.fn(async () => ({ ok: false as const, error: "NotFound" }))));
		registry.register(fakeTool("vault_search", "vault_read", second));
		const executor = new CommandExecutor(registry);
		const iterator = executor.executePlan({ commands: [
			{ id: "bad", domain: "vault", action: "read", args: { value: "missing" } },
			{ id: "never", domain: "vault", action: "search", args: { value: "x" } },
		] }, {});
		const events = [];
		let next = await iterator.next();
		while (!next.done) {
			events.push(next.value);
			next = await iterator.next();
		}
		expect(second).not.toHaveBeenCalled();
		expect(next.value).toMatchObject({ ok: false, stoppedAt: "bad" });
		expect(events.at(-1)).toMatchObject({ kind: "finished", result: { id: "bad", ok: false } });
	});

	it("requires approval for a write and does not execute it when rejected", async () => {
		const write = vi.fn(async () => ({ ok: true as const, value: "written" }));
		const registry = new ToolRegistry();
		registry.register(fakeTool("vault_write", "vault_write", write, true));
		registry.register(executeCommandsTool());
		const executor = new CommandExecutor(registry);
		const consent = new ConsentManager(() => ({ vault_read: "always", vault_write: "ask", network_read: "ask", external_write: "ask", plugin_control: "ask" }));
		const iterator = executor.executePlan({ commands: [{ id: "write-1", domain: "vault", action: "write", args: { value: "x" } }] }, { consent });
		const first = await iterator.next();
		expect(first.value).toMatchObject({ kind: "started", command: { id: "write-1" } });
		const consentEvent = await iterator.next();
		expect(consentEvent.value).toMatchObject({ kind: "consent_requested" });
		consent.resolveConsent("reject");
		const finished = await iterator.next();
		expect(finished.value).toMatchObject({ kind: "finished", result: { error: "ConsentDeniedError" } });
		expect(write).not.toHaveBeenCalled();
	});

	it("can permanently enable network or external capabilities after approval", async () => {
		const persisted: string[] = [];
		const consent = new ConsentManager(
			() => ({ vault_read: "always", vault_write: "ask", network_read: "ask", external_write: "ask", plugin_control: "ask" }),
			(category, mode) => persisted.push(`${category}:${mode}`),
		);
		const registry = new ToolRegistry();
		registry.register(fakeTool("git_commit", "external_write", vi.fn(async () => ({ ok: true as const, value: "committed" })), true));
		const executor = new CommandExecutor(registry);
		const iterator = executor.executePlan({ commands: [{ id: "commit-1", domain: "git", action: "commit", args: { value: "x" } }] }, { consent });
		await iterator.next();
		await iterator.next();
		consent.resolveConsent("approve-always");
		await iterator.next();
		await iterator.next();
		expect(persisted).toEqual(["external_write:always"]);
	});
});
