# Gemma 4 Hackathon Project

OpenAgent for Obsidian turns a normal vault into a privacy-first research workspace. The core plugin keeps the existing classic chat flow intact, and the new **Grounded Research** pack adds a retriever -> synthesizer -> verifier pipeline that catches hallucinated citations before they reach the user as verified facts. The core impact is that the same local note collection can now support higher-trust, local-only grounded research and agentic workflows without sending vault data to a hosted reasoning stack by default.

## Problem

Single-agent note assistants are fast, but they are hard to trust when they summarize across many notes. This submission focuses on a narrow, high-value fix:

- keep the default chat workflow unchanged for everyday use
- add an opt-in grounded-research mode for higher-trust answers
- verify every claim against the live note text before surfacing it as verified
- keep the whole pipeline local-by-default through OpenAI-compatible endpoints that can be served by MLX on Apple silicon
- orchestrate three Gemma 4 model sizes so local workflows can balance speed, reasoning quality, and verification

## What shipped

| Area | What is in the repo |
| --- | --- |
| Classic mode | The existing single-agent chat path still runs when no pack is selected. |
| Agent packs | `src/packs/` loads bundled and user-edited pack JSON files. |
| Grounded pipeline | `src/packs/runtime.ts` runs retriever, synthesizer, and verifier as a linear pack pipeline. |
| Claim verification | `src/agents/verifier.ts` combines exact quote checks with a verifier model decision. |
| Obsidian UI | `src/view.ts` shows step progress, verified vs flagged claims, note links, and recovery guidance. |
| Eval harness | `hackathon/eval/run.ts` runs the committed fixture corpus and writes timestamped JSON plus markdown reports. |

## Architecture

| Stage | Default endpoint | Default model | Responsibility |
| --- | --- | --- | --- |
| Retriever | `http://127.0.0.1:8000/v1` | `gemma-4-E4B-it-MLX-8bit` | Pull likely notes and summarize the strongest evidence with a smaller fast local model. |
| Synthesizer | `http://127.0.0.1:8000/v1` | `gemma-4-31B-it-MLX-8bit` | Produce `claims-v1` JSON grounded in the retrieved notes with the strongest reasoning model in the stack. |
| Verifier | `http://127.0.0.1:8000/v1` | `gemma-4-26B-A4B-it-MLX-8bit` | Check whether each cited quote actually supports the claim before it is shown as verified. |

Key code paths:

- `src/agents/` - reusable agent runtime, orchestrator, structured output, quote match, verifier
- `src/packs/` - pack schema, bundled defaults, pipeline runtime
- `src/view.ts` - chat panel mode switch, pack execution, verification rendering, recovery UI
- `hackathon/eval/` - committed fixture vault, query corpus, deterministic eval harness

## Local Gemma + MLX setup

The bundled `grounded-research.json` pack currently points all three agents at one local OpenAI-compatible endpoint, `http://127.0.0.1:8000/v1`, with different model ids per stage.

1. Install or start the local OpenAI-compatible server stack you want to use, such as an MLX-backed setup on Apple silicon.
2. Make sure that endpoint exposes these model ids:

   - retriever: `gemma-4-E4B-it-MLX-8bit`
   - synthesizer: `gemma-4-31B-it-MLX-8bit`
   - verifier: `gemma-4-26B-A4B-it-MLX-8bit`

3. If your local stack uses different ports or model names, edit the `providers` block in `grounded-research.json` before building or after the pack is copied into your plugin folder.
4. The plugin only requires a standard OpenAI-compatible `/v1/chat/completions` API at that endpoint.

5. Build the plugin from this repo:

```bash
npm install
npm run build
```

6. Copy `main.js`, `styles.css`, and `manifest.json` into `<vault>/.obsidian/plugins/open-agent/`, or use `npm run deploy` with `.vault-path` / `OBSIDIAN_VAULT`.
7. Enable **OpenAgent** in Obsidian.
8. Open the chat panel, keep **Classic** mode for the legacy path, or switch to **Grounded Research** to run the multi-agent pipeline.

If you want to target a hosted OpenAI-compatible provider instead of local MLX, edit the `providers` block in `grounded-research.json`.

## Running the eval harness

```bash
npm run eval
```

This command reads `hackathon/eval/fixtures/queries.json`, runs the committed fixture vault through the shared pack runtime twice (baseline and verified), and writes fresh timestamped JSON plus markdown reports under `hackathon/eval/results/`.

## Running the live Nobel benchmark

Use the live mode when you want a real-corpus spot check instead of the synthetic fixture harness.

```bash
npm run eval:live -- --pack <path-to-working-pack.json> --benchmark hackathon/data/nobel_physics/benchmark.quick.json
```

Notes:

- `--pack` should point at a grounded-research pack JSON with working provider credentials. The runner accepts pack-id variants such as `grounded-research.openai`.
- `hackathon/data/nobel_physics/benchmark.quick.json` is a compact 4-query same-day slice for fast reruns.
- `hackathon/data/nobel_physics/benchmark.json` is the broader labeled benchmark for deeper follow-up.
- Live mode writes the same timestamped JSON plus markdown reports under `hackathon/eval/results/`.
- `hackathon/RESULTS.md` contains the consolidated project outcomes and the strongest application-ready summary.

### Latest local metrics

The latest run against the committed 20-query corpus produced:

| Metric | Value |
| --- | ---: |
| Baseline hallucination rate | 37.0% |
| Verified hallucination rate | 0.0% |
| Improvement (baseline - verified) | 37.0 percentage points |
| Total claims | 27 |
| Total flagged claims | 10 |
| Claim buckets | 17 verified / 6 unsupported / 4 quote-missing |

The fixture set is balanced across 5 single-fact, 5 multi-note, 4 conflict, 3 no-support, and 3 adversarial queries.

### Latest live Nobel full-run artifact

The latest full 24-query live-corpus run is:

- `hackathon/eval/results/live-nobel-physics-2026-05-15T10-51-15-234Z.json`
- `hackathon/eval/results/live-nobel-physics-2026-05-15T10-51-15-234Z.md`

| Metric | Value |
| --- | ---: |
| Baseline hallucination rate | 66.7% |
| Verified hallucination rate | 61.0% |
| Improvement (baseline - verified) | 5.7 percentage points |
| Total claims | 48 |
| Total flagged claims | 7 |
| Claim buckets | 41 verified / 0 unsupported / 7 quote-missing |

This run reflects the benchmark cleanup plus retrieval tuning done during the hackathon push. It is the best full-corpus snapshot for the submission package today.

### Latest live Nobel quick-run artifact

The latest quick-slice smoke artifact remains:

- `hackathon/eval/results/live-nobel-physics-quick-2026-05-15T06-55-05-480Z.json`
- `hackathon/eval/results/live-nobel-physics-quick-2026-05-15T06-55-05-480Z.md`

Use the quick benchmark when you want a faster local sanity check. Use the full live artifact above when you want the strongest real-dataset result for the hackathon submission.

## Submission review flow

Use this order when reviewing the submission package from the repo:

1. Read `README.md` for the plugin overview and the hackathon banner.
2. Read this file for the submission story, setup, and evaluation context.
3. Review `hackathon/demo/script.md` for the demo narrative.
4. Run the automated gate:

```bash
npm run build && npm run lint && npm test -- --run && npm run eval
```

5. Do the manual smoke pass in Obsidian:
   - confirm **Classic** mode still sends a normal single-agent response
   - switch to **Grounded Research** and run a question that cites existing notes
   - verify that step progress, claim badges, note links, and model attribution render correctly
   - temporarily break a pack config and confirm the recovery banner suggests Classic mode or another pack
   - on mobile or a mobile-like unsupported session, confirm the pack stays hidden or offers **Use Classic mode**

### Manual smoke sign-off record

After the pass, capture the outcome in your PR, release note, or submission checklist with this template:

```text
Smoke pass date:
Environment: desktop / mobile / both
Vault used:
Classic mode:
Grounded Research mode:
Step progress + claim badges:
Source-note links + model attribution:
Broken-pack recovery banner:
Mobile-safe fallback:
Notes:
Signed off by:
```

Mark each line as `pass`, `fail`, or `n/a`, and use `Notes` for anything that needs follow-up before submission.

## Demo assets

- Demo script: `hackathon/demo/script.md`
- Evaluation harness: `hackathon/eval/run.ts`
- Results summary: `hackathon/RESULTS.md`
- Fixture corpus: `hackathon/eval/fixtures/`
- Live Nobel benchmarks: `hackathon/data/nobel_physics/benchmark.quick.json`, `hackathon/data/nobel_physics/benchmark.json`
- Hackathon spec: `hackathon/spec.md`
