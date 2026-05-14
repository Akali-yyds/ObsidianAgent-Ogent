# Roadmap: OpenAgent for Obsidian

## Overview

This roadmap revises milestone `v0.1 Grounded Research Hackathon` into the user's requested 3-phase flow: build as much as possible autonomously, then harden and validate it, then finish submission polish and run final checks right before hackathon submission. The compressed phase structure still preserves the spec's internal implementation order: first the no-behavior-change agent refactor, then pipeline and structured output, then pack loading and verifier work, then UI, then eval/docs/finalization.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Autonomous Buildout** - Land the grounded-research feature set end to end while keeping the default single-agent path stable.
- [x] **Phase 2: Testing & Hardening** - Validate the new flow, measure verifier impact, and fix regressions before submission prep.
- [x] **Phase 3: Submission Polish & Final Verification** - Finish submission-facing assets and run the last pre-submission checks.

## Phase Details

### Phase 1: Autonomous Buildout
**Goal**: Users can keep the existing single-agent experience by default and can also run the new grounded-research pack end to end inside Obsidian.
**Depends on**: Nothing (first phase)
**Requirements**: RUNT-01, RUNT-02, RUNT-03, RUNT-04, STRU-01, STRU-02, STRU-03, PACK-01, PACK-02, PACK-03, PACK-04, PACK-05, VERF-01, VERF-02, VERF-03, VERF-04, VERF-05, UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. User can keep using the current single-agent chat flow unchanged when no pack is selected.
  2. When pack files are absent, bundled grounded-research packs are copied in, load from disk, can be selected from the chat panel, can target per-agent provider/model endpoints through pack JSON edits, and unsupported multi-agent packs stay hidden on mobile.
  3. User can run the grounded-research pack as a linear, read-only pipeline, see step-by-step progress, and avoid write consent prompts in the happy path.
  4. User receives a claim-based result that matches the `claims-v1` schema, gets exactly one repair retry for invalid structured output, and sees a clear failure if that retry still produces invalid output.
  5. User can inspect per-claim verification state, expand or collapse claim details, open the cited note, trace quotes back to source text, distinguish verified vs unsupported vs missing-citation claims, and see which model ran each agent.
**Plans**: 4 plans
**UI hint**: yes

Plans:
- [x] 01-01: Refactor the current turn loop into a reusable Agent abstraction with no behavior change to the default single-agent path.
- [x] 01-02: Add the linear orchestrator, typed step context, structured-output validation, one retry, and progress/error plumbing.
- [x] 01-03: Add pack schemas/loading/default-pack installation plus verifier quote matching and verifier execution.
- [x] 01-04: Add pack selection, verifier rendering, source navigation, model attribution, and mobile-safe UI gating.

### Phase 2: Testing & Hardening
**Goal**: Maintainers can measure grounded-research quality, validate the new runtime against regressions, and harden it before submission packaging starts.
**Depends on**: Phase 1
**Requirements**: EVAL-01, EVAL-02, EVAL-03
**Success Criteria** (what must be TRUE):
  1. Maintainer can run `npm run eval` against `hackathon/eval/fixtures/` and get timestamped JSON and markdown result files.
  2. Eval output shows baseline-vs-verified hallucination rate, total claims, total flagged claims, and per-query breakdown.
  3. The eval fixture set contains at least 20 grounded queries with ground truth data.
  4. The default chat path and grounded-research path both pass the planned regression and hardening checks before the project moves into submission prep.
**Plans**: 3 plans

Plans:
- [x] 02-01: Add regression coverage for the refactor, structured-output retry behavior, pack loading, quote matching, and pipeline execution.
- [x] 02-02: Build the eval harness, fixture corpus, report generation, and npm entrypoint.
- [x] 02-03: Run a hardening pass from test/eval findings and verify desktop/mobile safety before the final phase.

### Phase 3: Submission Polish & Final Verification
**Goal**: Contributors can reproduce the hackathon story, demo it clearly, and perform a final pre-submission smoke test from the repo.
**Depends on**: Phase 2
**Requirements**: DOCS-01, DOCS-02
**Success Criteria** (what must be TRUE):
  1. Contributor can follow `hackathon/README.md` for the hackathon problem, architecture, local Gemma + MLX setup, and eval results.
  2. Contributor can use `hackathon/demo/script.md` as the submission demo script.
  3. Maintainer can run the documented pre-submission flow end to end and confirm the shipped plugin behavior still matches the docs and demo script.
**Plans**: 2 plans

Plans:
- [x] 03-01: Write the hackathon README, demo script, and repo pointers needed for reviewers.
- [x] 03-02: Run final smoke testing, fix last-mile polish issues, and prepare the submission handoff.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Autonomous Buildout | 4/4 | Complete | 2026-05-13 |
| 2. Testing & Hardening | 3/3 | Complete | 2026-05-13 |
| 3. Submission Polish & Final Verification | 2/2 | Complete | 2026-05-13 |
| 4. Improve agent work transparency UI | 2/2 | Complete   | 2026-05-14 |

### Phase 4: Improve agent work transparency UI

**Goal:** Users can inspect balanced, demo-friendly transparency details for grounded-research turns without changing the lightweight Classic-mode experience.
**Requirements**: UI-04, UI-05, UI-06, UI-07
**Depends on:** Phase 3
**Plans:** 2/2 plans complete

**Success Criteria** (what must be TRUE):
  1. Grounded-research turns render an `Agent work` section with Retriever, Synthesizer, Verifier, and Run metadata cards.
  2. Users can expand one card at a time to inspect intermediate agent work without leaving the transcript or opening a separate pane.
  3. Users can see retriever note/path summary, synthesizer draft-claim summary/raw JSON, verifier status counts/reasons, and total/per-step timing.
  4. Classic turns and legacy stored pack turns remain safe: no new transparency UI is shown when supporting data is absent.

Plans:
- [x] 04-01: Add runtime timing capture and persisted transparency payloads for grounded-research runs.
- [x] 04-02: Render and style the `Agent work` cards in the transcript with regression coverage.
