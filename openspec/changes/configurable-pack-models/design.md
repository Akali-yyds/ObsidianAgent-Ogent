## Context

Pack JSON files declare a `providers` map where each entry has `baseUrl`, `apiKey`, and `model`. The runtime reads these values directly when constructing `ModelProvider` instances (`buildProviders()` in `src/packs/runtime.ts`). Users who want to try a different model must hand-edit the JSON file, which is fragile and undiscoverable. Classic chat mode exposes a `model` text field in the settings tab and also inline in the view header — no JSON editing needed.

The plugin's `PluginSettings` object is persisted via Obsidian's `saveData()` / `loadData()`, and the settings tab is the canonical place for user-editable provider config. Packs are loaded once per plugin load and on demand; their `AgentPack` objects are available at the time the settings tab renders.

## Goals / Non-Goals

**Goals:**
- Let users override the model name for each provider in each installed pack via the settings tab.
- Apply overrides at runtime so the pack JSON remains the default and no files are mutated.
- Mirror the UX of the existing Classic mode Model field (plain text input, placeholder showing current value).

**Non-Goals:**
- Overriding `baseUrl` or `apiKey` per-provider (out of scope; model is the most common thing to swap).
- Editing pack structure (agents, steps, system prompts) from the UI.
- Saving model overrides inline from the chat view (settings tab is the primary UX touch point).

## Decisions

### 1. Store overrides as `packModelOverrides: Record<packId, Record<providerName, string>>` in `PluginSettings`

Alternatives considered:
- **Flat key** (`"grounded-research.retriever"`): simpler but fragile if pack IDs contain dots; nested map is self-documenting.
- **Per-pack settings object with all provider fields**: over-engineered for the scope; we only need model overrides today.

A missing key means "use the pack JSON value" — no migration needed for existing users.

### 2. Merge overrides in `buildProviders()` inside `runtime.ts`

The merge point is the last moment before a `ModelProvider` is instantiated. This keeps the `AgentPack` object immutable (no mutation of the loaded JSON struct) and means overrides are applied on every run without extra wiring.

Alternative: mutate the pack after loading in `loader.ts`. Rejected because it would hide the override logic away from the call site and make the loaded pack object diverge from the on-disk file.

### 3. Render a "Pack models" section in the settings tab, loaded via `loadPacks()`

The settings tab already holds a reference to the plugin instance; it can call `loadPacks()` async and render inputs after the packs resolve. Each provider gets one text input labelled with the provider name, placeholder showing the JSON-declared model.

Alternative: Add a dedicated "Pack settings" modal. Rejected — the settings tab is already the home for all config and this keeps it in one place.

### 4. Update the chat view pack summary to show effective model

The pack summary (`open-agent-pack-models` div) currently reads directly from `activePack.providers[name].model`. After this change, the view needs to resolve the effective model: override if present, else JSON default. The view already has access to `getSettings()` via `deps`, so it can read `settings.packModelOverrides[pack.id]?.[providerName] ?? pack.providers[providerName].model`.

## Risks / Trade-offs

- **Stale settings if pack is removed**: If a user removes a pack JSON file, orphaned override keys remain in `PluginSettings`. These are harmless (ignored at runtime) but can grow unbounded. → Acceptable for now; a cleanup pass on settings load would be a future improvement.
- **Provider name coupling**: Override keys are provider names from the pack JSON (e.g., `"retriever"`, `"synthesizer"`, `"verifier"`). If a pack renames a provider, existing overrides silently stop applying. → Acceptable; this is the same coupling as the pack JSON itself.
- **Async settings tab render**: `loadPacks()` is async, so the "Pack models" section must render after a promise resolves. The settings tab uses Obsidian's synchronous `display()`. → Render a loading placeholder, then populate with `void loadPacks(...).then(render)`.

## Migration Plan

- No data migration: `packModelOverrides` defaults to `{}`. Existing users see the new section in settings with empty inputs (pack JSON defaults apply).
- No breaking changes to pack JSON schema.
- Rollback: remove `packModelOverrides` from settings type; existing stored values are ignored by older plugin versions.
