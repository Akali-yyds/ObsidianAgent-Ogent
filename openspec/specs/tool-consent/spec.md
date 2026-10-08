# tool-consent Specification

## Purpose
Defines the two-risk-class consent boundary behind Ogent's three user-facing execution scopes. Low-risk inspection commands run automatically; high-risk commands are either blocked, approval-gated, or allowed according to the selected scope. The executor remains the source of truth for command validation and safety.

## Requirements

### Requirement: Execution scope
The plugin SHALL expose three user-facing execution scopes for the current chat: `read` (low-risk inspection only), `ask` (low-risk inspection automatic and high-risk commands require approval), and `full` (allowlisted high-risk commands may run without an additional approval prompt). The internal permission categories may remain for enforcement, migration, and audit, but they SHALL NOT require users to configure separate per-category policies for normal operation.

#### Scenario: Default scope applied
- **WHEN** the chat view opens
- **THEN** the execution scope is `ask`

#### Scenario: User changes scope
- **WHEN** the user selects `read`, `ask`, or `full`
- **THEN** the executor applies the corresponding policy to every high-risk capability for the current chat

### Requirement: Consent modal for mutating tools
When a high-risk command is invoked under `ask` scope, the plugin SHALL display an inline approval card showing the command, reason, target, and an operation-appropriate preview. The card SHALL provide Approve and Reject actions.

#### Scenario: Approve a write
- **WHEN** the model calls `vault_edit` and the modal opens; user clicks Approve
- **THEN** the edit applies and the tool result reports success

#### Scenario: Reject a write
- **WHEN** the user clicks Reject on the consent modal
- **THEN** the tool returns `{ error: "ConsentDeniedError" }` to the model and no write occurs

#### Scenario: Full scope
- **WHEN** the user selects Full access
- **THEN** allowlisted high-risk commands may execute without an additional approval card, while schemas, path boundaries, Git restrictions, and system-command prohibition remain enforced

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

### Requirement: Read-only scope
When the scope is `read`, high-risk commands SHALL be rejected before execution with a structured result explaining that the user must switch to Ask before action or Full access.

#### Scenario: Read-only reject
- **WHEN** the scope is `read` and the model emits a `vault_edit` or `git_pull` call
- **THEN** no approval card opens, no operation runs, and the tool returns `{ error: "ReadOnlyMode" }` with a scope-switch explanation

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
