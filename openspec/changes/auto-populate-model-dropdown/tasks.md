## 1. Shared fetch helper

- [x] 1.1 Add `async function fetchModelList(baseUrl: string, apiKey: string): Promise<string[]>` in `src/settings.ts` that instantiates a minimal `OpenAICompatibleProvider`-compatible config and calls `listModels()` — or directly calls `requestUrl` using the same pattern as `provider.ts` `listModels()`
- [x] 1.2 Return an empty array on any error (network failure, HTTP 4xx/5xx, empty data array)

## 2. Global model field — fetch-backed dropdown

- [x] 2.1 In `OpenAgentSettingsTab.display()`, replace the `addText` model setting with a `addDropdown` containing the saved model as the only initial option, plus a "Fetch models" button via `addButton`
- [x] 2.2 On button click: disable the button, set its label to "Fetching…", call `fetchModelList(settings.baseUrl, settings.apiKey)`, then re-enable the button and restore label
- [x] 2.3 On successful fetch (non-empty list): populate the dropdown with all returned model IDs; if the saved model is not in the list, add it as the first option; set `onChange` to save `settings.model`
- [x] 2.4 On failed or empty fetch: replace the row with a `addText` fallback (same as current behaviour) and append a notice "Could not fetch models — check URL and API key."
- [x] 2.5 Ensure the saved `settings.model` value is always the initially selected option, regardless of fetch state

## 3. Pack provider model fields — fetch-backed dropdown

- [x] 3.1 In `renderPackProviderOverrides()`, replace the `addText` model field for each provider with the same dropdown + button pattern used in task 2
- [x] 3.2 Resolve effective baseUrl and apiKey for each pack provider: use `packProviderOverrides[pack.id][providerName].baseUrl` if set, else `pack.providers[providerName].baseUrl`; same for apiKey
- [x] 3.3 If effective baseUrl is empty, render a plain `addText` input (no fetch button)
- [x] 3.4 Apply the same success/failure/in-flight behaviour as the global field (tasks 2.2–2.4)

## 4. Verification

- [x] 4.1 Run `npm run build` and confirm no TypeScript errors
- [ ] 4.2 Open Settings in the test vault; confirm the Model field shows a dropdown with the saved model pre-selected and a "Fetch models" button
- [ ] 4.3 Click "Fetch models" with a valid OpenAI base URL + API key; confirm dropdown populates with model IDs and the previously saved value remains selected
- [ ] 4.4 Click "Fetch models" with an invalid API key; confirm dropdown falls back to text input and notice appears
- [ ] 4.5 Select a different model from the dropdown, close and reopen settings; confirm the new model persists
- [ ] 4.6 Open Pack models section with a pack installed; confirm each provider model field has a "Fetch models" button and the same behaviour as the global field
