import { describe, expect, it, vi } from "vitest";
import { ConsentManager } from "../src/consent/manager";
import { runTurn } from "../src/loop";
import { ToolRegistry } from "../src/tools/registry";

describe("network tool consent", () => {
	it("does not run a public web tool before approval", async () => {
		const run = vi.fn(async () => ({ ok: true as const, value: "should not run" }));
		const registry = new ToolRegistry();
		registry.register({
			name: "web_search",
			description: "Search public web",
			schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
			category: "network_read",
			requiresApproval: true,
			mutates: false,
			run,
		});
		let calls = 0;
		const provider = {
			stream: async function* () {
				if (calls++ === 0) {
					yield { kind: "tool_call_assembled" as const, calls: [{ id: "web-1", name: "web_search", arguments: { query: "now" }, rawArguments: '{"query":"now"}' }] };
					yield { kind: "done" as const, finishReason: "tool_calls" as const };
				}
			},
		};
		const consent = new ConsentManager(() => ({ vault_read: "always", vault_write: "ask", network_read: "ask" }));
		const events = [];
		for await (const event of runTurn([{ role: "user", content: "search" }], provider, { tools: registry, consent })) {
			events.push(event);
			if (event.kind === "consent_requested") setTimeout(() => consent.resolveConsent("reject"), 0);
		}

		expect(run).not.toHaveBeenCalled();
		expect(events.some((event) => event.kind === "consent_requested")).toBe(true);
	});
});
