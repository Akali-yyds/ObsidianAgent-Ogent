import type { ClaimsV1 } from "./schemas/claims-v1";
import { resolveQuoteMatch } from "./quote-match";
import type { Agent } from "./agent";
import type { StructuredOutputSchema } from "./types";
import { runStructuredStep } from "./structured-output";
import type { ModelProvider } from "../types";
import type { VaultAdapter } from "../packs/vault-adapter";

export type ClaimVerificationStatus = "verified" | "unsupported" | "quote-missing";

export interface ExactPhraseAnchor {
	notePath: string;
	exactPhrase: string;
	startOffset: number;
	endOffset: number;
	occurrenceIndex: number;
}

export interface ClaimVerification {
	id: string;
	text: string;
	sourceNote: string;
	sourceQuote: string;
	quotePresent: boolean;
	supportsClaim: boolean | null;
	supportExplanation: string;
	status: ClaimVerificationStatus;
	exactPhraseAnchor?: ExactPhraseAnchor;
}

interface VerifyClaimsOptions {
	vault: VaultAdapter;
	claims: ClaimsV1;
	agent: Agent;
	provider: ModelProvider;
	signal?: AbortSignal;
}

const verifierDecisionSchema: StructuredOutputSchema<{
	decisions: Array<{
		claim_id: string;
		supports_claim: boolean;
		explanation: string;
	}>;
}> = {
	name: "verifier-support-batch-v1",
	schema: {
		type: "object",
		properties: {
			decisions: {
				type: "array",
				items: {
					type: "object",
					properties: {
						claim_id: { type: "string", minLength: 1 },
						supports_claim: { type: "boolean" },
						explanation: { type: "string", minLength: 1 },
					},
					required: ["claim_id", "supports_claim", "explanation"],
					additionalProperties: false,
				},
			},
		},
		required: ["decisions"],
		additionalProperties: false,
	},
};

export async function verifyClaims(opts: VerifyClaimsOptions): Promise<ClaimVerification[]> {
	const verifications = new Array<ClaimVerification | null>(opts.claims.claims.length).fill(null);
	const pendingClaims: Array<{
		index: number;
		claim: ClaimsV1["claims"][number];
		quoteResolution: ReturnType<typeof resolveQuoteMatch>;
		body: string;
	}> = [];

	for (const [index, claim] of opts.claims.claims.entries()) {
		const file = opts.vault.getFile(claim.source_note);
		if (!file) {
			verifications[index] = {
				id: claim.id,
				text: claim.text,
				sourceNote: claim.source_note,
				sourceQuote: claim.source_quote,
				quotePresent: false,
				supportsClaim: null,
				supportExplanation: "Quoted text not found in the live note.",
				status: "quote-missing",
			};
			continue;
		}

		const body = await opts.vault.read(file);
		const quoteResolution = resolveQuoteMatch(body, claim.source_quote);
		if (quoteResolution.kind === "missing") {
			verifications[index] = {
				id: claim.id,
				text: claim.text,
				sourceNote: claim.source_note,
				sourceQuote: claim.source_quote,
				quotePresent: false,
				supportsClaim: null,
				supportExplanation: "Quoted text not found in the live note.",
				status: "quote-missing",
			};
			continue;
		}

		pendingClaims.push({ index, claim, quoteResolution, body });
	}

	if (pendingClaims.length === 0) {
		return verifications.filter((value): value is ClaimVerification => value !== null);
	}

	const result = await runStructuredStep<{
		decisions: Array<{
			claim_id: string;
			supports_claim: boolean;
			explanation: string;
		}>;
	}>({
			agent: opts.agent,
			provider: opts.provider,
			signal: opts.signal,
			schema: verifierDecisionSchema,
			messages: [
				{
					role: "user",
					content:
						"Determine whether each quoted note text supports its claim.\n" +
						"Return JSON with a decisions array. Each decision must include claim_id, supports_claim, and explanation.\n\n" +
						`Claims:\n${JSON.stringify(
							pendingClaims.map(({ claim, body }) => ({
								claim_id: claim.id,
								claim: claim.text,
								quoted_text: claim.source_quote,
								note_excerpt: body.slice(0, 2000),
							})),
							null,
							2,
						)}`,
				},
			],
		});
	if (!result.ok) {
		throw new Error(`Verifier failed: ${result.reason}`);
	}

	const decisionsById = new Map(
		result.value.decisions.map((decision) => [
			decision.claim_id,
			{
				supportsClaim: decision.supports_claim,
				supportExplanation: decision.explanation,
			},
		]),
	);

	for (const { index, claim, quoteResolution } of pendingClaims) {
		const decision = decisionsById.get(claim.id);
		if (!decision) {
			throw new Error(`Verifier failed for claim ${claim.id}: missing decision in batch response`);
		}

		verifications[index] = {
			id: claim.id,
			text: claim.text,
			sourceNote: claim.source_note,
			sourceQuote: claim.source_quote,
			quotePresent: true,
			supportsClaim: decision.supportsClaim,
			supportExplanation: decision.supportExplanation,
			status: decision.supportsClaim ? "verified" : "unsupported",
			...(quoteResolution.kind === "exact"
				? {
					exactPhraseAnchor: {
						notePath: claim.source_note,
						exactPhrase: quoteResolution.exactPhrase,
						startOffset: quoteResolution.startOffset,
						endOffset: quoteResolution.endOffset,
						occurrenceIndex: quoteResolution.occurrenceIndex,
					},
				}
				: {}),
		};
	}

	return verifications.filter((value): value is ClaimVerification => value !== null);
}
