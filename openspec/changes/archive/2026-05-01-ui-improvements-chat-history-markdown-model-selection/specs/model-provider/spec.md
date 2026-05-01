## ADDED Requirements

### Requirement: Optional model enumeration
The `ModelProvider` interface SHALL declare an optional `listModels(): Promise<string[]>` method. Callers SHALL check for the method's presence before invoking it. Providers that do not support model listing SHALL omit the method; providers that do SHALL return an array of model ID strings.

#### Scenario: Interface shape with listModels
- **WHEN** a developer reads the ModelProvider interface
- **THEN** they find an optional `listModels?(): Promise<string[]>` method alongside the existing `stream` method

#### Scenario: Caller guards presence
- **WHEN** the chat view attempts to populate model suggestions
- **THEN** it checks `typeof provider.listModels === "function"` before calling it, and skips suggestions if absent

### Requirement: OpenAI-compatible listModels implementation
The `OpenAICompatibleProvider` SHALL implement `listModels()` by calling the provider's `/models` endpoint and returning an array of model ID strings sorted alphabetically. Network or CORS failures SHALL be caught and an empty array returned.

#### Scenario: Successful models fetch
- **WHEN** `listModels()` is called and the endpoint returns a valid `/models` response
- **THEN** the method resolves with an array of model ID strings sorted alphabetically

#### Scenario: Network or CORS failure
- **WHEN** `listModels()` is called and the request fails (CORS, timeout, non-2xx)
- **THEN** the method resolves with an empty array and does not throw
