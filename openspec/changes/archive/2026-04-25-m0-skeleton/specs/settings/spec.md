## ADDED Requirements

### Requirement: Settings tab UI
The plugin SHALL register a settings tab exposing fields for: provider preset (M0 only offers `openai-compatible`), base URL, API key, model name, and an optional system prompt.

#### Scenario: Settings tab visible
- **WHEN** the user opens Obsidian Settings → Community Plugins → AI Agent
- **THEN** the settings tab renders with the specified fields

#### Scenario: API key field is masked
- **WHEN** the user enters an API key
- **THEN** the field renders as a password input that does not display the key in plaintext by default

### Requirement: Settings persist via plugin data
The plugin SHALL persist settings using `this.saveData()` and load them via `this.loadData()`. Settings SHALL NOT be written to `localStorage` or to vault notes.

#### Scenario: Settings round-trip
- **WHEN** the user enters settings and reloads Obsidian
- **THEN** the previously entered values are restored from plugin data

#### Scenario: No localStorage writes
- **WHEN** the plugin saves settings
- **THEN** no `window.localStorage.setItem` calls reference settings keys

### Requirement: Settings change notifies the chat view
The settings tab SHALL emit a change event that the chat view listens to, so the disabled-state hint clears immediately when configuration becomes valid.

#### Scenario: Configure while chat view open
- **WHEN** the chat view is open with the unconfigured hint visible, and the user enters a valid API key and base URL
- **THEN** the chat view's send button becomes enabled without requiring a reload

### Requirement: Key exposure warning
The settings tab SHALL display a notice that the API key is stored in the plugin's data file and may be synced if the user syncs the plugin folder.

#### Scenario: Notice displayed
- **WHEN** the settings tab renders
- **THEN** a notice describes where the key is stored and that it may sync with the plugin folder
