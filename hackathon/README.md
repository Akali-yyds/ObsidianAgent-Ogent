# Gemma 4 Good Hackathon Submission

OpenAgent for Obsidian turns a normal vault into a privacy-first research workspace. The core plugin keeps the existing classic chat flow intact, and the new **Grounded Research** pack adds a retriever -> synthesizer -> verifier pipeline that catches hallucinated citations before they reach the user as verified facts.

## Problem

Single-agent note assistants are fast, but they are hard to trust when they summarize across many notes. This submission focuses on a narrow, high-value fix:

- keep the default chat workflow unchanged for everyday use
- add an opt-in grounded-research mode for higher-trust answers
- verify every claim against the live note text before surfacing it as verified
- keep the whole pipeline local-by-default through OpenAI-compatible endpoints that can be served by MLX on Apple silicon

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
| Retriever | `http://127.0.0.1:8081/v1` | `gemma-4-4b-it` | Pull likely notes and summarize the strongest evidence. |
| Synthesizer | `http://127.0.0.1:8082/v1` | `gemma-4-31b-it` | Produce `claims-v1` JSON grounded in the retrieved notes. |
| Verifier | `http://127.0.0.1:8083/v1` | `gemma-4-4b-it` | Check whether each cited quote actually supports the claim. |

Key code paths:

- `src/agents/` - reusable agent runtime, orchestrator, structured output, quote match, verifier
- `src/packs/` - pack schema, bundled defaults, pipeline runtime
- `src/view.ts` - chat panel mode switch, pack execution, verification rendering, recovery UI
- `hackathon/eval/` - committed fixture vault, query corpus, deterministic eval harness

## Local Gemma + MLX setup

The bundled `grounded-research.json` pack already points at three local OpenAI-compatible endpoints. The setup job is to bring those endpoints up.

1. Install or update `mlx-lm` in your preferred Python environment.
2. Start three MLX-LM servers. Context7’s current MLX-LM docs show `mlx_lm.server --model <path_or_hf_repo>` as the OpenAI-compatible entrypoint and support explicit host and port flags.

```bash
mlx_lm.server --model <gemma4-retriever-model> --host 127.0.0.1 --port 8081
mlx_lm.server --model <gemma4-synthesizer-model> --host 127.0.0.1 --port 8082
mlx_lm.server --model <gemma4-verifier-model> --host 127.0.0.1 --port 8083
```

Use any MLX-compatible Gemma 4 model path or Hugging Face repo that fits those roles. The plugin only requires that each server expose a standard OpenAI-compatible `/v1/chat/completions` API.

3. Build the plugin from this repo:

```bash
npm install
npm run build
```

4. Copy `main.js`, `styles.css`, and `manifest.json` into `<vault>/.obsidian/plugins/open-agent/`, or use `npm run deploy` with `.vault-path` / `OBSIDIAN_VAULT`.
5. Enable **OpenAgent** in Obsidian.
6. Open the chat panel, keep **Classic** mode for the legacy path, or switch to **Grounded Research** to run the multi-agent pipeline.

### Hosted fallback

The repo also ships `grounded-research.openai.json`. It is identical in structure, but the API keys intentionally remain `replace-me` until a maintainer edits that pack with real credentials.

## Running the eval harness

```bash
npm run eval
```

This command reads `hackathon/eval/fixtures/queries.json`, runs the committed fixture vault through the shared pack runtime twice (baseline and verified), and writes fresh timestamped JSON plus markdown reports under `hackathon/eval/results/`.

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

## Reviewer flow

Use this order when reviewing the submission from the repo:

1. Read `README.md` for the plugin overview and the hackathon banner.
2. Read this file for the hackathon-specific story and setup.
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

## Demo assets

- Demo script: `hackathon/demo/script.md`
- Evaluation harness: `hackathon/eval/run.ts`
- Fixture corpus: `hackathon/eval/fixtures/`
- Hackathon spec: `hackathon/spec.md`
