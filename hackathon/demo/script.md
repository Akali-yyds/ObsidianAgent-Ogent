# Demo Script

## Demo goal

Show that OpenAgent keeps the familiar Obsidian chat workflow, adds a higher-trust grounded-research mode, and measures verifier impact with a repeatable eval harness.

## Prep

1. Start the three local MLX-LM servers on ports `8081`, `8082`, and `8083`.
2. Build and install the plugin into a test vault.
3. Open Obsidian with a vault that contains a few notes worth citing.
4. Keep a terminal open with the repo root ready for `npm run eval`.

## Scene 1 - The baseline plugin still works

1. Open the OpenAgent panel.
2. Leave the mode selector on **Classic**.
3. Ask a short question about the current note.
4. Point out that this is the unchanged single-agent path: no pack selection required, no new UI complexity for normal use.

**Line to say:** "The default experience stays lightweight. Grounded research is opt-in, not a forced workflow change."

## Scene 2 - Switch to Grounded Research

1. Change the mode selector to **Grounded Research**.
2. Ask a question that should pull from multiple notes.
3. Pause on the step progress UI while retriever, synthesizer, and verifier run.
4. Call out that each stage can target its own OpenAI-compatible endpoint through pack JSON only.

**Line to say:** "This pack is just configuration plus reusable runtime code. Different endpoints, models, and prompts live in the pack file instead of being hard-coded into the plugin."

## Scene 3 - Show claim verification

1. Expand a verified claim.
2. Open the cited note link.
3. Show one flagged claim if available and explain the difference between:
   - verified
   - unsupported
   - quote-missing
4. Point out the model attribution footer.

**Line to say:** "Verified claims are the ones we trust enough to surface as grounded output. Flagged claims are still inspectable, but they are clearly separated from the verified summary."

## Scene 4 - Highlight recovery and safety

1. Mention that unsupported multi-agent packs stay hidden on mobile.
2. Mention the recovery banner when a pack is misconfigured.
3. Mention that the default grounded-research pack is read-only, so the happy path never triggers write consent prompts.

**Line to say:** "The plugin stays conservative: read-only research by default, explicit recovery when a pack is broken, and a bounded mobile story instead of shipping something unsafe."

## Scene 5 - Show the eval harness

1. In the terminal, run:

```bash
npm run eval
```

2. Open the generated markdown summary in `hackathon/eval/results/`.
3. Call out the latest metrics:
   - 20 committed fixture queries
   - 37.0% baseline hallucination rate
   - 0.0% verified hallucination rate
   - 27 total claims, 10 flagged

**Line to say:** "The verifier is not just a UI flourish. We can measure its effect on a committed fixture corpus and rerun that check before submission."

## Closing

Summarize the value in one sentence:

**Closing line:** "OpenAgent keeps local, user-controlled AI practical inside Obsidian while adding a grounded-research path that makes citation trust visible instead of implicit."
