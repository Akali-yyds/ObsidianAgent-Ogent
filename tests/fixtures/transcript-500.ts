export interface TranscriptFixtureTurn {
	id: string;
	role: "user" | "assistant";
	content: string;
	segments: Array<{ id: string; kind: "thinking" | "text" | "tool"; text?: string }>;
}

/** Stable 500-round fixture with Thought text, operation cards, and Markdown. */
export function createTranscript500Fixture(): TranscriptFixtureTurn[] {
	const turns: TranscriptFixtureTurn[] = [];
	const longMarkdown = [
		"## Summary",
		"A repeatable long-form response used to exercise transcript mounting and Markdown rendering.",
		"- A representative paragraph with enough text to create wrapping in a narrow Obsidian side panel.",
		"- A second paragraph with **formatting**, inline `code`, and a short checklist.",
		"\n```ts\nconst status = await agent.inspectVault();\nreturn status;\n```",
	].join("\n");
	for (let round = 0; round < 500; round++) {
		turns.push({ id: `fixture-user-${round}`, role: "user", content: `Round ${round}: inspect the notes and explain the relevant changes.`, segments: [] });
		turns.push({
			id: `fixture-assistant-${round}`,
			role: "assistant",
			content: longMarkdown,
			segments: [
				{ id: `fixture-thought-${round}`, kind: "thinking", text: `Compare note ${round} with its incoming links and preserve the user's reading context.` },
				{ id: `fixture-tool-${round}`, kind: "tool" },
				{ id: `fixture-text-${round}`, kind: "text", text: longMarkdown },
			],
		});
	}
	return turns;
}
