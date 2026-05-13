# Phase 2: Testing & Hardening - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

## Phase Boundary

Phase 2 validates and hardens the grounded-research runtime added in Phase 1.
This phase adds regression coverage for the refactor and new pack runtime, builds
the eval harness and fixture corpus, and fixes correctness and safety issues
found by those checks before the project moves into submission prep. This phase
does not broaden product scope or spend time on general submission polish.

## Implementation Decisions

### Regression Harness
- **D-01:** Use Vitest as the Phase 2 test runner.
- **D-02:** First-wave regression coverage targets runtime and persistence surfaces first: agent/orchestrator, structured-output retry behavior, pack loading/runtime, quote matching, and session persistence before DOM-heavy ChatView tests.
- **D-03:** The main regression gate for this phase is `npm run build && npm run lint && npm test`.
- **D-04:** Regression tests use deterministic mocks and fixture data only, not live model or network calls.

### Eval Corpus and Scoring
- **D-05:** Eval compares the verified grounded-research flow against the same grounded-research flow with the verifier step disabled, so verifier impact is isolated cleanly.
- **D-06:** Ship a synthetic in-repo fixture vault under `hackathon/eval/fixtures/vault/`.
- **D-07:** The fixture corpus should contain a balanced set of 20+ queries spanning single-note facts, multi-note synthesis, conflicting evidence, and no-support or adversarial prompts.
- **D-08:** Eval reports emphasize claim-level buckets (`verified`, `unsupported`, `quote-missing`) plus a per-query rollup.

### Hardening Priorities
- **D-09:** Keep transient provider and network failures as fail-loud plus manual retry in Phase 2; do not add automatic retry semantics late in the milestone.
- **D-10:** Corrupted saved sessions or turn files should recover safely but visibly, and preserve broken data as backup when practical.
- **D-11:** Mobile validation should keep the current hide-and-recover behavior for unsupported packs and add targeted checks plus a manual smoke checklist instead of widening mobile scope.
- **D-12:** When hardening exposes more work, prioritize correctness and safety fixes in the new runtime before broader polish or documentation cleanup.

### the agent's Discretion
Implementation details remain flexible as long as they preserve the decisions
above, keep the Phase 1 single-agent path stable, and do not broaden scope past
testing, eval, and hardening.

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and acceptance
- `.planning/PROJECT.md` — project constraints, milestone framing, and locked product boundaries.
- `.planning/REQUIREMENTS.md` — Phase 2 requirement IDs and milestone-wide traceability.
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria, and planned work order.
- `.planning/STATE.md` — current milestone position and known concerns after Phase 1.
- `hackathon/spec.md` — eval expectations, fixture/result contract, and milestone build order.

### Phase 1 outputs to harden
- `.planning/phases/01-autonomous-buildout/01-01-SUMMARY.md` — classic runtime refactor outcome.
- `.planning/phases/01-autonomous-buildout/01-02-SUMMARY.md` — orchestrator and structured-output outcome.
- `.planning/phases/01-autonomous-buildout/01-03-SUMMARY.md` — pack/runtime/verifier outcome.
- `.planning/phases/01-autonomous-buildout/01-04-SUMMARY.md` — session/UI/mobile gating outcome.

### Existing runtime and risk surfaces
- `src/agents/agent.ts` — extracted runtime loop and tool execution.
- `src/agents/orchestrator.ts` — linear pipeline state transitions.
- `src/agents/structured-output.ts` — schema validation and single retry path.
- `src/agents/schemas/claims-v1.ts` — structured claim contract for eval and fixtures.
- `src/agents/quote-match.ts` — deterministic quote presence logic that needs regression coverage.
- `src/agents/verifier.ts` and `src/agents/retrieval.ts` — claim verification and evidence gathering behavior.
- `src/packs/loader.ts` and `src/packs/runtime.ts` — pack validation, loading, and execution entrypoints.
- `src/view.ts`, `src/platform.ts`, and `src/sessions.ts` — session-scoped mode state, mobile gating, and persisted pack turns.
- `src/provider.ts` — network and provider failure handling.
- `src/tools/validate.ts`, `src/tools/vault/path-safe.ts`, and `src/consent/manager.ts` — argument validation, path safety, and consent edge cases.
- `package.json` — current scripts baseline; Phase 2 must add test and eval entrypoints here.

## Existing Code Insights

### Reusable Assets
- `src/agents/schemas/claims-v1.ts` already defines the structured claim shape the eval harness should score.
- `src/sessions.ts` already persists pack-turn metadata that can be reused for regression fixtures and reopen-state assertions.
- `src/provider.ts` and `src/types.ts` already provide typed error classes and result shapes that tests can assert against.
- Phase 1 already added pack defaults, pack runtime, retrieval, verifier, and mobile gating, so Phase 2 can test and harden those surfaces instead of inventing new architecture.

### Established Patterns
- The repo currently validates changes with npm scripts (`build`, `lint`); new regression and eval work should fit that same script-driven workflow.
- Runtime behavior is already modeled with narrow typed events and explicit error classes; tests should assert against those concrete contracts rather than UI text whenever possible.
- Mobile safety is handled by gating and recovery behavior in the chat view, not by partial multi-agent enablement.

### Integration Points
- `package.json` for `npm test` and `npm run eval`.
- `hackathon/eval/` for the fixture vault, query corpus, runner, and generated results.
- `src/agents/` and `src/packs/` for the main regression and hardening coverage.
- `src/view.ts`, `src/provider.ts`, and `src/sessions.ts` for correctness and safety fixes exposed by testing and eval.

## Specific Ideas

- Keep the eval corpus fully synthetic and checked into the repo so it is reproducible and safe to review.
- Measure verifier impact by toggling verifier execution off within the same grounded-research flow rather than switching to a different product mode.
- Use the hardening pass to fix correctness and safety issues that show up in the new runtime, but leave broader polish and submission-facing cleanup to Phase 3.

## Deferred Ideas

- Automatic retry or backoff for transient provider and network failures.
- Expanding grounded-research support on mobile beyond the current safe gating model.
- Verifier confidence scores in the product UI or eval reporting.
- DOM-heavy end-to-end chat view tests if the lighter regression suite is sufficient for this milestone.

---

*Phase: 2-Testing & Hardening*
*Context gathered: 2026-05-13*
