# Ogent

Ogent is an Obsidian vault-aware AI agent with streaming output, safe file tools, and bring-your-own-key provider support.

This repository is a personal fork and ongoing customization of [OpenAgent for Obsidian](https://github.com/nikitaclicks/obsidian-openagent). The upstream project and its MIT license remain the foundation; the changes in this repository focus on a lightweight, practical Agent for an Obsidian knowledge base.

## What it does

- **Vault awareness without automatic note loading**: provides lightweight current-note and current-folder metadata for path resolution, but does not send note bodies or editor selections automatically. The Agent can read a note body only when the user asks it to use a vault read tool.
- **Three execution scopes**:
  - **Read only**: low-risk inspection runs automatically; high-risk actions are blocked.
  - **Ask before action**: low-risk inspection runs automatically; high-risk actions explain their impact and wait for approval.
  - **Full access**: allowlisted high-risk actions can run without an additional approval prompt, while path, schema, Git, Vault, and system-command safety boundaries remain active.
- **Vault tools**: list and read notes, search note content, inspect metadata and links, write, append, edit, rename, move, delete, and restore notes.
- **Write safety**: vault-relative path checks, tool approval, undo snapshots, Agent-turn checkpoints, and recovery from failed session data.
- **Command-driven Agent core**: the model sees one structured `execute_commands` dispatcher. Vault, Git, Web, and Plugin actions use an allowlisted `domain/action/args` vocabulary; arbitrary Shell and arbitrary Git arguments are never exposed.
- **Intent-first path handling**: when a user names a Vault-relative directory, the Agent passes that path to the relevant capability directly. Vault discovery is used only when the request is ambiguous; capability errors are returned as structured results so the Agent can decide whether to retry, inspect candidates, or ask a question.
- **Desktop Git commands**: inspect status, diffs, history, branches, and remotes; initialize repositories; stage, commit, switch branches, pull, and push through approval-gated commands restricted to the current Vault.
- **Streaming conversations**: incremental thinking and answer output, ordered command-plan traces, copyable text, context compaction, queued messages, stop controls, and session recovery after restarting Obsidian.
- **Web research**: optional Tavily or Brave Search through `web.search`, followed by public HTML/plain-text retrieval through `web.fetch`. Results include source metadata and fetched pages are treated as untrusted reference material.
- **Provider compatibility**: OpenAI-compatible endpoints, including hosted providers and local servers that expose the same API shape. Runtime fallbacks handle endpoints that reject streaming, structured output, or required tool-choice parameters.
- **Risk-aware execution**: use the single Access control in the chat bar to choose Read only, Ask before action, or Full access. Low-risk commands can be batched; high-risk commands are approval-gated in Ask mode.
- **Mobile boundary**: mobile keeps Vault and Web basics; Desktop-only Git and runtime plugin control are not registered on mobile.

## Scope

This project intentionally keeps the core Agent small. Grounded Research, MLX/local embedding packs, and the former hackathon/evaluation data are not part of the current project. They can be developed as separate projects if needed later.

The plugin does not provide arbitrary terminal commands. Git operations are a deliberately limited desktop-only exception and cannot address paths outside the current Vault.

## Installation

When the release is available in the Obsidian Community plugins directory, install **Ogent** from **Settings → Community plugins → Browse**. For testing a release before marketplace propagation, manual installation from GitHub remains supported.

1. In **Settings → Community plugins → Browse**, search for **Ogent**, install it, and enable it.
2. For a manual test, download `main.js`, `manifest.json`, and `styles.css` from a GitHub release, or build them locally.
3. Create `<vault>/.obsidian/plugins/agent-ogent/` if it does not exist and copy the three files into that directory.
4. In Obsidian, open **Settings → Community plugins**, enable community plugins if necessary, and enable **Ogent**.

If you previously used the upstream `OpenAgent` build, enable this plugin once and then disable the old `open-agent` plugin. The first launch imports its settings and session files without deleting the old data.

For mobile, sync the same plugin files into the mobile vault's `.obsidian/plugins/agent-ogent/` directory.

## Configuration

Open **Settings → Ogent** and configure:

| Setting | Description |
| --- | --- |
| Provider | Currently an OpenAI-compatible endpoint. |
| Base URL | The provider API base URL, for example `https://api.openai.com/v1`. |
| API key | The key used by the configured model provider. |
| Model | A model name accepted by the endpoint; models can be fetched from `/models`. |
| Interface language | Automatic system language, 简体中文, or English. This controls command plans and approval prompts. |
| Web search provider | `Tavily` or `Brave Search`. |
| Web search API key | Optional until the Agent needs `web.search`; required for web search calls. |
| System prompt | Optional instruction prepended to conversations. |
| Agent memory | Optional plugin-local preferences. Do not store secrets here. |
| Execution scope | Read only, Ask before action, or Full access for the current chat. |

When current or time-sensitive information is needed, the Agent can use `execute_commands` with `web.search` and then `web.fetch` a selected page. Web access is approval-controlled and does not make DeepSeek or another model's native knowledge current by itself; the command results supply the current sources.

## Privacy and security

- The plugin sends conversation content and any note content returned by an explicitly approved vault tool to the LLM endpoint you configure. Use an endpoint you trust.
- Web search sends the search query to the selected Tavily or Brave service. `web.fetch` accepts only HTTP(S) URLs and blocks local, loopback, private, and link-local hosts.
- Fetched web pages are reference data, not instructions. The Agent is told not to execute instructions contained in web content.
- Vault writes use the selected execution scope and a visible plan flow in Ask mode. Deleted notes use Obsidian's trash behavior where supported.
- Git commands run only on desktop, use `spawn("git", args, { shell: false })`, and are limited to the current Vault after real-path and repository-root checks. In Ask mode, Git writes, commits, branch changes, pulls, and pushes explain hooks, remotes, and credential risks before waiting for approval.
- API keys are stored in the plugin data file at `.obsidian/plugins/agent-ogent/data.json`. This file is ignored by Git. Never commit it, put keys in notes or `OpenAgent.md`, or include them in bug reports and exported sessions.

## Development

Requirements: Node.js and npm.

```powershell
git clone https://github.com/Akali-yyds/ObsidianAgent-Ogent.git
cd ObsidianAgent-Ogent
npm install

# Development/watch build
npm run dev

# Verification
npm run build
npm run lint
npm test -- --run
```

To deploy a production build into a local test vault, set `.vault-path` to the vault path (the file is ignored by Git), or set the `OBSIDIAN_VAULT` environment variable, then run:

```powershell
npm run deploy
```

The deploy script copies `main.js`, `manifest.json`, and `styles.css` into the vault's `agent-ogent` plugin directory. Do not copy `data.json` from a personal vault into the repository.

## Project layout

```text
src/
  main.ts                 Plugin entry point and Obsidian integration
  settings.ts             Provider, web, consent, and tool settings
  view.ts                 Chat panel, controls, and rendering
  loop.ts                 Agent system prompt and execution entry point
  provider.ts             OpenAI-compatible streaming provider
  sessions.ts             Persistent sessions and event recovery
  compaction.ts           Conversation context compaction
  consent/                Approval, diff, checkpoint, and undo logic
  commands/               Structured command schema and executor
  tools/vault/            Vault read/write/path implementations
  tools/git.ts            Desktop Git implementation and safety checks
  tools/plugin.ts         Feature-detected public plugin command access
  tools/web-search.ts     Tavily and Brave Search implementation
  tools/web-fetch.ts      Safe public-page fetching and text extraction
  ui/                     Compact Agent controls and menus
```

## Contributing

Issues and pull requests are welcome. Please avoid including API keys, private vault content, `data.json`, generated bundles, or personal session files in reports or patches. Run the lint and test commands before opening a pull request.

## Attribution and license

This project is derived from [nikitaclicks/obsidian-openagent](https://github.com/nikitaclicks/obsidian-openagent). The upstream copyright notice is retained and modifications are attributed to Akali-yyds. See [LICENSE](LICENSE) for the MIT License.
