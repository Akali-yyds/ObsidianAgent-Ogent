# Phase 4 Research — Redesign Replan

## Why Phase 4 was reopened

The original Phase 4 implementation drifted from the intended interaction model. It introduced a separate `Agent work` / `Run details` surface instead of reusing the existing grounded-research step blocks, and it still treated the final result as a summary-plus-claims flow rather than a citation-ready research answer.

The approved redesign now targets:

1. Existing `Retriever`, `Synthesizer`, and `Verifier` step rows as the only transparency surface.
2. Whole-row click to expand live/final step details in place.
3. `Research result` prose as the primary result surface.
4. Inline citation links that jump to exact matched phrases in notes.
5. Existing claim cards reused as secondary evidence/details.

## Verified implementation findings

### Renderer / UI

- `src/view.ts` currently renders passive progress rows at the top of `renderPackTurn()` and then appends a separate transparency surface via `renderPackTransparencyInfo()`.
- The separate transparency surface is the wrong interaction model and should be removed.
- The renderer needs a single expanded-step state (one open step at a time) attached to `StoredPackTurnData` instances in memory only.
- Total timing should move near the `Research result` heading or step-stack header, not stay as its own block.

### Runtime / session data

- `agentWork` can remain the stored data contract for step-level details, but it should no longer imply a separate UI section.
- `StoredPackTurnData` needs a persisted primary-result field such as `researchMarkdown`.
- Stored claims need optional exact phrase anchor data:
  - `notePath`
  - `exactPhrase`
  - `startOffset`
  - `endOffset`
  - `occurrenceIndex`
- Session sanitization must keep all new fields optional and drop malformed nested data without breaking legacy turns.

### Verification / anchor capture

- The current quote-matching path only returns a boolean and cannot reconstruct a true exact-phrase jump target later.
- Exact phrase linking requires a richer quote resolution result, ideally:
  - exact match with offsets and occurrence index
  - fuzzy match with no anchor
  - missing match
- Exact anchors should be captured during verification while the live note text is available, not reconstructed later from only `sourceQuote`.
- Fuzzy-only matches must not emit inline exact-phrase citations.

### Result composition

- The current structured schema returns `summary + claims[]`, which is not enough to place inline citations deterministically inside final answer text.
- Planning should include a result-composition layer that creates citation-ready `researchMarkdown`, likely from claim-linked answer structure rather than heuristic text rewriting.

## Safe fallback rules

1. If a claim lacks an exact anchor, keep the claim card and normal note-open behavior, but do not emit an inline citation link in `Research result`.
2. On citation click, validate stored offsets against the current note text.
3. If offsets no longer match, try relocation with `exactPhrase + occurrenceIndex`.
4. If relocation fails, open the note normally and show a fallback message like `Citation target no longer matches the live note.`
5. Legacy turns without `researchMarkdown` or anchors must render without crashes and without fake citations.

## Test implications

### Quote / verifier

- exact-match offsets
- repeated-phrase occurrence indexing
- preserved original casing/punctuation in stored `exactPhrase`
- fuzzy match returns verification support without phrase anchor

### Runtime / sessions

- `researchMarkdown` round-trip
- exact anchor round-trip
- malformed anchor sanitization
- failure paths with partial anchor coverage and no fake citations

### View

- no separate `Agent work` / `Run details` node
- whole-row step expansion
- only one expanded step at a time
- failed-step auto-expand
- inline citation rendering and label reuse
- citation click exact jump and fallback
- claim cards reused as secondary evidence/details
- legacy and Classic safety

## Recommended planning split

Use **3 plans**:

1. **04-01 — Anchor and data-contract work**
   - quote resolution
   - verifier/runtime types
   - session schema and sanitizers

2. **04-02 — Result composition and citation mapping**
   - `researchMarkdown`
   - inline citation mapping
   - fallback behavior when anchors are absent or stale

3. **04-03 — Transcript UI redesign**
   - clickable step rows
   - inline citation rendering and click behavior
   - claim-card reuse
   - styles and regression coverage

## Biggest planning risk

The hardest dependency is not the step-row UI. It is reliable exact-anchor capture plus a citation-ready primary result format. The plan must not treat inline citations as a pure view concern.
