---
phase: OA-04-improve-agent-work-transparency-ui
plan: 04-02
subsystem: ui
tags: [citations, runtime, verifier, vitest]

# Dependency graph
requires:
  - phase: Phase 4 Plan 04-01
    provides: exact phrase anchors plus optional runtime/session citation contracts
provides:
  - deterministic `researchMarkdown` composition from exact anchored verified claims
  - ordered citation mappings with label reuse for repeated anchored phrase occurrences
  - safe citation target resolution with offset validation, relocation, and fallback
affects: [phase-4-transcript-rendering, citation-navigation, session-persistence]

# Tech tracking
tech-stack:
  added: []
  patterns: [deterministic citation composition, occurrence-index anchor relocation, runtime-ready citation mapping]

key-files:
  created: [src/citations.ts, tests/citations.test.ts]
  modified: [src/packs/runtime.ts, tests/packs/runtime.test.ts]

key-decisions:
  - "Compose `Research result` directly from exact anchored verified claims instead of rewriting the synthesizer summary heuristically."
  - "Treat the ordered `citations` array index as the stable inline label mapping so the view can render exact-link clicks without recomputing labels."

patterns-established:
  - "Only verified claims with exact phrase anchors are eligible for primary-result citations; fuzzy, unsupported, and quote-missing claims stay secondary evidence only."
  - "Citation clicks validate stored offsets first, then relocate by exact phrase plus occurrence index before falling back safely."

requirements-completed: [UI-05, UI-06]

# Metrics
duration: 2min
completed: 2026-05-14
---

# Phase 4 Plan 04-02: Citation-ready research result composition Summary

**Deterministic research-result markdown now ships with ordered exact-anchor citation mappings and safe live-note relocation for stale targets.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-14T17:13:48Z
- **Completed:** 2026-05-14T17:15:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added a pure citation helper module that composes `researchMarkdown` and ordered citations only from exact anchored verified claims.
- Added citation target resolution that validates stored offsets, relocates by `exactPhrase + occurrenceIndex`, and returns an explicit fallback instead of throwing.
- Wired grounded-research runtime results to persist citation-ready fields while preserving legacy-compatible `verifiedSummary` behavior and absence rules.

## Task Commits

Each task was committed atomically:

1. **Task 1: Build deterministic result-composition and citation-resolution helpers**
   - `d0976f6` test(OA-04-improve-agent-work-transparency-ui-04-02): add failing citation composition tests
   - `a94d334` feat(OA-04-improve-agent-work-transparency-ui-04-02): compose citation-ready research results
2. **Task 2: Populate runtime results with citation-ready research text and ordered citation mappings**
   - `6a05217` test(OA-04-improve-agent-work-transparency-ui-04-02): add failing runtime citation-result tests
   - `2c35681` feat(OA-04-improve-agent-work-transparency-ui-04-02): populate citation-ready runtime results

**Plan metadata:** pending final docs/state commit

## Files Created/Modified
- `src/citations.ts` - Pure helpers for deterministic research-result composition and exact-target resolution with relocation fallback.
- `src/packs/runtime.ts` - Populates `researchMarkdown` and ordered `citations` from anchored verified claims while preserving `verifiedSummary`.
- `tests/citations.test.ts` - Covers ordered labels, label reuse, ineligible-claim filtering, and relocation fallback semantics.
- `tests/packs/runtime.test.ts` - Verifies runtime population, label reuse, safe absence without anchors, and compatibility for verifier-disabled paths.

## Decisions Made
- Built the primary `Research result` from vetted claim text instead of the synthesizer summary so inline citations only appear on evidence-backed content.
- Kept citation labels implicit in markdown order (`[1]`, `[2]`, ...) and the ordered `citations` array so 04-03 can render link clicks without recomputing mappings.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed lint-blocking whitespace in the new citation helper**
- **Found during:** Task 2 verification
- **Issue:** Targeted eslint failed on `src/citations.ts` because the fallback union branch used mixed whitespace indentation.
- **Fix:** Normalized the union indentation so the new helper passes targeted repo lint checks.
- **Files modified:** `src/citations.ts`
- **Verification:** `npm test -- --run tests/citations.test.ts tests/packs/runtime.test.ts` and `npx eslint src/citations.ts src/packs/runtime.ts tests/citations.test.ts tests/packs/runtime.test.ts`
- **Committed in:** `2c35681`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix was verification-only hygiene required to leave the changed files in a clean, shippable state.

## Issues Encountered
- Targeted eslint surfaced mixed indentation in the new helper after runtime integration; fixing it kept the task-scoped verification green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- 04-03 can render `Research result` markdown and clickable inline citations directly from persisted runtime data without reconstructing labels in the view.
- Citation clicks now have a ready-to-use resolver that either returns an exact target or the spec-approved fallback message when notes drift.

## Self-Check: PASSED
