# vault-tools Specification

## Purpose
Provides vault read and write tools accessible to the agent loop, including tool registry abstraction, argument validation, execution timeout, and path safety for write operations.

## Requirements

### Requirement: Tool registry abstraction
The plugin SHALL define a `ToolDef` type and a `ToolRegistry` that the agent loop consumes to discover, validate, and dispatch tool calls. Tool sources (vault, web, MCP) SHALL register through this single seam.

#### Scenario: Registry shape
- **WHEN** a developer reads the source
- **THEN** they find a `ToolDef<TArgs>` interface with `name`, `description`, `schema`, and `run(args, ctx)` fields, and a `ToolRegistry` that exposes `list()`, `get(name)`, and `register(tool)` methods

#### Scenario: Tools serialised for the model
- **WHEN** the agent loop calls `registry.list()`
- **THEN** each tool's JSON Schema is forwarded to the model in the `tools` request field exactly as defined

### Requirement: Argument validation
The registry SHALL validate the model's tool arguments against each tool's schema before invocation. Invalid arguments SHALL produce a `ToolArgError` that is returned to the model as a tool result so the model can self-correct.

#### Scenario: Invalid args
- **WHEN** the model emits tool args missing a required field
- **THEN** the registry returns a tool result of `{ error: "ToolArgError: missing field 'path'" }` to the model and does not invoke `run`

### Requirement: vault_list
The plugin SHALL expose a `vault_list` tool that returns vault entries matching a glob, restricted to files (not folders) by default.

#### Scenario: List by glob
- **WHEN** the model calls `vault_list({ glob: "Daily/*.md" })`
- **THEN** the result contains every file in the `Daily/` folder (top level, not recursive) ending in `.md`, returned as `{ entries: [{ path, size }, …] }`

#### Scenario: Recursive glob
- **WHEN** the model calls `vault_list({ glob: "**/*.md" })`
- **THEN** the result contains every markdown file in the vault

### Requirement: vault_read
The plugin SHALL expose a `vault_read` tool that returns the raw text of a vault file plus its parsed frontmatter.

#### Scenario: Read note
- **WHEN** the model calls `vault_read({ path: "Notes/foo.md" })`
- **THEN** the result is `{ path, frontmatter, body }` where `body` is the file content with frontmatter stripped

#### Scenario: Missing file
- **WHEN** the model calls `vault_read` with a path that doesn't exist
- **THEN** the result is `{ error: "NotFound: <path>" }`

### Requirement: vault_search
The plugin SHALL expose a `vault_search` tool with three resolution strategies — exact-name resolution, tag-scoped iteration, and bounded full-text scan — selecting strategies in order until matches are found or the byte budget is hit.

#### Scenario: Exact filename
- **WHEN** the model calls `vault_search({ query: "[[meeting-notes]]" })` and a file `meeting-notes.md` exists
- **THEN** the result resolves to that file via `MetadataCache.getFirstLinkpathDest` and returns one match without scanning content

#### Scenario: Tag-scoped
- **WHEN** the model calls `vault_search({ query: "agenda", scope: { tag: "#work" } })`
- **THEN** the result iterates files tagged `#work` (via `MetadataCache`) and returns matches whose contents include "agenda"

#### Scenario: Full-text with byte budget
- **WHEN** the model calls `vault_search({ query: "design notes" })` against a vault > 5MB
- **THEN** the search reads candidate files up to a 5MB cumulative cap and returns `{ matches, truncated: true }` so the model knows results are partial

#### Scenario: No matches
- **WHEN** no files match the query
- **THEN** the result is `{ matches: [], truncated: false }`

### Requirement: vault_metadata
The plugin SHALL expose a `vault_metadata` tool that returns frontmatter, tags, headings, and outbound link targets for a single note via Obsidian's `MetadataCache`.

#### Scenario: Metadata for note
- **WHEN** the model calls `vault_metadata({ path: "Notes/foo.md" })`
- **THEN** the result is `{ frontmatter, tags, headings, outboundLinks }` extracted from `MetadataCache.getFileCache`

### Requirement: vault_links
The plugin SHALL expose a `vault_links` tool that returns inbound and outbound links for a note.

#### Scenario: Links for note
- **WHEN** the model calls `vault_links({ path: "Notes/foo.md" })`
- **THEN** the result is `{ inbound: [path, …], outbound: [path, …] }` derived from `MetadataCache.resolvedLinks` and `MetadataCache.getBacklinksForFile`

### Requirement: Tool execution timeout
Each tool invocation SHALL be bounded by a 30-second timeout. Timeouts SHALL be returned as a tool result so the model can react.

#### Scenario: Tool times out
- **WHEN** a tool's `run` function does not resolve within 30 seconds
- **THEN** the registry aborts the tool, records a `ToolTimeoutError`, and feeds `{ error: "ToolTimeoutError" }` back to the model

### Requirement: Tool category and mutation flag
Every tool SHALL declare a `category` (e.g., `vault_read`, `vault_write`) and a `mutates: boolean` flag. Mutating tools SHALL go through the `tool-consent` capability before execution.

#### Scenario: Mutation flag set on writes
- **WHEN** a developer audits M1 tool implementations
- **THEN** `vault_write`, `vault_append`, and `vault_edit` declare `mutates: true` and category `vault_write`; `vault_list`, `vault_read`, `vault_search`, `vault_metadata`, `vault_links` declare `mutates: false` and category `vault_read`

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
