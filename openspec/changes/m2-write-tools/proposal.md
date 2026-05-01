## Why

M1 delivered a read-only vault agent. M2 makes it actually useful: the model can now create, overwrite, append to, and surgically edit notes — turning the plugin from a Q&A tool into a real agent. Write safety (consent modal with diffs + session undo) is already specified and ships in the same milestone.

## What Changes

- Implement `vault_write` — create or overwrite a note with frontmatter merge
- Implement `vault_append` — append content to an existing note with newline safety
- Implement `vault_edit` — replace an exact `oldString` with `newString`, rejecting ambiguous matches
- Implement vault path safety guard — `normalizePath` + traversal rejection for all write tools
- Implement tool-consent modal — per-tool diff views (line diff for edit, frontmatter+body diff for write, trailing-context preview for append); Approve / Reject / Approve All This Session actions
- Implement session-scoped undo ring buffer (capacity 50) + "Undo last tool write" command
- Wire `mutates: true` flag on write tools so they route through consent before execution

## Capabilities

### New Capabilities

_(none — all write tool and consent requirements are already captured in existing specs)_

### Modified Capabilities

- `vault-tools`: write tools (`vault_write`, `vault_append`, `vault_edit`, vault path safety) were specified in M1 but not implemented — M2 delivers them
- `tool-consent`: fully specified but unimplemented — M2 delivers the consent modal, diff rendering, never-mode short-circuit, and undo buffer

## Impact

- `src/tools/vault-write.ts` (new) — write tool implementations
- `src/tools/vault-consent.ts` (new) — consent modal + undo buffer
- `src/tools/registry.ts` — wire write tools into registry with `mutates` routing
- `src/agent-loop.ts` — ensure consent gate is called before mutating tool dispatch
- `styles.css` — diff view styling (red/green, green-bordered append preview)
- No new dependencies required; Obsidian modal API + existing diff approach sufficient
