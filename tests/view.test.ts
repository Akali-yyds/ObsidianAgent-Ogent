import { describe, expect, it, vi } from "vitest";
import groundedResearchDefault from "../src/packs/defaults/grounded-research.json";
import { DEFAULT_SETTINGS } from "../src/settings";
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
