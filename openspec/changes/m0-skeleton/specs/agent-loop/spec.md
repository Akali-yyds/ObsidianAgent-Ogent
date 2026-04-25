## ADDED Requirements

### Requirement: Single-turn streaming chat
The agent loop SHALL accept a list of chat messages and a `ModelProvider`, and return an async iterable of text deltas representing the assistant's reply.

#### Scenario: Successful turn
- **WHEN** the chat view calls the loop with a non-empty user message
- **THEN** the loop yields text deltas in order until the model completes or the caller aborts

#### Scenario: System prompt prepended
- **WHEN** the user has configured a system prompt in settings
- **THEN** the loop prepends a `system` message before forwarding to the provider

### Requirement: Cancellation via AbortSignal
The agent loop SHALL accept an `AbortSignal` and abort the underlying HTTP request when the signal fires.

#### Scenario: Abort propagates
- **WHEN** the chat view aborts the signal mid-stream
- **THEN** the loop terminates the iteration and the underlying HTTP request is cancelled

### Requirement: No tools registered in M0
The agent loop SHALL NOT register any tools in M0 and SHALL pass `tools: undefined` (or equivalent) when calling the provider.

#### Scenario: No tool calls
- **WHEN** the loop runs in M0
- **THEN** the provider request contains no `tools` field and any tool-call deltas returned by the model are discarded

### Requirement: Errors are surfaced
The loop SHALL surface provider errors (network, auth, rate limit, malformed response) as typed errors that the chat view can render as user-visible messages.

#### Scenario: Auth failure
- **WHEN** the provider returns HTTP 401
- **THEN** the loop emits an `AuthError` that the chat view displays with a link to the settings tab

#### Scenario: Network failure
- **WHEN** the provider request fails to connect
- **THEN** the loop emits a `NetworkError` that the chat view displays with a retry hint
