## MODIFIED Requirements

### Requirement: Right-sidebar chat view
The plugin SHALL register an `ItemView` that opens in the right sidebar by default and contains a header bar (session selector, model selector), a transcript area, an input box, a send button, and a stop button.

#### Scenario: Open chat view
- **WHEN** the user runs the "Open AI Agent" command from the command palette
- **THEN** the chat view opens in the right sidebar leaf and gains focus

#### Scenario: View persists across reloads
- **WHEN** the user reloads Obsidian with the chat view open
- **THEN** Obsidian restores the view in its previous location and the last-active session is loaded

### Requirement: Send message and stream reply
The chat view SHALL send the user's message to the agent loop and stream the assistant's reply incrementally into the transcript.

#### Scenario: Streamed reply
- **WHEN** the user types a message and clicks Send (or presses Cmd/Ctrl+Enter)
- **THEN** the message appears in the transcript as a "user" turn, and the assistant's reply appears below it, updating as tokens arrive

#### Scenario: Markdown rendering for assistant messages
- **WHEN** the assistant streams or finishes a reply
- **THEN** the transcript renders the assistant's content as Markdown (headings, bold, italic, inline code, code blocks, lists, and links) using Obsidian's MarkdownRenderer

#### Scenario: User messages remain plain text
- **WHEN** a user turn is rendered
- **THEN** the content is displayed as plain text without Markdown interpretation

## ADDED Requirements

### Requirement: Model selector in chat header
The chat view SHALL display a model selector in the header bar. The selector SHALL default to the global model setting and SHALL allow the user to override the model for the active session. The override SHALL persist with the session.

#### Scenario: Selector shows active model
- **WHEN** the chat view loads a session
- **THEN** the model input shows that session's model override, or the global setting's model if no override is set

#### Scenario: Change model mid-session
- **WHEN** the user edits the model selector and the input loses focus or Enter is pressed
- **THEN** the active session's model is updated to the trimmed input value and saved; subsequent messages use the new model

#### Scenario: Model suggestions from provider
- **WHEN** the active provider implements `listModels()` and the view initialises
- **THEN** the model selector shows a suggestion list populated with the returned model IDs; the user can still type any value

#### Scenario: Provider does not support listModels
- **WHEN** the active provider does not implement `listModels()` or the call fails
- **THEN** the model selector behaves as a plain text input with no suggestions and no error is shown
