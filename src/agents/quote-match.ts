export function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function quotePresent(noteBody: string, quote: string): boolean {
	const normalizedQuote = normalizeForQuoteMatch(quote);
	if (!normalizedQuote) return false;
	const normalizedNote = normalizeForQuoteMatch(noteBody);
	if (normalizedNote.includes(normalizedQuote)) return true;
	return hasConservativeFuzzyMatch(tokenize(normalizedNote), tokenize(normalizedQuote));
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
