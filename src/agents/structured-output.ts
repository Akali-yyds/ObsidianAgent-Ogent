import Ajv, { type ErrorObject } from "ajv";
import type { ChatMessage, ResponseFormatConfig } from "../types";
import type {
	RunStructuredStepOptions,
	StructuredOutputAttemptFailure,
	StructuredOutputFailure,
	StructuredOutputResult,
} from "./types";

const ajv = new Ajv({ allErrors: true, strict: false });

export async function runStructuredStep<TValue>(
	opts: RunStructuredStepOptions<TValue>,
): Promise<StructuredOutputResult<TValue>> {
	const validate = ajv.compile<TValue>(opts.schema.schema);
	let attemptMessages = [...opts.messages];
	let lastFailure: StructuredOutputAttemptFailure | null = null;

	for (let attempt = 0; attempt < 2; attempt++) {
		const rawText = await collectStructuredText(attemptMessages, opts);
		const parsed = parseJsonPayload(rawText);
		if (!parsed.ok) {
			lastFailure = { attempt, reason: parsed.reason, rawText };
		} else if (validate(parsed.value)) {
			return { ok: true, attempts: attempt + 1, rawText, value: parsed.value };
		} else {
			lastFailure = {
				attempt,
				reason: "Schema validation failed",
				rawText,
				validationErrors: formatErrors(validate.errors),
			};
		}

		if (attempt === 0 && lastFailure) {
			await opts.onRetry?.(lastFailure);
			attemptMessages = buildRepairMessages(opts.messages, rawText, opts.schema.name, lastFailure);
		}
	}

	return toFailure(lastFailure);
}

async function collectStructuredText(
	messages: ChatMessage[],
	opts: RunStructuredStepOptions<unknown>,
): Promise<string> {
	let output = "";
	for await (const event of opts.agent.run({
		messages,
		provider: opts.provider,
		signal: opts.signal,
		tools: opts.tools,
		consent: opts.consent,
		responseFormat: opts.provider.capabilities?.().jsonSchema === false
			? undefined
			: buildResponseFormat(opts.schema.name, opts.schema.schema),
	})) {
		await opts.onAgentEvent?.(event);
		if (event.kind === "text") output += event.text;
	}
	return output.trim();
}

function buildResponseFormat(schemaName: string, schema: RunStructuredStepOptions<unknown>["schema"]["schema"]): ResponseFormatConfig {
	return {
		type: "json_schema",
		json_schema: {
			name: schemaName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "structured_output",
			strict: true,
			schema,
		},
	};
}

function parseJsonPayload(rawText: string): { ok: true; value: unknown } | { ok: false; reason: string } {
	const candidates = [rawText, stripCodeFence(rawText)].filter((candidate, index, all) => candidate.length > 0 && all.indexOf(candidate) === index);
	for (const candidate of candidates) {
		try {
			return { ok: true, value: JSON.parse(candidate) };
		} catch {
			// keep trying
		}
	}
	return { ok: false, reason: "Model did not return valid JSON" };
}

function stripCodeFence(text: string): string {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	return fenced?.[1]?.trim() ?? text;
}

function buildRepairMessages(
	originalMessages: ChatMessage[],
	rawText: string,
	schemaName: string,
	failure: StructuredOutputAttemptFailure,
): ChatMessage[] {
	return [
		...originalMessages,
		{ role: "assistant", content: rawText },
		{
			role: "user",
			content:
				`Your previous response failed ${schemaName} validation.\n` +
				`Reason: ${failure.reason}\n` +
				`${failure.validationErrors?.length ? `Validation errors: ${failure.validationErrors.join("; ")}\n` : ""}` +
				"Return only valid JSON that satisfies the requested schema. Do not add markdown fences or commentary.",
		},
	];
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
	return (errors ?? []).map((error) => {
		const path = error.instancePath || "/";
		return `${path} ${error.message ?? "is invalid"}`.trim();
	});
}

function toFailure(failure: StructuredOutputAttemptFailure | null): StructuredOutputFailure {
	return {
		ok: false,
		attempts: 2,
		rawText: failure?.rawText ?? "",
		reason: failure?.reason ?? "Structured output failed",
		validationErrors: failure?.validationErrors,
	};
}
