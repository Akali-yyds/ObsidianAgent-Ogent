import type { JsonSchema } from "../../types";
import type { StructuredOutputSchema } from "../types";

export interface ClaimRecord {
	id: string;
	text: string;
	source_note: string;
	source_quote: string;
	confidence?: number;
}

export interface ClaimsV1 {
	summary: string;
	claims: ClaimRecord[];
}

export const claimsV1Schema: StructuredOutputSchema<ClaimsV1> = {
	name: "claims-v1",
	schema: {
		type: "object",
		properties: {
			summary: { type: "string", minLength: 1 },
			claims: {
				type: "array",
				items: {
					type: "object",
					properties: {
						id: { type: "string", minLength: 1 },
						text: { type: "string", minLength: 1 },
						source_note: { type: "string", minLength: 1 },
						source_quote: { type: "string", minLength: 1 },
						confidence: { type: "number", minimum: 0, maximum: 1 },
					},
					required: ["id", "text", "source_note", "source_quote"],
					additionalProperties: false,
				},
			},
		},
		required: ["summary", "claims"],
		additionalProperties: false,
	} as JsonSchema,
};
