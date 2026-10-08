# settings Specification

## Purpose
Exposes plugin configuration via an Obsidian settings tab, including provider connection details, interface language, system prompt, and the single chat execution scope.

## Requirements

### Requirement: Settings tab UI
The plugin SHALL register a settings tab exposing fields for: provider preset (`openai-compatible`), base URL, API key, model name, interface language (`auto`, `zh-CN`, or `en`), an optional system prompt, and the execution-scope explanation. The active chat SHALL expose the user-facing `Read only`, `Ask before action`, and `Full access` choices.

#### Scenario: Settings tab visible
- **WHEN** the user opens Obsidian Settings → Community Plugins → AI Agent
- **THEN** the settings tab renders with the specified fields including the interface-language selector

#### Scenario: API key field is masked
- **WHEN** the user enters an API key
- **THEN** the field renders as a password input that does not display the key in plaintext by default

#### Scenario: Language selection persists
- **WHEN** the user changes the interface language
- **THEN** the new language is persisted via `saveData()` and the active chat view rerenders command plans and approval prompts via the existing `'settings-changed'` event

### Requirement: Key exposure warning
The settings tab SHALL display two notices: one stating that the API key is stored in the plugin's data file and may be synced if the user syncs the plugin folder, and one stating that vault contents (note bodies, paths, metadata) may be transmitted to the configured model endpoint when tools are enabled.

#### Scenario: Notices displayed
- **WHEN** the settings tab renders
- **THEN** both the key-storage notice and the vault-content notice are visible

### Requirement: Default consent modes
The plugin SHALL default `vault_read` consent mode to `always` and `vault_write` consent mode to `ask` on first install. Defaults SHALL NOT overwrite an existing user choice.

#### Scenario: First install
- **WHEN** the plugin loads with no prior settings
- **THEN** consent modes are `vault_read=always`, `vault_write=ask`

#### Scenario: User choice preserved
- **WHEN** the user has previously set `vault_write=always` and the plugin reloads
- **THEN** the stored `always` value is loaded; defaults do not overwrite it
