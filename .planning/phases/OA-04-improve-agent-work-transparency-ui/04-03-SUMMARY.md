---
phase: OA-04-improve-agent-work-transparency-ui
plan: 04-03
subsystem: ui
tags: [transcript, citations, obsidian, vitest]

# Dependency graph
requires:
  - phase: Phase 4 Plan 04-01
    provides: exact phrase anchors plus optional runtime/session citation contracts
  - phase: Phase 4 Plan 04-02
    provides: citation-ready research markdown and ordered citation mappings
provides:
  - result-first grounded-research transcript rendering with reusable step-row disclosures
  - inline citation links that validate, relocate, and safely fall back when notes drift
  - redesigned claim-card and transcript styling without separate Agent work or Run details panes
affects: [phase-4-ui, transcript-rendering, citation-navigation]

# Tech tracking
tech-stack:
  added: []
  patterns: [result-first transcript rendering, inline citation link interception, single-open disclosure rows]

key-files:
  created: []
  modified: [src/view.ts, styles.css, tests/view.test.ts]

key-decisions:
  - "Render research-result citations with a transcript-local parser so ordered labels stay tied to the persisted citations array."
  - "Keep one expanded step per grounded-research turn and auto-open the failed step instead of reintroducing a second transparency pane."

patterns-established:
  - "Grounded-research turns render in locked order: research result or unavailable copy, step stack, claim cards, model footer."
  - "Citation clicks validate stored offsets first, reuse relocation fallback from resolveCitationTarget(), then fall back to a normal note open with the locked notice."

requirements-completed: [UI-04, UI-05, UI-06, UI-07]

# Metrics
duration: 6min
completed: 2026-05-14
---

# Phase 4 Plan 04-03: Transcript citation redesign Summary

**Grounded-research turns now lead with citation-ready research prose, reuse the existing step rows as the only transparency surface, and jump to exact note phrases with safe fallback behavior.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-14T17:21:19Z
- **Completed:** 2026-05-14T17:27:44Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Replaced the obsolete separate transparency pane with result-first grounded-research transcript rendering and single-open step disclosures.
- Added inline citation links that resolve through `resolveCitationTarget()`, open exact phrase selections when possible, and fall back safely when anchors drift.
- Updated transcript-local styles and regression coverage to lock the approved step-row, evidence-card, timing, and no-result contracts.

## Task Commits

Each task was committed atomically:

1. **Task 1: Redesign pack-turn rendering so existing step rows become the only transparency surface**
   - `c62d1be` test(OA-04-improve-agent-work-transparency-ui-04-03): add failing transcript redesign tests
   - `134957c` feat(OA-04-improve-agent-work-transparency-ui-04-03): redesign step-row transparency UI
2. **Task 2: Render inline citations, exact-jump behavior, and redesign styles with safe fallback**
   - `1196888` test(OA-04-improve-agent-work-transparency-ui-04-03): add failing citation transcript tests
   - `1b0c241` feat(OA-04-improve-agent-work-transparency-ui-04-03): add inline research citations

**Plan metadata:** pending final docs/state commit

## Files Created/Modified
- `src/view.ts` - Renders result-first grounded-research turns, step-row disclosures, inline citation links, exact-jump navigation, and legacy-safe fallbacks.
- `styles.css` - Styles clickable transcript step rows, result metadata, inline citations, and the capped raw JSON block without a separate transparency pane.
- `tests/view.test.ts` - Locks transcript order, step-row detail contracts, claim-card copy, inline citation behavior, timing fallbacks, and no-result copy.

## Decisions Made
- Used a transcript-local citation renderer instead of generic markdown link parsing so citation labels stay aligned with the ordered persisted citation map.
- Kept retriever chips as direct note-open affordances inside the step row while the row itself owns the disclosure state.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The new citation click regression needed an async test flush because note reads and leaf opens resolve on microtasks inside the mocked Obsidian environment.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 4 now satisfies the approved grounded-research transcript contract end to end, including reusable transparency rows and inline citation navigation.
- Remaining project follow-up is the maintainer's manual Obsidian smoke/sign-off already tracked outside this plan.

## Self-Check: PASSED
