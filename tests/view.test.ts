import { describe, expect, it, vi } from "vitest";
import groundedResearchDefault from "../src/packs/defaults/grounded-research.json";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { StoredPackTurnData } from "../src/sessions";
import { ChatView } from "../src/view";
import {
	MockElement,
	MockTFile,
	createMockApp,
	setMobileMode,
} from "./setup";

function createDeps(activeSession: {
	id: string;
	model: string;
	selectedPackId: string | null;
	lastClassicModel: string;
	turns?: unknown[];
	recovery?: {
		reason: "turns-corrupt";
		message: string;
		backupPath: string;
		recoveredAt: number;
	} | null;
}): {
	deps: ConstructorParameters<typeof ChatView>[1];
	updateSelectedPack: ReturnType<typeof vi.fn>;
} {
	const updateSelectedPack = vi.fn(async () => undefined);
	const deps = {
		getSettings: () => ({ ...DEFAULT_SETTINGS, apiKey: "token" }),
		openSettings: vi.fn(),
		tools: {} as never,
		consent: {} as never,
		undo: {} as never,
		sessionStore: {
			getActive: () => ({
				title: "Session",
				createdAt: 1,
				updatedAt: 1,
				turns: [],
				...activeSession,
			}),
			getSessions: () => [],
			updateSelectedPack,
		} as never,
		getPacks: vi.fn(),
		runPack: vi.fn(),
	};
	return { deps, updateSelectedPack };
}

function findByClass(root: MockElement, className: string): MockElement[] {
	const results: MockElement[] = [];
	if (root.classList.contains(className)) results.push(root);
	for (const child of root.children) results.push(...findByClass(child, className));
	return results;
}

function textTree(root: MockElement): string {
	return [root.textContent, ...root.children.map((child) => textTree(child))]
		.filter(Boolean)
		.join(" ");
}

function renderPackTurn(view: ChatView, packTurn: StoredPackTurnData): MockElement {
	const parent = new MockElement("div");
	(
		view as unknown as {
			renderPackTurn(target: HTMLElement, packTurn: StoredPackTurnData): void;
		}
	).renderPackTurn(parent as unknown as HTMLElement, packTurn);
	return parent;
}

function createAgentWorkTurn(overrides: Partial<StoredPackTurnData> = {}): StoredPackTurnData {
	return {
		packId: groundedResearchDefault.id,
		packName: groundedResearchDefault.name,
		progressSteps: [
			{ id: "retriever", label: "Retrieving notes", state: "complete" },
			{ id: "synthesizer", label: "Drafting claims", state: "complete" },
			{ id: "verifier", label: "Verifying claims", state: "complete" },
		],
		verifiedSummary: "- Alpha evidence",
		claims: [
			{
				id: "claim-verified",
				text: "Alpha is supported",
				sourceNote: "notes/source.md",
				sourceQuote: "Alpha evidence",
				quotePresent: true,
				supportsClaim: true,
				supportExplanation: "Directly supported",
				status: "verified",
			},
			{
				id: "claim-missing",
				text: "Beta needs more support",
				sourceNote: "notes/source.md",
				sourceQuote: "Beta quote",
				quotePresent: false,
				supportsClaim: null,
				supportExplanation: "Quoted text not found in the live note.",
				status: "quote-missing",
			},
		],
		agentWork: {
			retriever: {
				status: "ready",
				elapsedMs: 2400,
				notesFoundCount: 5,
				topNotePaths: [
					"notes/source.md",
					"notes/appendix.md",
					"notes/archive.md",
				],
				brief: "- notes/source.md backs Alpha\n- notes/appendix.md adds context",
			},
			synthesizer: {
				status: "ready",
				elapsedMs: 11200,
				claimCount: 2,
				summary: "Alpha is directly supported by the source note. Beta needs more evidence before it can be treated as verified.",
				rawJson: {
					summary: "Alpha is directly supported by the source note. Beta needs more evidence before it can be treated as verified.",
					claims: [
						{
							id: "claim-verified",
							text: "Alpha is supported",
							source_note: "notes/source.md",
							source_quote: "Alpha evidence",
							confidence: 0.91,
						},
						{
							id: "claim-missing",
							text: "Beta needs more support",
							source_note: "notes/source.md",
							source_quote: "Beta quote",
							confidence: 0.42,
						},
					],
				},
			},
			verifier: {
				status: "ready",
				elapsedMs: 62000,
				counts: {
					verified: 1,
					unsupported: 0,
					quoteMissing: 1,
				},
				reasons: [
					{
						claimId: "claim-verified",
						claimText: "Alpha is supported by the source note and should remain first in order.",
						sourceNote: "notes/source.md",
						status: "verified",
						explanation: "Direct quote support found.",
					},
					{
						claimId: "claim-missing",
						claimText: "Beta needs more support before it can be considered safe to state confidently.",
						sourceNote: "notes/source.md",
						status: "quote-missing",
						explanation: "Quote was not found in the live note.",
					},
				],
			},
			run: {
				state: "completed",
				elapsedMs: 75600,
				stepElapsedMs: {
					retriever: 2400,
					synthesizer: 11200,
					verifier: 62000,
				},
			},
		},
		modelsUsed: {
			retriever: "gemma-4-4b-it",
			synthesizer: "gemma-4-31b-it",
			verifier: "gemma-4-4b-it",
		},
		...overrides,
	};
}

describe("ChatView pack UI", () => {
	it("stores pack selection per session and preserves the classic model for future turns", async () => {
		const app = createMockApp();
		const { deps, updateSelectedPack } = createDeps({
			id: "session-a",
			model: "gpt-4o-mini",
			selectedPackId: null,
			lastClassicModel: "gpt-4o-mini",
		});
		const view = new ChatView({ app } as never, deps);
		(view as unknown as { modeSelectEl: { value: string }; modelInputEl: { value: string } }).modeSelectEl = {
			value: groundedResearchDefault.id,
		};
		(view as unknown as { modeSelectEl: { value: string }; modelInputEl: { value: string } }).modelInputEl = {
			value: "restored-classic-model",
		};
		vi.spyOn(view as never, "refreshHeader" as never).mockImplementation(() => undefined);
		vi.spyOn(view as never, "refreshConfiguredState" as never).mockImplementation(() => undefined);

		await (view as unknown as { handleModeChange(): Promise<void> }).handleModeChange();

		expect(updateSelectedPack).toHaveBeenCalledWith(
			"session-a",
			groundedResearchDefault.id,
			"restored-classic-model",
		);
	});

	it("hides unsupported packs on mobile and blocks desktop-only packs from running", () => {
		setMobileMode(true);
		const app = createMockApp();
		const { deps } = createDeps({
			id: "session-a",
			model: "gpt-4o-mini",
			selectedPackId: groundedResearchDefault.id,
			lastClassicModel: "gpt-4o-mini",
		});
		const view = new ChatView({ app } as never, deps);
		(view as unknown as { availablePacks: typeof groundedResearchDefault[] }).availablePacks = [
			groundedResearchDefault,
			{
				...structuredClone(groundedResearchDefault),
				id: "mobile-pack",
				name: "Mobile Pack",
				support: { mobile: true },
			},
		];

		expect((view as unknown as { getSelectablePacks(): Array<{ id: string }> }).getSelectablePacks().map((pack) => pack.id)).toEqual([
			"mobile-pack",
		]);
		expect((view as unknown as { isMobileBlockedPack(): boolean }).isMobileBlockedPack()).toBe(true);

		setMobileMode(false);
	});

	it("renders collapsible claim cards, source-note navigation, and model attribution for pack turns", () => {
		const app = createMockApp({
			files: {
				"notes/source.md": "Alpha evidence",
			},
		});
		const openFile = vi.fn(async () => undefined);
		app.workspace.getLeaf = vi.fn(() => ({ openFile }));
		const { deps } = createDeps({
			id: "session-a",
			model: "gpt-4o-mini",
			selectedPackId: groundedResearchDefault.id,
			lastClassicModel: "gpt-4o-mini",
		});
		const view = new ChatView({ app } as never, deps);
		const parent = new MockElement("div");

		(
			view as unknown as {
				renderPackTurn(target: HTMLElement, packTurn: {
					progressSteps: Array<{ id: string; label: string; state: "pending" | "running" | "complete" | "failed"; message?: string }>;
					verifiedSummary?: string;
					claims?: Array<{
						id: string;
						text: string;
						sourceNote: string;
						sourceQuote: string;
						quotePresent: boolean;
						supportsClaim: boolean | null;
						supportExplanation: string;
						status: "verified" | "unsupported" | "quote-missing";
					}>;
					modelsUsed?: { retriever: string; synthesizer: string; verifier: string };
				}): void;
			}
		).renderPackTurn(parent as unknown as HTMLElement, {
			progressSteps: [
				{ id: "retriever", label: "Retrieving notes", state: "complete" },
				{ id: "synthesizer", label: "Drafting claims", state: "complete" },
				{ id: "verifier", label: "Verifying claims", state: "complete" },
			],
			verifiedSummary: "- Alpha evidence",
			claims: [
				{
					id: "claim-verified",
					text: "Alpha is supported",
					sourceNote: "notes/source.md",
					sourceQuote: "Alpha evidence",
					quotePresent: true,
					supportsClaim: true,
					supportExplanation: "Directly supported",
					status: "verified",
				},
				{
					id: "claim-flagged",
					text: "Beta is unsupported",
					sourceNote: "notes/source.md",
					sourceQuote: "Beta quote",
					quotePresent: false,
					supportsClaim: null,
					supportExplanation: "Quoted text not found in the live note.",
					status: "quote-missing",
				},
			],
			modelsUsed: {
				retriever: "gemma-4-4b-it",
				synthesizer: "gemma-4-31b-it",
				verifier: "gemma-4-4b-it",
			},
		});

		const cards = findByClass(parent, "open-agent-claim");
		expect(cards).toHaveLength(2);
		const verifiedDetails = findByClass(cards[0], "open-agent-claim-details")[0];
		const flaggedDetails = findByClass(cards[1], "open-agent-claim-details")[0];
		const toggles = findByClass(parent, "open-agent-claim-toggle");

		expect(toggles[0].textContent).toBe("Show details");
		expect(verifiedDetails.classList.contains("is-hidden")).toBe(true);
		expect(toggles[1].textContent).toBe("Hide details");
		expect(flaggedDetails.classList.contains("is-hidden")).toBe(false);

		toggles[0].click();
		expect(toggles[0].textContent).toBe("Hide details");
		expect(verifiedDetails.classList.contains("is-hidden")).toBe(false);

		findByClass(cards[0], "open-agent-claim-open")[0].click();
		expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "notes/source.md" }));
		expect(openFile.mock.calls[0]?.[0]).toBeInstanceOf(MockTFile);

		expect(findByClass(parent, "open-agent-pack-model-footer")[0]?.textContent).toBe(
			"Models used: Retriever — gemma-4-4b-it; Synthesizer — gemma-4-31b-it; Verifier — gemma-4-4b-it",
		);
	});

	it("renders Agent work between the outcome surface and claim cards, keeps successful cards collapsed, and only opens one at a time", () => {
		const app = createMockApp();
		const { deps } = createDeps({
			id: "session-a",
			model: "gpt-4o-mini",
			selectedPackId: groundedResearchDefault.id,
			lastClassicModel: "gpt-4o-mini",
		});
		const view = new ChatView({ app } as never, deps);
		const parent = renderPackTurn(view, createAgentWorkTurn());

		expect(findByClass(parent, "open-agent-pack-section-title").map((el) => el.textContent)).toEqual([
			"Verified summary",
			"Agent work",
			"Flagged claims",
		]);
		expect(findByClass(parent, "open-agent-work-card-title").map((el) => el.textContent)).toEqual([
			"Retriever",
			"Synthesizer",
			"Verifier",
			"Run metadata",
		]);

		const toggles = findByClass(parent, "open-agent-work-toggle");
		const details = findByClass(parent, "open-agent-work-details");
		expect(toggles.map((el) => el.textContent)).toEqual([
			"Show details",
			"Show details",
			"Show details",
			"Show details",
		]);
		expect(details.every((el) => el.classList.contains("is-hidden"))).toBe(true);

		toggles[0].click();
		expect(toggles.map((el) => el.textContent)).toEqual([
			"Hide details",
			"Show details",
			"Show details",
			"Show details",
		]);
		expect(details[0].classList.contains("is-hidden")).toBe(false);
		expect(details.slice(1).every((el) => el.classList.contains("is-hidden"))).toBe(true);

		toggles[2].click();
		expect(toggles.map((el) => el.textContent)).toEqual([
			"Show details",
			"Show details",
			"Hide details",
			"Show details",
		]);
		expect(details[0].classList.contains("is-hidden")).toBe(true);
		expect(details[2].classList.contains("is-hidden")).toBe(false);
	});

	it("keeps legacy and classic turns unchanged and reuses the existing note-opening path for retriever note chips", () => {
		const app = createMockApp({
			files: {
				"notes/source.md": "Alpha evidence",
			},
		});
		const openFile = vi.fn(async () => undefined);
		app.workspace.getLeaf = vi.fn(() => ({ openFile }));
		const { deps } = createDeps({
			id: "session-a",
			model: "gpt-4o-mini",
			selectedPackId: groundedResearchDefault.id,
			lastClassicModel: "gpt-4o-mini",
		});
		const view = new ChatView({ app } as never, deps);

		const withWork = renderPackTurn(view, createAgentWorkTurn());
		findByClass(withWork, "open-agent-work-note-path")[0].click();
		expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "notes/source.md" }));
		expect(openFile.mock.calls[0]?.[0]).toBeInstanceOf(MockTFile);

		const legacyPackTurn = renderPackTurn(view, {
			packId: groundedResearchDefault.id,
			packName: groundedResearchDefault.name,
			progressSteps: [{ id: "retriever", label: "Retrieving notes", state: "complete" }],
			verifiedSummary: "- Legacy answer",
		});
		expect(findByClass(legacyPackTurn, "open-agent-work-section")).toHaveLength(0);

		const classicView = new ChatView({ app } as never, createDeps({
			id: "session-classic",
			model: "gpt-4o-mini",
			selectedPackId: null,
			lastClassicModel: "gpt-4o-mini",
		}).deps);
		const classicRow = new MockElement("div");
		(
			classicView as unknown as {
				renderTranscript(): void;
				transcriptEl: MockElement;
				turns: unknown[];
			}
		).transcriptEl = classicRow;
		(
			classicView as unknown as {
				transcriptEl: MockElement;
				turns: unknown[];
			}
		).turns = [{
			role: "assistant",
			content: "",
			segments: [{ kind: "text", text: "Classic answer" }],
			toolCallMap: {},
			thinking: false,
		}];
		(classicView as unknown as { renderTranscript(): void }).renderTranscript();
		expect(findByClass(classicRow, "open-agent-work-section")).toHaveLength(0);
	});

	it("renders live pending states and failed-run missing cards without hiding completed work", () => {
		const app = createMockApp();
		const { deps } = createDeps({
			id: "session-a",
			model: "gpt-4o-mini",
			selectedPackId: groundedResearchDefault.id,
			lastClassicModel: "gpt-4o-mini",
		});
		const view = new ChatView({ app } as never, deps);

		const liveParent = renderPackTurn(view, createAgentWorkTurn({
			agentWork: {
				retriever: {
					status: "ready",
					elapsedMs: 2400,
					notesFoundCount: 2,
					topNotePaths: ["notes/source.md", "notes/appendix.md"],
					brief: "- notes/source.md backs Alpha",
				},
				synthesizer: { status: "pending" },
				verifier: { status: "pending" },
				run: {
					state: "running",
					elapsedMs: 2400,
					stepElapsedMs: { retriever: 2400 },
				},
			},
			claims: [],
			verifiedSummary: "",
		}));
		const liveToggles = findByClass(liveParent, "open-agent-work-toggle");
		const liveDetails = findByClass(liveParent, "open-agent-work-details");
		expect(textTree(liveParent)).toContain("Waiting for step to finish.");
		liveToggles[0].click();
		expect(liveDetails[0].classList.contains("is-hidden")).toBe(false);
		liveToggles[1].click();
		expect(liveDetails[1].classList.contains("is-hidden")).toBe(true);

		const failedParent = renderPackTurn(view, createAgentWorkTurn({
			agentWork: {
				retriever: {
					status: "ready",
					elapsedMs: 2400,
					notesFoundCount: 2,
					topNotePaths: ["notes/source.md", "notes/appendix.md"],
					brief: "- notes/source.md backs Alpha",
				},
				synthesizer: { status: "absent" },
				verifier: { status: "absent" },
				run: {
					state: "failed",
					elapsedMs: 9100,
					stepElapsedMs: { retriever: 2400 },
					failedStepId: "synthesizer",
				},
			},
			claims: [],
			verifiedSummary: "",
		}));
		const failedToggles = findByClass(failedParent, "open-agent-work-toggle");
		const failedDetails = findByClass(failedParent, "open-agent-work-details");
		expect(failedToggles.map((el) => el.textContent)).toEqual([
			"Show details",
			"Hide details",
			"Show details",
			"Show details",
		]);
		expect(textTree(failedDetails[1])).toContain("No data captured");
		failedToggles[0].click();
		expect(failedDetails[0].classList.contains("is-hidden")).toBe(false);
		expect(failedDetails[1].classList.contains("is-hidden")).toBe(true);
	});

	it("preserves retriever ordering, omits raw scores, renders verifier reasons in claim order, and ends run metadata with the final run state", () => {
		const app = createMockApp();
		const { deps } = createDeps({
			id: "session-a",
			model: "gpt-4o-mini",
			selectedPackId: groundedResearchDefault.id,
			lastClassicModel: "gpt-4o-mini",
		});
		const view = new ChatView({ app } as never, deps);
		const parent = renderPackTurn(view, createAgentWorkTurn());

		expect(textTree(findByClass(parent, "open-agent-work-card")[0])).toContain("5 notes found");
		expect(findByClass(parent, "open-agent-work-note-path").map((el) => el.textContent)).toEqual([
			"notes/source.md",
			"notes/appendix.md",
			"notes/archive.md",
		]);
		expect(textTree(findByClass(parent, "open-agent-work-card")[0])).toContain("+2 more");

		findByClass(parent, "open-agent-work-toggle")[0].click();
		const retrieverDetails = findByClass(parent, "open-agent-work-details")[0];
		expect(textTree(retrieverDetails)).toContain("notes/source.md backs Alpha");
		expect(textTree(retrieverDetails)).not.toContain("0.91");

		findByClass(parent, "open-agent-work-toggle")[2].click();
		const verifierRows = findByClass(parent, "open-agent-work-verifier-row");
		expect(verifierRows.map((row) => textTree(row))).toEqual([
			expect.stringContaining("Verified Alpha is supported by the source note and should remain first in order. source.md Direct quote support found."),
			expect.stringContaining("Quote missing Beta needs more support before it can be considered safe to state confidently. source.md Quote was not found in the live note."),
		]);

		findByClass(parent, "open-agent-work-toggle")[3].click();
		const runDetails = findByClass(parent, "open-agent-work-details")[3];
		const runState = findByClass(runDetails, "open-agent-work-run-state").at(-1);
		expect(runState?.textContent).toBe("Completed");
	});

	it("shows a recovery banner when the active session was restored from corrupt history", () => {
		const app = createMockApp();
		const { deps } = createDeps({
			id: "session-a",
			model: "gpt-4o-mini",
			selectedPackId: null,
			lastClassicModel: "gpt-4o-mini",
			recovery: {
				reason: "turns-corrupt",
				message: "Saved chat history was unreadable. OpenAgent moved the original file to sessions/session-a.corrupt-123.json and reset this chat to an empty history.",
				backupPath: "sessions/session-a.corrupt-123.json",
				recoveredAt: 123,
			},
		});
		const view = new ChatView({ app } as never, deps);
		const sessionTitleEl = new MockElement("span");
		const modelInputEl = new MockElement("input");
		modelInputEl.parentElement = new MockElement("div");
		const modeSelectEl = new MockElement("select");
		const packSummaryEl = new MockElement("div");
		const packHintEl = new MockElement("div");
		const packRecoveryEl = new MockElement("div");
		const packMobileBannerEl = new MockElement("div");
		const sessionRecoveryEl = new MockElement("div");

		Object.assign(view as unknown as Record<string, unknown>, {
			sessionTitleEl,
			modelInputEl,
			modeSelectEl,
			packSummaryEl,
			packHintEl,
			packRecoveryEl,
			packMobileBannerEl,
			sessionRecoveryEl,
			availablePacks: [],
		});

		(view as unknown as { refreshHeader(): void }).refreshHeader();

		const banners = findByClass(sessionRecoveryEl, "open-agent-pack-banner");
		expect(banners).toHaveLength(1);
		expect(banners[0]?.textContent).toContain("sessions/session-a.corrupt-123.json");
	});
});
