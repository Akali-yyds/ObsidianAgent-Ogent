## 1. Write Tool Implementations

- [ ] 1.1 Create `src/tools/vault-write.ts` with `vault_write` tool: create/overwrite note, frontmatter merge via `parseYaml`/`stringifyYaml`, return `{ path, created, bytesBefore, bytesAfter }`
- [ ] 1.2 Implement `vault_append` in `vault-write.ts`: refuse non-existent files, ensure newline separator, return `{ path, bytesAppended }`
- [ ] 1.3 Implement `vault_edit` in `vault-write.ts`: count matches before applying, reject when count ≠ `occurrences` (default 1), return `{ path, replaced }` or structured error
- [ ] 1.4 Add vault path safety guard to all three write tools: `normalizePath` + traversal check, return `{ error: "PathError" }` on escape attempt
- [ ] 1.5 Register all three write tools in `src/tools/registry.ts` with `mutates: true` and `category: "vault_write"`

## 2. Consent Gate

- [ ] 2.1 Create `src/tools/vault-consent.ts` with `ConsentModal` extending Obsidian `Modal`: Approve / Reject / Approve All This Session buttons, returns a promise resolved by button click or `AbortSignal`
- [ ] 2.2 Implement inline LCS line diff utility in `vault-consent.ts` (no external library)
- [ ] 2.3 Implement per-tool diff rendering: line diff (red/green) for `vault_edit`, old/new frontmatter YAML + body line diff for `vault_write`, 5-line trailing context + green-bordered append block for `vault_append`; collapse diffs >200 lines with "show full diff"
- [ ] 2.4 Wire consent gate into `ToolRegistry.dispatch()`: before calling `run()` on a tool with `mutates: true`, check category consent mode (`always` / `ask` / `never`); open `ConsentModal` for `ask`, auto-reject for `never`
- [ ] 2.5 Implement "Approve All This Session": clicking the button sets an in-memory `sessionAlways` flag on the active `ChatSession`; gate checks this flag before opening modal

## 3. Undo Ring Buffer

- [ ] 3.1 Implement undo ring buffer in `vault-consent.ts`: module-level array (cap 50) storing `{ id, path, before, after, timestamp }`; write tools push entry after successful write
- [ ] 3.2 Register "Undo last tool write" command in plugin `onload`: pops most recent buffer entry, restores `before` via `app.vault.modify`, shows notice; shows "Nothing to undo" when buffer is empty
- [ ] 3.3 Clear undo buffer when chat session is reset (hook into existing session-clear logic)

## 4. Styling

- [ ] 4.1 Add diff view CSS to `styles.css`: `.diff-removed` (red background), `.diff-added` (green background), `.append-preview` (green border), collapsed diff toggle

## 5. Verification

- [ ] 5.1 Manual test `vault_write`: create new file, overwrite existing, frontmatter merge, traversal rejection
- [ ] 5.2 Manual test `vault_append`: append with/without trailing newline, refuse missing file
- [ ] 5.3 Manual test `vault_edit`: single match, ambiguous match rejection, no-match rejection
- [ ] 5.4 Manual test consent modal: Approve, Reject, Approve All This Session for each tool; verify correct diff is shown per tool
- [ ] 5.5 Manual test undo: undo after edit, undo after write, empty buffer notice, buffer clears on session reset
- [ ] 5.6 Manual test never-mode: set `vault_write` to `never` in settings, confirm no modal and `ConsentDeniedError` returned
