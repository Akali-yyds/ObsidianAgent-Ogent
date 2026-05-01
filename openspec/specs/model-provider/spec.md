## Purpose
Defines the `ModelProvider` abstraction and the OpenAI-compatible implementation that streams chat completions and tool calls to any compatible endpoint.

## Requirements

### Requirement: ModelProvider interface
The plugin SHALL define a `ModelProvider` interface with a `stream` method that accepts chat messages, an `AbortSignal`, and an optional `tools` array (JSON Schema), and an optional `listModels` method returning a sorted list of available model IDs. The `stream` method SHALL return an async iterable of events: text deltas, tool-call deltas (incremental), and a final tool-call assembly event when the model finishes a tool-calling turn. The interface SHALL be the only seam used by the agent loop.

#### Scenario: Interface shape
- **WHEN** a developer reads the source
- **THEN** they find `ModelProvider.stream(messages, opts)` where `opts` accepts `signal` and `tools`, and the iterable yields events typed as text deltas, tool-call deltas, or tool-call completion; and optionally `ModelProvider.listModels()` returning `Promise<string[]>`

#### Scenario: Tools field omitted when empty
- **WHEN** the loop calls `stream` with an empty or missing `tools` array
- **THEN** the request body sent to the endpoint contains no `tools` field

### Requirement: OpenAI-compatible provider implementation
The plugin SHALL ship one implementation of `ModelProvider` targeting any OpenAI-compatible chat-completions HTTP endpoint, configured by base URL, API key, and model name. The implementation SHALL forward the optional `tools` parameter and parse `tool_calls` deltas in the streaming response.

#### Scenario: Successful call to OpenAI
- **WHEN** the user configures `baseUrl=https://api.openai.com/v1`, a valid `apiKey`, and `model=gpt-4o-mini`, then sends a message
- **THEN** the provider streams the assistant's reply as text deltas

#### Scenario: Successful call to LAN Ollama
- **WHEN** the user configures `baseUrl=http://192.168.x.x:11434/v1`, any non-empty `apiKey`, and `model=llama3.1`, then sends a message
- **THEN** the provider streams the assistant's reply

#### Scenario: Tool calls streamed
- **WHEN** the model emits a tool-calling turn (`finish_reason: "tool_calls"`)
- **THEN** the provider yields per-fragment tool-call deltas as they arrive and a final assembly event containing the parsed `{ id, name, arguments }` for each call

### Requirement: CORS-safe transport with streaming preference
The provider SHALL prefer `fetch` for streaming and fall back to Obsidian's `requestUrl` (non-streaming) when `fetch` is blocked by CORS. The fallback SHALL handle both text-only and tool-calling responses.

#### Scenario: Streaming path
- **WHEN** the endpoint allows browser CORS
- **THEN** the provider uses `fetch` with `stream: true` and yields incremental deltas

#### Scenario: CORS fallback (text)
- **WHEN** `fetch` fails with a CORS error and the response is text-only
- **THEN** the provider retries the request via `requestUrl`, parses the non-streaming response, yields the full text as one delta, and sets a `degraded: true` flag the chat view can display

#### Scenario: CORS fallback (tool calls)
- **WHEN** `fetch` fails with a CORS error and the model returns tool calls
- **THEN** the provider retries via `requestUrl`, reads `tool_calls` directly from `choices[0].message`, yields a single tool-call assembly event with the parsed structure, and sets `degraded: true`

### Requirement: Tool-call argument parsing
The provider SHALL accumulate streamed `tool_calls[i].function.arguments` fragments per call and `JSON.parse` the assembled string at the end of the tool-calling turn. Parse failures SHALL be reported as a typed `ToolCallParseError` so the loop can return a structured error to the model.

#### Scenario: Args parse cleanly
- **WHEN** the model emits valid JSON arguments across multiple deltas
- **THEN** the provider yields one tool-call assembly event with `arguments` as a parsed object

#### Scenario: Args malformed
- **WHEN** the assembled argument string is not valid JSON
- **THEN** the provider yields a `ToolCallParseError` event referencing the offending tool call id, allowing the loop to surface a structured error to the model

### Requirement: Model listing
The `OpenAICompatibleProvider` SHALL implement `listModels()` by calling `GET <baseUrl>/models`, returning a sorted array of model ID strings. All errors SHALL be caught and return an empty array so callers never need to handle exceptions.

#### Scenario: Models fetched successfully
- **WHEN** `listModels()` is called with a reachable endpoint
- **THEN** it returns the sorted list of model IDs from the `data[].id` field of the response

#### Scenario: Endpoint unreachable
- **WHEN** `listModels()` is called and the network request fails
- **THEN** it returns `[]` without throwing
