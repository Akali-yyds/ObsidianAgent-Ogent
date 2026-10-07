import type { JsonSchema, JsonSchemaProperty } from "../types";

export type ValidationResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

export function validateArgs(args: unknown, schema: JsonSchema): ValidationResult {
	const result = validateNode(args, schema, "");
	return result.ok ? { ok: true, value: args as Record<string, unknown> } : result;
}

function validateNode(value: unknown, schema: JsonSchema | JsonSchemaProperty, path: string): ValidationResult {
	if (schema.oneOf) {
		const results = schema.oneOf.map((candidate) => validateNode(value, candidate, path));
		const matches = results.filter((result) => result.ok);
		if (matches.length !== 1) {
			const discriminatorIndex = schema.oneOf.findIndex((candidate) => matchesCommandDiscriminator(value, candidate));
			const discriminatorResult = discriminatorIndex >= 0 ? results[discriminatorIndex] : undefined;
			if (discriminatorResult && !discriminatorResult.ok) return discriminatorResult;
			return { ok: false, error: `field '${path}' must match exactly one supported command shape` };
		}
	}

	const t = schema.type;
	const propertySchema = schema as JsonSchemaProperty;
	const actualType = jsType(value);

	if (t === "integer") {
		if (typeof value !== "number" || !Number.isInteger(value)) {
			return { ok: false, error: `field '${path}' expected integer, got ${actualType}` };
		}
	} else if (t === "array") {
		if (!Array.isArray(value)) return { ok: false, error: `field '${path}' expected array, got ${actualType}` };
		if (schema.items) {
			for (let i = 0; i < value.length; i++) {
				const r = validateNode(value[i], schema.items, `${path}[${i}]`);
				if (!r.ok) return r;
			}
		}
	} else if (t === "object") {
		if (actualType !== "object") {
			return { ok: false, error: `field '${path}' expected object, got ${actualType}` };
		}
		if (schema.properties) {
			const obj = value as Record<string, unknown>;
			if (schema.additionalProperties === false) {
				for (const key of Object.keys(obj)) {
					if (!hasOwn(schema.properties, key)) return { ok: false, error: `unknown field '${childPath(path, key)}'` };
				}
			}
			for (const k of schema.required ?? []) {
				if (!hasOwn(obj, k)) return { ok: false, error: `field '${childPath(path, k)}' is required` };
			}
			for (const [k, v] of Object.entries(obj)) {
				const sub = schema.properties[k];
				if (!hasOwn(schema.properties, k)) continue;
				const r = validateNode(v, sub, childPath(path, k));
				if (!r.ok) return r;
			}
		}
	} else {
		if (actualType !== t) return { ok: false, error: `field '${path}' expected ${t}, got ${actualType}` };
	}

	if (propertySchema.enum && !propertySchema.enum.includes(value)) {
		return { ok: false, error: `field '${path}' must be one of ${JSON.stringify(propertySchema.enum)}` };
	}

	if (typeof value === "number") {
		if (propertySchema.minimum !== undefined && value < propertySchema.minimum) {
			return { ok: false, error: `field '${path}' must be >= ${propertySchema.minimum}` };
		}
		if (propertySchema.maximum !== undefined && value > propertySchema.maximum) {
			return { ok: false, error: `field '${path}' must be <= ${propertySchema.maximum}` };
		}
	}
	if (typeof value === "string") {
		if (propertySchema.minLength !== undefined && value.length < propertySchema.minLength) {
			return { ok: false, error: `field '${path}' must be at least ${propertySchema.minLength} chars` };
		}
		if (propertySchema.maxLength !== undefined && value.length > propertySchema.maxLength) {
			return { ok: false, error: `field '${path}' must be at most ${propertySchema.maxLength} chars` };
		}
	}

	return { ok: true, value: value as Record<string, unknown> };
}

function jsType(v: unknown): string {
	if (v === null) return "null";
	if (Array.isArray(v)) return "array";
	return typeof v;
}

function hasOwn(value: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function childPath(parent: string, key: string): string {
	return parent ? `${parent}.${key}` : key;
}

function matchesCommandDiscriminator(value: unknown, schema: JsonSchema | JsonSchemaProperty): boolean {
	if (typeof value !== "object" || value === null || Array.isArray(value) || schema.type !== "object" || !schema.properties) return false;
	const object = value as Record<string, unknown>;
	for (const key of ["domain", "action"]) {
		const property = schema.properties[key];
		if (!property?.enum || !property.enum.includes(object[key])) return false;
	}
	return true;
}
