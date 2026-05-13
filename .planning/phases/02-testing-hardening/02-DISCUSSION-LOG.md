# Phase 2: Testing & Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the selected answers.

**Date:** 2026-05-13
**Phase:** 2-Testing & Hardening
**Areas discussed:** Regression harness, Eval corpus and scoring, Hardening priorities

---

## Regression Harness

| Question | Selected |
|----------|----------|
| Which test runner should Phase 2 add? | Vitest |
| What should the first regression wave cover? | Runtime and persistence first |
| What should become the Phase 2 regression gate? | `npm run build && npm run lint && npm test` |
| How should regression tests handle model and vault dependencies? | Deterministic mocks and fixtures only |

---

## Eval Corpus and Scoring

| Question | Selected |
|----------|----------|
| What should the eval compare the verified path against? | The same grounded-research flow without the verifier step |
| What fixture source should ship in-repo? | Synthetic fixture vault under `hackathon/eval/fixtures/vault/` |
| How should the 20+ eval queries be distributed? | Balanced coverage across single-note, multi-note, conflicting-evidence, and adversarial/no-support prompts |
| What scoring granularity should the report emphasize? | Claim-level buckets plus per-query rollup |

---

## Hardening Priorities

| Question | Selected |
|----------|----------|
| How should Phase 2 handle transient network/provider failures? | Fail loud with manual retry |
| How should corrupted saved sessions/turn files recover? | Recover safely but visibly |
| How should mobile hardening be validated? | Targeted mobile checks plus a manual smoke checklist |
| When hardening finds additional issues, what should Phase 2 prioritize? | Correctness and safety fixes in the new runtime first |
