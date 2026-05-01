## ADDED Requirements

### Requirement: Consent mode per tool category
The plugin SHALL track a consent mode for each tool category. Modes are `always` (auto-approve), `ask` (prompt the user via modal), and `never` (auto-reject with a structured error to the model). The default mode SHALL be `always` for `vault_read` and `ask` for `vault_write`.

#### Scenario: Default modes applied
- **WHEN** the plugin loads with no prior settings
- **THEN** `vault_read` mode is `always` and `vault_write` mode is `ask`

#### Scenario: User changes mode
- **WHEN** the user sets `vault_write` to `always` in settings
- **THEN** subsequent write tool calls execute without prompting until the user changes the mode again

### Requirement: Consent modal for mutating tools
When a mutating tool is invoked under `ask` mode, the plugin SHALL display a modal showing tool name, target path, and a tool-shape-appropriate diff. The modal SHALL provide three actions: Approve, Reject, and Approve All This Session.

#### Scenario: Approve a write
- **WHEN** the model calls `vault_edit` and the modal opens; user clicks Approve
- **THEN** the edit applies and the tool result reports success

#### Scenario: Reject a write
- **WHEN** the user clicks Reject on the consent modal
- **THEN** the tool returns `{ error: "ConsentDeniedError" }` to the model and no write occurs

#### Scenario: Approve all in session
- **WHEN** the user clicks "Approve All This Session" on a `vault_write` modal
- **THEN** the in-memory category mode for `vault_write` becomes `always` for the lifetime of the chat-view session, and subsequent `vault_write` calls execute without prompting

#### Scenario: Stop dismisses modal
- **WHEN** a consent modal is open and the user clicks the chat view's Stop button
- **THEN** the modal closes, the tool returns `{ error: "ConsentDeniedError" }`, and the agent loop aborts

### Requirement: Per-tool diff rendering
The consent modal SHALL render a diff appropriate to each write tool: line-level red/green diff for `vault_edit`, frontmatter + body diff for `vault_write`, and an appended-block preview with trailing context for `vault_append`.

#### Scenario: Edit diff
- **WHEN** the modal opens for a `vault_edit` call
- **THEN** the diff shows the matched line(s) with the `oldString` removed and `newString` added, in red/green columns; long diffs (>200 lines) collapse with "show full diff"

#### Scenario: Write diff
- **WHEN** the modal opens for a `vault_write` call against an existing file
- **THEN** the modal shows old vs new frontmatter (YAML pretty-print) and a line diff of the body

#### Scenario: Append diff
- **WHEN** the modal opens for a `vault_append` call
- **THEN** the modal shows the trailing 5 lines of the existing file as context plus the appended block in a green-bordered preview

### Requirement: Never-mode short-circuits
When a category mode is `never`, mutating tool calls in that category SHALL be auto-rejected without showing the modal.

#### Scenario: Never-mode reject
- **WHEN** the user has set `vault_write` to `never` and the model emits a `vault_edit` call
- **THEN** the modal does not open and the tool returns `{ error: "ConsentDeniedError", reason: "category disabled" }`

### Requirement: Session-scoped undo of tool writes
The plugin SHALL maintain a per-session ring buffer (capacity 50) of successful write operations, recording `{ id, path, before, after, timestamp }`. A command "Undo last tool write" SHALL pop the most recent entry and restore `before`. Undo SHALL NOT go through the consent modal.

#### Scenario: Undo last write
- **WHEN** a `vault_edit` succeeded and the user runs "Undo last tool write"
- **THEN** the file is rewritten to `before` and the entry is removed from the buffer

#### Scenario: Empty buffer
- **WHEN** the user runs "Undo last tool write" with no entries in the buffer
- **THEN** Obsidian shows a notice "Nothing to undo" and no I/O occurs

#### Scenario: Buffer clears on chat reset
- **WHEN** the user clears the chat-view session
- **THEN** the undo buffer is cleared

### Requirement: Tool-call payload size limit
Tool execution logs SHALL truncate any single payload (args or result) larger than 1KB before writing to the developer console. Full payloads remain visible in the chat view's expanded card.

#### Scenario: Console truncation
- **WHEN** a tool result exceeds 1KB and the plugin logs it
- **THEN** the console message is truncated with an ellipsis indicator; the chat view card retains the full content (subject to its own 2KB preview cap with show-more)
