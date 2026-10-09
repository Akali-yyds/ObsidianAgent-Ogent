# Design: chat interaction phases 2–5

## State ownership

`SessionMeta` is the durable owner of the session's Access mode and queued user messages. Turns and assistant segments receive stable IDs during load, and migrated IDs are persisted on the next normal write. In-flight runtime state remains in memory and is keyed by `sessionId`; restart converts unfinished runs to an interrupted state and never replays commands.

Each concurrently running session has its own consent manager and undo checkpoint context. A pending approval is only actionable in its owning session. Write execution uses one shared FIFO mutex for Vault/Git mutations; approval happens before acquiring the mutex, and command-specific validation runs again at the execution boundary.

## Rendering

The active row is updated by stable turn ID. Structural operations may rebuild the transcript, while a small render window mounts only a bounded set of turns. The window uses estimated spacer heights and captures the first visible turn plus its offset before adding older history. Completed Markdown may be cached by content hash; live text remains incrementally appended. Disclosure/edit/approval state is keyed by stable IDs and survives row recycling.

## Compatibility

Missing IDs default to deterministic IDs derived from session, turn position, segment position, and kind, avoiding content-based collisions. Legacy sessions without Access migrate to `ask`; malformed queue entries are discarded individually. Existing `execute_commands` payloads and old turn order/content remain unchanged.

## Failure and shutdown

Stopping or unloading aborts each active run and resolves its outstanding approvals as rejected/cancelled. Queue content remains stored but paused. A run that was active at shutdown is shown interrupted after restart. A queued send is never started solely because the plugin reopened.

## Performance and accessibility

Windowing limits attached turn rows; expensive Markdown output is cached only for unchanged completed segments. Controls expose localized names, keyboard focus indicators, status/live-region announcements, and explicit approval buttons. No keyboard shortcut performs approval implicitly.
