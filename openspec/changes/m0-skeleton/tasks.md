## 1. Repo scaffold

- [x] 1.1 Initialize `package.json` with `obsidian` (peer/dev), `esbuild`, `typescript`, `@types/node` (AI SDK deferred to M1 per design.md)
- [x] 1.2 Add `tsconfig.json` configured for ES2022 / DOM / NodeNext
- [x] 1.3 Add `esbuild.config.mjs` producing a single `main.js` bundle (external: `obsidian`)
- [x] 1.4 Add `.gitignore`, `.eslintrc` (ban Node-only top-level imports), `.editorconfig`
- [x] 1.5 Add `manifest.json` with `id`, `name`, `version`, `minAppVersion`, `description`, `author`, `isDesktopOnly: false`
- [x] 1.6 Add `README.md` stub describing install and dev workflow
- [x] 1.7 Wire `npm run dev` (esbuild watch) and `npm run build` (esbuild production)

## 2. Plugin shell

- [x] 2.1 Create `src/main.ts` exporting a class extending `Plugin`
- [x] 2.2 Implement `onload`: register chat view, settings tab, "Open AI Agent" command
- [x] 2.3 Implement `onunload`: unregister, abort any in-flight `AbortController`s
- [x] 2.4 Add `Platform.isMobileApp` check helper for future use
- [x] 2.5 Verify the bundle has no top-level Node imports (lint rule + manual check)

## 3. Settings

- [x] 3.1 Define `PluginSettings` type: `provider`, `baseUrl`, `apiKey`, `model`, `systemPrompt`
- [x] 3.2 Define `DEFAULT_SETTINGS` constant
- [x] 3.3 Implement `loadSettings()` / `saveSettings()` using `loadData()` / `saveData()`
- [x] 3.4 Build `SettingsTab` extending `PluginSettingTab` with the five fields
- [x] 3.5 Mask the API key field (`type=password` on the input)
- [x] 3.6 Show the key-storage notice at the top of the tab
- [x] 3.7 Emit a `'settings-changed'` event on save; chat view subscribes

## 4. Model provider

- [x] 4.1 Define `ModelProvider` interface with `stream(messages, opts): AsyncIterable<TextDelta>`
- [x] 4.2 Implement `OpenAICompatibleProvider` that targets `${baseUrl}/chat/completions`
- [x] 4.3 Streaming path: `fetch` with `Authorization: Bearer …`, parse SSE lines, yield deltas
- [x] 4.4 Fallback path: on CORS-shaped error, call `requestUrl` with `stream: false`, yield full content as one delta, set `degraded` flag
- [x] 4.5 Map HTTP status to typed errors: `AuthError` (401/403), `RateLimitError` (429), `NetworkError` (network/CORS), `ProviderError` (other)
- [x] 4.6 Ensure no log statement includes the API key or full headers

## 5. Agent loop

- [x] 5.1 Build `runTurn(messages, provider, opts)` that prepends the system prompt and forwards to `provider.stream`
- [x] 5.2 Forward `AbortSignal` through to the provider call
- [x] 5.3 Discard any tool-call deltas defensively (in case a misconfigured server emits them)
- [x] 5.4 Re-export typed errors so the chat view can `instanceof`-check

## 6. Chat view

- [x] 6.1 Create `ChatView` extending `ItemView`, `getViewType()` returns `'ai-agent-chat'`
- [x] 6.2 Render transcript area, input box, send button, stop button
- [x] 6.3 Handle Cmd/Ctrl+Enter to submit
- [x] 6.4 On send: append user turn, create `AbortController`, call `runTurn`, append assistant turn streaming
- [x] 6.5 On stop: call `abort()`, mark assistant turn as interrupted, re-enable input
- [x] 6.6 Disable send + show hint when settings are unconfigured; subscribe to `'settings-changed'` to clear
- [x] 6.7 Render plain text only (mark a TODO that markdown rendering is M6)
- [x] 6.8 Display degraded-mode banner when provider reports `degraded: true`
- [x] 6.9 Render typed errors with appropriate copy and a deep link to settings for `AuthError`

## 7. Manual verification

- [ ] 7.1 Build, copy bundle to a desktop test vault, enable plugin, complete a streamed chat against OpenAI
- [ ] 7.2 Repeat against a LAN Ollama endpoint via OpenAI-compatible mode
- [ ] 7.3 Sideload to Obsidian mobile (iOS or Android) via vault sync, verify load + streamed chat
- [ ] 7.4 Mid-stream Stop on desktop and mobile — verify network request is cancelled (DevTools / Charles)
- [ ] 7.5 Misconfigure key — verify `AuthError` UI + settings deep link
- [ ] 7.6 Disconnect network mid-stream — verify `NetworkError` + retry hint
- [x] 7.7 Inspect produced bundle for Node-only imports — confirm none

## 8. Wrap-up

- [x] 8.1 Run `openspec validate m0-skeleton`
- [ ] 8.2 Tag a `v0.0.1` release commit
- [ ] 8.3 Run `openspec archive m0-skeleton` to promote specs into `openspec/specs/`
