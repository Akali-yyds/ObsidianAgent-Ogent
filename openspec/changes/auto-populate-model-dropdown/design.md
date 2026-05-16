## Context

The settings tab has a freeform text input for the model name (global provider) and for each pack provider model override. The `OpenAICompatibleProvider` class already exposes a `listModels()` method that calls `GET {baseUrl}/models` and returns sorted model IDs. No new network code is needed; the gap is purely in the settings UI.

Users who forget exact model IDs (e.g. `gpt-4o-2024-11-20` vs `gpt-4o`) must trial-and-error or look up the ID externally. Providers like OpenRouter expose hundreds of models; a dropdown makes selection tractable.

## Goals / Non-Goals

**Goals:**
- Replace the freeform model text input (global + per-pack) with a select dropdown populated from the live endpoint.
- Provide a "Fetch models" button that triggers the network call on demand (not on every settings open, to avoid latency and rate-limit concerns).
- Preserve the currently saved model as the selected value, even if the fetch returns no results.
- Fall back to a freeform text input when the fetch fails or returns an empty list.

**Non-Goals:**
- Automatic refresh or polling of the model list.
- Caching model lists across Obsidian restarts.
- Showing model metadata (context window, pricing, etc.).
- Changing provider handling or the `listModels()` implementation.

## Decisions

### Dropdown + fetch button, not auto-fetch on display

**Chosen**: Render the field as a `<select>` pre-filled with the saved value, plus a "Fetch" button next to it. The button triggers `listModels()` and repopulates the select.

**Alternative considered**: Auto-fetch every time `display()` runs. Rejected because: settings tab opens on every Obsidian startup via the settings pane; an automatic network call on display adds latency, can surface auth errors in an unexpected moment, and wastes quota for users who aren't changing the model.

**Alternative considered**: Always show a text input and add a separate "Load models" section. Rejected because it duplicates the field and adds confusion.

### Native `<select>` element via Obsidian `addDropdown`, with manual DOM fallback

**Chosen**: Use Obsidian's `Setting.addDropdown()` to render a `<select>`. If the model list is empty or the fetch failed, swap the control to `addText` via a re-render of just that setting row.

**Why**: Obsidian's `addDropdown` produces a native select styled consistently with other settings. The fallback re-render is simpler than maintaining a custom combobox component.

### Fetch uses saved baseUrl + apiKey from settings, not a live form value

**Chosen**: Read `this.plugin.settings.baseUrl` and `this.plugin.settings.apiKey` when the button is pressed. The user must save those fields first.

**Why**: Reading unsaved form values would require capturing intermediate component references; that complexity is unjustified for this feature. The button label can hint "uses saved URL/key".

### Pack model fetch reuses same helper

**Chosen**: A shared `fetchModels(baseUrl, apiKey): Promise<string[]>` helper is called for both the global model field and each pack provider model field. Pack provider fields read their effective baseUrl/apiKey (override → pack JSON default → empty).

## Risks / Trade-offs

- **CORS / Obsidian sandbox** → Obsidian's `requestUrl` bypasses CORS, so this is safe. No mitigation needed.
- **Auth errors surfaced in settings** → If the API key is wrong, `listModels()` returns `[]`; the field falls back to text input with an informational notice "Could not fetch models — check URL and API key." No error is thrown into the UI.
- **Large model lists** → OpenRouter returns 300+ models. A native `<select>` with 300 options is scroll-heavy but functional. No pagination is implemented in M1.
- **Pack provider baseUrl/apiKey may be blank** → If neither the override nor the pack JSON provides a baseUrl, the fetch is skipped and the field stays as text input.
