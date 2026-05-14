---
phase: 03
slug: submission-polish
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-13
last_audited: 2026-05-14
---

# Phase 03 - Validation Strategy

> Retroactive Nyquist audit reconstructed from executed plans, summaries, current docs, and milestone state artifacts.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | ripgrep content checks + npm repo gate |
| **Config file** | n/a |
| **Quick run command** | `rg -n "^> \\*\\*Hackathon build:\\*\\*" README.md && rg -n "^## Problem$" hackathon/README.md && rg -n "^## Architecture$" hackathon/README.md && rg -n "^## Local Gemma \\+ MLX setup$" hackathon/README.md && rg -n "^## Running the eval harness$" hackathon/README.md && rg -n "^## Reviewer flow$" hackathon/README.md && rg -n "127\\.0\\.0\\.1:8000" hackathon/README.md && rg -n "gemma-4-E4B-it-MLX-8bit" hackathon/README.md && rg -n "gemma-4-31B-it-MLX-8bit" hackathon/README.md && rg -n "gemma-4-26B-A4B-it-MLX-8bit" hackathon/README.md && rg -n "Baseline hallucination rate" hackathon/README.md && rg -n "Verified hallucination rate" hackathon/README.md && rg -n "37\\.0%" hackathon/README.md && rg -n "0\\.0%" hackathon/README.md && rg -n "^## Scene 1 - The baseline plugin still works$" hackathon/demo/script.md && rg -n "^## Scene 2 - Switch to Grounded Research$" hackathon/demo/script.md && rg -n "^## Scene 3 - Show claim verification$" hackathon/demo/script.md && rg -n "^## Scene 5 - Show the eval harness$" hackathon/demo/script.md && rg -n "^hackathon/eval/results/\\*$" .gitignore && rg -n "^!hackathon/eval/results/\\.gitkeep$" .gitignore && rg -n "^### Phase 3: Submission Polish & Final Verification$" .planning/ROADMAP.md && rg -n "^\\| 3\\. Submission Polish & Final Verification \\| 2/2 \\| Complete \\| 2026-05-13 \\|$" .planning/ROADMAP.md && rg -n "^\\*\\*Current focus:\\*\\* Milestone complete - submission handoff ready$" .planning/STATE.md && rg -n "Final manual Obsidian smoke pass" .planning/STATE.md && rg -n "^- \\[x\\] \\*\\*DOCS-01\\*\\*:" .planning/REQUIREMENTS.md && rg -n "^- \\[x\\] \\*\\*DOCS-02\\*\\*:" .planning/REQUIREMENTS.md` |
| **Full suite command** | `npm run build && npm run lint && npm test -- --run && npm run eval` |
| **Estimated runtime** | `<10s` quick checks, `~90s` full gate |

---

## Sampling Rate

- **After every task commit:** Run the quick content/state check command
- **After every plan wave:** Run `npm run build && npm run lint && npm test -- --run && npm run eval`
- **Before `/gsd-verify-work`:** Full suite must be green and the live Obsidian smoke pass must be completed
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | DOCS-01,DOCS-02 | — | Root README points reviewers to the submission package, `hackathon/README.md` covers the problem, architecture, local MLX setup, eval results, and reviewer flow, and `hackathon/demo/script.md` covers Classic mode, Grounded Research, claim verification, and eval narration. | docs | `rg -n "^> \\*\\*Hackathon build:\\*\\*" README.md && rg -n "^## Problem$" hackathon/README.md && rg -n "^## Architecture$" hackathon/README.md && rg -n "^## Local Gemma \\+ MLX setup$" hackathon/README.md && rg -n "^## Running the eval harness$" hackathon/README.md && rg -n "^## Reviewer flow$" hackathon/README.md && rg -n "127\\.0\\.0\\.1:8000" hackathon/README.md && rg -n "gemma-4-E4B-it-MLX-8bit" hackathon/README.md && rg -n "gemma-4-31B-it-MLX-8bit" hackathon/README.md && rg -n "gemma-4-26B-A4B-it-MLX-8bit" hackathon/README.md && rg -n "Baseline hallucination rate" hackathon/README.md && rg -n "Verified hallucination rate" hackathon/README.md && rg -n "37\\.0%" hackathon/README.md && rg -n "0\\.0%" hackathon/README.md && rg -n "^## Scene 1 - The baseline plugin still works$" hackathon/demo/script.md && rg -n "^## Scene 2 - Switch to Grounded Research$" hackathon/demo/script.md && rg -n "^## Scene 3 - Show claim verification$" hackathon/demo/script.md && rg -n "^## Scene 5 - Show the eval harness$" hackathon/demo/script.md` | ✅ | ✅ green |
| 03-02-01 | 02 | 1 | DOCS-01,DOCS-02 | — | Generated eval reports stay ignored by default, and roadmap/state/requirements artifacts reflect a completed submission handoff with the remaining manual smoke pass called out. | docs | `rg -n "^hackathon/eval/results/\\*$" .gitignore && rg -n "^!hackathon/eval/results/\\.gitkeep$" .gitignore && rg -n "^### Phase 3: Submission Polish & Final Verification$" .planning/ROADMAP.md && rg -n "^\\| 3\\. Submission Polish & Final Verification \\| 2/2 \\| Complete \\| 2026-05-13 \\|$" .planning/ROADMAP.md && rg -n "^\\*\\*Current focus:\\*\\* Milestone complete - submission handoff ready$" .planning/STATE.md && rg -n "Final manual Obsidian smoke pass" .planning/STATE.md && rg -n "^- \\[x\\] \\*\\*DOCS-01\\*\\*:" .planning/REQUIREMENTS.md && rg -n "^- \\[x\\] \\*\\*DOCS-02\\*\\*:" .planning/REQUIREMENTS.md` | ✅ | ✅ green |
| 03-02-02 | 02 | 1 | DOCS-01,DOCS-02 | — | The documented pre-submission automation remains rerunnable from the repo root through the shared build/lint/test/eval gate. | integration | `npm run build && npm run lint && npm test -- --run && npm run eval` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Obsidian smoke pass matches the reviewer flow and demo script | Phase 3 success criterion 3 | Requires a real Obsidian vault plus desktop/mobile UI interaction | Follow `hackathon/README.md` reviewer flow in order: confirm Classic mode sends a normal response, Grounded Research renders step progress plus verified/flagged claim states, note links and model attribution work, a broken pack shows the recovery guidance, and an unsupported mobile session hides the pack or offers `Use Classic mode`. Record the outcome with the `Manual smoke sign-off record` template in `hackathon/README.md`. |

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
