import { describe, expect, it } from "vitest";
import { normalizeTranscriptWindow, shiftTranscriptWindowAtRenderedEdge, shiftTranscriptWindowOnScroll, shouldFollowTranscriptAfterRender } from "../src/transcript-window";
import { createTranscript500Fixture } from "./fixtures/transcript-500";

describe("transcript window", () => {
	it("keeps explicit latest/send intent when new content makes the old position look far from the bottom", () => {
		expect(shouldFollowTranscriptAfterRender(true, true)).toBe(true);
		expect(shouldFollowTranscriptAfterRender(false, true)).toBe(true);
		expect(shouldFollowTranscriptAfterRender(true, false)).toBe(true);
		expect(shouldFollowTranscriptAfterRender(false, false)).toBe(false);
	});
	it("normalizes empty, short, and oversized windows", () => {
		expect(normalizeTranscriptWindow(0, 80, { start: 0, end: 0 })).toEqual({ start: 0, end: 0 });
		expect(normalizeTranscriptWindow(12, 80, { start: 5, end: 10 })).toEqual({ start: 0, end: 12 });
		expect(normalizeTranscriptWindow(500, 80, { start: 100, end: 300 })).toEqual({ start: 220, end: 300 });
	});

	it("loads older rows near the top while keeping the window bounded", () => {
		const next = shiftTranscriptWindowOnScroll(500, { start: 420, end: 500 }, { scrollTop: 0, scrollHeight: 12_000, clientHeight: 800 }, { size: 80, step: 40, edgeThreshold: 120 });
		expect(next).toEqual({ start: 380, end: 460 });
		expect(next.end - next.start).toBe(80);
	});

	it("moves forward near the bottom and does not shift in the middle", () => {
		const forward = shiftTranscriptWindowOnScroll(500, { start: 100, end: 180 }, { scrollTop: 11_500, scrollHeight: 12_000, clientHeight: 800 }, { size: 80, step: 40, edgeThreshold: 120 });
		const steady = shiftTranscriptWindowOnScroll(500, { start: 100, end: 180 }, { scrollTop: 4_000, scrollHeight: 12_000, clientHeight: 800 }, { size: 80, step: 40, edgeThreshold: 120 });
		expect(forward).toEqual({ start: 140, end: 220 });
		expect(steady).toEqual({ start: 100, end: 180 });
	});

	it("moves the bounded window only when the rendered edge is reached", () => {
		expect(shiftTranscriptWindowAtRenderedEdge(1000, { start: 920, end: 1000 }, "top", { size: 80, step: 40 }))
			.toEqual({ start: 880, end: 960 });
		expect(shiftTranscriptWindowAtRenderedEdge(1000, { start: 40, end: 120 }, "top", { size: 80, step: 40 }))
			.toEqual({ start: 0, end: 80 });
		expect(shiftTranscriptWindowAtRenderedEdge(1000, { start: 0, end: 80 }, "bottom", { size: 80, step: 40 }))
			.toEqual({ start: 40, end: 120 });
		expect(shiftTranscriptWindowAtRenderedEdge(1000, { start: 920, end: 1000 }, "bottom", { size: 80, step: 40 }))
			.toEqual({ start: 920, end: 1000 });
	});

	it("keeps the fixed 500-round workload within the mounted-row bound", () => {
		const fixture = createTranscript500Fixture();
		expect(fixture).toHaveLength(1000);
		expect(fixture.some((turn) => turn.segments.some((segment) => segment.kind === "thinking"))).toBe(true);
		expect(fixture.some((turn) => turn.segments.some((segment) => segment.kind === "tool"))).toBe(true);
		expect(fixture.filter((turn) => turn.role === "assistant").every((turn) => turn.content.includes("```ts"))).toBe(true);
		const window = normalizeTranscriptWindow(fixture.length, 80, { start: 920, end: 1000 });
		expect(fixture.slice(window.start, window.end)).toHaveLength(80);
	});
});
