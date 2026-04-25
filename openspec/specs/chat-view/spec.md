# chat-view Specification

## Purpose
TBD - created by archiving change m0-skeleton. Update Purpose after archive.
## Requirements
### Requirement: Right-sidebar chat view
The plugin SHALL register an `ItemView` that opens in the right sidebar by default and contains a transcript area, an input box, a send button, and a stop button.

#### Scenario: Open chat view
- **WHEN** the user runs the "Open AI Agent" command from the command palette
- **THEN** the chat view opens in the right sidebar leaf and gains focus

#### Scenario: View persists across reloads
- **WHEN** the user reloads Obsidian with the chat view open
- **THEN** Obsidian restores the view in its previous location

### Requirement: Send message and stream reply
The chat view SHALL send the user's message to the agent loop and stream the assistant's reply incrementally into the transcript.

#### Scenario: Streamed reply
- **WHEN** the user types a message and clicks Send (or presses Cmd/Ctrl+Enter)
- **THEN** the message appears in the transcript as a "user" turn, and the assistant's reply appears below it, updating as tokens arrive

#### Scenario: Plain text rendering in M0
- **WHEN** the assistant streams content
- **THEN** the transcript renders the content as plain text (markdown rendering is out of scope for M0)

### Requirement: Cancellation
The chat view SHALL provide a stop button that aborts an in-flight stream.

#### Scenario: Stop in-flight stream
- **WHEN** an assistant reply is streaming and the user clicks Stop
- **THEN** the underlying HTTP request is aborted, the partial reply remains in the transcript marked as interrupted, and the input becomes re-enabled

### Requirement: Disabled state when unconfigured
The chat view SHALL disable the send button and display a hint when the user has not configured a provider yet.

#### Scenario: No provider configured
- **WHEN** the chat view loads and `apiKey` or `baseUrl` is empty in plugin settings
- **THEN** the send button is disabled and a hint links the user to the settings tab

