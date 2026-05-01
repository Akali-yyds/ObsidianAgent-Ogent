# chat-sessions Specification

## Purpose
Manages persistent named chat sessions including creation, deletion, renaming, switching, and per-session turn and model storage. Session turns are stored in individual per-session files to avoid data.json bloat.
## Requirements
### Requirement: Persistent session storage
The plugin SHALL persist named chat sessions to disk via `Plugin.saveData` so that conversations survive view closes and Obsidian reloads. Each session SHALL store an ordered list of turns, a title, a model override, and timestamps.

#### Scenario: Session survives reload
- **WHEN** the user closes and reopens Obsidian with an existing session containing messages
- **THEN** the chat view restores the last-active session with all prior turns visible

#### Scenario: Session data shape
- **WHEN** a session is saved
- **THEN** the stored object contains `id`, `title`, `model`, `createdAt`, `updatedAt`, and `turns` fields

### Requirement: Create new session
The plugin SHALL allow the user to create a new empty session from within the chat view. A new session SHALL be given the title "New chat" and SHALL immediately become the active session.

#### Scenario: Create session via button
- **WHEN** the user clicks the "+ New" button in the chat header
- **THEN** a new session is created with title "New chat", saved to disk, and the transcript is cleared ready for input

#### Scenario: Auto-title on first message
- **WHEN** the user sends the first message in a session titled "New chat"
- **THEN** the session title is updated to the first 60 characters of that message and saved

### Requirement: Switch between sessions
The plugin SHALL provide a session selector in the chat header that lists all existing sessions by title. Selecting a session SHALL load its turns and make it the active session.

#### Scenario: Switch session
- **WHEN** the user opens the session dropdown and selects a different session by title
- **THEN** the transcript updates to show the selected session's turns, and subsequent messages are appended to that session

#### Scenario: Active session highlighted
- **WHEN** the session dropdown is open
- **THEN** the currently active session is visually distinguished from the others

### Requirement: Delete session
The plugin SHALL allow the user to delete the active session. If the deleted session is the only one, the plugin SHALL replace it with a fresh empty session rather than leaving zero sessions.

#### Scenario: Delete with multiple sessions
- **WHEN** the user clicks "Delete" with two or more sessions and confirms
- **THEN** the active session is removed from storage and the plugin switches to the most recently updated remaining session

#### Scenario: Delete last session
- **WHEN** the user deletes the only remaining session and confirms
- **THEN** the session list is reset to a single new empty session titled "New chat"

### Requirement: Rename session
The plugin SHALL allow the user to rename the active session. The new title SHALL be trimmed of leading/trailing whitespace and SHALL not be empty.

#### Scenario: Rename via inline edit
- **WHEN** the user clicks the session title in the header, edits it, and presses Enter or blurs the field
- **THEN** the session title is updated to the trimmed input and saved; if the input is empty the previous title is restored

