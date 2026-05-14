export function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export interface ExactQuoteMatch {
	kind: "exact";
	exactPhrase: string;
	startOffset: number;
	endOffset: number;
	occurrenceIndex: number;
}

export type QuoteResolution = ExactQuoteMatch | { kind: "fuzzy" } | { kind: "missing" };

export function quotePresent(noteBody: string, quote: string): boolean {
	return resolveQuoteMatch(noteBody, quote).kind !== "missing";
}

export function resolveQuoteMatch(noteBody: string, quote: string): QuoteResolution {
	const exactMatch = findExactQuoteMatch(noteBody, quote);
	if (exactMatch) return exactMatch;

	const normalizedQuote = normalizeForQuoteMatch(quote);
	if (!normalizedQuote) return { kind: "missing" };
	const normalizedNote = normalizeForQuoteMatch(noteBody);
	if (normalizedNote.includes(normalizedQuote)) return { kind: "fuzzy" };
	return hasConservativeFuzzyMatch(tokenize(normalizedNote), tokenize(normalizedQuote))
		? { kind: "fuzzy" }
		: { kind: "missing" };
}

function findExactQuoteMatch(noteBody: string, quote: string): ExactQuoteMatch | null {
	const normalizedQuote = normalizeWhitespace(quote);
	if (!normalizedQuote) return null;
	const collapsedNote = collapseWhitespaceWithMap(noteBody, { lowercase: true });
	const collapsedQuote = normalizeWhitespace(quote).toLocaleLowerCase();
	if (!collapsedQuote) return null;

	const candidates: ExactQuoteMatch[] = [];
	for (
		let index = collapsedNote.text.indexOf(collapsedQuote);
		index !== -1;
		index = collapsedNote.text.indexOf(collapsedQuote, index + 1)
	) {
		const startOffset = collapsedNote.map[index];
		const endOffset = collapsedNote.map[index + collapsedQuote.length - 1] + 1;
		candidates.push({
			kind: "exact",
			exactPhrase: noteBody.slice(startOffset, endOffset),
			startOffset,
			endOffset,
			occurrenceIndex: candidates.length,
		});
	}

	if (candidates.length === 0) return null;

	return [...candidates].sort((left, right) => {
		const leftScore = scoreExactCandidate(left.exactPhrase, quote);
		const rightScore = scoreExactCandidate(right.exactPhrase, quote);
		if (leftScore !== rightScore) return leftScore - rightScore;
		return left.startOffset - right.startOffset;
	})[0];
}

function scoreExactCandidate(exactPhrase: string, quote: string): number {
	return normalizeWhitespace(exactPhrase) === normalizeWhitespace(quote) ? 0 : 1;
}

function collapseWhitespaceWithMap(value: string, { lowercase = false }: { lowercase?: boolean } = {}): {
	text: string;
	map: number[];
} {
	let text = "";
	const map: number[] = [];
	let pendingWhitespaceAt: number | null = null;

	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (/\s/u.test(char)) {
			if (text.length > 0 && pendingWhitespaceAt === null) pendingWhitespaceAt = index;
			continue;
		}
		if (pendingWhitespaceAt !== null) {
			text += " ";
			map.push(pendingWhitespaceAt);
			pendingWhitespaceAt = null;
		}
		text += lowercase ? char.toLocaleLowerCase() : char;
		map.push(index);
	}

	return { text, map };
}

function normalizeForQuoteMatch(value: string): string {
	return normalizeWhitespace(
		value
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
			.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
			.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
			.replace(/[\u2013\u2014\u2212]/g, "-")
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]+/gu, " "),
	);
}

function tokenize(value: string): string[] {
	return value.split(" ").filter(Boolean);
}

function hasConservativeFuzzyMatch(noteTokens: string[], quoteTokens: string[]): boolean {
	if (quoteTokens.length < 4 || noteTokens.length < quoteTokens.length - 1) return false;
	const maxEdits = quoteTokens.length >= 8 ? 2 : 1;
	for (let start = 0; start < noteTokens.length; start++) {
		if (noteTokens[start] !== quoteTokens[0]) continue;
		if (matchesFromStart(noteTokens, quoteTokens, start, maxEdits)) return true;
	}
	return false;
}

function matchesFromStart(noteTokens: string[], quoteTokens: string[], start: number, maxEdits: number): boolean {
	let noteIndex = start;
	let quoteIndex = 0;
	let matched = 0;
	let edits = 0;
	const noteLimit = Math.min(noteTokens.length, start + quoteTokens.length + maxEdits);

	while (noteIndex < noteLimit && quoteIndex < quoteTokens.length) {
		if (noteTokens[noteIndex] === quoteTokens[quoteIndex]) {
			noteIndex += 1;
			quoteIndex += 1;
			matched += 1;
			continue;
		}
		if (edits >= maxEdits) break;
		if (noteIndex + 1 < noteLimit && noteTokens[noteIndex + 1] === quoteTokens[quoteIndex]) {
			noteIndex += 1;
			edits += 1;
			continue;
		}
		if (quoteIndex + 1 < quoteTokens.length && noteTokens[noteIndex] === quoteTokens[quoteIndex + 1]) {
			quoteIndex += 1;
			edits += 1;
			continue;
		}
		noteIndex += 1;
		quoteIndex += 1;
		edits += 1;
	}

	const remainingQuoteTokens = quoteTokens.length - quoteIndex;
	return remainingQuoteTokens <= maxEdits - edits && matched >= quoteTokens.length - maxEdits;
}
