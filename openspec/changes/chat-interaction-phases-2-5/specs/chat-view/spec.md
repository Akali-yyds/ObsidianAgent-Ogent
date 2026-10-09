## ADDED Requirements

### Requirement: Stable turn-local rendering and reading position
The chat view SHALL update the affected assistant turn or operation card by stable identity without rebuilding unrelated transcript rows. Re-rendering SHALL retain disclosure state, the user's visible reading anchor, and focus when the corresponding control remains available. Approval, rejection, error, and Markdown completion SHALL NOT move the user to the transcript start.

#### Scenario: Update an approval card while the user is reading
- **WHEN** an operation changes from awaiting approval to running or rejected
- **THEN** only its card is replaced, the card disclosure state and visible scroll anchor remain stable, and focus moves to the corresponding operation summary if the clicked action disappears

### Requirement: Bounded transcript rendering
The chat view SHALL mount a bounded window of turns and load older turns as the user scrolls upward, using stable estimated spacers and a visible-turn anchor. Completed Markdown MAY be cached only when it does not depend on Obsidian-specific links, embeds, tags, code processing, or postprocessors.

#### Scenario: Load older transcript history
- **WHEN** the user scrolls near the top of a long transcript
- **THEN** older turns are mounted without changing the first visible turn's viewport position

### Requirement: Queue messages while a run is active
The chat view SHALL keep message submission available during an active run and add new drafts to the active session's visible editable queue. Queue edits and session-state refreshes SHALL NOT discard editor focus or uncommitted text.

#### Scenario: Add a message during streaming
- **WHEN** the user submits a message while the active session is running
- **THEN** the message is persisted in order, appears in the queue, and can be edited or cancelled before dispatch

### Requirement: Accessible chat controls and status
All chat controls and operation statuses SHALL follow the selected Simplified Chinese or English language. Session selection SHALL support native keyboard interaction, visible focus, and an accessible active/running/approval status. Approval state changes SHALL be announced without making the streaming transcript a noisy live region.

#### Scenario: Navigate sessions by keyboard
- **WHEN** a keyboard user focuses a session item
- **THEN** Enter or Space switches to that session and the active session is exposed to assistive technology
