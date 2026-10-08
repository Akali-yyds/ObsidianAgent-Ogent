# Vault-native semantic operations

Ogent currently exposes safe file tools, but moving or renaming a note is still a file-system operation from the Agent's perspective. This change adds a lightweight in-memory Vault relationship index, generic path resolution, and transactional ChangeSets so Obsidian knowledge-structure edits are planned, approved, executed, and undoable as one operation.

The first vertical slice covers user-intent-driven note/folder move and rename with internal link repair. It deliberately does not add proactive whole-vault automation, Playbooks, external Agent protocols, or new Git workflows.

