## MODIFIED Requirements

### Requirement: Settings tab UI
The plugin SHALL register a settings tab exposing fields for: provider preset (`openai-compatible` in M0–M1), base URL, API key, model name (as a fetch-backed dropdown or freeform text fallback), an optional system prompt, and consent-mode dropdowns per tool category (`vault_read`, `vault_write`).

#### Scenario: Settings tab visible
- **WHEN** the user opens Obsidian Settings → Community Plugins → AI Agent
- **THEN** the settings tab renders with the specified fields including the consent-mode dropdowns

#### Scenario: Model field renders as dropdown after fetch
- **WHEN** the user clicks "Fetch models" and models are returned
- **THEN** the model field switches from a text input to a `<select>` dropdown with the returned model IDs

#### Scenario: Model field falls back to text input on failure
- **WHEN** the user clicks "Fetch models" and the fetch fails or returns no models
- **THEN** the model field remains a freeform text input

#### Scenario: API key field is masked
- **WHEN** the user enters an API key
- **THEN** the field renders as a password input that does not display the key in plaintext by default

#### Scenario: Consent-mode persists
- **WHEN** the user changes a consent-mode dropdown
- **THEN** the new mode is persisted via `saveData()` and the active chat view picks it up via the existing `'settings-changed'` event
