# Requirements: OpenAgent for Obsidian

**Defined:** 2026-05-12
**Core Value:** Users can safely run a vault-aware AI agent inside Obsidian without giving up control over their model endpoint, data flow, or write permissions.

## v1 Requirements

### Runtime

- [ ] **RUNT-01**: User can keep using the current single-agent chat flow unchanged when no pack is selected.
- [ ] **RUNT-02**: User can run a linear agent pipeline where each step has its own prompt, provider/model endpoint, and tool allowlist.
- [ ] **RUNT-03**: User can see per-step progress while the grounded-research pipeline is running.
- [ ] **RUNT-04**: User can run the grounded-research pack without write consent prompts in the happy path.

### Structured Output

- [ ] **STRU-01**: User receives a synthesizer result that matches the `claims-v1` schema with summary and claim records.
- [ ] **STRU-02**: User gets exactly one retry when a structured-output step returns invalid JSON or schema-invalid output.
- [ ] **STRU-03**: User sees a visible failure if structured output is still invalid after the retry.

### Packs

- [ ] **PACK-01**: User can load agent packs from `.obsidian/plugins/open-agent/packs/*.json`.
- [ ] **PACK-02**: User can select a bundled `grounded-research` pack from the chat panel.
- [ ] **PACK-03**: User gets bundled `grounded-research` and `grounded-research.openai` pack files copied into the plugin folder when no pack files are present.
- [ ] **PACK-04**: User can assign different OpenAI-compatible provider/model endpoints to different agents by editing the pack JSON only.
- [ ] **PACK-05**: Mobile user does not see unsupported multi-agent packs that would fail on mobile.

### Verification

- [ ] **VERF-01**: User can ask a grounded research question and get a claim-based answer synthesized from vault notes.
- [ ] **VERF-02**: User can see whether each claim's quoted text is present in the live source note via whitespace-normalized exact match.
- [ ] **VERF-03**: User can see whether a verifier model judges the quoted source text as supporting the claim.
- [ ] **VERF-04**: User can trace each claim back to its source note and quoted text.
- [ ] **VERF-05**: User can distinguish verified, unsupported, and missing-citation claims in the response.

### Interface

- [ ] **UI-01**: User can expand and collapse claim details for each verification result.
- [ ] **UI-02**: User can open the cited Obsidian note from a claim result.
- [ ] **UI-03**: User can see which model ran the retriever, synthesizer, and verifier for the current response.

### Evaluation

- [ ] **EVAL-01**: Maintainer can run `npm run eval` against `hackathon/eval/fixtures/` and produce timestamped JSON and markdown results.
- [ ] **EVAL-02**: Maintainer can compare baseline-vs-verified hallucination rate, total claims, total flagged claims, and per-query breakdown in the generated eval reports.
- [ ] **EVAL-03**: Maintainer has at least 20 fixture queries with ground truth for the eval harness.

### Documentation

- [ ] **DOCS-01**: Contributor can follow `hackathon/README.md` for the hackathon problem, architecture, local Gemma + MLX setup, and eval results.
- [ ] **DOCS-02**: Contributor can use `hackathon/demo/script.md` as the demo script for the submission.

## v2 Requirements

### Packs

- **PACK-06**: User can author and edit agent packs from the plugin UI instead of editing JSON by hand.

### Orchestration

- **RUNT-05**: User can run non-linear orchestration patterns such as routing or graph-based agent flows.

### Verification

- **VERF-06**: User can inspect a verifier confidence score alongside the support decision for each claim.

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
| RUNT-01 | Phase 1 | Pending |
| RUNT-02 | Phase 1 | Pending |
| RUNT-03 | Phase 1 | Pending |
| RUNT-04 | Phase 1 | Pending |
| STRU-01 | Phase 1 | Pending |
| STRU-02 | Phase 1 | Pending |
| STRU-03 | Phase 1 | Pending |
| PACK-01 | Phase 1 | Pending |
| PACK-02 | Phase 1 | Pending |
| PACK-03 | Phase 1 | Pending |
| PACK-04 | Phase 1 | Pending |
| PACK-05 | Phase 1 | Pending |
| VERF-01 | Phase 1 | Pending |
| VERF-02 | Phase 1 | Pending |
| VERF-03 | Phase 1 | Pending |
| VERF-04 | Phase 1 | Pending |
| VERF-05 | Phase 1 | Pending |
| UI-01 | Phase 1 | Pending |
| UI-02 | Phase 1 | Pending |
| UI-03 | Phase 1 | Pending |
| EVAL-01 | Phase 2 | Pending |
| EVAL-02 | Phase 2 | Pending |
| EVAL-03 | Phase 2 | Pending |
| DOCS-01 | Phase 3 | Pending |
| DOCS-02 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-12*
*Last updated: 2026-05-12 after roadmap revision*
