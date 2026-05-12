# Phase 1: Autonomous Buildout - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 1-Autonomous Buildout
**Areas discussed:** Pack opt-in behavior, Model controls with packs, Research source scope, Verification strictness

---

## Pack opt-in behavior

### What owns the pack choice?

| Option | Description | Selected |
|--------|-------------|----------|
| Per session | Each chat keeps its own pack choice | ✓ |
| Global default | One pack choice applies to all chats until changed | |
| Per message | Choose a pack for each individual prompt | |

**User's choice:** Per session
**Notes:** Pack choice should live on the chat session.

### What is the default for a new session?

| Option | Description | Selected |
|--------|-------------|----------|
| Classic single-agent | Preserve today's plugin behavior until the user opts in | ✓ |
| Reuse last pack | Carry the most recent pack choice into every new session | |
| Ask on start | Prompt for pack choice when the session starts | |

**User's choice:** Classic single-agent
**Notes:** New sessions should preserve today's behavior until the user opts in.

### What happens when the user changes pack in an existing session?

| Option | Description | Selected |
|--------|-------------|----------|
| Future turns only | Prior turns stay unchanged; the new pack only affects later turns | ✓ |
| Lock after first send | Require a new session to change pack | |
| Reinterpret whole session | Reframe the whole session under the new pack | |

**User's choice:** Future turns only
**Notes:** Session history stays unchanged; the new pack only applies to later turns.

### What happens when reopening a session that used a pack?

| Option | Description | Selected |
|--------|-------------|----------|
| Restore pack | Reopen the session with its prior pack state intact | ✓ |
| Always classic mode | Reset every reopened session to classic mode | |
| Ask every reopen | Prompt again each time a pack session is reopened | |

**User's choice:** Restore pack
**Notes:** Reopened sessions should preserve their last selected pack.

---

## Model controls with packs

### What happens to the single-model input when a pack is active?

| Option | Description | Selected |
|--------|-------------|----------|
| Disable and show pack info | Replace the editable classic control with read-only pack details | ✓ |
| Use as fallback | Let the single-model input fill gaps in pack config | |
| Override all pack agents | Let one header model override every agent in the pack | |

**User's choice:** Disable and show pack info
**Notes:** Pack sessions should not be driven by the classic single-model control.

### If a pack is missing a required provider/model entry, what should happen?

| Option | Description | Selected |
|--------|-------------|----------|
| Fail loudly | Stop and surface the configuration problem | ✓ |
| Fallback to session model | Reuse the classic session model automatically | |
| Fallback to plugin default | Reuse the plugin default model automatically | |

**User's choice:** Fail loudly with guided recovery
**Notes:** The user wanted a loud failure and some recovery path rather than a silent fallback.

### What recovery path should a misconfigured pack use?

| Option | Description | Selected |
|--------|-------------|----------|
| Switch to classic or another pack | Keep recovery in-app without changing pack JSON from the UI | ✓ |
| Point to pack file | Show the file path and leave correction fully manual | |
| Block until fixed | Show only the error until the JSON is repaired | |

**User's choice:** Switch to classic or another pack
**Notes:** Recovery should stay in-app without silently changing provider/model settings.

### What should the header show while a pack is active?

| Option | Description | Selected |
|--------|-------------|----------|
| Pack name plus per-agent summary | Show the active pack and the provider/model mapping in read-only form | ✓ |
| Pack name only | Keep model details hidden unless expanded elsewhere | |
| Hide model area | Remove the model section entirely while a pack is active | |

**User's choice:** Pack name plus per-agent summary
**Notes:** Header stays informative but read-only during pack sessions.

### What happens to the classic model when returning from pack mode?

| Option | Description | Selected |
|--------|-------------|----------|
| Restore last classic model | Resume the session's old classic-model state | ✓ |
| Reset to plugin default | Drop back to the default configured model | |
| Ask before continue | Force a new classic-model choice each time | |

**User's choice:** Restore last classic model
**Notes:** Classic mode should resume the session's previous non-pack model state.

---

## Research source scope

### What is the default retrieval scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Whole vault with active-note bias | Search broadly but weight the active note and its neighborhood first | ✓ |
| Active note plus linked notes | Constrain runs to the current note neighborhood | |
| Whole vault without bias | Search broadly with no special treatment for the current note | |

**User's choice:** Whole vault with active-note bias
**Notes:** Grounded research should search broadly, but weight the active note neighborhood when available.

### What happens when no active note is open?

| Option | Description | Selected |
|--------|-------------|----------|
| Search whole vault | Keep grounded research available as a general vault assistant | ✓ |
| Ask user to pick scope first | Require manual scope selection before running | |
| Block until note is open | Force note-centric usage | |

**User's choice:** Search whole vault
**Notes:** Grounded research should still work as a vault-wide flow when there is no active note.

### How should explicit note/folder/tag scope in the prompt behave?

| Option | Description | Selected |
|--------|-------------|----------|
| Override default behavior | Treat explicit prompt scope as authoritative | ✓ |
| Use as a hint | Prefer the scope, but allow search outside it | |
| Ignore and use automatic default | Always use automatic scope rules | |

**User's choice:** Override default behavior
**Notes:** Prompt-level scope should take precedence when the user is explicit.

### How large should the retrieved note set usually be?

| Option | Description | Selected |
|--------|-------------|----------|
| 5-8 notes | Keep retrieval focused and reviewable | ✓ |
| 10-20 notes | Allow a broader evidence set per run | |
| Uncapped | Let the retriever decide freely with no normal target | |

**User's choice:** 5-8 notes
**Notes:** Phase 1 retrieval should stay focused rather than pulling a broad evidence set.

---

## Verification strictness

### How should flagged claims appear in the final response?

| Option | Description | Selected |
|--------|-------------|----------|
| Verified-only top summary plus flagged section | Clean summary stays strict while flagged claims remain visible below | ✓ |
| Mixed claim list with badges | Verified and flagged claims all live in one list | |
| Hide flagged claims | Show only verified claims anywhere in the answer | |

**User's choice:** Verified-only top summary plus flagged section
**Notes:** The clean summary should exclude claims that did not pass verification.

### What counts as a green verified claim?

| Option | Description | Selected |
|--------|-------------|----------|
| Quote present and supports claim | Require both the code-level presence check and verifier support judgment | ✓ |
| Quote present only | Presence alone is enough | |
| Support judgment only | Let the verifier judgment alone drive green state | |

**User's choice:** Quote present and supports claim
**Notes:** A claim is only verified when both checks pass.

### How should an unsupported-but-present quote be shown?

| Option | Description | Selected |
|--------|-------------|----------|
| Yellow warning with visible explanation | Show the quote and why it failed support | ✓ |
| Collapsed by default | Hide the detail unless expanded | |
| Treat as missing quote | Use the same treatment as a quote-not-found failure | |

**User's choice:** Yellow warning with visible explanation
**Notes:** Unsupported claims should remain visible with an immediate explanation.

### What happens if every claim is flagged or missing?

| Option | Description | Selected |
|--------|-------------|----------|
| Failure-style result with flagged details | Do not show a clean summary when nothing verifies | ✓ |
| Show summary with all claims flagged | Keep the synthesizer summary even if nothing passes | |
| Auto-rerun once more | Retry the full pipeline before showing anything | |

**User's choice:** Failure-style result with flagged details
**Notes:** If nothing verifies, the response should not present a clean summary.

---

## the agent's Discretion

None explicitly delegated.

## Deferred Ideas

None.
