# Vault semantic operations

## Requirement: Discovery-first path resolution

The plugin SHALL resolve Vault targets from authoritative current context and Vault metadata before executing semantic writes. It SHALL not embed a product-specific directory or test path.

### Scenario: Ambiguous target

- **WHEN** a requested note or folder maps to multiple Vault paths
- **THEN** the semantic command is blocked with candidates and no write occurs

## Requirement: Relationship-aware ChangeSet

The plugin SHALL create a ChangeSet for Vault note and folder rename/move operations. The ChangeSet SHALL include path operations, affected Markdown content patches, blockers, warnings, and source fingerprints.

### Scenario: Rename with inbound links

- **WHEN** a note is renamed and other notes link to it
- **THEN** the ChangeSet includes the rename and link patches while preserving aliases, headings, and block references

## Requirement: Transactional semantic write

The plugin SHALL require one approval for a valid semantic ChangeSet, reject stale fingerprints, stop on failure, and attempt reverse rollback. One successful ChangeSet SHALL be undoable as one transaction.

### Scenario: Stale approval

- **WHEN** an affected note changes after preview and before approval
- **THEN** execution is rejected and no planned content is overwritten

