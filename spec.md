---
title: Obsidian AI Agent Plugin — Spec
status: draft
created: 2026-04-25
tags: [obsidian, plugin, agent, mcp, spec]
---

# Obsidian AI Agent Plugin — Spec

> [!summary]
> A model-agnostic AI agent that runs **inside** Obsidian (desktop + mobile), reads/writes the vault, browses the web, and uses MCP servers. Agent code runs on-device; the LLM is BYOK (any OpenAI-compatible endpoint, plus native Anthropic / Google).

## Goals

- **Model-agnostic** — user supplies endpoint + key; works with OpenAI, Anthropic, Google, Groq, Together, OpenRouter, Ollama on LAN, etc.
- **Cross-platform** — single plugin bundle runs on Obsidian desktop (Electron) and mobile (iOS/Android webview).
- **Vault-native** — agent has first-class tools for reading, searching, linking, and editing notes; respects frontmatter and wikilinks.
- **MCP-capable** — connect to user-configured MCP servers for extended tools.
- **Local-first execution** — the agent loop, tool dispatch, and MCP client run on-device. Only the LLM call leaves the device (to whatever endpoint the user configured).
- **BYOK** — keys stored in Obsidian's plugin data, never transmitted anywhere except the user's chosen model endpoint.

## Non-goals

- Local LLM inference (Ollama-on-device, llama.cpp). Mobile-class hardware can't run agent-quality models with reliable tool-calling. Users can still point at a LAN Ollama from mobile.
- Multi-user / cloud sync of agent state.
- Replacing Smart Connections / Copilot for chat-style note Q&A — this plugin is **agent-shaped** (multi-step tool use), not RAG-shaped.
- Building our own MCP servers (we're a client only).

## Platform constraints

| Capability | Desktop (Electron) | Mobile (webview) |
| --- | --- | --- |
| Node APIs (`child_process`, `fs`) | ✅ | ❌ |
| Spawning stdio MCP servers | ✅ | ❌ |
| HTTP / SSE / Streamable-HTTP MCP | ✅ | ✅ |
| `app.vault` (Obsidian FS) | ✅ | ✅ |
| `requestUrl` (CORS-bypass HTTP) | ✅ | ✅ |
| Streaming responses | ✅ (fetch / SSE) | ✅ (fetch / SSE) |

> [!warning] Mobile gotcha
> No `child_process`, so stdio MCP servers must be hidden behind a desktop-only feature flag. The plugin must detect `Platform.isMobileApp` at startup and present only HTTP/SSE MCP transports in the UI on mobile.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Obsidian Plugin (single TS bundle, esbuild)                │
│                                                             │
│  ┌────────────┐   ┌──────────────┐   ┌─────────────────┐    │
│  │ Chat UI    │──▶│ Agent Loop   │──▶│ Tool Registry   │    │
│  │ (ItemView) │   │ (AI SDK)     │   │                 │    │
│  └────────────┘   └──────┬───────┘   │  • Vault tools  │    │
│                          │           │  • Web search   │    │
│                          │           │  • MCP tools    │    │
│                          ▼           └────────┬────────┘    │
│                   ┌──────────────┐            │             │
│                   │ Model Client │            ▼             │
│                   │ (provider    │   ┌─────────────────┐    │
│                   │  abstraction)│   │ MCP Client Pool │    │
│                   └──────┬───────┘   │ (stdio | http)  │    │
│                          │           └────────┬────────┘    │
└──────────────────────────┼────────────────────┼─────────────┘
                           │                    │
                           ▼                    ▼
                  ┌────────────────┐   ┌────────────────┐
                  │ User's LLM API │   │ MCP server(s)  │
                  └────────────────┘   └────────────────┘
```

### Components

#### 1. Agent loop
- **Engine:** [Vercel AI SDK](https://sdk.vercel.ai) (`ai` package). Pure ESM, runs in webview, has built-in tool-use loop via `streamText({ tools, maxSteps })`.
- **Why not Claude Agent SDK / Mastra:** Node-only, won't run on mobile.
- **Loop budget:** `maxSteps` configurable (default 15). Hard cap on tokens per turn.
- **Streaming:** stream assistant tokens + tool-call events to the UI.
- **Cancellation:** `AbortController` wired to a stop button.

#### 2. Model providers
Single config screen. User picks a provider preset or "OpenAI-compatible custom":

- OpenAI (`@ai-sdk/openai`)
- Anthropic (`@ai-sdk/anthropic`)
- Google (`@ai-sdk/google`)
- OpenAI-compatible (any base URL + key — covers OpenRouter, Groq, Together, Ollama, vLLM, LM Studio)

> [!note] Provider abstraction
> Use AI SDK's `LanguageModel` interface so the rest of the plugin doesn't care which vendor is behind it. One switch statement at config-load time.

#### 3. Vault tools

Implemented against Obsidian's `App` API. All paths are vault-relative.

| Tool | Purpose |
| --- | --- |
| `vault_list` | List files/folders matching a glob |
| `vault_read` | Read a note (returns frontmatter + body separately) |
| `vault_search` | Full-text search across vault (uses Obsidian's search index where possible, falls back to scan) |
| `vault_write` | Create or overwrite a note (frontmatter-aware) |
| `vault_append` | Append to an existing note |
| `vault_edit` | Targeted edit via old-string/new-string match |
| `vault_links` | Resolve `[[wikilinks]]` and backlinks for a note |
| `vault_metadata` | Get tags, frontmatter, headings via `MetadataCache` |
| `open_note` | Open a note in the active leaf (UI tool) |

> [!important] Write safety
> All write tools require user confirmation by default (toggle in settings). Confirmation modal shows a diff. This is non-negotiable for the v1 trust story.

#### 4. Web tools
- `web_search` — pluggable backend (Brave, Tavily, Exa, SerpAPI). User supplies key.
- `web_fetch` — uses `requestUrl` to dodge CORS; returns readable text (Mozilla Readability extraction).

#### 5. MCP client
- Library: `@modelcontextprotocol/sdk` (official TS client).
- **Desktop:** stdio + HTTP transports.
- **Mobile:** HTTP / SSE / Streamable-HTTP only. UI greys out stdio config on mobile.
- Tools from connected MCP servers are merged into the agent's tool registry at session start, namespaced as `mcp_<server>_<tool>`.
- Per-server enable/disable toggle.

#### 6. UI
- **Chat view** — right sidebar `ItemView`, markdown-rendered turns, tool-call cards (collapsed by default), syntax-highlighted JSON for tool args/results.
- **Inline action** — command palette entry "Ask agent about current note" pre-fills context with the active file.
- **Settings tab** — provider config, MCP server config, tool permissions, system prompt override.

## Data & storage

- **Plugin data** (`this.saveData()`): provider config, MCP server list, tool permission flags, system prompt. Keys stored here — never written to vault.
- **Conversations:** stored as notes under a configurable folder (default `_AI Agent/Conversations/`). One note per conversation, frontmatter holds metadata, body holds the transcript. This makes them searchable, linkable, and synced via the user's existing vault sync.

## Security & permissions

- Keys: `localStorage` is shared across plugins — **don't** use it. Use `this.saveData()` (per-plugin scoped JSON file).
- Tool consent: every tool category has an allow-mode (`always` / `ask` / `never`). `ask` raises a modal with the tool call payload.
- MCP servers are untrusted code paths — stdio servers run with the user's privileges. Display a clear warning when adding a new stdio server.
- No telemetry. No outbound calls except to the user's configured model endpoint and explicitly-added MCP/web-search backends.

## Open questions

- [ ] Conversation memory: one-shot vs persistent? Probably per-conversation note + optional "memory" tool that writes summaries to a designated note.
- [ ] Streaming markdown rendering — incremental Obsidian markdown render is non-trivial; may ship v1 with plain text streaming, then upgrade.
- [ ] Sub-agents / parallel tool calls — AI SDK supports parallel tool calls; worth wiring through but UI gets messier.
- [ ] Mobile MCP discovery UX — pasting an HTTP URL is fine for power users, less great for everyone else. Maybe a "presets" list later.

## Milestones

1. **M0 — skeleton** — plugin scaffold, settings tab, chat view, single OpenAI-compatible provider, no tools. Agent can chat.
2. **M1 — vault tools** — read/search/list/metadata. Read-only agent that can answer questions about the vault.
3. **M2 — write tools** — write/append/edit with confirmation modal. Now it's an agent.
4. **M3 — web tools** — search + fetch.
5. **M4 — MCP (desktop)** — stdio + HTTP transports.
6. **M5 — MCP (mobile)** — HTTP/SSE only, mobile-tested.
7. **M6 — polish** — streaming markdown, conversation history, sub-agent UI.

## References

- [Obsidian Plugin API](https://docs.obsidian.md/Plugins)
- [Vercel AI SDK — agent / tool use](https://sdk.vercel.ai/docs/foundations/agents)
- [Model Context Protocol — TS SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Prior art: Smart Connections, Copilot for Obsidian, Obsidian Companion (none do MCP + cross-platform agent loop — that's the wedge).
