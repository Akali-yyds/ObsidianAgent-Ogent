import type { JsonSchema } from "../types";
import type { OpenAICompatibleConfig } from "../provider";

export type PackStepKind = "retrieval" | "structured" | "verification";

export interface PackSupport {
	mobile: boolean;
}

export interface PackAgentDefinition {
	name: string;
	provider: string;
	systemPrompt: string;
	toolAllowlist?: string[];
}

export interface PackStep {
	id: string;
	label: string;
	agent: string;
	kind: PackStepKind;
	schema?: "claims-v1";
}

export interface AgentPack {
	id: string;
	name: string;
	description: string;
	support: PackSupport;
	providers: Record<string, OpenAICompatibleConfig>;
	agents: Record<string, PackAgentDefinition>;
	steps: PackStep[];
}

export const agentPackSchema: JsonSchema = {
	type: "object",
	properties: {
		id: { type: "string", minLength: 1 },
		name: { type: "string", minLength: 1 },
		description: { type: "string", minLength: 1 },
		support: {
			type: "object",
			properties: {
				mobile: { type: "boolean" },
			},
			required: ["mobile"],
			additionalProperties: false,
		},
		providers: {
			type: "object",
			properties: {},
			required: [],
			additionalProperties: true,
		},
		agents: {
			type: "object",
			properties: {},
			required: [],
			additionalProperties: true,
		},
		steps: {
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string", minLength: 1 },
					label: { type: "string", minLength: 1 },
					agent: { type: "string", minLength: 1 },
					kind: {
						type: "string",
						enum: ["retrieval", "structured", "verification"],
					},
					schema: { type: "string", enum: ["claims-v1"] },
				},
				required: ["id", "label", "agent", "kind"],
				additionalProperties: false,
			},
		},
	},
	required: ["id", "name", "description", "support", "providers", "agents", "steps"],
	additionalProperties: false,
};
