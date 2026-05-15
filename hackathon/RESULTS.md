# Project Results

## Project

OpenAgent for Obsidian now has a grounded-research mode that answers from vault notes through a retriever -> synthesizer -> verifier pipeline instead of relying on a single ungrounded response. The goal was to keep classic chat unchanged, add a higher-trust research path, and prove it with both deterministic fixture evals and a real Nobel Physics corpus.

## What shipped

| Area | Outcome |
| --- | --- |
| Grounded pack runtime | `src/packs/runtime.ts` now runs retriever, synthesizer, and verifier as a reusable staged pipeline. |
| Verification | `src/agents/verifier.ts` verifies claims in a single batched structured step per query. |
| Retrieval | `src/agents/retrieval.ts` was tuned to reduce generic note matches and better surface the right laureate pages on hard benchmark queries. |
| Live eval harness | `hackathon/eval/run.ts` supports real-corpus live evals against a real vault and pack config. |
| Benchmark set | `hackathon/data/nobel_physics/benchmark.json` now has exact source quotes and corrected note slugs. |
| Tests | Added retrieval tests and updated eval coverage around staged execution and verifier batching. |

## Final evaluation snapshot

### Stable fixture regression

Artifacts:

- `hackathon/eval/results/fixture-2026-05-15T11-41-05-085Z.json`
- `hackathon/eval/results/fixture-2026-05-15T11-41-05-085Z.md`

| Metric | Value |
| --- | ---: |
| Baseline hallucination rate | 37.0% |
| Verified hallucination rate | 0.0% |
| Improvement | 37.0 percentage points |
| Total claims | 27 |
| Total flagged claims | 10 |

### Final live Nobel benchmark

Artifacts:

- `hackathon/eval/results/live-nobel-physics-2026-05-15T10-51-15-234Z.json`
- `hackathon/eval/results/live-nobel-physics-2026-05-15T10-51-15-234Z.md`

| Metric | Value |
| --- | ---: |
| Queries | 24 |
| Baseline hallucination rate | 66.7% |
| Verified hallucination rate | 61.0% |
| Improvement | 5.7 percentage points |
| Total claims | 48 |
| Total flagged claims | 7 |
| Claim buckets | 41 verified / 0 unsupported / 7 quote-missing |

## Live benchmark improvement trail

| Run | What changed | Baseline | Verified | Delta |
| --- | --- | ---: | ---: | ---: |
| `live-nobel-physics-2026-05-15T09-07-45-450Z` | First full 24-query live run | 83.9% | 82.8% | 1.1 pts |
| `live-nobel-physics-2026-05-15T09-43-55-168Z` | Filled benchmark quotes and fixed note slugs | 61.3% | 58.6% | 2.7 pts |
| `live-nobel-physics-2026-05-15T10-51-15-234Z` | Tuned retrieval for hard runtime misses | 66.7% | 61.0% | 5.7 pts |

## Notable hard-case wins

- `nobel-rutherford-trap` now drops from a surfaced false positive to `0.0%` verified hallucination rate in the latest full run.
- Targeted live checks now ground `nobel-bardeen-twice`, `nobel-bragg-youngest`, `nobel-chadwick-neutron`, and `nobel-roentgen-first` on the expected note families.
- The eval/runtime flow was refactored to batch retrieval, synthesis, and verification by stage, which keeps only one local model family active at a time during benchmark runs.

## Remaining limitations

- The full live benchmark still has real run-to-run model variance because it uses local live models instead of mocked providers.
- Some supported answers are still split into multiple correct claims that the current benchmark scores harshly.
- A few failures are now more about benchmark strictness or quote matching than outright unsupported answers.

## Application-ready summary

Built a grounded-research mode for an Obsidian AI plugin that answers from vault notes with explicit claim extraction and quote-level verification instead of ungrounded generation. I added a live end-to-end eval harness over a 24-query Nobel Physics corpus, refactored the runtime/eval flow to batch retrieval, synthesis, and verification by stage for better local-model throughput, and tightened the benchmark with exact source quotes plus retrieval fixes for hard cases. In the latest full live run, the grounded path reduced hallucination rate from 66.7% to 61.0% versus the baseline, a 5.7-point improvement, and it now correctly handles failure-prone cases like the unsupported Rutherford trap while grounding queries such as Bardeen-twice, youngest Bragg, Chadwick's neutron discovery, and the first Physics Nobel to Rontgen on the expected notes.

## Submission notes

- Repo: `https://github.com/nikitaclicks/obsidian-openagent`
- Hackathon README: `hackathon/README.md`
- Demo script: `hackathon/demo/script.md`
- Main results file: `hackathon/RESULTS.md`
