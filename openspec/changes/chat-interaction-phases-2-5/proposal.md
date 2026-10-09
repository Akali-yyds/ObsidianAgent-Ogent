# Chat interaction phases 2–5

## Why

Ogent's chat has streaming and approval UI, but long conversations and concurrent sessions expose unstable rendering, transient queues, and shared approval/undo state. The chat should remain predictable while users read older content or work in another session.

## What changes

- Give persisted turns and assistant segments stable identities and migrate older history without changing its order or text.
- Keep streaming and approval updates local to the owning turn; preserve reading position, disclosure state, and focus.
- Persist per-session access scope and unsent queue entries; permit up to two concurrent session runs, with session-owned approvals and explicit status.
- Serialize vault/Git writes and revalidate after approval; do not auto-replay queued work after restart.
- Window long transcripts and render only a bounded number of message rows, retaining interaction state for important cards.
- Complete chat localization, responsive behavior, keyboard/focus support, and screen-reader status announcements.

## Out of scope

- GitHub commits, releases, or Obsidian Community submission.
- Changing the `execute_commands` model protocol or weakening existing vault, Git, or approval boundaries.
- Claims of manual desktop/mobile acceptance without testing on those devices.

## Acceptance

Each phase passes relevant automated tests, type-check, lint, and desktop/mobile production builds before local deployment. Device-only checks are recorded as pending when the device is unavailable. A fixed 500-round sample is used for transcript performance measurement; measured results and environment are recorded rather than assumed.
