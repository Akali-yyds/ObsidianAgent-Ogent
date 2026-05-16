## ADDED Requirements

### Requirement: Claim card source navigation opens exact quote
When a research claim card has a verified exact-phrase anchor, the "Open source note" button SHALL navigate to the quoted passage in the file rather than just opening the file at the top. When no anchor is available, the button SHALL open the file at the top as before.

#### Scenario: Verified claim with anchor — navigates to quote
- **WHEN** the user clicks "Open source note" on a claim card that has a non-null `exactPhraseAnchor`
- **THEN** Obsidian opens the anchor's note and scrolls to the quoted passage with the text selected

#### Scenario: Verified claim with stale anchor — falls back with notice
- **WHEN** the user clicks "Open source note" and the note has been edited so the stored phrase no longer matches
- **THEN** Obsidian opens the file at the top and shows a notice "Citation target no longer matches the live note."

#### Scenario: Claim without anchor — opens file at top
- **WHEN** the user clicks "Open source note" on a claim card that has no `exactPhraseAnchor` (e.g., quote-missing status)
- **THEN** Obsidian opens the source note file at the top with no notice
