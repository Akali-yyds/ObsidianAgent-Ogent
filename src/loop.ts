import type { ConsentManager } from "./consent/manager";
import { ToolTimeoutError, runWithTimeout } from "./tools/timeout";
import type { ToolRegistry } from "./tools/registry";
import { validateArgs } from "./tools/validate";
import {
	type AssembledToolCall,
	type ChatMessage,
	type LoopEvent,
	type ModelProvider,
	type ToolCallSpec,
	type ToolResult,
} from "./types";

export interface RunTurnOptions {
	signal?: AbortSignal;
	systemPrompt?: string;
	tools?: ToolRegistry;
	consent?: ConsentManager;
	maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 8;

export async function* runTurn(
	userMessages: ChatMessage[],
	provider: ModelProvider,
	opts: RunTurnOptions = {},
): AsyncIterable<LoopEvent> {
	const messages: ChatMessage[] = [];
	if (opts.systemPrompt && opts.systemPrompt.trim().length > 0) {
		messages.push({ role: "system", content: opts.systemPrompt });
	}
	messages.push(...userMessages);

	const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
	const toolsApi = opts.tools?.toApiSpec();
	const useTools = toolsApi && toolsApi.length > 0;

	for (let step = 0; step < maxSteps; step++) {
		const assembled: AssembledToolCall[] = [];
		let assistantText = "";

		for await (const ev of provider.stream(messages, { signal: opts.signal, tools: useTools ? toolsApi : undefined })) {
			if (opts.signal?.aborted) return;
			if (ev.kind === "text") {
				assistantText += ev.text;
				yield { kind: "text", text: ev.text, degraded: ev.degraded };
			} else if (ev.kind === "tool_call_assembled") {
				assembled.push(...ev.calls);
			}
			// `done` ends this turn naturally when the iterable closes
		}

		if (assembled.length === 0) {
			yield { kind: "done" };
			return;
		}

		// Append the assistant's tool-calling turn to the conversation.
		const toolCallSpecs: ToolCallSpec[] = assembled.map((c) => ({
			id: c.id,
			type: "function",
			function: { name: c.name, arguments: c.rawArguments || JSON.stringify(c.arguments) },
		}));
		messages.push({ role: "assistant", content: assistantText, tool_calls: toolCallSpecs });

		// Dispatch each call sequentially.
		for (const call of assembled) {
			if (opts.signal?.aborted) return;
			const toolDef = opts.tools?.get(call.name);
			if (!toolDef) {
				yield {
					kind: "tool_call_started",
					id: call.id,
					name: call.name,
					args: call.arguments,
					mutates: false,
				};
				const result: ToolResult = { ok: false, error: `UnknownToolError: ${call.name}` };
				yield { kind: "tool_call_finished", id: call.id, result };
				messages.push(toolMessage(call, result));
				continue;
			}

			yield {
				kind: "tool_call_started",
				id: call.id,
				name: call.name,
				args: call.arguments,
				mutates: toolDef.mutates,
			};

			// Validate args.
			const validated = validateArgs(call.arguments, toolDef.schema);
			if (!validated.ok) {
				const result: ToolResult = { ok: false, error: `ToolArgError: ${validated.error}` };
				yield { kind: "tool_call_finished", id: call.id, result };
				messages.push(toolMessage(call, result));
				continue;
			}

			// Consent.
			if (toolDef.mutates) {
				if (!opts.consent) {
					const result: ToolResult = { ok: false, error: "ConsentDeniedError: no consent manager" };
					yield { kind: "tool_call_finished", id: call.id, result };
					messages.push(toolMessage(call, result));
					continue;
				}
				yield { kind: "consent_requested", id: call.id, name: call.name };
				const approved = await opts.consent.requestApproval(toolDef, validated.value);
				if (!approved) {
					const result: ToolResult = { ok: false, error: "ConsentDeniedError" };
					yield { kind: "tool_call_finished", id: call.id, result };
					messages.push(toolMessage(call, result));
					continue;
				}
			}

			// Execute with timeout.
			let result: ToolResult;
			try {
				result = await runWithTimeout(
					toolDef.run(validated.value, { signal: opts.signal }),
					30_000,
					toolDef.name,
					opts.signal,
				);
			} catch (err) {
				if (err instanceof ToolTimeoutError) {
					result = { ok: false, error: "ToolTimeoutError", details: err.message };
				} else if (err instanceof Error) {
					result = { ok: false, error: err.name || "ToolError", details: err.message };
				} else {
					result = { ok: false, error: "ToolError", details: String(err) };
				}
			}

			yield { kind: "tool_call_finished", id: call.id, result };
			messages.push(toolMessage(call, result));
		}
	}

	yield { kind: "cap_hit" };
	yield { kind: "done" };
}

function toolMessage(call: AssembledToolCall, result: ToolResult): ChatMessage {
	return {
		role: "tool",
		tool_call_id: call.id,
		name: call.name,
		content: JSON.stringify(result),
	};
}
