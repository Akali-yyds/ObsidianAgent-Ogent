## Context

The plugin must run on both Obsidian desktop (Electron, Node available) and Obsidian mobile (iOS/Android, webview only — no Node, no `child_process`, no spawning binaries). M0 is the foundation that all later milestones (vault tools, web tools, MCP) will extend. The constraint set drives most decisions: anything that won't work on mobile is forbidden in M0, even if convenient on desktop.

The user has chosen OpenSpec as the spec workflow and a BYOK / model-agnostic posture: keys live on-device only, the plugin never proxies model traffic.

## Goals / Non-Goals

**Goals:**
- A loadable Obsidian plugin that builds with one `npm run build` and runs identically on desktop and mobile.
- Round-trip user message → streamed assistant reply against any OpenAI-compatible HTTP endpoint the user configures.
- A trust-safe key storage path (plugin data, not vault, not `localStorage`).
- A clean seam where M1+ can register tools without rewriting the loop.
- Cancellation that actually aborts the in-flight HTTP request.

**Non-Goals:**
- Tool calls of any kind (no vault, web, MCP tools yet).
- Multiple providers in the UI. The provider abstraction exists, but only the OpenAI-compatible implementation is wired.
- Conversation persistence to disk.
- Markdown rendering of streamed output (plain text in M0; markdown rendering arrives in a later milestone).
- Mobile-specific UI affordances beyond "doesn't crash."

## Decisions

### Agent loop: direct `fetch` in M0, Vercel AI SDK adoption deferred to M1
- **M0 reality:** the loop is single-turn, no tools. Direct `fetch` against `/chat/completions` with manual SSE parsing is ~80 LOC and avoids fighting AI SDK's `fetch` to honour our CORS fallback to `requestUrl`. The `ModelProvider` interface is our seam, not the AI SDK.
- **M1 plan:** when the first tool lands (vault tools), swap `OpenAICompatibleProvider` to use `streamText({ tools, maxSteps })` from the AI SDK so we don't reinvent the tool-use loop. The interface stays stable.
- **Alternatives considered:**
  - *AI SDK from M0* — usable, but its native `fetch` won't go through `requestUrl`, so the CORS-fallback path requires either patching its `fetch` option or a parallel implementation. Either is more code than just deferring.
  - *Claude Agent SDK* — Node-only, spawns a CLI. Mobile-incompatible.
  - *LangChain.js* — works in browser but heavy; verbose tool-call API; weaker streaming story.

### HTTP transport: Obsidian's `requestUrl` (with `fetch` fallback)
- **Why:** the webview enforces CORS for `fetch` against arbitrary model endpoints. `requestUrl` is Obsidian's CORS-bypass for both desktop and mobile.
- **Catch:** `requestUrl` is request/response, not streaming. To preserve streaming we must either (a) use `fetch` where CORS is permissive (Anthropic, OpenAI both send permissive headers in practice, but this is fragile), or (b) ship a streaming adapter that uses `requestUrl` for non-streaming and falls back to chunked rendering.
- **Decision for M0:** prefer `fetch` for streaming; fall back to `requestUrl` (non-streaming) when `fetch` fails with a CORS-shaped error. Surface the degraded mode in the UI ("non-streaming response — your endpoint blocks browser CORS"). Revisit if this proves brittle.

### Key storage: `this.saveData()` only
- **Why:** plugin-scoped JSON file, not shared across plugins (unlike `localStorage`), survives mobile restarts, syncs only if the user's vault config syncs the plugin folder.
- **Rejected:** `localStorage` (cross-plugin leakage), vault notes (would sync the key to every device, including untrusted ones), OS keychain (not available on mobile).

### Build: esbuild, single bundle, no dynamic import of Node modules
- **Why:** Obsidian's recommended template uses esbuild; single-bundle output is what mobile loads. Any `require('child_process')` or `require('fs')` at module top-level would crash mobile load.
- **Enforcement:** lint rule / build flag that fails the build on Node-only imports. Desktop-only features in later milestones must be lazy-loaded behind `Platform.isMobileApp` checks.

### Provider abstraction: thin interface, one impl in M0
- **Shape:** `interface ModelProvider { stream(messages, opts): AsyncIterable<TextDelta> }` — concrete enough that M3+ can add native Anthropic / Google providers without touching the chat view or settings shape.
- **Rejected for M0:** the AI SDK's full `LanguageModel` interface as the public seam. We expose the SDK's types to upstream code so we don't get stuck if we want to swap engines later, but the surface our UI talks to is our own narrow interface.

### View: `ItemView` in the right sidebar
- **Why:** matches user expectation for Copilot-style plugins, easy to register, works on mobile.
- **Rejected:** full-pane / workspace leaf — too invasive for M0; modal — bad ergonomics for streamed output.

## Risks / Trade-offs

- **CORS / streaming flakiness on mobile** → Mitigation: `fetch` first, `requestUrl` non-streaming fallback, clear UI banner when degraded. If this is unacceptable, M1 can add a small relay configuration (out of M0 scope).
- **AI SDK bundle size** → Mitigation: tree-shake aggressively in esbuild; only import the OpenAI-compatible provider in M0. Re-evaluate at M3 when more providers land.
- **Mobile reload semantics** → Obsidian mobile aggressively unloads plugins when backgrounded; in-flight streams may abort. Mitigation: surface aborts as user-visible errors rather than silent failure. Persistence of conversation state is M6, not M0.
- **API key exposure via plugin data sync** → If the user syncs `.obsidian/plugins/<id>/data.json` via Obsidian Sync or a third-party sync, the key travels too. Mitigation for M0: document this clearly in the settings tab. A future milestone can add a "don't persist key — re-prompt each session" toggle.
- **No tool-call rendering yet** → If a misconfigured endpoint returns tool-call deltas anyway (some OpenAI-compatible servers do unsolicited tool calls), we'd display garbage. Mitigation: pass `tools: undefined` and `tool_choice: "none"` where supported; otherwise discard tool-call deltas in the renderer.

## Migration Plan

Greenfield — no migration. First release is M0 itself. Subsequent milestones (M1+) will add capabilities via OpenSpec deltas without breaking M0's surface.
