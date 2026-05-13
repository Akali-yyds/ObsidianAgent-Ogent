# Phase 2: Testing & Hardening - Research

**Date:** 2026-05-13
**Phase:** 2 - Testing & Hardening
**Status:** Research complete

## Executive Summary

Plan this phase as four workstreams:

1. Test harness setup
2. Regression coverage on the highest-value runtime seams
3. Eval seam extraction plus fixture and report pipeline
4. Targeted hardening fixes surfaced by the new checks

The key planning constraint is that there is currently no test suite, no eval
folder, and no CLI-safe seam below the Obsidian runtime for eval execution. The
plan should therefore establish the test/eval infrastructure first, then use it
to drive the hardening pass.

## Recommended Stack

- **Vitest** as the test runner for this TypeScript repo.
- **Node environment** as the default test environment, since the locked first
  regression wave targets runtime and persistence seams rather than DOM-heavy
  ChatView rendering.
- **tsx** for `npm run eval`, so `hackathon/eval/run.ts` can execute directly
  without a separate build step.
- No browser test stack yet; defer DOM-heavy view tests unless the lighter suite
  proves insufficient.

## Current State Findings

### Infrastructure Gaps

- There is no existing `npm test` script or test framework in `package.json`.
- The repo currently validates with `npm run build` and `npm run lint`.
- `hackathon/` currently contains only `spec.md`; there is no `eval/` tree yet.
- The repo is Node- and Obsidian-runtime-heavy, so tests and eval need explicit
  seams for Obsidian imports and vault access.

### Runtime Surfaces Worth Testing First

- `src/agents/structured-output.ts` — one-retry structured output contract
- `src/agents/orchestrator.ts` — ordered step execution and failure propagation
- `src/packs/loader.ts` — pack discovery, validation, and default pack install
- `src/packs/runtime.ts` — grounded-research pipeline happy path and fail-loud behavior
- `src/agents/quote-match.ts` — deterministic quote presence matching
- `src/sessions.ts` and session I/O paths in `src/main.ts` — pack-turn persistence and corrupted file recovery

## Concrete File Targets

### Test Harness

- `package.json` — add `test`, `test:watch`, `test:coverage`, and `eval`
- `vitest.config.ts` — node environment, aliasing/mocking strategy for `obsidian`, include patterns
- `tests/setup.ts` or `tests/setup/obsidian.ts` — shared Obsidian shim/mocks

### Regression Coverage

- `tests/agents/structured-output.test.ts`
- `tests/agents/orchestrator.test.ts`
- `tests/agents/quote-match.test.ts`
- `tests/packs/loader.test.ts`
- `tests/packs/runtime.test.ts`
- `tests/sessions.test.ts` or `tests/main.session-io.test.ts`

### Eval Harness

- `hackathon/eval/run.ts`
- `hackathon/eval/fixtures/vault/**`
- `hackathon/eval/fixtures/queries.json`
- `hackathon/eval/results/.gitkeep`

## Regression Strategy

### Highest-Value Seams

1. `runStructuredStep` retry and terminal failure behavior
2. `runPipeline` step ordering, progress states, and fail-fast behavior
3. `loadPacks` and `ensureDefaultPacks` validation and default-install behavior
4. `quotePresent` whitespace-normalized match behavior and negative cases
5. `runPack` happy path and explicit configuration failures with deterministic fakes
6. Session reopen and pack-turn persistence behavior

### Test Style

- Use deterministic provider mocks and fixture notes only.
- Avoid live model calls and external network in the regression suite.
- Prefer assertions on typed runtime outputs, result objects, and event sequences
  over assertions on UI text where possible.

## Eval Harness Architecture

- Do not drive eval through the chat UI.
- Run eval against the grounded-research runtime at the pack/pipeline layer.
- Add a seam below `runPack` that exposes enough data to compare baseline and
  verified runs honestly: retrieved notes, raw `claims-v1` output, verification
  records, and final verified summary.
- Make verifier execution toggleable so the baseline path uses the same runtime
  with verifier disabled, matching locked decision D-05.
- Introduce a narrow vault adapter interface for eval so the CLI harness can run
  without depending directly on the full Obsidian runtime.

## Fixture and Report Design

### Fixture Corpus

Use a synthetic committed corpus under `hackathon/eval/fixtures/`:

- `vault/` — markdown notes that act as the fixture vault
- `queries.json` — 20+ balanced queries with metadata

Each query entry should include:

- `id`
- `category` (`single-fact`, `multi-note`, `conflict`, `no-support`, `adversarial`)
- `query`
- optional reviewer hints such as `notesExpected`, `mustCite`, or `mustNotClaim`

### Results Output

Use JSON as the source of truth and markdown as the human-readable summary.

The JSON results should include:

- `runId`
- `timestamp`
- `packId`
- fixture metadata
- aggregate baseline-vs-verified totals
- per-query breakdown
- per-claim buckets: `verified`, `unsupported`, `quote-missing`

The markdown summary should surface the same totals in a reviewer-friendly form.

## Validation Architecture

The phase should validate itself in this order:

1. Establish test and eval entrypoints in `package.json`
2. Add deterministic regression coverage for the new runtime seams
3. Build the eval harness and fixture corpus
4. Run the regression gate: `npm run build && npm run lint && npm test`
5. Run `npm run eval` and inspect baseline-vs-verified outputs
6. Use findings from steps 4 and 5 to drive targeted correctness and safety fixes
7. Re-run the full gate before marking the phase complete

## Hardening Targets

### Correctness and Safety First

- Corrupted session or turn JSON recovery should stop failing silently; Phase 2
  should preserve broken data as backup and recover visibly.
- Pack-mode error handling should map more pack failures to clear recovery paths,
  not just raw messages.
- The bundled OpenAI variant pack should fail early and clearly when placeholder
  API keys are still present.
- Node testability and eval execution should rely on narrow adapters or shims
  instead of importing full Obsidian runtime behavior directly.

### Explicit Non-Goals for This Phase

- Do not add automatic retry or backoff for transient provider/network failures.
- Do not widen mobile feature scope beyond the current safe gating model.
- Do not spend Phase 2 on broad docs or demo polish; reserve that for Phase 3.

## Suggested Planning Shape

### Workstream 1: Test Harness Setup

Establish Vitest, Node-based test setup, Obsidian shims, and npm scripts.

### Workstream 2: Runtime Regression Coverage

Cover the runtime seams added in Phase 1: structured output, orchestration,
pack loading/runtime, quote matching, and session persistence.

### Workstream 3: Eval Harness and Fixtures

Build the CLI harness, the fixture vault, the query corpus, and the JSON +
markdown report generation flow.

### Workstream 4: Hardening Pass

Use regression and eval findings to land targeted fixes in the new runtime,
then re-run the full validation gate and record any remaining manual smoke steps
for desktop and mobile safety.

## Major Risks

1. **CLI eval is blocked** unless retrieval and verifier logic can run through a
   CLI-safe seam rather than direct Obsidian runtime assumptions.
2. **Baseline-vs-verified reporting is incomplete** until the runtime exposes
   the raw synthesis output and verifier-disabled path cleanly.
3. **Session corruption currently hides data loss**, which directly conflicts
   with the locked Phase 2 hardening policy.

## Recommended Outcome

The plan should leave Phase 2 with:

- a reproducible `npm test` regression gate,
- a reproducible `npm run eval` harness with 20+ committed fixture queries,
- timestamped JSON and markdown eval results,
- and a targeted hardening pass that resolves correctness and safety issues
  exposed by those checks without broadening product scope.
