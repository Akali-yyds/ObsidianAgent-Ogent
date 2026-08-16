# Ogent

Ogent is an Obsidian vault-aware AI agent with streaming output, safe file tools, and bring-your-own-key provider support.

This repository is a personal fork and ongoing customization of [OpenAgent for Obsidian](https://github.com/nikitaclicks/obsidian-openagent). The upstream project and its MIT license remain the foundation; the changes in this repository focus on a lightweight, practical Agent for an Obsidian knowledge base.

## What it does

- **Vault awareness without automatic note loading**: provides lightweight current-note and current-folder metadata for path resolution, but does not send note bodies or editor selections automatically. The Agent can read a note body only when the user asks it to use a vault read tool.
- **Three execution modes**:
  - **Read**: inspect and search the vault with read-only tools.
  - **Agent**: read and modify the vault, with approval before writes and network access.
  - **Full**: reduce repeated approval prompts for the session; vault writes still use the visible safety flow.
- **Vault tools**: list and read notes, search note content, inspect metadata and links, write, append, edit, rename, move, delete, and restore notes.
- **Write safety**: vault-relative path checks, tool approval, undo snapshots, Agent-turn checkpoints, and recovery from failed session data.
- **Streaming conversations**: incremental thinking and answer output, ordered tool traces, copyable text, context compaction, queued messages, stop controls, and session recovery after restarting Obsidian.
- **Web research**: optional Tavily or Brave Search through `web_search`, followed by public HTML/plain-text retrieval through `web_fetch`. Results include source metadata and fetched pages are treated as untrusted reference material.
- **Provider compatibility**: OpenAI-compatible endpoints, including hosted providers and local servers that expose the same API shape. Runtime fallbacks handle endpoints that reject streaming, structured output, or required tool-choice parameters.
- **Tool management**: enable or disable individual tools and configure read, write, and network consent in the plugin settings.

## Scope

This project intentionally keeps the core Agent small. Grounded Research, MLX/local embedding packs, and the former hackathon/evaluation data are not part of the current project. They can be developed as separate projects if needed later.

The plugin does not provide arbitrary terminal commands or external system writes.

## Installation

This fork is currently intended for manual installation while it is under development. Community-plugin submission is planned; until it is approved, install a GitHub Release manually.

1. Download `main.js`, `manifest.json`, and `styles.css` from a release, or build them locally.
2. Create `<vault>/.obsidian/plugins/agent-ogent/` if it does not exist.
3. Copy the three files into that directory.
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
| Web search provider | `Tavily` or `Brave Search`. |
| Web search API key | Optional until the Agent needs `web_search`; required for web search calls. |
| System prompt | Optional instruction prepended to conversations. |
| Agent memory | Optional plugin-local preferences. Do not store secrets here. |
| Tool consent | Separate defaults for vault reads, vault writes, and network reads. |
| Enabled tools | Per-tool enable/disable controls. |

When current or time-sensitive information is needed, the Agent can search the public web and then fetch a selected page. Web access is approval-controlled and does not make DeepSeek or another model's native knowledge current by itself; the search tools supply the current sources.

## Privacy and security

- The plugin sends conversation content and any note content returned by an explicitly approved vault tool to the LLM endpoint you configure. Use an endpoint you trust.
- Web search sends the search query to the selected Tavily or Brave service. `web_fetch` accepts only HTTP(S) URLs and blocks local, loopback, private, and link-local hosts.
- Fetched web pages are reference data, not instructions. The Agent is told not to execute instructions contained in web content.
- Vault writes require the configured consent policy and use a visible tool flow. Deleted notes use Obsidian's trash behavior where supported.
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
  tools/vault/            Vault read/write/path tools
  tools/web-search.ts     Tavily and Brave Search integration
  tools/web-fetch.ts      Safe public-page fetching and text extraction
  ui/                     Compact Agent controls and menus
```

## Contributing

Issues and pull requests are welcome. Please avoid including API keys, private vault content, `data.json`, generated bundles, or personal session files in reports or patches. Run the lint and test commands before opening a pull request.

## Attribution and license

This project is derived from [nikitaclicks/obsidian-openagent](https://github.com/nikitaclicks/obsidian-openagent). The upstream copyright notice is retained and modifications are attributed to Akali-yyds. See [LICENSE](LICENSE) for the MIT License.
