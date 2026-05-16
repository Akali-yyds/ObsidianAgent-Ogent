## Purpose
The chat view is the primary user interface for interacting with the AI agent. It provides a persistent panel where users can send messages, view streaming responses, manage multiple chat sessions, and observe tool-call activity.

## Requirements

### Requirement: Right-sidebar chat view
The plugin SHALL register an `ItemView` that opens in the right sidebar on desktop and as a full-screen tab on mobile, containing a transcript area, an input box, a send button, and a stop button.

#### Scenario: Open chat view
- **WHEN** the user runs the "Open AI Agent" command from the command palette
- **THEN** the chat view opens in the right sidebar (desktop) or full-screen tab (mobile) and gains focus

#### Scenario: View persists across reloads
- **WHEN** the user reloads Obsidian with the chat view open
- **THEN** Obsidian restores the view in its previous location

### Requirement: Send message and stream reply
The chat view SHALL send the user's message to the agent loop and stream the assistant's reply incrementally into the transcript. When tool calls occur during the loop, the view SHALL render each as a collapsible card inline within the in-progress assistant turn.

#### Scenario: Streamed reply
- **WHEN** the user types a message and clicks Send (or presses Cmd/Ctrl+Enter)
- **THEN** the message appears in the transcript as a "user" turn, and the assistant's reply appears below it, updating as tokens arrive

#### Scenario: Markdown rendering on completion
- **WHEN** the assistant's reply finishes streaming
- **THEN** the transcript re-renders the assistant turn using Obsidian's MarkdownRenderer so that bold, code blocks, lists, and other markdown are styled correctly

#### Scenario: Tool-call card rendered
- **WHEN** the agent loop emits a tool-call event during a turn
- **THEN** the view appends a collapsible card under the in-progress assistant turn with the tool name and a one-line summary of arguments, defaulting to collapsed

#### Scenario: Tool-call result preview
- **WHEN** the tool finishes
- **THEN** the card updates to show success or error status; expanding the card reveals full JSON arguments and the first 2KB of the result with a "show more" affordance

### Requirement: Cancellation
The chat view SHALL provide a stop button that aborts an in-flight stream for the active session.

#### Scenario: Stop in-flight stream
- **WHEN** an assistant reply is streaming and the user clicks Stop
- **THEN** the underlying HTTP request is aborted, the partial reply remains in the transcript marked as interrupted, and the input becomes re-enabled

### Requirement: Disabled state when unconfigured
The chat view SHALL disable the send button and display a hint when the user has not configured a provider yet.

#### Scenario: No provider configured
- **WHEN** the chat view loads and `apiKey` or `baseUrl` is empty in plugin settings
- **THEN** the send button is disabled and a hint links the user to the settings tab

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

### Requirement: Per-session model override
The chat view SHALL display a model input in the header allowing the user to override the global model for the active session. The override is persisted per session and used when sending messages.

#### Scenario: Model override applied
- **WHEN** the user enters a model name in the header input and sends a message
- **THEN** the request uses the per-session model rather than the global setting

### Requirement: Message edit and retry
The chat view SHALL allow the user to edit a sent user message (via a pencil button) or retry a failed assistant turn (via a ↺ button). Editing or retrying truncates the conversation from that point and re-sends.

#### Scenario: Edit user message
- **WHEN** the user clicks the pencil icon on a user turn
- **THEN** an inline textarea opens pre-filled with the original message; submitting truncates subsequent turns and re-sends

#### Scenario: Retry failed turn
- **WHEN** an assistant turn shows an error and the user clicks ↺
- **THEN** the error turn and preceding user turn are removed and the message is re-sent

### Requirement: Per-session in-flight isolation
Each session SHALL track its own in-flight request independently. Sending in one session SHALL NOT disable the send button or input in another session.

#### Scenario: Parallel requests
- **WHEN** the user sends a message in session A and switches to session B
- **THEN** session B's send button and input are enabled and a new message can be sent independently

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
