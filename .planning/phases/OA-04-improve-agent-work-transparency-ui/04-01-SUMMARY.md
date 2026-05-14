---
phase: OA-04-improve-agent-work-transparency-ui
plan: 04-01
subsystem: ui
tags: [citations, verifier, runtime, sessions, vitest]

# Dependency graph
requires:
  - phase: Phase 1
    provides: grounded-research verifier, runtime result contracts, and stored pack turns
provides:
  - exact vs fuzzy quote resolution with persisted exact phrase anchors
  - optional citation-ready runtime result fields for grounded-research turns
  - legacy-safe session sanitizing for anchored claims and citation payloads
affects: [phase-4-result-composition, phase-4-transcript-rendering, session-persistence]

# Tech tracking
tech-stack:
  added: []
  patterns: [structured quote-resolution states, optional citation-ready contracts, nested stored-payload sanitizing]

key-files:
  created: [.planning/phases/OA-04-improve-agent-work-transparency-ui/deferred-items.md]
  modified: [src/agents/quote-match.ts, src/agents/verifier.ts, src/packs/runtime.ts, src/sessions.ts, tests/agents/quote-match.test.ts, tests/agents/verifier.test.ts, tests/packs/runtime.test.ts, tests/sessions.test.ts]

key-decisions:
  - "Exact anchors are captured only from whitespace-normalized exact spans, while punctuation/markdown drift stays fuzzy and anchorless."
  - "Runtime and stored-turn citation fields stay optional so legacy and Classic sessions remain readable without migration."
  - "Malformed stored anchors and citations are dropped on load instead of crashing or trusting nested persisted JSON."

patterns-established:
  - "Quote resolution returns exact, fuzzy, or missing so verifier logic can allow support checks without fabricating citation targets."
  - "Citation-ready contracts duplicate anchor metadata at the citation level and sanitize nested payloads independently."

requirements-completed: [UI-06, UI-07]

# Metrics
duration: 4min
completed: 2026-05-14
---

# Phase 4 Plan 04-01: Capture exact phrase anchors and citation-ready contracts Summary

**Exact verifier phrase anchors, optional research result citation contracts, and legacy-safe stored-turn sanitizing for grounded-research sessions.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-14T17:01:27Z
- **Completed:** 2026-05-14T17:05:41Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Added structured quote resolution that distinguishes exact, fuzzy, and missing matches while preserving live-note offsets and occurrence indexing.
- Extended verifier and runtime claim contracts with optional exact phrase anchors plus optional top-level `researchMarkdown` and `citations` fields.
- Hardened stored session loading so malformed nested anchor/citation payloads are stripped without breaking legacy pack turns.

## Task Commits

Each task was committed atomically:

1. **Task 1: Capture exact phrase anchors during quote resolution and verification**
   - `f035eb8` test(OA-04-improve-agent-work-transparency-ui-04-01): add failing anchor verification tests
   - `dc993be` feat(OA-04-improve-agent-work-transparency-ui-04-01): capture exact quote anchors during verification
   - `cd79142` fix(OA-04-improve-agent-work-transparency-ui-04-01): restore verifier schema typing
2. **Task 2: Extend runtime and stored-turn contracts for anchored citation-ready turns with legacy-safe sanitizing**
   - `548ede0` test(OA-04-improve-agent-work-transparency-ui-04-01): add failing citation contract tests
   - `cc6009b` feat(OA-04-improve-agent-work-transparency-ui-04-01): add citation-ready runtime and session contracts

**Plan metadata:** pending final docs/state commit

## Files Created/Modified
- `src/agents/quote-match.ts` - Exposes exact/fuzzy/missing quote resolution with exact phrase offsets and occurrence indexes.
- `src/agents/verifier.ts` - Persists optional `exactPhraseAnchor` data for exact live-note matches and leaves fuzzy matches anchorless.
- `src/packs/runtime.ts` - Adds optional citation-ready result fields and exports the ordered citation contract.
- `src/sessions.ts` - Stores optional anchors/citations and sanitizes malformed nested payloads on load.
- `tests/agents/quote-match.test.ts` - Covers exact anchor capture, duplicate-occurrence indexing, and fuzzy fallback behavior.
- `tests/agents/verifier.test.ts` - Verifies exact anchors are attached only for exact matches while fuzzy matches remain citation-ineligible.
- `tests/packs/runtime.test.ts` - Confirms runtime results safely expose anchored claims and optional citation-ready fields.
- `tests/sessions.test.ts` - Confirms round-trip persistence for anchors/citations and soft failure for malformed nested session payloads.

## Decisions Made
- Used a structured quote-resolution result instead of expanding boolean quote checks so exact anchors and fuzzy verification can share one path.
- Kept `researchMarkdown` and `citations` optional placeholders in runtime/session contracts for 04-02 population rather than fabricating inline citations early.
- Sanitized malformed nested anchor/citation payloads at load time to preserve legacy safety across stored sessions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored verifier schema typing compatibility during repo verification**
- **Found during:** Final verification after Task 2
- **Issue:** Full `tsc --noEmit` failed in `src/agents/verifier.ts` because the verifier schema literal no longer matched the structured-output schema type under the repo's current TypeScript toolchain.
- **Fix:** Added an explicit `StructuredOutputSchema` annotation for the verifier schema literal.
- **Files modified:** `src/agents/verifier.ts`
- **Verification:** `npm test -- --run tests/agents/quote-match.test.ts tests/agents/verifier.test.ts tests/packs/runtime.test.ts tests/sessions.test.ts`, targeted eslint, and rerun full `tsc --noEmit`
- **Committed in:** `cd79142`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix stayed within the touched verifier contract and was required to keep verification focused on plan-owned files.

## Issues Encountered
- Full `tsc --noEmit` still fails in pre-existing `src/main.ts` manifest-dir typing paths unrelated to Plan 04-01. Logged to `.planning/phases/OA-04-improve-agent-work-transparency-ui/deferred-items.md` instead of expanding plan scope.

## Deferred Issues
- `src/main.ts:62` and `src/main.ts:186` still require an existing manifest-dir typing fix outside this plan's file scope before the repository can pass a full TypeScript check.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- 04-02 can now compose `researchMarkdown` and ordered `citations` from persisted verifier anchors without re-deriving phrase spans later.
- Transcript rendering can safely treat legacy turns, fuzzy-only matches, and malformed stored citation payloads as citation-absent rather than crashing or inventing links.

## Self-Check: PASSED
