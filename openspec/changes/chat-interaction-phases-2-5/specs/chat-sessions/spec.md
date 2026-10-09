## ADDED Requirements

### Requirement: Session-scoped access and queued drafts
Each session SHALL persist its own Access scope and ordered unsent drafts. A legacy session without an Access scope SHALL migrate to `ask`. Drafts restored after restart SHALL remain paused and SHALL NOT be dispatched automatically.

#### Scenario: Restore queued messages after restart
- **WHEN** a session with queued drafts is loaded
- **THEN** its drafts retain their order and content, the queue is paused, and the user must explicitly continue it

### Requirement: Concurrent background session activity
The Agent SHALL run at most two sessions concurrently. Switching the visible session SHALL NOT stop a background run. Session rows SHALL expose running, awaiting-approval, failed, or interrupted state, and a background approval SHALL be handled only after the user returns to its owning session and reviews its operation card.

#### Scenario: Switch away from a running session
- **WHEN** the user switches to another chat while a session is running
- **THEN** the original run continues and its live turns and approval state remain attached to that session

### Requirement: Session-scoped undo
Vault undo checkpoints SHALL be associated with the session that caused the writes. Undo in one session SHALL NOT consume or revert another session's changes.

#### Scenario: Undo a session's most recent checkpoint
- **WHEN** the user requests undo from a session
- **THEN** only that session's latest checkpoint is considered
