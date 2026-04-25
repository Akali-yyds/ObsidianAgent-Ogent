# model-provider Specification

## Purpose
TBD - created by archiving change m0-skeleton. Update Purpose after archive.
## Requirements
### Requirement: ModelProvider interface
The plugin SHALL define a `ModelProvider` interface with a single method that streams text deltas given chat messages and an `AbortSignal`. The interface SHALL be the only seam used by the agent loop.

#### Scenario: Interface shape
- **WHEN** a developer reads the source
- **THEN** they find a `ModelProvider` interface exposing a `stream(messages, opts)` method that returns an async iterable of text deltas

### Requirement: OpenAI-compatible provider implementation
The plugin SHALL ship one implementation of `ModelProvider` targeting any OpenAI-compatible chat-completions HTTP endpoint, configured by base URL, API key, and model name.

#### Scenario: Successful call to OpenAI
- **WHEN** the user configures `baseUrl=https://api.openai.com/v1`, a valid `apiKey`, and `model=gpt-4o-mini`, then sends a message
- **THEN** the provider streams the assistant's reply as text deltas

#### Scenario: Successful call to LAN Ollama
- **WHEN** the user configures `baseUrl=http://192.168.x.x:11434/v1`, any non-empty `apiKey`, and `model=llama3.1`, then sends a message
- **THEN** the provider streams the assistant's reply

### Requirement: CORS-safe transport with streaming preference
The provider SHALL prefer `fetch` for streaming and fall back to Obsidian's `requestUrl` (non-streaming) when `fetch` is blocked by CORS. When the fallback is used, the provider SHALL still yield the response as a single text delta and surface a degraded-mode flag to callers.

#### Scenario: Streaming path
- **WHEN** the endpoint allows browser CORS
- **THEN** the provider uses `fetch` with `stream: true` and yields incremental deltas

#### Scenario: CORS fallback
- **WHEN** `fetch` fails with a CORS error
- **THEN** the provider retries the request via `requestUrl`, parses the non-streaming response, yields the full text as one delta, and sets a `degraded: true` flag the chat view can display

### Requirement: Authorization header
The provider SHALL send the API key as a Bearer token in the `Authorization` header.

#### Scenario: Header sent
- **WHEN** the provider issues a request
- **THEN** the request carries `Authorization: Bearer <apiKey>`

### Requirement: No key logging
The provider SHALL NOT log the API key, full request headers, or full request body to the console or to any persistent log.

#### Scenario: Error logged
- **WHEN** the provider catches an error and logs it
- **THEN** the log message contains the error type and HTTP status but does not include the API key or full headers

