import type { App } from "obsidian";
import { Agent, runPipeline } from "../agents";
import { claimsV1Schema, type ClaimsV1 } from "../agents/schemas/claims-v1";
import { formatRetrievedNotes, retrieveEvidence, type RetrievedNote } from "../agents/retrieval";
import { verifyClaims, type ClaimVerification } from "../agents/verifier";
import { OpenAICompatibleProvider, type OpenAICompatibleConfig } from "../provider";
import type { ModelProvider } from "../types";
import type { AgentPack } from "./types";
import { createAppVaultAdapter, type VaultAdapter } from "./vault-adapter";

export interface PackProgressStep {
	id: string;
	label: string;
	state: "pending" | "running" | "complete" | "failed";
	message?: string;
}

export interface PackModelsUsed {
	retriever: string;
	synthesizer: string;
	verifier: string;
}

export interface PackRunArtifacts {
	verifierEnabled: boolean;
	retrieval: { notes: RetrievedNote[]; brief: string } | null;
	draftClaims: ClaimsV1 | null;
	verifications: ClaimVerification[] | null;
}

export interface PackRunResult {
	packId: string;
	packName: string;
	verifiedSummary: string;
	claims: ClaimVerification[];
	modelsUsed: PackModelsUsed;
	artifacts: PackRunArtifacts;
}

export interface PackRuntimeEventStep {
	kind: "step";
	step: PackProgressStep;
}

export interface PackRuntimeEventRetry {
	kind: "structured_retry";
	stepId: string;
	attempt: number;
	maxAttempts: number;
	reason: string;
}

export type PackRuntimeEvent = PackRuntimeEventStep | PackRuntimeEventRetry;

export class PackConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PackConfigError";
	}
}

interface PackRunOptions {
	app?: App;
	vault?: VaultAdapter;
	pack: AgentPack;
	query: string;
	activeFilePath?: string | null;
	signal?: AbortSignal;
	onEvent?: (event: PackRuntimeEvent) => void | Promise<void>;
	verifierEnabled?: boolean;
	providerFactory?: (config: OpenAICompatibleConfig, agentId: string, pack: AgentPack) => ModelProvider;
}

interface GroundedResearchContext {
	query: string;
	activeFilePath?: string | null;
	pack: AgentPack;
	retrieval?: { notes: RetrievedNote[]; brief: string };
	claims?: ClaimsV1;
	verifications?: ClaimVerification[];
}

export async function runPack(opts: PackRunOptions): Promise<PackRunResult> {
	return runPackForEval({ ...opts, verifierEnabled: true });
}

export async function runPackForEval(opts: PackRunOptions): Promise<PackRunResult> {
	const providers = buildProviders(opts.pack, opts.providerFactory);
	const vault = resolveVault(opts);
	const verifierEnabled = opts.verifierEnabled ?? true;
	const retrieverStep = opts.pack.steps.find((step) => step.id === "retriever");
	const synthesizerStep = opts.pack.steps.find((step) => step.id === "synthesizer");
	const verifierStep = opts.pack.steps.find((step) => step.id === "verifier");
	if (!retrieverStep || !synthesizerStep || !verifierStep) {
		throw new PackConfigError(`Pack ${opts.pack.id} must declare retriever, synthesizer, and verifier steps`);
	}

	const retrieverAgent = buildAgent(opts.pack, retrieverStep.agent);
	const synthesizerAgent = buildAgent(opts.pack, synthesizerStep.agent);
	const verifierAgent = buildAgent(opts.pack, verifierStep.agent);

	const steps = [
		{
			id: retrieverStep.id,
			label: retrieverStep.label,
			run: async (context: GroundedResearchContext) => {
				const retrieval = await retrieveEvidence(vault, context.query, context.activeFilePath);
				const brief = await collectBrief(
					retrieverAgent,
					providers[retrieverStep.agent],
					context.query,
					retrieval.notes,
					opts.signal,
				);
				return { notes: retrieval.notes, brief };
			},
			apply: async (context: GroundedResearchContext, output: unknown) => ({
				...context,
				retrieval: output as { notes: RetrievedNote[]; brief: string },
			}),
		},
		{
			id: synthesizerStep.id,
			label: synthesizerStep.label,
			kind: "structured" as const,
			prepare: async (context: GroundedResearchContext) => {
				if (!context.retrieval) throw new PackConfigError("Retriever step did not produce evidence");
				return {
					agent: synthesizerAgent,
					provider: providers[synthesizerStep.agent].provider,
					signal: opts.signal,
					schema: claimsV1Schema,
					messages: [
						{
							role: "user" as const,
							content:
								"Answer the research question using only the retrieved Obsidian notes.\n" +
								"Return JSON matching the requested schema.\n\n" +
								`Question: ${context.query}\n\n` +
								`Retriever brief:\n${context.retrieval.brief}\n\n` +
								`Retrieved notes:\n${formatRetrievedNotes(context.retrieval.notes)}`,
						},
					],
				};
			},
			apply: async (context: GroundedResearchContext, output: unknown) => ({
				...context,
				claims: output as ClaimsV1,
			}),
		},
		...(verifierEnabled
			? [
				{
					id: verifierStep.id,
					label: verifierStep.label,
					run: async (context: GroundedResearchContext) => {
						if (!context.claims) throw new PackConfigError("Synthesizer step did not produce claims");
						return verifyClaims({
							vault,
							claims: context.claims,
							agent: verifierAgent,
							provider: providers[verifierStep.agent].provider,
							signal: opts.signal,
						});
					},
					apply: async (context: GroundedResearchContext, output: unknown) => ({
						...context,
						verifications: output as ClaimVerification[],
					}),
				},
			]
			: []),
	];

	const pipeline = await runPipeline<GroundedResearchContext>({
		initialContext: {
			query: opts.query,
			activeFilePath: opts.activeFilePath,
			pack: opts.pack,
		},
		steps,
		onEvent: async (event) => {
			if (event.kind === "step") {
				await opts.onEvent?.({
					kind: "step",
					step: {
						id: event.stepId,
						label: event.label,
						state: event.state,
						message: event.message,
					},
				});
				return;
			}
			await opts.onEvent?.({
				kind: "structured_retry",
				stepId: event.stepId,
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				reason: event.reason,
			});
		},
	});

	if (!pipeline.ok) {
		if (pipeline.error instanceof Error) throw pipeline.error;
		throw new Error(pipeline.error.reason);
	}

	const claims = verifierEnabled ? (pipeline.context.verifications ?? []) : [];
	const verifiedClaims = claims.filter((claim) => claim.status === "verified");
	const verifiedSummary = verifierEnabled
		? verifiedClaims.map((claim) => `- ${claim.text}`).join("\n")
		: (pipeline.context.claims?.summary ?? "");

	return {
		packId: opts.pack.id,
		packName: opts.pack.name,
		verifiedSummary,
		claims,
		modelsUsed: {
			retriever: providers[retrieverStep.agent].config.model,
			synthesizer: providers[synthesizerStep.agent].config.model,
			verifier: providers[verifierStep.agent].config.model,
		},
		artifacts: {
			verifierEnabled,
			retrieval: pipeline.context.retrieval ?? null,
			draftClaims: pipeline.context.claims ?? null,
			verifications: pipeline.context.verifications ?? null,
		},
	};
}

function buildProviders(
	pack: AgentPack,
	providerFactory?: (config: OpenAICompatibleConfig, agentId: string, pack: AgentPack) => ModelProvider,
): Record<string, { config: { model: string }; provider: ModelProvider }> {
	const byAgent: Record<string, { config: { model: string }; provider: ModelProvider }> = {};
	for (const [agentId, agent] of Object.entries(pack.agents)) {
		const providerConfig = pack.providers[agent.provider];
		if (!providerConfig) {
			throw new PackConfigError(`Pack ${pack.id} is missing provider ${agent.provider} for agent ${agentId}`);
		}
		if (!providerConfig.baseUrl.trim() || !providerConfig.apiKey.trim() || !providerConfig.model.trim()) {
			throw new PackConfigError(`Pack ${pack.id} provider ${agent.provider} must declare baseUrl, apiKey, and model`);
		}
		if (isPlaceholderApiKey(providerConfig.apiKey)) {
			throw new PackConfigError(
				`Pack ${pack.id} provider ${agent.provider} still uses the placeholder API key "replace-me"`,
			);
		}
		byAgent[agentId] = {
			config: { model: providerConfig.model },
			provider: providerFactory ? providerFactory(providerConfig, agentId, pack) : new OpenAICompatibleProvider(providerConfig),
		};
	}
	return byAgent;
}

function resolveVault(opts: PackRunOptions): VaultAdapter {
	if (opts.vault) return opts.vault;
	if (opts.app) return createAppVaultAdapter(opts.app);
	throw new PackConfigError("Pack runtime requires an Obsidian app or vault adapter");
}

function buildAgent(pack: AgentPack, agentId: string): Agent {
	const config = pack.agents[agentId];
	if (!config) throw new PackConfigError(`Pack ${pack.id} is missing agent ${agentId}`);
	return new Agent({
		id: agentId,
		name: config.name,
		systemPrompt: config.systemPrompt,
		toolAllowlist: config.toolAllowlist,
	});
}

async function collectBrief(
	agent: Agent,
	boundProvider: { provider: ModelProvider },
	query: string,
	notes: RetrievedNote[],
	signal?: AbortSignal,
): Promise<string> {
	let text = "";
	for await (const event of agent.run({
		messages: [
			{
				role: "user",
				content:
					"Summarize the strongest note evidence for the user question. Cite note paths inline. Use concise bullets.\n\n" +
					`Question: ${query}\n\n` +
					`Notes:\n${formatRetrievedNotes(notes)}`,
			},
		],
		provider: boundProvider.provider,
		signal,
	})) {
		if (event.kind === "text") text += event.text;
	}
	return text.trim();
}

function isPlaceholderApiKey(apiKey: string): boolean {
	return apiKey.trim().toLowerCase() === "replace-me";
}
