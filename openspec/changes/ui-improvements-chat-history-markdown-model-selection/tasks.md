## 1. Session Storage Layer

- [ ] 1.1 Define `StoredSession` and `StoredTurn` types in a new `src/sessions.ts` module
- [ ] 1.2 Implement `SessionStore` class wrapping `Plugin.saveData`/`loadData`: load, save, create, delete, update (title, model, turns)
- [ ] 1.3 Wire `SessionStore` into `main.ts` and pass it to `ChatView` via `ChatViewDeps`
- [ ] 1.4 On plugin load, initialise with at least one session; migrate gracefully when `sessions` key is absent

## 2. Model Provider: listModels

- [ ] 2.1 Add optional `listModels?(): Promise<string[]>` to the `ModelProvider` interface in `src/types.ts`
- [ ] 2.2 Implement `listModels()` in `OpenAICompatibleProvider`: call `<baseUrl>/models`, parse response, return sorted IDs; catch all errors and return `[]`

## 3. Chat View: Header Bar

- [ ] 3.1 Add header bar element to `ChatView.onOpen()` above the transcript
- [ ] 3.2 Implement session dropdown: populate from `SessionStore`, show active session, switch on selection
- [ ] 3.3 Implement inline rename: clicking the active session title turns it into an `<input>`; save on Enter/blur, restore on empty
- [ ] 3.4 Implement "+ New" button: create session via `SessionStore`, switch view to it
- [ ] 3.5 Implement "Delete" button with confirmation; handle last-session edge case (reset to empty)
- [ ] 3.6 Implement model selector `<input>` with `<datalist>`; populate datalist from `listModels()` if available; save model override to active session on change

## 4. Chat View: Session Lifecycle

- [ ] 4.1 On `onOpen`, load active session turns into `this.turns` and call `renderTranscript()`
- [ ] 4.2 After each `handleSend` completes, persist updated turns to `SessionStore`
- [ ] 4.3 Auto-title session on first user message (update title to first 60 chars if still "New chat")
- [ ] 4.4 Pass session's `model` override (falling back to global setting) when constructing `OpenAICompatibleProvider`

## 5. Chat View: Markdown Rendering

- [ ] 5.1 Replace `body.setText(turn.content)` with `MarkdownRenderer.render(this.app, turn.content, body, "", this)` for assistant turns
- [ ] 5.2 Debounce re-renders during streaming (≥50 ms interval); always do a final full render on stream completion
- [ ] 5.3 Verify user turns still render as plain text

## 6. Styles

- [ ] 6.1 Add CSS for header bar layout (session dropdown, rename input, new/delete buttons, model input) in `styles.css`
- [ ] 6.2 Ensure Markdown-rendered content inside `.open-agent-turn-body` inherits theme styles cleanly (no double-border, correct code block appearance)

## 7. Verification

- [ ] 7.1 Manual test: create two sessions, add messages to each, reload Obsidian — verify both sessions restore correctly
- [ ] 7.2 Manual test: rename a session, delete a session, verify last-session guard works
- [ ] 7.3 Manual test: confirm Markdown renders (bold, code block, list) in assistant turns; user turns are plain text
- [ ] 7.4 Manual test: change model in header, send a message, confirm the correct model name is sent in the request (check DevTools network tab)
- [ ] 7.5 Run `npm run build` (or `tsc --noEmit`) with zero errors
