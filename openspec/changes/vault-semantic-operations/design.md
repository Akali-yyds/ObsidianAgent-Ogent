# Design

## Boundaries

- The model continues to see only `execute_commands`.
- Directory and file names are discovered from current context, Vault metadata, list/search results, and the semantic index. No test or product directory is embedded in prompts or implementation.
- The index is in memory. It stores paths and parsed metadata/link relationships; full file content is read only while preparing a concrete ChangeSet.
- The semantic handler is injected into the command executor. It prepares a ChangeSet before consent and commits only after approval.

## Flow

1. A `vault.rename` or `vault.move` command enters the command executor.
2. `ContextResolver` validates exact paths or returns deterministic candidates; ambiguous targets are blocked.
3. `VaultRelationIndex` identifies moved descendants and inbound/outbound references.
4. `ChangeSetPlanner` reads affected Markdown files, computes explicit content patches, captures fingerprints, and reports blockers/warnings.
5. The command event exposes the ChangeSet to the chat plan card. One consent request covers the semantic write.
6. `ChangeSetExecutor` revalidates fingerprints, applies path and content operations deterministically, and records one UndoBuffer checkpoint.
7. Failures trigger reverse best-effort rollback and return recovery items when rollback is incomplete.

## Link policy

- Wikilinks, embeds, aliases, heading references, and block references preserve their suffixes while updating the link target.
- Standard Markdown links are changed only when their relative path resolves to a Vault file.
- URLs, code blocks, unresolved references, ambiguous targets, and unsafe syntax block the ChangeSet when they are affected by the requested operation; they are never silently rewritten.

