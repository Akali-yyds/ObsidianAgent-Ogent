# Semantic ChangeSet consent

## Requirement: Transaction-level approval

The consent boundary for a valid Vault semantic ChangeSet SHALL cover the complete ChangeSet rather than each generated link patch.

### Scenario: Rejected ChangeSet

- **WHEN** the user rejects the semantic plan
- **THEN** no path or content operation is applied

