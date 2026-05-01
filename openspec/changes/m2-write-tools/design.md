## Context

M1 shipped a read-only vault agent with a `ToolRegistry` that dispatches tool calls. Write tools (`vault_write`, `vault_append`, `vault_edit`) and the consent system (`tool-consent`) were fully specced in M1 but intentionally deferred. The registry already supports `mutates: boolean` and `category` on each `ToolDef` — the consent gate just needs to be wired in before `run()` is called.

## Goals / Non-Goals

**Goals:**
- Implement three write tools with all edge-case handling from the specs (frontmatter merge, newline safety, ambiguous-match rejection, path traversal guard)
- Implement consent modal with per-tool diff rendering (line diff, frontmatter+body diff, append preview)
- Implement session-scoped undo ring buffer (cap 50) + "Undo last tool write" command
- Wire consent gate into registry so it applies to all current and future mutating tools

**Non-Goals:**
- Persistent undo across sessions
- Multi-step undo / redo
- Conflict resolution when another plugin modifies the same file during a session

## Decisions

### 1. Consent gate lives in ToolRegistry, not in individual tool `run()` functions

The registry already sees every tool call. Putting the gate in `run()` would require each write tool to duplicate the consent call and error shape. Centralised in the registry, a new mutating tool automatically gets consent by setting `mutates: true`.

**Alternative considered:** Middleware/interceptor pattern wrapping `run`. Rejected — adds indirection without benefit at this scale.

### 2. No external diff library; compute diffs inline

Bundle size is a constraint for an Obsidian plugin (targeting <500 KB gzipped). A full diff library (e.g., `diff`, `jsdiff`) adds ~20 KB for a feature that only needs line-level diffs in one modal. A straightforward LCS-based line diff is ~40 lines of TS, sufficient for the three diff views the spec requires.

**Alternative considered:** Import `diff` package. Rejected — bundle bloat, and the spec's diff requirements are narrow (line diff, YAML pretty-print, 5-line trailing context).

### 3. ConsentModal extends Obsidian's `Modal`

Obsidian's `Modal` class handles focus management, backdrop, keyboard dismissal, and mobile layout. The modal renders diff content into `contentEl` using standard DOM manipulation. "Approve All This Session" sets an in-memory flag on the `ChatSession` that the consent gate checks before opening future modals.

**Alternative considered:** A custom overlay component. Rejected — re-implementing what Obsidian already provides correctly for both desktop and mobile.

### 4. Write tools in `src/tools/vault-write.ts`, consent in `src/tools/vault-consent.ts`

Keeps vault I/O logic separate from UI/consent logic. The undo ring buffer lives in `vault-consent.ts` as a module-level singleton scoped to the session (cleared when the chat view resets).

**Alternative considered:** Single file for all write/consent. Rejected — the consent module has a distinct concern (UI + undo) that would bloat the tool file.

### 5. Frontmatter merge uses Obsidian's `parseYaml` / `stringifyYaml`

These are already available via the Obsidian API and produce output consistent with what Obsidian itself writes. No extra YAML dependency needed.

## Risks / Trade-offs

- **Diff accuracy on large files** → The inline LCS diff is O(n²) on line count. Mitigated by collapsing diffs >200 lines in the modal (per spec). Files that large are unusual in Obsidian vaults.
- **Concurrent write race** → If the user edits the same file in Obsidian while the agent holds a before-snapshot for undo, restoring `before` will overwrite the user's manual edit. Mitigated by showing a notice on undo that warns about this; not fixable without a file lock Obsidian doesn't expose.
- **ConsentModal blocking the agent loop** → The agent loop awaits the consent promise. If the user closes Obsidian with a modal open, the promise never resolves. Mitigated by the `AbortController` wired to the Stop button — cancelling the run rejects all pending consent promises.
