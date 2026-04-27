## Why

M0 ships a chat shell that can talk to any OpenAI-compatible model but has zero awareness of the user's vault. A read-only milestone alone would be half a product — the agent could describe notes but never help maintain them. M1 makes the agent fully vault-capable (read **and** write) in one shot, gated by a consent layer the user controls. This also exercises the full tool-calling round-trip (agent emits tool call → plugin runs tool, optionally with user consent → result feeds back → agent continues), which every later milestone (web tools in M2, MCP in M3/M4) builds on.

## What Changes

- New `vault-tools` capability with eight tools:
  - **Read:** `vault_list`, `vault_read`, `vault_search`, `vault_metadata`, `vault_links`.
  - **Write:** `vault_write` (create or overwrite, frontmatter-aware), `vault_append`, `vault_edit` (old-string/new-string match).
- New `tool-consent` capability: every tool declares a `mutates: boolean` flag and a category (`vault_read`, `vault_write`, etc.). Per-category consent mode (`always` / `ask` / `never`) is configurable in settings; default is `always` for read tools and `ask` for write tools.
- Consent modal: when a write tool fires under `ask` mode, the user sees a modal with the tool name, target path, and a diff (red/green per line for `vault_edit`; before/after frontmatter for `vault_write`; appended block for `vault_append`). Approve / Reject / Approve All This Session.
- Tools registered with the agent loop via a typed tool registry so later milestones can plug in.
- Agent loop becomes multi-step: dispatches tool calls (sequential), runs them (with consent gating where applicable), appends `tool` results, continues until the model produces a final assistant message or `maxSteps` (default 8) is hit.
- Model provider learns to emit OpenAI-style `tools` on requests and parse `tool_calls` deltas from streaming responses (and from the `requestUrl` fallback).
- Chat view renders tool calls as collapsible cards (collapsed by default) showing tool name, args, status, and result preview. Write cards visually distinguish from reads.
- New "Ask agent about current note" command pre-fills the chat input with `Tell me about [[<active-note>]]`.
- New "Undo last tool write" command that reverses the most recent write performed via a tool call (in-memory session history).
- Tool execution is logged in the chat transcript; full payloads never go to the developer console (truncate >1KB).

Out of scope for M1: web tools, MCP, markdown rendering of tool results, persistent conversations, parallel tool execution, multi-file refactors as a single tool, undo across plugin reloads.

## Capabilities

### New Capabilities
- `vault-tools`: typed read and write tools that expose vault contents to the agent (list, read, search, metadata, links, write, append, edit), plus the tool-registry abstraction.
- `tool-consent`: per-category consent mode + a confirmation modal for mutating tools, with diff rendering tailored to each write tool's shape, plus session-scoped undo for tool-driven writes.

### Modified Capabilities
- `agent-loop`: gains a multi-step tool-dispatch loop with `maxSteps` cap; accepts a tool registry; appends `tool` role messages with results between turns.
- `model-provider`: streams `tool_calls` deltas in addition to text deltas; accepts a `tools` parameter on each request; the `requestUrl` fallback understands tool-call shape.
- `chat-view`: renders tool-call cards (collapsed by default), with distinct styling for mutating tools; pre-fills via the new "Ask agent about current note" command.
- `settings`: adds consent-mode toggles per tool category and a clearer notice that vault contents may be sent to the model endpoint.

## Impact

- Code: new `src/tools/` directory (registry + vault tools), new `src/consent.ts` (modal + per-category gating + session history); modifications to `src/loop.ts`, `src/provider.ts`, `src/view.ts`, `src/settings.ts`, `src/main.ts`.
- Dependencies: none new (still no AI SDK; extending the existing custom loop remains cheaper).
- APIs: still only the user's configured LLM endpoint; no new outbound calls.
- Trust story: read tools surface arbitrary vault contents to the model endpoint (covered by an updated settings notice). Write tools are gated by the consent modal under default settings; no writes happen without explicit user action unless the user has explicitly switched a category to `always`. Every write is reversible within the session via the undo command.
- Performance: `vault_search` capped at 5MB cumulative scan. Write tools are O(1) per file. `vault_edit` validates uniqueness of the old-string match before applying and rejects ambiguous edits.
