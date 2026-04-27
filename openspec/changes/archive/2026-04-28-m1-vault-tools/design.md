## Context

M0 produced a working chat shell with no tools. M1 introduces tool-calling end-to-end **and** ships both read and write surfaces in one cut, gated by a consent layer the user controls. The user has explicitly rejected a read-only first cut as too thin. Every later milestone (web tools in M2, MCP in M3/M4) plugs into the tool-registry and consent abstractions defined here.

Sequential tool dispatch (no parallel) is fine for v1; OpenAI's streaming protocol supports parallel calls, but the consent UX needs to be sequential anyway and vault reads don't benefit much from parallelism at typical sizes.

## Goals / Non-Goals

**Goals:**
- A registry-based tool abstraction that any tool source (vault, web, MCP) can plug into.
- Eight vault tools covering the realistic shapes: list / read / search / metadata / links / write / append / edit.
- A consent layer with per-category modes (`always` / `ask` / `never`), defaulting to `ask` for writes — so destructive actions never happen without explicit user input under default settings.
- Diff-based confirmation modal that's tailored per write-tool shape (full diff for edits, frontmatter+body diff for writes, appended block preview for appends).
- Session-scoped undo for tool-driven writes.
- Multi-step loop with `maxSteps: 8`.

**Non-Goals:**
- Web tools, MCP, markdown rendering, persistent conversations, parallel tool execution.
- AI SDK adoption — extending our M0 custom loop is cheaper.
- Cross-session undo, vault-history integration, or git-style rollback.
- Smart RAG / embedding-based search.
- Multi-file refactors as one tool call.

## Decisions

### Tool registry: typed `ToolDef[]` with hand-rolled JSON Schema validation
- Each tool is `{ name, description, schema, category, mutates, run }`. `schema` is a JSON-Schema-shaped object the model sees verbatim.
- `category` is one of `vault_read | vault_write` (M2+ adds `web`, `mcp_<server>`).
- `mutates: boolean` is the source of truth for whether consent applies.
- **Why not Zod:** ~50KB+ for one feature when OpenAI's tool-calling API already wants JSON Schema. We ship a small validator (~30 LOC) covering required / type / enum / basic string-number constraints.
- `defineTool<TArgs>(spec)` helper that ties `run`'s args type to the schema.

### Consent layer: per-category mode + modal
- Setting per category: `always` (auto-approve), `ask` (modal), `never` (always reject with structured error to model).
- Defaults: `vault_read` = `always`, `vault_write` = `ask`. Future categories default `ask`.
- "Approve All This Session" sets the category to `always` for the lifetime of the open chat view (cleared on view close or on a "Reset session approvals" command). Persistence across sessions requires the user to flip the global setting — friction is intentional.
- Modal blocks the loop until the user responds. Stop button on the chat view also dismisses the modal as a reject.
- **Rejected:** auto-approve with toast + undo button. Too easy to miss the toast on mobile; an explicit modal is the trustworthy default.

### Diff renderer
- `vault_edit`: line-level diff between current file and `file.replace(oldString, newString)`. Red minus / green plus rows. Capped at 200 lines visible (collapse rest behind "show full diff").
- `vault_write`: split frontmatter vs body, show old → new for each. Frontmatter rendered as YAML pretty-print; body as line diff.
- `vault_append`: show the appended block in a green-bordered preview, plus the trailing 5 lines of the existing file as context.
- All diffs use a small custom diff implementation (Patience-style line diff, ~80 LOC) — no `diff` npm dep.

### Write-tool semantics
- `vault_write({ path, body, frontmatter? })`: creates if missing, overwrites otherwise. If `frontmatter` is provided, merges with existing frontmatter (existing keys preserved unless the model explicitly sets them). Body is rewritten verbatim. Returns `{ path, created: bool, bytesBefore, bytesAfter }`.
- `vault_append({ path, content, ensureNewline?: true })`: appends `content` to the end of the file. If `ensureNewline` (default true), prepends a newline if the file doesn't end with one. Refuses to create new files (use `vault_write` for that). Returns `{ path, bytesAppended }`.
- `vault_edit({ path, oldString, newString, occurrences?: 1 })`: finds `oldString` in the file. If exactly `occurrences` matches, replaces them; otherwise rejects with `AmbiguousEditError` carrying the actual count. This is the same primitive Claude Code's edit tool uses — it's been battle-tested for LLM-driven edits.
- All write tools refuse paths outside the vault (resolves via Obsidian's `normalizePath`, rejects `..` traversal).

### Session undo
- Every successful write tool emits a `WriteOp { id, path, before, after }` to an in-memory ring buffer (last 50). "Undo last tool write" pops the most recent and writes `before` back. Disabled when buffer empty.
- Buffer is per chat-view-session — clearing the chat clears the buffer.
- Undo deliberately doesn't go through the consent modal; it's reverting a prior approved action.

### Vault search strategy
- `vault_search({ query, scope?: { folder?, tag?, limit? } })`.
- Path 1: exact-name resolution via `MetadataCache.getFirstLinkpathDest` — O(1).
- Path 2: tag-scoped iteration via `MetadataCache.getCache(file).tags` — O(notes).
- Path 3: bounded full-text scan, ≤5MB cumulative, ≤50 candidate files. Result `{ matches: [{ path, line, excerpt }], truncated }`.

### Multi-step loop with `maxSteps: 8` and consent-aware dispatch
- Loop:
  1. Provider.stream with messages + tools.
  2. Collect text deltas (yield to UI) and tool-call deltas (buffer).
  3. After turn ends, for each tool call: validate args; if mutating + category mode is `ask`, open consent modal and await; if `never`, return a `ConsentDeniedError` tool result; otherwise run.
  4. Append `tool` messages with results, increment step, loop.
  5. If `maxSteps` hit: emit synthetic assistant message, exit.

### Tool-call rendering
- One card per call, collapsed by default. Read cards: neutral border. Write cards: amber border before approval, green after success, red on reject/error.
- Header: `tool_name(arg1=value1, arg2=value2)` truncated. Expand reveals full JSON args, result preview (first 2KB), and any "Open" action when the result has a `path`.

### Pre-fill command
- "Ask agent about current note" inserts `Tell me about [[<basename>]]`, focuses input, doesn't auto-send. Lets the user refine before submitting.

## Risks / Trade-offs

- **Smaller models hallucinate tool args** → Mitigation: clear narrow schemas; reject malformed args via the validator and feed errors back so the model can self-correct one step.
- **Modal fatigue** → Mitigation: "Approve All This Session" for the obvious cases; future M2 work could add per-path or per-folder approval scopes if real usage demands it.
- **Edit ambiguity** → Mitigation: `AmbiguousEditError` returns the actual occurrence count so the model can re-narrow `oldString`. Same pattern that works in Claude Code.
- **Mobile modal UX** → Mitigation: modal sized for mobile breakpoints; diff renders horizontally-scrollable on narrow screens; primary actions are large tap targets.
- **`requestUrl` non-streaming + tool-calling** → Mitigation: parser handles both shapes (streamed deltas and parsed `choices[0].message.tool_calls`).
- **Read tools leak vault contents to the model endpoint** → Mitigation: settings notice is explicit; user opted in by configuring a remote provider.
- **Session-only undo is thin** → Mitigation: documented; full vault-history integration is a future change. Combined with consent-by-default, this is acceptable for M1.
- **Sequential dispatch can stall on slow tools** → Mitigation: 30s default timeout per tool; `vault_search` returns truncated quickly under the byte cap.

## Migration Plan

No user-facing migration. Internal: M0's `runTurn` signature gains an optional `tools` registry parameter (backwards-compatible default empty). Existing M0 chat behaviour is identical when no tools are registered.
