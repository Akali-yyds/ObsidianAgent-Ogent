## Phase 2 — stable messages and operation cards

- [x] Add stable IDs to persisted turns and assistant segments; migrate legacy records and test round-trip/order preservation.
- [x] Key turn DOM and live segment updates by stable IDs; keep approval and disclosure state stable through local updates.
- [x] Preserve scroll anchor/focus during approval, rejection, errors, and async Markdown completion; retain the existing new-content affordance.
- [x] Add focused rendering/state tests and run type-check, lint, and tests.

## Phase 3 — queue, approval, and background sessions

- [x] Persist session Access and editable/cancellable queued messages; restore them paused after restart.
- [x] Allow up to two concurrent sessions and keep session activity/approval/failure visible; switch sessions without aborting runs.
- [x] Isolate consent requests and undo checkpoints by session; migrate old sessions to Ask before action.
- [x] Serialize vault/Git writes; acquire the lock after approval and revalidate at execution time.
- [x] Stop and classify in-flight work on unload; add tests for cross-session approval and queue behavior.

## Phase 4 — long conversation performance

- [x] Render a bounded transcript window and load older turns on upward scroll while preserving a stable visible anchor.
- [x] Cache completed Markdown by content and keep expanded/editing/approval state outside recycled DOM.
- [x] Add a deterministic 500-round fixture for repeatable long-transcript testing.
- [ ] Record first-interaction, input, and scroll measurements on a benchmark desktop; validate memory/usability on a mobile device.
- [x] Build the production bundle and verify it has no top-level Node/Electron imports.
- [ ] Complete hands-on mobile-device validation; automated tests/build do not substitute for device measurements.

## Phase 5 — language, mobile, and accessibility

- [x] Localize all chat controls, queue, statuses, consent, and errors through the Language setting (zh-CN/en).
- [x] Implement narrow-layout, safe-area, zoom, and theme adaptations; visual device review remains pending below.
- [x] Add keyboard navigation, visible focus, focus return, and screen-reader announcements; ensure shortcuts cannot approve.
- [x] Run type-check, lint, unit tests, and production build; deploy the three plugin runtime files locally without replacing vault data.
- [ ] Manually verify the deployed plugin in Obsidian Desktop and Mobile, including approval/queue interactions and visual accessibility.

## Verification status

- Automated verification: TypeScript, ESLint, production build, and Vitest passed (18 files / 82 tests).
- Local deployment: `main.js`, `styles.css`, and `manifest.json` copied to the configured vault plugin directory; their hashes match the workspace build. Existing `data.json` was preserved.
- Not yet verified: 500-round device performance measurements, hands-on mobile validation, and the Obsidian UI smoke test. The UI automation could see Obsidian windows but failed twice to activate the selected window, so no manual interaction was attempted.
- No GitHub commit, release, or Obsidian Community submission was made.
