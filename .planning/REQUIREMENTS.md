# Requirements: OpenAgent for Obsidian

**Defined:** 2026-05-12
**Core Value:** Users can safely run a vault-aware AI agent inside Obsidian without giving up control over their model endpoint, data flow, or write permissions.

## v1 Requirements

### Runtime

- [x] **RUNT-01**: User can keep using the current single-agent chat flow unchanged when no pack is selected.
- [x] **RUNT-02**: User can run a linear agent pipeline where each step has its own prompt, provider/model endpoint, and tool allowlist.
- [x] **RUNT-03**: User can see per-step progress while the grounded-research pipeline is running.
- [x] **RUNT-04**: User can run the grounded-research pack without write consent prompts in the happy path.

### Structured Output

- [x] **STRU-01**: User receives a synthesizer result that matches the `claims-v1` schema with summary and claim records.
- [x] **STRU-02**: User gets exactly one retry when a structured-output step returns invalid JSON or schema-invalid output.
- [x] **STRU-03**: User sees a visible failure if structured output is still invalid after the retry.

### Packs

- [x] **PACK-01**: User can load agent packs from `.obsidian/plugins/open-agent/packs/*.json`.
- [x] **PACK-02**: User can select a bundled `grounded-research` pack from the chat panel.
- [x] **PACK-03**: User gets the bundled `grounded-research` pack file copied into the plugin folder when no pack files are present.
- [x] **PACK-04**: User can assign different OpenAI-compatible provider/model endpoints to different agents by editing the pack JSON only.
- [x] **PACK-05**: Mobile user does not see unsupported multi-agent packs that would fail on mobile.

### Verification

- [x] **VERF-01**: User can ask a grounded research question and get a claim-based answer synthesized from vault notes.
- [x] **VERF-02**: User can see whether each claim's quoted text is present in the live source note via whitespace-normalized exact match.
- [x] **VERF-03**: User can see whether a verifier model judges the quoted source text as supporting the claim.
- [x] **VERF-04**: User can trace each claim back to its source note and quoted text.
- [x] **VERF-05**: User can distinguish verified, unsupported, and missing-citation claims in the response.

### Interface

- [x] **UI-01**: User can expand and collapse claim details for each verification result.
- [x] **UI-02**: User can open the cited Obsidian note from a claim result.
- [x] **UI-03**: User can see which model ran the retriever, synthesizer, and verifier for the current response.

### Evaluation

- [x] **EVAL-01**: Maintainer can run `npm run eval` against `hackathon/eval/fixtures/` and produce timestamped JSON and markdown results.
- [x] **EVAL-02**: Maintainer can compare baseline-vs-verified hallucination rate, total claims, total flagged claims, and per-query breakdown in the generated eval reports.
- [x] **EVAL-03**: Maintainer has at least 20 fixture queries with ground truth for the eval harness.

### Documentation

- [x] **DOCS-01**: Contributor can follow `hackathon/README.md` for the hackathon problem, architecture, local Gemma + MLX setup, and eval results.
- [x] **DOCS-02**: Contributor can use `hackathon/demo/script.md` as the demo script for the submission.

## v2 Requirements

### Packs

- **PACK-06**: User can author and edit agent packs from the plugin UI instead of editing JSON by hand.

### Orchestration

- **RUNT-05**: User can run non-linear orchestration patterns such as routing or graph-based agent flows.

### Verification

- **VERF-06**: User can inspect a verifier confidence score alongside the support decision for each claim.

### Interface

- [ ] **UI-04**: User can inspect grounded-research transparency by clicking the existing Retriever, Synthesizer, and Verifier step blocks instead of opening a separate `Agent work` surface.
- [ ] **UI-05**: User receives a primary `Research result` answer rendered as prose-like research text with inline citation links for claims that have exact phrase anchors.
- [x] **UI-06**: User can click an inline citation and jump to the exact matched phrase in the source note when anchor data exists, while claim cards still provide safe fallback evidence and note-opening behavior.
- [x] **UI-07**: User can see per-step and total timing in the reused transcript surfaces, and Classic/legacy turns stay safe when step-detail or phrase-anchor data is absent.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Pack marketplace | Not required for the hackathon deliverable |
| In-app pack authoring | JSON-based packs are sufficient for this milestone |
| Non-markdown or non-Obsidian vault sources | The pack is grounded in the current vault only |
| Multi-agent write tools | The default grounded-research pack is intentionally read-only |
| New provider protocols beyond the current OpenAI-compatible path | Keep the implementation compatible with the existing provider layer |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RUNT-01 | Phase 1 | Complete |
| RUNT-02 | Phase 1 | Complete |
| RUNT-03 | Phase 1 | Complete |
| RUNT-04 | Phase 1 | Complete |
| STRU-01 | Phase 1 | Complete |
| STRU-02 | Phase 1 | Complete |
| STRU-03 | Phase 1 | Complete |
| PACK-01 | Phase 1 | Complete |
| PACK-02 | Phase 1 | Complete |
| PACK-03 | Phase 1 | Complete |
| PACK-04 | Phase 1 | Complete |
| PACK-05 | Phase 1 | Complete |
| VERF-01 | Phase 1 | Complete |
| VERF-02 | Phase 1 | Complete |
| VERF-03 | Phase 1 | Complete |
| VERF-04 | Phase 1 | Complete |
| VERF-05 | Phase 1 | Complete |
| UI-01 | Phase 1 | Complete |
| UI-02 | Phase 1 | Complete |
| UI-03 | Phase 1 | Complete |
| EVAL-01 | Phase 2 | Complete |
| EVAL-02 | Phase 2 | Complete |
| EVAL-03 | Phase 2 | Complete |
| DOCS-01 | Phase 3 | Complete |
| DOCS-02 | Phase 3 | Complete |
| UI-04 | Phase 4 | Planned |
| UI-05 | Phase 4 | Planned |
| UI-06 | Phase 4 | Complete |
| UI-07 | Phase 4 | Complete |

**Coverage:**
- total requirements: 29
- Mapped to phases: 29
- Unmapped: 0 ✓
- Completed: 27

---
*Requirements defined: 2026-05-12*
*Last updated: 2026-05-14 after Phase 4 redesign re-scope*
