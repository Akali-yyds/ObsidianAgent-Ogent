## Why

The "Model" field in settings is a freeform text input, so users must know the exact model ID string from memory. Since the configured endpoint already supports a standard `/models` API, we can fetch available models and show them in a dropdown, eliminating typos and guesswork.

## What Changes

- Replace the freeform "Model" text input in the settings tab with a hybrid dropdown + fetch button: clicking "Fetch models" calls `GET {baseUrl}/models` using the saved API key and populates the dropdown with returned model IDs.
- If the fetch fails or returns no models, fall back gracefully to the existing freeform text input so the field stays editable.
- The same fetch-and-populate behaviour is added to each pack provider model field in the "Pack models" section.
- The currently saved model value is preserved as the selected option (or kept as typed text in fallback mode).

## Capabilities

### New Capabilities

- `model-list-fetch`: Fetching available model IDs from a configured OpenAI-compatible endpoint and populating a settings dropdown.

### Modified Capabilities

- `settings`: The model fields in the global provider section and the pack models section change from freeform text inputs to fetch-backed dropdowns.

## Impact

- `src/settings.ts` — `display()` and `renderPackProviderOverrides()`: replace `addText` model fields with a dropdown + fetch-button component; add an async helper `fetchAndPopulateModels()`.
- `src/provider.ts` — `listModels()` already exists and is reused; no changes needed.
- No changes to `PluginSettings` shape, pack JSON files, or runtime pack execution.
