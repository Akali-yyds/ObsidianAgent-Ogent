import { describe, expect, it } from "vitest";
import { validateArgs } from "../src/tools/validate";

describe("tool argument validation", () => {
	it("rejects unknown top-level fields when the schema is closed", () => {
		const result = validateArgs(
			{ path: "Notes/a.md", extra: true },
			{
				type: "object",
				properties: { path: { type: "string" } },
				additionalProperties: false,
			},
		);

		expect(result).toEqual({ ok: false, error: "unknown field 'extra'" });
	});

	it("rejects unknown nested fields when the nested schema is closed", () => {
		const result = validateArgs(
			{ scope: { folder: "Notes", unexpected: "value" } },
			{
				type: "object",
				properties: {
					scope: {
						type: "object",
						properties: { folder: { type: "string" } },
						additionalProperties: false,
					},
				},
			},
		);

		expect(result).toEqual({ ok: false, error: "unknown field 'scope.unexpected'" });
	});

	it("does not treat prototype names as schema properties", () => {
		const args = JSON.parse('{"__proto__":"unexpected"}') as Record<string, unknown>;
		const result = validateArgs(args, {
			type: "object",
			properties: {},
			additionalProperties: false,
		});

		expect(result).toEqual({ ok: false, error: "unknown field '__proto__'" });
	});
});
