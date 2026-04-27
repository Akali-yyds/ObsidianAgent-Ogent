## MODIFIED Requirements

### Requirement: Send message and stream reply
The chat view SHALL send the user's message to the agent loop and stream the assistant's reply incrementally into the transcript. When tool calls occur during the loop, the view SHALL render each as a collapsible card inline within the in-progress assistant turn.

#### Scenario: Streamed reply
- **WHEN** the user types a message and clicks Send (or presses Cmd/Ctrl+Enter)
- **THEN** the message appears in the transcript as a "user" turn, and the assistant's reply appears below it, updating as tokens arrive

#### Scenario: Plain text rendering in M1
- **WHEN** the assistant streams content
- **THEN** the transcript renders the content as plain text (markdown rendering is out of scope for M1)

#### Scenario: Tool-call card rendered
- **WHEN** the agent loop emits a tool-call event during a turn
- **THEN** the view appends a collapsible card under the in-progress assistant turn with the tool name and a one-line summary of arguments, defaulting to collapsed

#### Scenario: Tool-call result preview
- **WHEN** the tool finishes
- **THEN** the card updates to show success or error status; expanding the card reveals full JSON arguments and the first 2KB of the result with a "show more" affordance

## ADDED Requirements

### Requirement: "Ask agent about current note" command
The plugin SHALL register a command "Ask agent about current note" that opens the chat view (if not already open), focuses the input, and pre-fills `Tell me about [[<active-file-basename>]]` without sending. If no file is active, the command SHALL be a no-op with a notice.

#### Scenario: Active file present
- **WHEN** the user runs the command with `Notes/foo.md` active
- **THEN** the chat view opens and the input is pre-filled with `Tell me about [[foo]]`, focused, ready to send or edit

#### Scenario: No active file
- **WHEN** the user runs the command with no active file
- **THEN** Obsidian shows a notice "No active note" and the chat view state is unchanged

### Requirement: Tool-call card actions
Each tool-call card SHALL provide an "open path" action when the result references a vault path, opening the file in the active leaf.

#### Scenario: Open referenced path
- **WHEN** a `vault_read` card shows `path: "Notes/foo.md"` in its result and the user clicks "Open"
- **THEN** Obsidian opens `Notes/foo.md` in the active leaf
