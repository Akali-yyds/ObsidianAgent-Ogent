import type { App } from "obsidian";
import { Agent, runPipeline } from "../agents";
import { claimsV1Schema, type ClaimsV1 } from "../agents/schemas/claims-v1";
import { formatRetrievedNotes, retrieveEvidence, type RetrievedNote } from "../agents/retrieval";
import { verifyClaims, type ClaimVerification } from "../agents/verifier";
import type { OpenAICompatibleConfig } from "../provider-config";
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

type PackRunStepId = "retriever" | "synthesizer" | "verifier";
type PackTransparencyCardState = "pending" | "ready" | "absent";

export type PackRunState = "running" | "completed" | "failed" | "stopped";

export interface PackRunRetrieverTransparency {
	status: PackTransparencyCardState;
	elapsedMs?: number;
	notesFoundCount?: number;
	topNotePaths?: string[];
	brief?: string;
}

export interface PackRunSynthesizerTransparency {
	status: PackTransparencyCardState;
	elapsedMs?: number;
	claimCount?: number;
	summary?: string;
	rawJson?: ClaimsV1;
}

export interface PackRunVerifierReason {
	claimId: string;
	claimText: string;
	sourceNote: string;
	status: ClaimVerification["status"];
	explanation: string;
}

export interface PackRunVerifierTransparency {
	status: PackTransparencyCardState;
	elapsedMs?: number;
	counts?: {
		verified: number;
		unsupported: number;
		quoteMissing: number;
	};
	reasons?: PackRunVerifierReason[];
}

export interface PackRunTransparency {
	retriever: PackRunRetrieverTransparency;
	synthesizer: PackRunSynthesizerTransparency;
	verifier: PackRunVerifierTransparency;
	run: {
		state: PackRunState;
		elapsedMs: number;
		stepElapsedMs: Partial<Record<PackRunStepId, number>>;
		failedStepId?: PackRunStepId;
	};
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
	transparency: PackRunTransparency;
}

export interface PackRunFailure {
	packId: string;
	packName: string;
	failedStepId: PackRunStepId;
	modelsUsed: PackModelsUsed;
	artifacts: PackRunArtifacts;
	transparency: PackRunTransparency;
}

export interface PackRuntimeEventStep {
	kind: "step";
	step: PackProgressStep;
	agentWork?: PackRunTransparency;
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

export class PackRunError extends Error {
	readonly failure: PackRunFailure;

	constructor(message: string, failure: PackRunFailure, cause?: unknown) {
		super(message);
		this.name = "PackRunError";
		this.failure = failure;
		if (cause !== undefined) this.cause = cause;
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
	const providers = await buildProviders(opts.pack, opts.providerFactory);
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
	const modelsUsed: PackModelsUsed = {
		retriever: providers[retrieverStep.agent].config.model,
		synthesizer: providers[synthesizerStep.agent].config.model,
		verifier: providers[verifierStep.agent].config.model,
	};
	let latestContext: GroundedResearchContext = {
		query: opts.query,
		activeFilePath: opts.activeFilePath,
		pack: opts.pack,
	};
	const runStartedAt = Date.now();
	const lastStepId: PackRunStepId = verifierEnabled ? "verifier" : "synthesizer";
	const stepStartedAt: Partial<Record<PackRunStepId, number>> = {};
	const stepElapsedMs: Partial<Record<PackRunStepId, number>> = {};
	let terminalAt: number | null = null;
	let failedStepId: PackRunStepId | null = null;

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
			apply: async (context: GroundedResearchContext, output: unknown) => {
				const nextContext = {
					...context,
					retrieval: output as { notes: RetrievedNote[]; brief: string },
				};
				latestContext = nextContext;
				return nextContext;
			},
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
			apply: async (context: GroundedResearchContext, output: unknown) => {
				const nextContext = {
					...context,
					claims: output as ClaimsV1,
				};
				latestContext = nextContext;
				return nextContext;
			},
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
					apply: async (context: GroundedResearchContext, output: unknown) => {
						const nextContext = {
							...context,
							verifications: output as ClaimVerification[],
						};
						latestContext = nextContext;
						return nextContext;
					},
				},
			]
			: []),
	];

	const buildArtifacts = (): PackRunArtifacts => ({
		verifierEnabled,
		retrieval: latestContext.retrieval ?? null,
		draftClaims: latestContext.claims ?? null,
		verifications: latestContext.verifications ?? null,
	});

	const buildTransparency = (runState: PackRunState, referenceTime: number): PackRunTransparency => {
		const verifications = latestContext.verifications ?? null;
		return {
			retriever: buildRetrieverTransparency(latestContext.retrieval ?? null, runState, stepElapsedMs.retriever),
			synthesizer: buildSynthesizerTransparency(latestContext.claims ?? null, runState, stepElapsedMs.synthesizer),
			verifier: buildVerifierTransparency(verifications, runState, stepElapsedMs.verifier),
			run: {
				state: runState,
				elapsedMs: Math.max(0, referenceTime - runStartedAt),
				stepElapsedMs: { ...stepElapsedMs },
				...(failedStepId ? { failedStepId } : {}),
			},
		};
	};

	const pipeline = await runPipeline<GroundedResearchContext>({
		initialContext: latestContext,
		steps,
		onEvent: async (event) => {
			if (event.kind === "step") {
				let agentWork: PackRunTransparency | undefined;
				if (isPackRunStepId(event.stepId)) {
					if (event.state === "running") {
						stepStartedAt[event.stepId] = Date.now();
					}
					if (event.state === "complete" || event.state === "failed") {
						const endedAt = Date.now();
						const startedAt = stepStartedAt[event.stepId];
						if (typeof startedAt === "number") {
							stepElapsedMs[event.stepId] = Math.max(0, endedAt - startedAt);
						}
						terminalAt = endedAt;
						if (event.state === "failed") failedStepId = event.stepId;
						agentWork = buildTransparency(
							event.state === "failed" ? "failed" : event.stepId === lastStepId ? "completed" : "running",
							endedAt,
						);
					}
				}
				await opts.onEvent?.({
					kind: "step",
					step: {
						id: event.stepId,
						label: event.label,
						state: event.state,
						message: event.message,
					},
					...(agentWork ? { agentWork } : {}),
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
		if (isPackRunStepId(pipeline.failedStepId) && failedStepId === null) {
			failedStepId = pipeline.failedStepId;
		}
		if (isPackRunStepId(pipeline.failedStepId) && stepElapsedMs[pipeline.failedStepId] === undefined) {
			const startedAt = stepStartedAt[pipeline.failedStepId];
			if (typeof startedAt === "number") {
				const endedAt = terminalAt ?? Date.now();
				stepElapsedMs[pipeline.failedStepId] = Math.max(0, endedAt - startedAt);
				terminalAt = endedAt;
			}
		}
		const message = pipeline.error instanceof Error ? pipeline.error.message : pipeline.error.reason;
		const runState = isAbortError(pipeline.error, opts.signal) ? "stopped" : "failed";
		const failure: PackRunFailure = {
			packId: opts.pack.id,
			packName: opts.pack.name,
			failedStepId: failedStepId ?? "verifier",
			modelsUsed,
			artifacts: buildArtifacts(),
			transparency: buildTransparency(runState, terminalAt ?? Date.now()),
		};
		throw new PackRunError(message, failure, pipeline.error);
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
		modelsUsed,
		artifacts: buildArtifacts(),
		transparency: buildTransparency("completed", terminalAt ?? Date.now()),
	};
}

async function buildProviders(
	pack: AgentPack,
	providerFactory?: (config: OpenAICompatibleConfig, agentId: string, pack: AgentPack) => ModelProvider,
): Promise<Record<string, { config: { model: string }; provider: ModelProvider }>> {
	const byAgent: Record<string, { config: { model: string }; provider: ModelProvider }> = {};
	let resolvedProviderFactory = providerFactory;
	if (!resolvedProviderFactory) {
		const { OpenAICompatibleProvider } = await import("../provider");
		resolvedProviderFactory = (config) => new OpenAICompatibleProvider(config);
	}
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
			provider: resolvedProviderFactory(providerConfig, agentId, pack),
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

function buildRetrieverTransparency(
	retrieval: { notes: RetrievedNote[]; brief: string } | null,
	runState: PackRunState,
	elapsedMs?: number,
): PackRunRetrieverTransparency {
	if (!retrieval) {
		return buildMissingTransparency(runState, elapsedMs);
	}
	return {
		status: "ready",
		...(elapsedMs !== undefined ? { elapsedMs } : {}),
		notesFoundCount: retrieval.notes.length,
		topNotePaths: retrieval.notes.slice(0, 3).map((note) => note.path),
		brief: retrieval.brief,
	};
}

function buildSynthesizerTransparency(
	claims: ClaimsV1 | null,
	runState: PackRunState,
	elapsedMs?: number,
): PackRunSynthesizerTransparency {
	if (!claims) {
		return buildMissingTransparency(runState, elapsedMs);
	}
	return {
		status: "ready",
		...(elapsedMs !== undefined ? { elapsedMs } : {}),
		claimCount: claims.claims.length,
		summary: claims.summary,
		rawJson: claims,
	};
}

function buildVerifierTransparency(
	verifications: ClaimVerification[] | null,
	runState: PackRunState,
	elapsedMs?: number,
): PackRunVerifierTransparency {
	if (!verifications) {
		return buildMissingTransparency(runState, elapsedMs);
	}
	return {
		status: "ready",
		...(elapsedMs !== undefined ? { elapsedMs } : {}),
		counts: {
			verified: verifications.filter((claim) => claim.status === "verified").length,
			unsupported: verifications.filter((claim) => claim.status === "unsupported").length,
			quoteMissing: verifications.filter((claim) => claim.status === "quote-missing").length,
		},
		reasons: verifications.map((claim) => ({
			claimId: claim.id,
			claimText: claim.text,
			sourceNote: claim.sourceNote,
			status: claim.status,
			explanation: claim.supportExplanation,
		})),
	};
}

function buildMissingTransparency<T extends { status: PackTransparencyCardState; elapsedMs?: number }>(
	runState: PackRunState,
	elapsedMs?: number,
): T {
	return {
		status: runState === "running" ? "pending" : "absent",
		...(elapsedMs !== undefined ? { elapsedMs } : {}),
	} as T;
}

function isPackRunStepId(stepId: string): stepId is PackRunStepId {
	return stepId === "retriever" || stepId === "synthesizer" || stepId === "verifier";
}

function isAbortError(error: Error | { reason: string }, signal?: AbortSignal): boolean {
	if (signal?.aborted) return true;
	return error instanceof Error && error.name === "AbortError";
}
