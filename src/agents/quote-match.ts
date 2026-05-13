export function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function quotePresent(noteBody: string, quote: string): boolean {
	const normalizedQuote = normalizeWhitespace(quote);
	if (!normalizedQuote) return false;
	return normalizeWhitespace(noteBody).includes(normalizedQuote);
}
