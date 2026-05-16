## Why

The "Open source note" button on each claim card opens the file but drops the user at the top, making them manually search for the relevant quote. The exact-phrase anchor data is already stored on every verified claim — it just isn't used when opening the note.

## What Changes

- The "Open source note" button in claim cards navigates to the exact quoted passage (via `exactPhraseAnchor`) instead of just opening the file
- When the anchor cannot be resolved, behavior falls back gracefully to opening the file with a notice (same pattern as citation links)

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `chat-view`: The claim card's source-note navigation now resolves to an exact quote position when anchor data is available

## Impact

- `src/view.ts`: `renderPackClaim` — change the "Open source note" click handler to call the same resolution logic used by `openCitationTarget`
- `src/citations.ts`: no change (resolution logic already correct)
- No API, schema, or session-storage changes needed
