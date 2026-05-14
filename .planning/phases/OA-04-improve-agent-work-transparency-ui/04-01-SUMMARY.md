---
phase: OA-04-improve-agent-work-transparency-ui
plan: 04-01
subsystem: ui
tags: [transparency, runtime, sessions, vitest]

# Dependency graph
requires:
  - phase: Phase 1
    provides: grounded-research runtime, pack results, and persisted session turns
provides:
  - sanitized grounded-research agent-work payloads with elapsed timing
  - optional stored pack-turn agentWork persistence with legacy-safe loading
  - partial-failure transparency snapshots for live and reload-safe rendering
affects: [phase-4-ui-rendering, transcript-rendering, session-persistence]

# Tech tracking
tech-stack:
  added: []
  patterns: [normalized transparency separate from raw artifacts, optional persisted JSON sanitization]

key-files:
  created: [.planning/phases/OA-04-improve-agent-work-transparency-ui/04-01-SUMMARY.md]
  modified: [src/packs/runtime.ts, src/sessions.ts, tests/packs/runtime.test.ts, tests/sessions.test.ts]

key-decisions:
  - "Keep PackRunResult.artifacts unchanged for eval callers and add a separate transparency payload for UI/state use."
  - "Persist agentWork as an optional schema and drop malformed payloads on load instead of migrating or crashing legacy turns."

patterns-established:
  - "Runtime step-complete and step-failed events can carry sanitized agentWork snapshots for live card activation."
  - "Stored pack turns may include agentWork, but loaders must tolerate its absence and strip invalid nested shapes."

requirements-completed: []

# Metrics
duration: 6min
completed: 2026-05-14
---

# Phase 4 Plan 04-01: Add runtime timing capture and persisted transparency payloads Summary

**Grounded-research runs now emit sanitized retriever/synthesizer/verifier/run transparency with numeric timing and legacy-safe session persistence.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-14T15:00:36Z
- **Completed:** 2026-05-14T15:06:50Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added a normalized `transparency` contract to grounded-research runtime results without changing raw eval artifacts.
- Captured `elapsedMs` totals and per-step timings from runtime step transitions, including partial-failure snapshots.
- Extended stored pack turns with optional `agentWork` persistence and soft validation for malformed payloads.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add runtime timing capture and a UI-safe transparency payload**
   - `311b526` test(OA-04-improve-agent-work-transparency-ui-04-01): add failing runtime transparency coverage
   - `ccd936a` feat(OA-04-improve-agent-work-transparency-ui-04-01): add runtime transparency payloads
2. **Task 2: Extend stored pack turns to persist transparency data without breaking legacy sessions**
   - `fcf593a` test(OA-04-improve-agent-work-transparency-ui-04-01): add failing session transparency coverage
   - `7beb407` feat(OA-04-improve-agent-work-transparency-ui-04-01): persist optional agent work payloads
   - `93090df` fix(OA-04-improve-agent-work-transparency-ui-04-01): clean up session transparency sanitizing

**Plan metadata:** recorded in the final docs/state commit for this plan.

## Files Created/Modified
- `src/packs/runtime.ts` - Defines normalized pack transparency types, event snapshots, elapsed timing capture, and partial-failure `PackRunError` details.
- `src/sessions.ts` - Adds optional stored `agentWork` typing and sanitizes malformed persisted transparency payloads during load.
- `tests/packs/runtime.test.ts` - Covers sanitized success snapshots, per-step timing, live event snapshots, and partial-failure transparency.
- `tests/sessions.test.ts` - Covers round-trip persistence, legacy safety, and malformed `agentWork` soft-failure behavior.

## Decisions Made
- Kept runtime `artifacts` untouched for eval consumers and added normalized transparency beside it for UI persistence and live rendering.
- Stored `agentWork` as an optional contract so Classic turns and legacy pack turns remain unchanged when transparency data is absent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Dropped malformed persisted `agentWork` payloads during session load**
- **Found during:** Task 2 (Extend stored pack turns to persist transparency data without breaking legacy sessions)
- **Issue:** Persisted transparency crossed a trust boundary into the renderer, but malformed nested JSON would have loaded unchecked and risked corrupt UI state.
- **Fix:** Added nested `agentWork` sanitization in `loadStoredTurnsFile()` and removed invalid payloads while preserving the rest of the turn.
- **Files modified:** `src/sessions.ts`, `tests/sessions.test.ts`
- **Verification:** `npm test -- --run tests/sessions.test.ts` and combined runtime/session verification
- **Committed in:** `7beb407`, `93090df`

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** The added sanitization was required by the Phase 4 threat model and did not expand scope beyond persisted-transparency correctness.

## Issues Encountered
- Task 2's initial round-trip tests passed immediately because session JSON already preserved unknown keys; the RED gate was tightened with a malformed-payload case to verify the new contract's soft-failure behavior.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `src/view.ts` can consume live and persisted `agentWork` payloads for `Agent work` card rendering in 04-02.
- Legacy turns still omit `agentWork`, so the next plan can safely hide the new UI when transparency is unavailable.

## Self-Check: PASSED
