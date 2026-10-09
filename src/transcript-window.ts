export interface TranscriptWindow {
	start: number;
	end: number;
}

/** Scroll intent is explicit state; adding a turn can invalidate old geometry. */
export function shouldFollowTranscriptAfterRender(following: boolean, requestedLatest: boolean): boolean {
	return requestedLatest || following;
}

export function normalizeTranscriptWindow(total: number, size: number, current: TranscriptWindow): TranscriptWindow {
	if (total <= size) return { start: 0, end: total };
	const end = Math.max(0, Math.min(total, current.end));
	const start = Math.max(0, Math.min(end, current.start));
	if (end - start > size) return { start: end - size, end };
	if (end === 0) return { start: Math.max(0, total - size), end: total };
	return { start, end };
}

export function shiftTranscriptWindowOnScroll(
	total: number,
	window: TranscriptWindow,
	metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
	options: { size: number; step: number; edgeThreshold?: number },
): TranscriptWindow {
	const normalized = normalizeTranscriptWindow(total, options.size, window);
	if (total <= options.size) return normalized;
	const edge = options.edgeThreshold ?? 100;
	const nearBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < edge;
	if (metrics.scrollTop < edge && normalized.start > 0) {
		const start = Math.max(0, normalized.start - options.step);
		return { start, end: Math.min(total, start + options.size) };
	}
	if (nearBottom && normalized.end < total) {
		const start = Math.min(total - options.size, normalized.start + options.step);
		return { start, end: Math.min(total, start + options.size) };
	}
	return normalized;
}

export function shiftTranscriptWindowAtRenderedEdge(
	total: number,
	window: TranscriptWindow,
	edge: "top" | "bottom",
	options: { size: number; step: number },
): TranscriptWindow {
	const normalized = normalizeTranscriptWindow(total, options.size, window);
	if (total <= options.size) return normalized;
	if (edge === "top") {
		const start = Math.max(0, normalized.start - options.step);
		return { start, end: Math.min(total, start + options.size) };
	}
	const start = Math.min(total - options.size, normalized.start + options.step);
	return { start, end: Math.min(total, start + options.size) };
}
