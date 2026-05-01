## ADDED Requirements

### Requirement: Tool category and mutation flag
Every tool SHALL declare a `category` (e.g., `vault_read`, `vault_write`) and a `mutates: boolean` flag. Mutating tools SHALL go through the `tool-consent` capability before execution.

#### Scenario: Mutation flag set on writes
- **WHEN** a developer audits the tool implementations
- **THEN** `vault_write`, `vault_append`, and `vault_edit` declare `mutates: true` and category `vault_write`; read tools declare `mutates: false` and category `vault_read`

### Requirement: vault_write
The plugin SHALL expose a `vault_write` tool that creates or overwrites a note. When `frontmatter` is supplied, it SHALL be merged into the file's existing frontmatter (existing keys preserved unless explicitly overridden). Body SHALL be rewritten verbatim.

#### Scenario: Create new file
- **WHEN** the model calls `vault_write({ path: "Notes/new.md", body: "hello" })` and the file doesn't exist
- **THEN** after consent the file is created and the result is `{ path, created: true, bytesBefore: 0, bytesAfter: 5 }`

#### Scenario: Overwrite existing file
- **WHEN** the model calls `vault_write` against an existing file
- **THEN** after consent the file is overwritten and the result is `{ path, created: false, bytesBefore: <prev>, bytesAfter: <new> }`

#### Scenario: Frontmatter merge
- **WHEN** the model calls `vault_write({ path, body, frontmatter: { tags: ["x"] } })` against a file whose frontmatter has `title: "y"` and `tags: []`
- **THEN** after consent the resulting frontmatter contains `title: "y"` and `tags: ["x"]` (override) while body is rewritten verbatim

### Requirement: vault_append
The plugin SHALL expose a `vault_append` tool that appends content to an existing file. The tool SHALL refuse to create new files. By default, it SHALL ensure a newline separator before the appended content if the file doesn't already end with one.

#### Scenario: Append with newline
- **WHEN** the model calls `vault_append({ path, content })` and the file does not end with a newline
- **THEN** after consent the file gains a leading newline before the appended content; the result is `{ path, bytesAppended }`

#### Scenario: Refuse non-existent file
- **WHEN** the model calls `vault_append` against a non-existent path
- **THEN** the tool returns `{ error: "NotFound: <path>" }` without prompting for consent

### Requirement: vault_edit
The plugin SHALL expose a `vault_edit` tool that replaces an exact `oldString` with `newString` in a target file. The tool SHALL count matches before applying and reject when the actual count does not equal `occurrences` (default `1`).

#### Scenario: Single match
- **WHEN** the model calls `vault_edit({ path, oldString, newString })` with `oldString` matching exactly once
- **THEN** after consent the match is replaced and the result is `{ path, replaced: 1 }`

#### Scenario: Ambiguous edit rejected
- **WHEN** the model calls `vault_edit` with `oldString` matching three times and `occurrences: 1`
- **THEN** the tool returns `{ error: "AmbiguousEditError", actual: 3, expected: 1 }` so the model can narrow `oldString`

#### Scenario: No match
- **WHEN** `oldString` is not present in the file
- **THEN** the tool returns `{ error: "NoMatchError" }` without writing

### Requirement: Vault path safety
All write tools (`vault_write`, `vault_append`, `vault_edit`) SHALL resolve their `path` argument via Obsidian's `normalizePath` and reject any path that escapes the vault root.

#### Scenario: Traversal rejected
- **WHEN** the model supplies `path: "../foo.md"` to any write tool
- **THEN** the tool returns `{ error: "PathError" }` and performs no I/O
