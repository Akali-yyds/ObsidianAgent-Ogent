# Agent semantic events

## Requirement: ChangeSet lifecycle events

The Agent loop SHALL expose structured ChangeSet lifecycle data through its existing command events, including creation, blocker state, approval request, start, completion, and rollback.

### Scenario: Visible semantic plan

- **WHEN** a semantic rename/move command is prepared
- **THEN** the chat view can render the affected paths, content patches, blockers, warnings, and current status

### Requirement: Structured command enforcement

When a user request requires an executable command, the Agent loop SHALL require a structured `execute_commands` call before treating the turn as complete. If the provider returns ordinary prose instead, the loop MAY perform one hidden repair attempt; if no structured call is returned afterward, it SHALL emit a structured failure, execute no command, and SHALL NOT present the prose as an approval request.

#### Scenario: Provider omits a required tool call

- **WHEN** a provider returns prose for a request that requires a command
- **THEN** Ogent retries once with an internal tool-call correction instruction, and otherwise reports that no command was executed

