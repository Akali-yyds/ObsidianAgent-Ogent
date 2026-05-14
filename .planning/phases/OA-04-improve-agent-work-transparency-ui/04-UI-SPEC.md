---
phase: 4
slug: improve-agent-work-transparency-ui
status: approved
shadcn_initialized: false
preset: none
created: 2026-05-14
reviewed_at: 2026-05-14T19:22:00Z
---

# Phase 4 — UI Design Contract

> Visual and interaction contract for frontend phases. Revised to restore the intended transparency model for grounded-research turns.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none |
| Preset | not applicable |
| Component library | none — imperative Obsidian `createEl` UI in `src/view.ts` |
| Icon library | Obsidian core icons where already available; text labels and simple glyphs remain acceptable |
| Font | Obsidian theme UI font via existing `var(--font-ui-*)` tokens |

---

## Spacing Scale

Declared values (must be multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Inline citation gap, compact badge spacing, step-meta separators |
| sm | 8px | Step header gaps, stacked metadata items, claim-card internals |
| md | 16px | Default block padding, research body spacing, expanded step internals |
| lg | 24px | Separation between result, progress blocks, and claim-detail sections |
| xl | 32px | Separation between major transcript blocks in long grounded-research turns |
| 2xl | 48px | Reserved for large empty states only |
| 3xl | 64px | Not used in Phase 4 |

Exceptions: compact disclosure glyphs may remain visually small, but the whole interactive step block must provide a 44x44px minimum hit target on mobile.

---

## Typography

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 14px | 400 | 1.5 |
| Label | 12px | 600 | 1.3 |
| Heading | 16px | 600 | 1.25 |
| Display | 20px | 600 | 1.2 |

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `var(--background-primary)` | Transcript body, expanded step details, claim cards, code/JSON blocks |
| Secondary (30%) | `var(--background-secondary)` | Step rows, result containers, citation chips, muted metadata surfaces |
| Accent (10%) | `var(--interactive-accent)` | Running step border, expanded step affordance, inline citation link, focus state |
| Destructive | `var(--text-error)` | Failed step border/text, quote-missing states, unresolved citation-target failure |

Accent is reserved for: the currently running step, the expanded step affordance, keyboard focus, and inline citation links inside the final research text. Do not use accent on every status badge or all claim borders.

Unsupported-but-quoted states keep the existing amber treatment (`#d8a13c`).

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | `Run research` |
| Primary result heading | `Research result` |
| No-result heading | `Research result unavailable` |
| No-result body | `This run did not produce a citation-ready research answer. Review the completed steps and claim details below, then rerun research if needed.` |
| Step pending copy | `Waiting for step to finish.` |
| Step missing copy | `No details captured.` |
| Citation resolution fallback | `Citation target no longer matches the live note.` |
| Destructive confirmation | Delete session: `Delete this session? This removes its saved transcript.` |

Prohibited labels in the final UI for completed grounded-research turns: `Agent work`, `Run details`.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not required |

---

## Locked Decisions Applied

- Reuse the existing assistant progress/step blocks as the only transparency surface. Source: user revision brief.
- Do not render a separate `Agent work` section, `Run details` bar, or standalone run-metadata card. Source: user revision brief.
- Make the whole step block interactive; clicking the row expands its live or final details in place. Source: user revision brief.
- Render the final answer as research text with inline citation links as the primary outcome surface. Source: user revision brief.
- Inline citation links must jump to exact document phrases, which requires exact-phrase anchor data in runtime and stored session data. Source: user revision brief plus current gaps in `src/packs/runtime.ts`, `src/sessions.ts`, `src/view.ts`.
- Reuse existing claim cards as secondary evidence/details surfaces; do not duplicate them with a separate verifier summary card. Source: user revision brief.
- Keep Classic turns and legacy stored pack turns safe when transparency or phrase-anchor data is absent. Source: `ROADMAP.md`, `REQUIREMENTS.md`, `src/sessions.ts`.

---

## Phase 4 Surface Contract

**Primary visual anchor:** completed grounded-research turns lead with a citation-ready `Research result`. Transparency stays inside the existing step blocks, and evidence stays in the existing claim cards.

| Surface | Contract |
|---------|----------|
| Completed turn order | For completed or failed grounded-research turns, render in this order: `Research result` (or failure message), existing step-block stack, claim cards, model footer. Do not append any additional transparency section after the result. |
| Running turn order | While a pack run is in flight, keep the existing step-block stack visible at the top of the assistant turn. When the run completes, preserve the same blocks and move them into the completed-turn order above. |
| Step stack inventory | Render exactly the existing pipeline steps only: `Retriever`, `Synthesizer`, `Verifier`. Do not add a fourth `Run metadata` block. |
| Step block interaction | The entire step row is the disclosure control when the step has live details, final details, or an error message. Use button semantics or equivalent accessible semantics with `aria-expanded`. Visible affordance may be a chevron/glyph plus state text, but the whole row must toggle. |
| Expansion behavior | Only one step block may be expanded at a time. Expanding a new block collapses the previously expanded block. For failed runs, auto-expand the failed step on first render. |
| Step header content | Every step header shows: step label, state (`Pending`, `Running`, `Complete`, `Failed`), and step duration when known. Do not place total duration in a standalone card. |
| Retriever step details | Collapsed header summary shows `{N} notes` and up to 3 note-path chips. Expanded details show the retriever brief plus the same note-path chips. Chips open the note file only; they are not phrase-jump citations. Do not render raw note bodies or retrieval scores. |
| Synthesizer step details | Collapsed header summary shows `{N} draft claims` plus a 1-line preview from the synthesizer summary. Expanded details show that summary and a `Raw JSON` block rendered from stored draft claims. Keep the JSON block monospace, scrollable, and capped at 240px desktop / 30vh mobile. No second transparency card or nested modal. |
| Verifier step details | Collapsed header summary shows the three status counts: `Verified`, `Unsupported`, `Quote missing`. Expanded details show a compact reason list keyed to claim order. Each row includes status, claim text preview, note basename, and verifier explanation. Do not duplicate full quotes or full claim cards here. |
| Total timing | Show total elapsed time once as compact muted metadata adjacent to the `Research result` heading or inline with the step-stack container header. It must not appear as its own block or section. |
| Final research result | Render a prose-like research answer as markdown/rich text, not a separate `Verified summary` bullet-only surface. Inline citations appear inside the answer text immediately after the supported clause or sentence. |
| Inline citations | Inline citations use compact link labels (`[1]`, `[2]`, etc.) in order of first appearance. Repeated use of the same exact note phrase reuses the same label. Different phrases in the same note get different labels. |
| Citation destination | Clicking an inline citation opens the source note and reveals the exact matched phrase captured during verification. The jump target is the persisted phrase anchor, not a plain file open. |
| Claim cards | Existing claim cards remain below the step stack as the secondary evidence/details surface. Keep current verified/unsupported/quote-missing visual states and expand/collapse behavior. These cards are the place for full quote text and note-opening fallback. |
| Failure handling | If no citation-ready research result can be rendered, show `Research result unavailable`, keep completed step blocks interactive, and keep claim cards below. Do not add substitute `Agent work` or `Run details` sections. |
| Classic and legacy safety | Classic turns never render this Phase 4 transparency UI. Legacy pack turns without persisted step-detail or phrase-anchor data render safely with the older note-opening behavior and without inline citation links. |

---

## Interaction Rules

1. The existing progress rows are the only transparency surface for grounded-research turns.
2. There is no separate section title for transparency content on completed turns.
3. Whole-row click toggles expansion for step blocks that have details or failure text; purely pending rows without details remain non-expandable.
4. Use the same 3 step rows during live execution and after completion; do not swap to different cards or a different information architecture.
5. Inline citation links appear only for claims with a persisted exact-phrase anchor. Unsupported and quote-missing claims never inject inline citations into the primary result.
6. If a claim remains visible in claim cards but lacks an exact-phrase anchor, its claim card may still open the source note normally; the primary research text must not pretend phrase-jump support exists.
7. Clicking a verifier reason row may scroll to or highlight the matching claim card, but it must not duplicate the full claim-detail UI inside the verifier step.
8. Duration formatting rules:
   - under 10 seconds: 1 decimal place (`2.4s`)
   - 10 to 59.9 seconds: whole seconds (`18s`)
   - 60 seconds or more: `Xm Ys`
9. If total or step timing is unavailable for completed content, show `Timing unavailable` instead of `0s`.
10. Do not expose raw prompts, provider URLs, API keys, tool-call internals, or full retrieved note bodies.
11. Keyboard users must be able to focus each interactive step row and each inline citation link.
12. On mobile, step rows remain single-column, with wrapping metadata and no horizontal scroll except inside the synthesizer JSON block.

---

## Data and Rendering Constraints

- Replace the current Phase 4 assumption of a separate `agentWork` surface. The renderer should continue using the existing step/progress data as the top-level transparency structure.
- Add a persisted primary-result field for grounded-research turns, e.g. `researchMarkdown` or equivalent, that stores the final citation-ready answer text rendered in the assistant turn.
- Add persisted exact-phrase anchor data to verified claims and citation targets. Each anchor must include:
  - `notePath`
  - `exactPhrase`
  - `startOffset`
  - `endOffset`
  - `occurrenceIndex`
- `exactPhrase` must be the exact substring as found in the live note during verification, preserving live casing and punctuation.
- Phrase-anchor data must be captured during runtime verification or immediately after quote resolution, then stored on the assistant turn in session data. Do not try to reconstruct phrase anchors later from only `sourceQuote` text.
- Inline citation rendering must be driven by persisted phrase anchors, not by ad hoc string search at render time.
- If quote matching succeeds only through the current fuzzy path and no exact phrase span can be recovered, keep the claim card but do not emit an inline phrase-jump citation for that claim.
- Keep step-detail data persisted on the same assistant turn object as progress steps and claims. Store only UI-needed data:
  - retriever note count, top note paths, retriever brief
  - synthesizer summary, draft-claim count, raw JSON
  - verifier counts and compact reasons
  - total and per-step timing in milliseconds
- Do **not** persist full retrieved note bodies.
- Keep timing stored as numeric milliseconds, not formatted strings.
- Session sanitization must treat new phrase-anchor fields and research-result fields as optional so legacy turns remain readable.
- Legacy turns missing phrase-anchor data must render without inline citations and without crashes.
- Keep implementation in the current imperative renderer in `src/view.ts`; do not add a new framework or a detached transparency pane.

---

## Phase 4 Copy and Label Inventory

| Element | Required Label |
|---------|----------------|
| Primary result heading | `Research result` |
| Failure heading | `Research result unavailable` |
| Step titles | `Retriever`, `Synthesizer`, `Verifier` |
| Step pending copy | `Waiting for step to finish.` |
| Step missing copy | `No details captured.` |
| Synthesizer JSON label | `Raw JSON` |
| Claim-card disclosure closed | `Show evidence` |
| Claim-card disclosure open | `Hide evidence` |
| Claim-note action | `Open source note` |
| Failed citation fallback | `Citation target no longer matches the live note.` |

Do not ship visible labels `Agent work`, `Run details`, or `Run metadata`.

---

## Implementation Notes for This Revision

- `src/view.ts` currently renders a separate `Run details` surface after the summary. Remove that pattern entirely.
- `src/view.ts` should convert the existing `.open-agent-pack-step` rows into expandable rows rather than rendering a separate `.open-agent-pack-info-*` section.
- `src/packs/runtime.ts` currently persists timing and transparency details but does not capture exact phrase anchors for citations. Extend runtime result types accordingly.
- `src/sessions.ts` currently stores note path and quote text only. Extend stored claim/session types to persist exact-phrase anchors and the final citation-ready research text, while keeping legacy sanitization tolerant.

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved
