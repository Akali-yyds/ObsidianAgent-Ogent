import type { ClaimVerification, ExactPhraseAnchor } from "./agents/verifier";

export interface ComposedResearchCitation extends ExactPhraseAnchor {
	claimId: string;
}

export interface ComposedResearchResult {
	researchMarkdown: string;
	citations: ComposedResearchCitation[];
}

export type CitationTargetResolution =
	| ({ kind: "resolved"; matchType: "stored-offsets" | "relocated" } & ExactPhraseAnchor)
	| {
			kind: "fallback";
			reason: "unresolved";
			message: typeof CITATION_TARGET_FALLBACK_MESSAGE;
	  };

export const CITATION_TARGET_FALLBACK_MESSAGE = "Citation target no longer matches the live note.";

export function composeResearchResult(claims: ClaimVerification[]): ComposedResearchResult | null {
	const citations: ComposedResearchCitation[] = [];
	const labels = new Map<string, number>();
	const paragraphs: string[] = [];

	for (const claim of claims) {
		const anchor = getCitationEligibleAnchor(claim);
		if (!anchor) continue;

		const key = getCitationKey(anchor);
		let label = labels.get(key);
		if (label === undefined) {
			label = citations.length + 1;
			labels.set(key, label);
			citations.push({
				claimId: claim.id,
				...anchor,
			});
		}

		const text = claim.text.trim();
		if (!text) continue;
		paragraphs.push(`${text} [${label}](openagent://citation/${label})`);
	}

	if (paragraphs.length === 0 || citations.length === 0) return null;

	return {
		researchMarkdown: paragraphs.join("\n\n"),
		citations,
	};
}

export function resolveCitationTarget(anchor: ExactPhraseAnchor, noteBody: string): CitationTargetResolution {
	const storedTarget = resolveStoredOffsets(anchor, noteBody);
	if (storedTarget) return storedTarget;

	const relocatedTarget = relocateCitationTarget(anchor, noteBody);
	if (relocatedTarget) return relocatedTarget;

	return {
		kind: "fallback",
		reason: "unresolved",
		message: CITATION_TARGET_FALLBACK_MESSAGE,
	};
}

function getCitationEligibleAnchor(claim: ClaimVerification): ExactPhraseAnchor | null {
	if (claim.status !== "verified" || claim.supportsClaim !== true || claim.quotePresent !== true) return null;
	const anchor = claim.exactPhraseAnchor;
	if (!anchor) return null;
	if (
		!anchor.notePath.trim() ||
		!anchor.exactPhrase ||
		anchor.startOffset < 0 ||
		anchor.endOffset < anchor.startOffset ||
		anchor.occurrenceIndex < 0
	) {
		return null;
	}
	return anchor;
}

function getCitationKey(anchor: ExactPhraseAnchor): string {
	return `${anchor.notePath}\u0000${anchor.exactPhrase}\u0000${anchor.occurrenceIndex}`;
}

function resolveStoredOffsets(
	anchor: ExactPhraseAnchor,
	noteBody: string,
): ({ kind: "resolved"; matchType: "stored-offsets" } & ExactPhraseAnchor) | null {
	if (!Number.isInteger(anchor.startOffset) || !Number.isInteger(anchor.endOffset) || !Number.isInteger(anchor.occurrenceIndex)) {
		return null;
	}
	if (anchor.startOffset < 0 || anchor.endOffset < anchor.startOffset || anchor.endOffset > noteBody.length) return null;
	if (noteBody.slice(anchor.startOffset, anchor.endOffset) !== anchor.exactPhrase) return null;
	if (getOccurrenceIndexAtOffset(noteBody, anchor.exactPhrase, anchor.startOffset) !== anchor.occurrenceIndex) return null;
	return {
		kind: "resolved",
		matchType: "stored-offsets",
		...anchor,
	};
}

function relocateCitationTarget(
	anchor: ExactPhraseAnchor,
	noteBody: string,
): ({ kind: "resolved"; matchType: "relocated" } & ExactPhraseAnchor) | null {
	if (!anchor.exactPhrase) return null;
	const matches = findPhraseOffsets(noteBody, anchor.exactPhrase);
	const relocated = matches[anchor.occurrenceIndex];
	if (!relocated) return null;
	return {
		kind: "resolved",
		matchType: "relocated",
		notePath: anchor.notePath,
		exactPhrase: anchor.exactPhrase,
		startOffset: relocated.startOffset,
		endOffset: relocated.endOffset,
		occurrenceIndex: anchor.occurrenceIndex,
	};
}

function getOccurrenceIndexAtOffset(noteBody: string, exactPhrase: string, startOffset: number): number {
	const matches = findPhraseOffsets(noteBody, exactPhrase);
	return matches.findIndex((match) => match.startOffset === startOffset);
}

function findPhraseOffsets(noteBody: string, exactPhrase: string): Array<{ startOffset: number; endOffset: number }> {
	const matches: Array<{ startOffset: number; endOffset: number }> = [];
	for (
		let index = noteBody.indexOf(exactPhrase);
		index !== -1;
		index = noteBody.indexOf(exactPhrase, index + 1)
	) {
		matches.push({
			startOffset: index,
			endOffset: index + exactPhrase.length,
		});
	}
	return matches;
}
