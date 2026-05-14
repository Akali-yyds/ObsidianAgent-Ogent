---
phase: 02
slug: testing-hardening
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-13
last_audited: 2026-05-14
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm run build && npm run lint && npm test -- --run && npm run eval` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm run build && npm run lint && npm test -- --run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds
- **Latency exception:** Phase 02 Plan 03 Task 3 may run the ~90 second full `build + lint + test + eval` gate after a fast smoke pre-check because it is the final checkpoint before Phase 3.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | EVAL-01 | T-02-03 / — | Vitest harness runs deterministically with mocked Obsidian seams and no live provider dependencies. | unit | `npm test -- --run` | ✅ | ✅ green |
| 02-01-02 | 01 | 1 | EVAL-01 | T-02-01 / T-02-02 | Structured output, orchestration, quote match, and pack runtime regressions fail before runtime. | unit | `npm test -- --run tests/agents/structured-output.test.ts tests/agents/orchestrator.test.ts tests/agents/quote-match.test.ts tests/packs/loader.test.ts tests/packs/runtime.test.ts` | ✅ | ✅ green |
| 02-01-03 | 01 | 1 | EVAL-01 | T-02-04 / — | Session persistence and reopen semantics remain stable under regression coverage. | unit | `npm test -- --run tests/sessions.test.ts` | ✅ | ✅ green |
| 02-02-01 | 02 | 2 | EVAL-01 | T-02-07 / — | CLI-safe eval seam executes the shared grounded-research runtime without importing the Obsidian-backed provider path. | integration | `npm test -- --run tests/eval/provider-seam.test.ts tests/eval/run.test.ts` | ✅ | ✅ green |
| 02-02-02 | 02 | 2 | EVAL-03 | T-02-05 / — | Fixture corpus includes 20+ balanced queries with committed ground truth. | data | `node -e "const q=require('./hackathon/eval/fixtures/queries.json'); if(!Array.isArray(q.queries)||q.queries.length<20) throw new Error('need 20+ queries');"` | ✅ | ✅ green |
| 02-02-03 | 02 | 2 | EVAL-01,EVAL-02 | T-02-06 / T-02-08 | Eval runner writes timestamped JSON and markdown with baseline-vs-verified hallucination reporting. | integration | `npm test -- --run tests/eval/run.test.ts tests/eval/provider-seam.test.ts && npm run eval` | ✅ | ✅ green |
| 02-03-01 | 03 | 3 | EVAL-01 | T-02-09 / — | Session recovery fallbacks stay safe and deterministic under corrupted turn-read conditions. | unit | `npm test -- --run tests/sessions.test.ts` | ✅ | ✅ green |
| 02-03-02 | 03 | 3 | EVAL-01 | T-02-10 / T-02-11 / T-02-12 | Placeholder pack config fails fast and mobile-safe runtime behavior remains recoverable. | unit | `npm test -- --run tests/packs/loader.test.ts tests/packs/runtime.test.ts tests/view.test.ts` | ✅ | ✅ green |
| 02-03-03 | 03 | 3 | EVAL-01,EVAL-02,EVAL-03 | T-02-06 / T-02-08 | Full build, lint, test, and eval gate proves both classic and grounded paths remain safe before Phase 3. | integration | `npm run build && npm run lint && npm test -- --run && npm run eval` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Classic no-pack chat path still works after Phase 2 hardening | Phase 2 success criterion 4 | Requires end-to-end Obsidian UI interaction | Open the plugin in desktop Obsidian, start a new session in Classic mode, send a prompt, confirm normal single-agent response flow and no pack UI regression. |
| Existing unsupported mobile pack session can recover back to Classic mode | Phase 2 success criterion 4 | Requires mobile runtime and platform gating behavior | Open the plugin on mobile with a session that previously had an unsupported pack selected, confirm the recovery banner appears, choose `Use Classic mode`, and verify send is restored in Classic mode. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-13

## Validation Audit 2026-05-13

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

## Validation Audit 2026-05-14

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
