## ADDED Requirements

### Requirement: Pack model overrides stored in plugin settings
The plugin SHALL store per-pack, per-provider model overrides in `PluginSettings` as `packModelOverrides: Record<string, Record<string, string>>`, keyed by pack ID then provider name. An absent key at either level SHALL mean "use the pack JSON value." The default value SHALL be an empty object `{}`.

#### Scenario: Override present
- **WHEN** `packModelOverrides["grounded-research"]["synthesizer"]` is set to `"gpt-4o"`
- **THEN** the runtime uses `"gpt-4o"` as the synthesizer model, ignoring the JSON-declared model

#### Scenario: Override absent
- **WHEN** `packModelOverrides` has no entry for `"grounded-research"`
- **THEN** the runtime uses all model names declared in the pack JSON file unchanged

#### Scenario: Partial override
- **WHEN** only `packModelOverrides["grounded-research"]["retriever"]` is set
- **THEN** the retriever uses the override model and synthesizer/verifier use their JSON-declared models

### Requirement: Overrides applied at runtime without mutating pack objects
The runtime SHALL merge overrides in `buildProviders()` immediately before constructing each `ModelProvider`. The `AgentPack` object loaded from disk SHALL NOT be mutated.

#### Scenario: Override applied per-provider
- **WHEN** `buildProviders()` is called with a pack and a non-empty overrides map
- **THEN** each provider config used to construct `ModelProvider` reflects the override model where present, and the original `AgentPack.providers` record remains unmodified

### Requirement: Effective model displayed in pack summary
The chat view pack summary SHALL display the *effective* model for each provider (override if set, JSON default otherwise) rather than reading directly from the `AgentPack` object.

#### Scenario: Override reflected in view
- **WHEN** the user has set a model override for `"synthesizer"` in settings and the pack is active in the view
- **THEN** the pack summary row shows the overridden model name for the synthesizer slot
