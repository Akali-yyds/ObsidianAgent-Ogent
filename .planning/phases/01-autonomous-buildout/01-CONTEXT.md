# Phase 1: Autonomous Buildout - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

## Phase Boundary

Phase 1 delivers the grounded-research flow end to end inside the existing
Obsidian plugin while keeping the current single-agent experience unchanged by
default. This phase covers the no-behavior-change agent refactor, multi-agent
pipeline and structured output, pack loading, citation verification, and the
first user-facing pack/verification UI needed to run the feature.

## Implementation Decisions

### Pack Session Behavior
- **D-01:** Pack choice is stored per session, not globally and not per message.
- **D-02:** Every new session starts in classic single-agent mode until the user opts into a pack.
- **D-03:** Changing the pack inside a session affects only future turns; prior turns stay as they were.
- **D-04:** Reopening a session restores that session's last selected pack.

### Model Controls with Packs
- **D-05:** When a pack is active, disable the editable single-model header input and replace it with read-only pack/provider/model information.
- **D-06:** If any required agent provider/model entry is missing, fail loudly instead of silently falling back.
- **D-07:** Recovery from a misconfigured pack should let the user switch to classic mode or another pack in-app.
- **D-08:** Returning from pack mode to classic mode restores that session's last classic-model value.

### Grounded Retrieval Scope
- **D-09:** Default retrieval searches the whole vault, but biases toward the active note and its linked neighborhood when one is open.
- **D-10:** If no active note is open, grounded research still runs against the whole vault.
- **D-11:** Explicit note, folder, or tag scoping in the user's prompt overrides the default retrieval behavior.
- **D-12:** Keep the retrieved evidence set focused to roughly 5-8 notes per run.

### Verification Output Policy
- **D-13:** The clean top summary contains only verified claims; flagged claims appear in a separate section below.
- **D-14:** A claim is green only when the quoted text is found in the live note and the verifier judges that quote as supporting the claim.
- **D-15:** A quote-present-but-unsupported claim appears as a yellow warning with the quote and a short explanation visible.
- **D-16:** If every claim is flagged or missing, show a failure-style result with the flagged details and no clean summary.

### the agent's Discretion
No explicit "you decide" areas were delegated. Research and planning may choose
the implementation details within the locked behaviors above, as long as they
preserve the spec build order and current single-agent compatibility.

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and acceptance
- `.planning/PROJECT.md` — project constraints, milestone framing, and locked product boundaries.
- `.planning/REQUIREMENTS.md` — Phase 1 requirement IDs and milestone-wide traceability.
- `.planning/ROADMAP.md` — Phase 1 goal, required execution order, and success criteria.
- `hackathon/spec.md` — authoritative Phase 1 feature contract, acceptance criteria, and requested build order.

### Existing runtime and session model
- `src/main.ts` — ChatView wiring, tool registry setup, and plugin entry points that must remain compatible.
- `src/loop.ts` — current single-agent loop that Phase 1 refactors into a reusable agent abstraction.
- `src/provider.ts` — current OpenAI-compatible provider wrapper to reuse for per-agent pack providers.
- `src/sessions.ts` — persisted session metadata model that should absorb pack state and classic-model restoration.
- `src/settings.ts` — classic provider configuration and default model behavior that pack mode must not silently override.

### Chat UI and platform behavior
- `src/view.ts` — header/transcript UI, session switching, and streaming rendering where pack selection, pack summary, progress, and verification UI must fit.
- `src/platform.ts` — mobile/desktop gating helper; unsupported multi-agent pack UI should hide on mobile.

### Grounding inputs
- `src/tools/vault/search.ts` — vault-wide and scoped search behavior available for retriever logic.
- `src/tools/vault/read.ts` — note read path for source extraction.
- `src/tools/vault/links.ts` — note-neighborhood expansion for active-note bias.

## Existing Code Insights

### Reusable Assets
- `src/view.ts` header/session bar — natural integration point for a pack picker, read-only pack summary, and verification result rendering.
- `src/sessions.ts` session metadata persistence — extendable place to store per-session pack choice and the session's last classic-model value.
- `src/loop.ts` plus `src/types.ts` stream events — reusable basis for agent/pipeline progress and structured-result delivery.
- `src/provider.ts` — reusable OpenAI-compatible provider boundary for pack agents.
- `src/tools/vault/search.ts`, `src/tools/vault/read.ts`, and `src/tools/vault/links.ts` — existing retrieval primitives for grounded note selection.

### Established Patterns
- Session-scoped state already persists through `SessionStore`; pack opt-in should follow the same model.
- The current model override is single-session and single-model; pack mode should not silently reuse it as an implicit override.
- Streaming UI is already event-driven and incremental; pack progress and verifier output should fit that rendering style.
- Mobile behavior is explicitly gated via platform helpers; unsupported pack controls should be hidden instead of disabled-broken.

### Integration Points
- `src/view.ts` for pack selection, pack summary, progress updates, and verification claim cards.
- `src/sessions.ts` for persisting pack choice and restoring classic model state.
- `src/main.ts` for wiring any new pack-aware view dependencies.
- `src/loop.ts` for the no-behavior-change refactor into an agent abstraction before orchestration is added.
- `src/provider.ts` for per-agent provider/model execution from pack definitions.
- `src/tools/vault/search.ts` and `src/tools/vault/links.ts` for active-note-biased retrieval.

## Specific Ideas

- Preserve the current single-agent UX until a user explicitly opts into a pack at the session level.
- Make pack sessions visibly read-only in the header so model behavior is explicit, not surprising.
- Keep verification warnings visible and understandable rather than hiding them behind extra clicks.

## Deferred Ideas

None — discussion stayed within phase scope.

---

*Phase: 1-Autonomous Buildout*
*Context gathered: 2026-05-12*
