## ADDED Requirements

### Requirement: Fetch model list from endpoint
The settings tab SHALL provide a "Fetch models" button adjacent to each model field. When clicked, the button SHALL call `GET {baseUrl}/models` with the configured API key and populate the model dropdown with the returned model IDs sorted alphabetically.

#### Scenario: Successful fetch populates dropdown
- **WHEN** the user clicks "Fetch models" and the endpoint returns a non-empty list
- **THEN** the model field renders as a `<select>` dropdown containing all returned model IDs, with the currently saved model pre-selected if present in the list

#### Scenario: Fetch with unknown saved model
- **WHEN** the user clicks "Fetch models", the endpoint returns a list, but the saved model ID is not in the list
- **THEN** the saved model ID is added as the first option in the dropdown and remains selected

#### Scenario: Fetch fails or returns empty list
- **WHEN** the user clicks "Fetch models" and the request fails (network error, HTTP 4xx/5xx) or returns zero models
- **THEN** the model field falls back to a freeform text input and a notice "Could not fetch models — check URL and API key." is shown beneath the field

#### Scenario: Fetch in progress
- **WHEN** the user clicks "Fetch models" and the request is in flight
- **THEN** the button is disabled and its label changes to "Fetching…" until the request completes

### Requirement: Pack provider model fetch
Each pack provider model field in the "Pack models" section SHALL have the same "Fetch models" button, using the pack's effective baseUrl and apiKey (override if set, otherwise pack JSON default).

#### Scenario: Pack fetch uses effective credentials
- **WHEN** the user clicks "Fetch models" on a pack provider model field
- **THEN** the fetch uses the pack provider's effective baseUrl (override or JSON default) and effective apiKey (override or JSON default)

#### Scenario: Pack provider missing baseUrl
- **WHEN** the pack provider has no baseUrl in either the override or the pack JSON
- **THEN** the "Fetch models" button is absent and the field renders as a freeform text input
