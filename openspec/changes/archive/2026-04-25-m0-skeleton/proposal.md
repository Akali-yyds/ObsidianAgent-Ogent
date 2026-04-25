## Why

The plugin needs a runnable end-to-end shell before any feature work has somewhere to land. M0 establishes the bones — a loadable Obsidian plugin with a chat view, a settings tab, and a single working LLM provider — so that subsequent milestones (vault tools, web tools, MCP) can be added as focused deltas rather than bundled with infrastructure.

## What Changes

- New Obsidian plugin scaffold (TypeScript, esbuild bundle, `manifest.json`, `main.ts`).
- New chat view registered as a right-sidebar `ItemView` with text input, send button, and streamed assistant output.
- New settings tab exposing provider config: provider preset (start with OpenAI-compatible only), base URL, API key, model name.
- New agent loop wired to Vercel AI SDK's `streamText`, with no tools registered yet — pure chat.
- New plugin data store for settings via `this.saveData()` / `this.loadData()`.
- Cancellation: stop button on the chat view aborts the current stream.
- Cross-platform load: works on desktop (Electron) and mobile (webview); no Node-only APIs in M0.

Out of scope for M0: vault tools, web tools, MCP, conversation persistence, tool-call rendering, multiple providers, streaming markdown rendering (plain text is fine for M0).

## Capabilities

### New Capabilities
- `plugin-shell`: Obsidian plugin lifecycle, manifest, build pipeline, command/view registration.
- `chat-view`: Right-sidebar `ItemView` with input box, transcript area, send/stop controls, streamed text output.
- `settings`: Settings tab UI and persistence for provider config (base URL, API key, model name).
- `agent-loop`: Single-turn, tool-less chat loop using Vercel AI SDK with cancellation support.
- `model-provider`: Provider abstraction with one implementation (OpenAI-compatible HTTP) using Obsidian `requestUrl` for transport.

### Modified Capabilities
<!-- None — this is the first change. -->

## Impact

- Code: new repo files only (`manifest.json`, `main.ts`, `src/`, `esbuild.config.mjs`, `tsconfig.json`, `package.json`).
- Dependencies: `obsidian` (peer/dev), `ai`, `@ai-sdk/openai-compatible`, `esbuild`, `typescript`.
- APIs: none yet — agent only talks to the user's configured LLM endpoint.
- Platforms: must load on both desktop and mobile Obsidian; CI/dev test plan should include mobile sideload via the `obsidian://` install flow or manual copy to a synced vault.
- Trust story: API key stored only in plugin data (`this.saveData()`), never in `localStorage` or the vault.
