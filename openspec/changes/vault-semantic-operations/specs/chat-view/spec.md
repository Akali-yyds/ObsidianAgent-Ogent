# Semantic plan card

## Requirement: ChangeSet preview

The chat view SHALL render a ChangeSet plan card showing intent, source and target paths, affected files, patch summaries, blockers, warnings, approval state, and rollback state.

### Scenario: Applied plan

- **WHEN** a ChangeSet completes
- **THEN** the card shows the applied state and identifies that the complete transaction is available to undo

