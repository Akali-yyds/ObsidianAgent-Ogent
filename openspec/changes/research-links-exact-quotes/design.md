## Context

Each research claim card has an "Open source note" button. Today it calls `openStoredNote(claim.sourceNote)`, which just opens the file at the top. The exact-phrase anchor (`exactPhraseAnchor`) is already stored on every verified claim and already drives navigation for the numbered citation links `[1]`, `[2]` in the research result body. The resolution logic (`resolveCitationTarget`) is already implemented in `citations.ts`.

## Goals / Non-Goals

**Goals:**
- Make "Open source note" navigate to the exact quoted passage when anchor data is present
- Reuse the existing resolution and fallback path from `openCitationTarget`

**Non-Goals:**
- Changing the numbered citation link behavior (already correct)
- Adding new UI affordances or changing the card layout
- Modifying session storage or anchor data structures

## Decisions

### Reuse `openCitationTarget` logic, not a new helper

`openCitationTarget` already handles reading the note, resolving the anchor, selecting the passage, and falling back gracefully with a Notice. Rather than duplicating the logic, the `renderPackClaim` click handler will pass a citation-shaped object (same fields as `ComposedResearchCitation`) built from `claim.exactPhraseAnchor` to `openCitationTarget` when the anchor is present, or fall back to `openStoredNote` when it is not.

**Alternative considered**: Refactor `openStoredNote` to accept an optional anchor — rejected because it changes the contract of a simple helper that is used elsewhere for plain file opens (e.g., step details).

### No fallback change when anchor is absent

Claims without a verified `exactPhraseAnchor` (e.g., `quote-missing` status) continue to open the file without a quote — the current behavior is the right fallback.

## Risks / Trade-offs

- [Anchor stale after note edit] → `resolveCitationTarget` already handles this: it tries stored offsets first, then relocates by phrase scan, and falls back to a Notice if both fail. No new risk.
- [Claims with `exactPhraseAnchor` that map to a different note than `sourceNote`] → `exactPhraseAnchor.notePath` is the authoritative path; `sourceNote` is used only as the fallback open target when no anchor is present.
