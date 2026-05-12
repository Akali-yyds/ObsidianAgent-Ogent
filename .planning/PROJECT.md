# OpenAgent for Obsidian

## What This Is

OpenAgent is an Obsidian plugin that lets users run a vault-aware AI agent inside
their vault with bring-your-own-model settings, consented tool use, and
cross-platform support. Today it ships a single-agent chat experience with vault
read/write tools; this milestone extends it with an opt-in grounded research flow
for the Gemma 4 Good Hackathon.

## Core Value

Users can safely run a vault-aware AI agent inside Obsidian without giving up
control over their model endpoint, data flow, or write permissions.

## Requirements

### Validated

- ✓ Single-agent chat panel with streaming responses and per-session history
- ✓ OpenAI-compatible provider settings with BYOK storage in plugin data
- ✓ Vault list/read/search/metadata/links tools and consented write/append/edit
- ✓ Cross-platform Obsidian plugin baseline for desktop and mobile

### Active

- [ ] Add an opt-in agent-pack architecture for multi-agent grounded research
- [ ] Verify citations with a dedicated verifier agent and code-level quote matching
- [ ] Load selectable grounded-research pack defaults with per-agent providers
- [ ] Render verifier results and pack selection in the chat panel
- [ ] Add eval harness and submission docs under `hackathon/`

### Out of Scope

- Pack marketplace or in-app pack authoring — not needed for the hackathon deliverable
- Non-linear orchestration patterns — keep this milestone to a linear pipeline
- Write-capable agents in the grounded-research pack — the default pack is read-only by design
- New provider protocols beyond the current OpenAI-compatible approach — avoid unnecessary platform risk
- Behavior changes to the existing single-agent flow when no pack is selected — current usage must stay stable

## Context

- Current plugin entry points and UX live in `src/main.ts`, `src/view.ts`, and `src/settings.ts`.
- The existing single-agent loop lives in `src/loop.ts` with vault tools registered from `src/tools/vault/`.
- Session metadata is stored in plugin data, with turn transcripts persisted as JSON files.
- The hackathon spec lives in `hackathon/spec.md` and targets a privacy-first grounded research assistant using local Gemma via MLX.

## Constraints

- **Tech stack**: TypeScript, current ESLint config, and existing esbuild bundle only — keep the runtime pure JS.
- **Compatibility**: The current single-agent chat flow must keep working unchanged when no pack is selected.
- **Platform**: Mobile must remain safe; hiding multi-agent packs on mobile is acceptable, crashing is not.
- **Dependencies**: Keep additions small and justified; prefer a lightweight schema validator over custom parsing.
- **Safety**: Existing consent rules still apply to mutating tools; grounded research should stay read-only on its happy path.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep the current single-agent path as the default experience | Preserve existing behavior and minimize regression risk while adding hackathon scope | — Pending |
| Introduce agent packs as an opt-in extension point | Add multi-agent behavior without forcing architecture changes on current users | — Pending |
| Keep the default grounded-research pack read-only | Support the trust story and avoid unnecessary consent prompts | — Pending |
| Allow each pack agent to target a different model endpoint | Match the local MLX setup and keep providers swappable via config only | — Pending |

## Current Milestone: v0.1 Grounded Research Hackathon

**Goal:** add an opt-in multi-agent grounded research pack with verified citations,
without changing the existing single-agent flow.

**Target features:**
- Agent abstraction plus linear pipeline orchestrator
- Structured-output validation with one retry
- Verifier agent with code-level quote matching and support checks
- Pack loading plus bundled grounded-research defaults
- Chat UI for pack selection, verifier rendering, and model attribution
- Eval harness and submission documentation under `hackathon/`

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check -> still the right priority?
3. Audit Out of Scope -> reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-12 after milestone v0.1 kickoff*
