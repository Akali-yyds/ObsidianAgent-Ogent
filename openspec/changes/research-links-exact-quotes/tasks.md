## 1. Wire anchor navigation into the claim card button

- [x] 1.1 In `renderPackClaim` (`src/view.ts`), change the "Open source note" click handler: when `claim.exactPhraseAnchor` is present, call `openCitationTarget` with a citation object built from the anchor instead of calling `openStoredNote`
- [x] 1.2 When `claim.exactPhraseAnchor` is absent, keep the existing `openStoredNote(claim.sourceNote)` call as the fallback

## 2. Verify behavior

- [ ] 2.1 Build the plugin and install it; run a research query that produces verified claims, click "Open source note" on a verified claim and confirm the note opens with the quoted passage selected
- [ ] 2.2 Confirm that clicking "Open source note" on a `quote-missing` claim still opens the file at the top without errors
