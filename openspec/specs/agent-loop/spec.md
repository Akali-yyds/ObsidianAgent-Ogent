# agent-loop Specification

## Purpose
Manages the multi-turn tool-dispatching conversation loop between the chat view and the model provider, streaming typed events to the caller.

## Requirements

### Requirement: Single-turn streaming chat
The agent loop SHALL accept a list of chat messages, a `ModelProvider`, and an optional `ToolRegistry`, and return an async iterable of events representing the assistant's reply (text deltas, tool-call announcements, tool-result echoes, and completion). When no tool registry is supplied, the loop's behaviour matches M0 (text-only deltas).

#### Scenario: Successful turn without tools
- **WHEN** the chat view calls the loop with a non-empty user message and no tool registry
- **THEN** the loop yields text deltas in order until the model completes or the caller aborts

#### Scenario: System prompt prepended
- **WHEN** the user has configured a system prompt in settings
- **THEN** the loop prepends a `system` message before forwarding to the provider

#### Scenario: Successful turn with tool dispatch
- **WHEN** the chat view calls the loop with a tool registry and the model emits one or more tool calls in its first turn
- **THEN** the loop yields text deltas (if any), runs each tool sequentially, yields tool-call and tool-result events, appends `tool` role messages with the results, and resumes the conversation until the model returns a final assistant message

### Requirement: Multi-step tool dispatch with cap
The loop SHALL run up to `maxSteps` (default 8) iterations of model-call → tool-dispatch → resume. When the cap is reached without a final assistant message, the loop SHALL yield a synthetic assistant message indicating the cap was hit.

#### Scenario: Within cap
- **WHEN** the model finishes within 5 tool-dispatch rounds
- **THEN** the loop completes and the synthetic-cap message is not emitted

#### Scenario: Cap hit
- **WHEN** the model emits tool calls on every turn through 8 iterations without a final assistant message
- **THEN** the loop stops, yields a synthetic assistant turn explaining the cap was hit, and exits cleanly

### Requirement: Sequential tool execution
The loop SHALL execute tool calls within a single assistant turn one at a time in the order the model emitted them.

#### Scenario: Multiple tool calls in one turn
- **WHEN** the model emits two tool calls in the same assistant turn
- **THEN** the loop runs them sequentially, appending each tool result before invoking the next, and only resumes the model after both have completed (or one has errored)

### Requirement: Tool errors propagate to the model
The loop SHALL convert tool errors into `tool` role messages with structured error payloads so the model can self-correct or surface the failure to the user.

#### Scenario: Tool throws
- **WHEN** a tool's `run` throws or times out
- **THEN** the loop appends a `tool` message with `{ error: <type>, message: <string> }` and continues the conversation rather than terminating
