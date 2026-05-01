## Context

The plugin currently stores conversation turns only in memory (`this.turns: UiTurn[]` in `ChatView`). Every Obsidian reload or view close wipes the history. Assistant messages are rendered with `body.setText(...)` — plain text only. The model is a global setting; changing it requires opening the settings tab.

The three improvements are independent at the data layer but all surface in the same view component. The design keeps them loosely coupled so they can ship and be tested separately.

## Goals / Non-Goals

**Goals:**
- Persist named chat sessions across reloads; let users create, rename, switch, and delete sessions.
- Render assistant message content as Markdown using Obsidian's built-in renderer.
- Add an inline model selector in the chat header; selection persists per-session and overrides the global setting.

**Non-Goals:**
- Syncing sessions across devices (sessions live in plugin data, which may or may not be synced depending on the user's Obsidian Sync setup — no special handling added).
- Importing / exporting sessions.
- Full conversation search across all sessions.
- Per-session system prompt override.

## Decisions

### 1. Session storage: Plugin.saveData / loadData

Sessions are stored in the plugin's existing data file (`.obsidian/plugins/open-agent/data.json`) under a `sessions` key alongside settings. `Plugin.saveData` accepts any JSON-serializable object; adding a top-level `sessions` map next to `PluginSettings` fields is the zero-dependency path.

**Why over separate files**: Vault file API adds async path-resolution and triggers vault events; `saveData` is simpler and already used for settings.

**Alternatives considered**:
- Separate `.obsidian/plugins/open-agent/sessions/` directory with one JSON per session — more granular, easier to delete individual sessions without rewriting everything, but adds file-system coupling.
- We start with a single blob; if the data grows unwieldy the storage layer can be extracted later.

**Data shape**:
```ts
interface StoredSession {
  id: string;            // uuid-ish (Date.now() + random suffix)
  title: string;         // first user message, truncated to 60 chars
  model: string;         // overrides global setting for this session
  createdAt: number;     // ms epoch
  updatedAt: number;
  turns: StoredTurn[];   // serializable subset of UiTurn
}
```
Sessions are stored in an ordered array; the active session ID is stored separately so switching is O(1) lookup.

### 2. Markdown rendering: Obsidian MarkdownRenderer

`MarkdownRenderer.render(app, markdown, el, sourcePath, component)` is the official Obsidian API for rendering Markdown inside plugins. It handles headings, bold, code blocks, lists, and links. We call it only for assistant turns; user turns remain plain text to avoid accidental interpretation.

**Why over a third-party renderer (marked, markdown-it)**: Avoids bundling a Markdown parser. Obsidian's renderer honors the vault's CSS theme and plugin styles automatically.

**Approach**: `body.setText(...)` is replaced by `await MarkdownRenderer.render(this.app, turn.content, body, "", this)`. During streaming, we re-render the body element on each text event (wiping and re-rendering). This is acceptable for message-length text.

### 3. Model selector: free-text input with optional datalist

The chat header gets a compact text `<input>` that mirrors the current session's model. On change, it updates the session's `model` field and saves.

If the active provider implements `listModels(): Promise<string[]>`, we attach a `<datalist>` populated with the returned model IDs. The method hits the `/models` endpoint (standard OpenAI-compatible API).

**Why not a `<select>`**: The list is dynamic and may be empty if the endpoint doesn't support `/models`. A text input with `<datalist>` degrades gracefully to a free-text field.

**Scope**: `listModels()` is optional on `ModelProvider`; the existing interface is not broken. `OpenAICompatibleProvider` implements it.

### 4. Session UI: header dropdown + new/delete buttons

A thin header bar above the transcript contains: `[Session name ▼] [+ New] [🗑 Delete]` and `[Model: <input>]`.

- The session dropdown shows all session titles; selecting one switches the active session.
- "New" creates a blank session with the title "New chat" and switches to it.
- "Delete" removes the active session (if only one session exists, it is cleared and re-titled rather than deleted).

Renaming happens inline by clicking the session title in the dropdown trigger — it becomes an `<input>` on click, saves on blur/Enter.

## Risks / Trade-offs

- **Re-rendering on every token**: Wiping and re-rendering the assistant `body` on every streaming token may cause visible flicker. Mitigation: debounce re-renders to ~50 ms intervals during streaming; on the final event do a full render.
- **Storage size**: Long or numerous sessions can bloat `data.json`. Mitigation: no active limit now; add a session-count soft cap (e.g. 50) as a follow-up if needed.
- **listModels CORS**: The `/models` endpoint may be blocked by CORS on some providers. Mitigation: `listModels()` catches network errors silently and returns an empty array; the UI falls back to plain text input.
- **MarkdownRenderer async during streaming**: `MarkdownRenderer.render` is async. We use fire-and-forget (`void`) calls during streaming to avoid blocking the stream loop; the final render is awaited.
