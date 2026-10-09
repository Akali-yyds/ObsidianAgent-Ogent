## ADDED Requirements

### Requirement: Session-owned approval requests
Each pending approval SHALL be stored and resolved by the consent manager belonging to the command's session. Changing the Access selector after a run starts SHALL affect future runs only and SHALL NOT approve or reject an already pending request.

#### Scenario: Approve an operation in another session
- **WHEN** a background session has a pending approval
- **THEN** switching to that session shows its complete operation card and only that session's pending request can be approved or rejected

### Requirement: Serialize writes after approval
Vault and Git writes SHALL use one shared FIFO execution lock. Approval SHALL happen before waiting for the lock, and the target snapshot SHALL be revalidated after lock acquisition and immediately before execution.

#### Scenario: An approved target changes while waiting for another write
- **WHEN** another session modifies a target before an approved write obtains the lock
- **THEN** the write SHALL be rejected as stale and SHALL NOT overwrite the newer content
