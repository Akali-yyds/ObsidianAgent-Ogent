## 1. Settings data model

- [x] 1.1 Add `packModelOverrides: Record<string, Record<string, string>>` to `PluginSettings` in `src/settings.ts`
- [x] 1.2 Set `packModelOverrides: {}` in `DEFAULT_SETTINGS`

## 2. Runtime override merge

- [x] 2.1 Add `packModelOverrides` parameter to `buildProviders()` in `src/packs/runtime.ts`
- [x] 2.2 In `buildProviders()`, merge override model over `providerConfig.model` before constructing `ModelProvider` (leave `baseUrl` and `apiKey` from pack JSON)
- [x] 2.3 Thread `packModelOverrides[pack.id]` from `preparePackExecution()` down to `buildProviders()` — `preparePackExecution()` currently takes no settings; add an optional `modelOverrides` param
- [x] 2.4 Pass `settings.packModelOverrides[pack.id]` when calling `preparePackExecution()` from `runPack()` / `runPackForEval()` in `src/packs/runtime.ts`
- [x] 2.5 Pass `settings.packModelOverrides[pack.id]` when calling `preparePackExecution()` from `src/main.ts` (via `runPack`)

## 3. Settings tab UI

- [x] 3.1 Add a `setPacks(packs: AgentPack[])` helper or load packs inline in `display()` using `loadPacks()` in `src/settings.ts`
- [x] 3.2 Render a "Pack models" heading section after the consent section
- [x] 3.3 For each pack, render a sub-heading with the pack name and one `addText` input per provider, labelled `"<ProviderName> model"`, placeholder = JSON-declared model, value = current override (empty string if not set)
- [x] 3.4 On `onChange`, write to `settings.packModelOverrides[pack.id][providerName]`; delete key when value is empty; call `saveSettings()`
- [x] 3.5 When no packs are installed, render an informational line "No packs installed." in the Pack models section

## 4. Chat view effective model

- [x] 4.1 In `src/view.ts` `refreshHeader()`, replace direct `activePack.providers[name]?.model` reads with a helper that checks `settings.packModelOverrides[pack.id]?.[providerName]` first, falling back to `activePack.providers[providerName]?.model`

## 5. Verification

- [x] 5.1 Build the plugin (`npm run build`) and confirm no TypeScript errors
- [ ] 5.2 Load plugin in the test vault; open Settings → AI Agent and confirm "Pack models" section appears with inputs pre-populated from `grounded-research.json`
- [ ] 5.3 Enter a custom model name, close and reopen settings — confirm the value persists
- [ ] 5.4 Run the Grounded Research pack and confirm the pack summary in the view shows the overridden model name
- [ ] 5.5 Clear the override field and confirm the pack uses the JSON-declared model again
