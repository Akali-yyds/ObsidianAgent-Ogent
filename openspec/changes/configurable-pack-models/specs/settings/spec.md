## MODIFIED Requirements

### Requirement: Settings tab UI
The plugin SHALL register a settings tab exposing fields for: provider preset (`openai-compatible` in M0–M1), base URL, API key, model name, an optional system prompt, consent-mode dropdowns per tool category (`vault_read`, `vault_write`), and a "Pack models" section with a model text input per provider for each installed pack.

#### Scenario: Settings tab visible
- **WHEN** the user opens Obsidian Settings → Community Plugins → AI Agent
- **THEN** the settings tab renders with the specified fields including the consent-mode dropdowns and the "Pack models" section

#### Scenario: API key field is masked
- **WHEN** the user enters an API key
- **THEN** the field renders as a password input that does not display the key in plaintext by default

#### Scenario: Consent-mode persists
- **WHEN** the user changes a consent-mode dropdown
- **THEN** the new mode is persisted via `saveData()` and the active chat view picks it up via the existing `'settings-changed'` event

#### Scenario: Pack models section renders per provider
- **WHEN** at least one pack is installed
- **THEN** the "Pack models" section shows a model text input for each provider in each pack, labelled with the provider name, with the pack JSON model as the placeholder

#### Scenario: Pack model override persists
- **WHEN** the user types a new model name into a pack provider input and the field loses focus
- **THEN** the value is persisted in `packModelOverrides[packId][providerName]` via `saveData()`

#### Scenario: Clearing override restores default
- **WHEN** the user clears a pack provider input (empty string)
- **THEN** `packModelOverrides[packId][providerName]` is deleted (or set to empty string) and the runtime falls back to the JSON-declared model

#### Scenario: No packs installed
- **WHEN** no pack JSON files exist in the packs directory
- **THEN** the "Pack models" section renders an informational message instead of inputs (e.g., "No packs installed.")
