import type { ClaimsV1 } from "./schemas/claims-v1";
import { resolveQuoteMatch } from "./quote-match";
import type { Agent } from "./agent";
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

const verifierDecisionSchema = {
	name: "verifier-support-v1",
	schema: {
		type: "object",
		properties: {
			supports_claim: { type: "boolean" },
			explanation: { type: "string", minLength: 1 },
		},
		required: ["supports_claim", "explanation"],
		additionalProperties: false,
	},
} as const;

export async function verifyClaims(opts: VerifyClaimsOptions): Promise<ClaimVerification[]> {
	const verifications: ClaimVerification[] = [];

	for (const claim of opts.claims.claims) {
		const file = opts.vault.getFile(claim.source_note);
		if (!file) {
			verifications.push({
				id: claim.id,
				text: claim.text,
				sourceNote: claim.source_note,
				sourceQuote: claim.source_quote,
				quotePresent: false,
				supportsClaim: null,
				supportExplanation: "Quoted text not found in the live note.",
				status: "quote-missing",
			});
			continue;
		}

		const body = await opts.vault.read(file);
		const quoteResolution = resolveQuoteMatch(body, claim.source_quote);
		if (quoteResolution.kind === "missing") {
			verifications.push({
				id: claim.id,
				text: claim.text,
				sourceNote: claim.source_note,
				sourceQuote: claim.source_quote,
				quotePresent: false,
				supportsClaim: null,
				supportExplanation: "Quoted text not found in the live note.",
				status: "quote-missing",
			});
			continue;
		}

		const result = await runStructuredStep<{
			supports_claim: boolean;
			explanation: string;
		}>({
			agent: opts.agent,
			provider: opts.provider,
			signal: opts.signal,
			schema: verifierDecisionSchema,
			messages: [
				{
					role: "user",
					content:
						"Determine whether the quoted note text supports the claim.\n" +
						"Return JSON with supports_claim and explanation.\n\n" +
						`Claim: ${claim.text}\n\n` +
						`Quoted text: ${claim.source_quote}\n\n` +
						`Note excerpt:\n${body.slice(0, 3500)}`,
				},
			],
		});
		if (!result.ok) {
			throw new Error(`Verifier failed for claim ${claim.id}: ${result.reason}`);
		}

		verifications.push({
			id: claim.id,
			text: claim.text,
			sourceNote: claim.source_note,
			sourceQuote: claim.source_quote,
			quotePresent: true,
			supportsClaim: result.value.supports_claim,
			supportExplanation: result.value.explanation,
			status: result.value.supports_claim ? "verified" : "unsupported",
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
		});
	}

	return verifications;
}
