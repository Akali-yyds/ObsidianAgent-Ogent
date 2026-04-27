## 1. Tool registry

- [x] 1.1 Add `src/tools/registry.ts` with `ToolDef<TArgs>`, `ToolResult`, `ToolRegistry` (`list/get/register`)
- [x] 1.2 Add a small JSON Schema validator (`src/tools/validate.ts`, ~30 LOC): required fields, type, enum, basic string/number constraints
- [x] 1.3 Add `defineTool<TArgs>(spec)` helper that types `run`'s args from the schema; spec carries `category` and `mutates`
- [x] 1.4 Add `runWithTimeout(promise, ms)` and wire 30s default into the registry's dispatch path
- [x] 1.5 Define typed errors: `ToolArgError`, `ToolTimeoutError`, `ToolCallParseError`, `ConsentDeniedError`, `PathError`, `AmbiguousEditError`, `NoMatchError`, `NotFoundError`

## 2. Vault read tools

- [x] 2.1 Add `src/tools/vault/list.ts` — glob match via `app.vault.getFiles()` + simple glob-to-regex
- [x] 2.2 Add `src/tools/vault/read.ts` — `app.vault.cachedRead`; split frontmatter via `parseYaml` + `getFrontMatterInfo`
- [x] 2.3 Add `src/tools/vault/search.ts` — three-strategy resolution (linkpath / tag-scope / full-text), 5MB byte cap
- [x] 2.4 Add `src/tools/vault/metadata.ts` — `MetadataCache.getFileCache()` extraction
- [x] 2.5 Add `src/tools/vault/links.ts` — `MetadataCache.resolvedLinks` + `getBacklinksForFile`

## 3. Vault write tools

- [x] 3.1 Add `src/tools/vault/path-safe.ts` — `normalizePath`, reject `..` traversal; shared helper used by all write tools
- [x] 3.2 Add `src/tools/vault/write.ts` — create-or-overwrite; merge frontmatter via existing parse + serialise; emit `WriteOp` to undo buffer
- [x] 3.3 Add `src/tools/vault/append.ts` — refuse non-existent files; ensure-newline default; emit `WriteOp`
- [x] 3.4 Add `src/tools/vault/edit.ts` — count occurrences; reject ambiguous; replace; emit `WriteOp`
- [x] 3.5 Add `src/tools/vault/index.ts` exporting `vaultTools(app, deps)` returning all eight `ToolDef[]`

## 4. Consent layer

- [x] 4.1 Add `src/consent/index.ts` — `ConsentManager` with `getMode(category)`, `setMode(category, mode)`, `requestApproval(toolDef, args, ctx)` returning `Promise<"approve" | "reject">`
- [x] 4.2 Add `src/consent/modal.ts` — `ConsentModal` extending Obsidian's `Modal`; renders header, diff, three buttons (Approve / Reject / Approve All This Session)
- [x] 4.3 Add `src/consent/diff.ts` — small Patience-style line diff (~80 LOC) producing `{ added, removed, context }` rows
- [x] 4.4 Add `src/consent/render-diff.ts` — three renderers: `renderEditDiff`, `renderWriteDiff`, `renderAppendDiff`
- [x] 4.5 Add session-scoped overrides: "Approve All This Session" sets in-memory mode for current chat-view session; cleared on view close
- [x] 4.6 Wire Stop button on the chat view to dismiss any open consent modal as a reject

## 5. Undo buffer

- [x] 5.1 Add `src/consent/undo.ts` — ring buffer (cap 50) of `WriteOp { id, path, before, after, timestamp }`
- [x] 5.2 Register command "Undo last tool write" — pops most recent, writes `before` back, emits notice
- [x] 5.3 Clear buffer on chat-view session reset

## 6. Provider — tool-call streaming

- [x] 6.1 Update `provider.stream` signature to yield typed event union (`text` | `tool_call_delta` | `tool_call_assembled` | `done`)
- [x] 6.2 Extend SSE parser to detect `delta.tool_calls[]` and buffer per-call args
- [x] 6.3 On `finish_reason === "tool_calls"`, parse buffered args, yield `tool_call_assembled` with `{ id, name, arguments }`
- [x] 6.4 `requestUrl` fallback: read `choices[0].message.tool_calls` if present, yield assembled event
- [x] 6.5 Forward `tools` parameter from caller into the request body (omit when empty)
- [x] 6.6 Surface `ToolCallParseError` for malformed JSON arg strings

## 7. Agent loop — multi-step + consent

- [x] 7.1 Update `runTurn` signature to accept optional `tools: ToolRegistry`, `consent: ConsentManager`, `maxSteps: number = 8`
- [x] 7.2 Replace single-iteration loop with step-counted loop: model call → buffer text + tool calls → for each call: validate args, gate via consent if `mutates`, dispatch, append `tool` message → repeat
- [x] 7.3 Yield typed events to the view (`text` / `tool_call_started` / `tool_call_finished` / `consent_requested` / `done` / `cap_hit`)
- [x] 7.4 Convert thrown tool errors into `tool` messages with structured payload; never abort the loop
- [x] 7.5 On `cap_hit`, emit synthetic assistant message and exit cleanly
- [x] 7.6 Forward `AbortSignal` into every model call, consent prompt, and tool dispatch

## 8. Chat view — tool cards

- [x] 8.1 Extend `UiTurn` to carry an array of tool-call records (`{ id, name, args, status, result, error, mutates }`)
- [x] 8.2 Render collapsible card per tool call: header (`name(arg1=…)`), expandable JSON args + result preview (first 2KB)
- [x] 8.3 Distinct styling for mutating cards: amber border pre-approval, green on success, red on reject/error
- [x] 8.4 "Show more" affordance for results > 2KB
- [x] 8.5 "Open" action when result has a `path` field; route to `app.workspace.getLeaf(false).openFile(file)`
- [x] 8.6 Wire new typed events from the loop into card lifecycle

## 9. Settings — consent toggles

- [x] 9.1 Extend `PluginSettings` with `consent: { vault_read, vault_write }: ("always" | "ask" | "never")`; defaults `always` / `ask`
- [x] 9.2 Render two dropdowns in the settings tab; persist via `saveSettings()`; emit existing `'settings-changed'` event
- [x] 9.3 Add the vault-content notice alongside the existing key-storage notice

## 10. Plugin wiring

- [x] 10.1 In `main.ts`, build `ToolRegistry`, `ConsentManager`, `UndoBuffer` at plugin load and register vault tools
- [x] 10.2 Pass registry + consent + undo to the chat view, which threads them into `runTurn`
- [x] 10.3 Register command "Ask agent about current note" — opens view, pre-fills `Tell me about [[<basename>]]`
- [x] 10.4 Register command "Undo last tool write"
- [x] 10.5 Notice + no-op when no active file on the "Ask agent" command

## 11. Manual verification

- [x] 11.1 Read flow: ask "what's in [[<note>]]?" — verify `vault_read` is called, answer cites file, no consent prompt
- [x] 11.2 Search flow: ask "find notes mentioning 'spec tools'" — verify `vault_search` returns matches
- [x] 11.3 Links flow: ask "what links to [[<note>]]?" — verify `vault_links` returns inbound list
- [x] 11.4 Write — modal approve: ask agent to add a sentence to a test note via `vault_edit` — verify modal shows correct diff, approve, file updated
- [x] 11.5 Write — modal reject: same flow, reject — verify file unchanged and model receives `ConsentDeniedError`
- [x] 11.6 Write — approve-all-session: write twice, second call shouldn't prompt; reset chat view, third call prompts again
- [~] 11.7 Write — never mode: set `vault_write=never`, agent attempts edit — verify auto-rejection without modal
- [~] 11.8 Edit ambiguity: have agent attempt an `oldString` matching multiple times — verify `AmbiguousEditError` returned
- [~] 11.9 Path safety: prompt agent to write to `../escape.md` — verify `PathError`
- [~] 11.10 Undo: perform a write, run "Undo last tool write" — verify revert; run again with empty buffer — verify notice
- [~] 11.11 Mid-stream Stop: stop while consent modal open — verify modal dismisses + loop aborts
- [~] 11.12 Mobile: full read + write flows on iOS/Android, verify modal renders usable on narrow screens
- [~] 11.13 Smaller-model regression: try with a 7B-class model — note any tool-arg hallucinations and whether self-correct loop recovers

## 12. Wrap-up

- [ ] 12.1 `openspec validate m1-vault-tools`
- [ ] 12.2 Tag a `v0.1.0` release commit
- [ ] 12.3 `openspec archive m1-vault-tools`
