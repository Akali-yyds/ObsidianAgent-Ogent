## Why

Pack AI models are hardcoded in JSON config files (e.g., `grounded-research.json`), which requires users to hand-edit JSON to swap models. The classic chat mode lets users type a model name directly in the settings tab, but there is no equivalent control for packs.

## What Changes

- Add `packModelOverrides` to `PluginSettings`: a nested map of `packId → providerName → model string`.
- Add a "Pack models" section to the settings tab that renders a model text input per provider (retriever, synthesizer, verifier) for each loaded pack — identical UX to the classic-mode Model field.
- At runtime, merge saved overrides over the pack's JSON-declared model before constructing providers, so the JSON file remains the default and user settings win.
- Update the pack summary in the chat view to show the *effective* model (override if set, else JSON default).

## Capabilities

### New Capabilities

- `pack-model-overrides`: Per-provider model override stored in plugin settings and applied at pack runtime.

### Modified Capabilities

- `settings`: Settings tab gains a "Pack models" section with per-provider model text inputs.

## Impact

- `src/settings.ts` — `PluginSettings` type and `DEFAULT_SETTINGS`, settings tab `display()`
- `src/packs/runtime.ts` — `buildProviders()` merges overrides before constructing `ModelProvider`
- `src/packs/loader.ts` — `loadPacks()` must be called before the settings tab can render pack names (already done at plugin load; settings tab may need to re-call or receive packs via deps)
- `src/view.ts` — pack summary must read effective model from merged config
- No schema changes to pack JSON files; existing packs continue to work unchanged
