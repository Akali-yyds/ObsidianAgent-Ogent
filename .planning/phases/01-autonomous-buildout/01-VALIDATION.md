---
phase: 01
slug: autonomous-buildout
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-13
---

# Phase 01 — Validation Strategy

> Retroactive Nyquist audit reconstructed from executed plans, summaries, and current tests.

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
- **After every plan wave:** Run `npm run build && npm run lint && npm test -- --run && npm run eval`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | RUNT-01 | T-01-01-01 / T-01-01-02 | Classic wrapper still executes the legacy single-agent path and tool loop through the extracted `Agent` runtime. | unit | `npm test -- --run tests/loop.test.ts` | ✅ | ✅ green |
| 01-01-02 | 01 | 1 | RUNT-01 | T-01-01-03 | Mutating tool requests still stop cleanly on denied consent in classic mode. | unit | `npm test -- --run tests/loop.test.ts` | ✅ | ✅ green |
| 01-02-01 | 02 | 2 | STRU-01, STRU-02 | T-01-02-01 / T-01-02-03 | Structured output validates against schema and gets exactly one repair retry. | unit | `npm test -- --run tests/agents/structured-output.test.ts` | ✅ | ✅ green |
| 01-02-02 | 02 | 2 | RUNT-03, STRU-03 | T-01-02-02 / T-01-02-03 | Pipeline emits ordered progress and terminal failure states without hidden retries. | unit | `npm test -- --run tests/agents/orchestrator.test.ts` | ✅ | ✅ green |
| 01-03-01 | 03 | 3 | PACK-01, PACK-03 | T-01-03-01 / T-01-03-02 | Default packs install into the plugin folder and pack files load with schema validation. | unit | `npm test -- --run tests/packs/loader.test.ts` | ✅ | ✅ green |
| 01-03-02 | 03 | 3 | RUNT-02, RUNT-04, PACK-04, VERF-01 | T-01-03-01 / T-01-03-02 | Pack runtime resolves per-agent provider mappings, stays read-only on the happy path, and returns claim-based results. | integration | `npm test -- --run tests/packs/runtime.test.ts` | ✅ | ✅ green |
| 01-03-03 | 03 | 3 | VERF-02, VERF-03, VERF-04 | T-01-03-03 / T-01-03-04 | Quote matching and verifier decisions preserve note/quote trace data and distinguish support from quote presence. | unit | `npm test -- --run tests/agents/quote-match.test.ts tests/agents/verifier.test.ts` | ✅ | ✅ green |
| 01-04-01 | 04 | 4 | PACK-02 | T-01-04-01 | Session-scoped mode switching stores the selected pack and keeps classic-model restoration data. | unit | `npm test -- --run tests/sessions.test.ts tests/view.test.ts` | ✅ | ✅ green |
| 01-04-02 | 04 | 4 | PACK-05, UI-03 | T-01-04-03 | Mobile hides unsupported multi-agent packs and pack turns render model attribution. | unit | `npm test -- --run tests/view.test.ts` | ✅ | ✅ green |
| 01-04-03 | 04 | 4 | VERF-05, UI-01, UI-02 | T-01-04-02 / T-01-04-04 | Claim cards keep flagged states visible, default verified details collapsed, and support source-note navigation. | unit | `npm test -- --run tests/view.test.ts tests/agents/verifier.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-13
