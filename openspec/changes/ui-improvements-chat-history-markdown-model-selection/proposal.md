## Why

The current chat view is functional but minimal: every reload wipes the conversation, all assistant output is plain text, and the model is only configurable in settings. These gaps make daily use feel rough and limit the plugin's utility as a real AI assistant inside Obsidian.

## What Changes

- Add persistent chat sessions: conversations are saved to disk and restored across reloads.
- Add a sessions panel/switcher so users can create, switch between, and delete named sessions.
- Render assistant message content as Markdown (headings, bold, code blocks, lists, etc.) instead of plain text.
- Add an inline model selector to the chat header so users can switch models without opening settings.

## Capabilities

### New Capabilities

- `chat-sessions`: Persistent conversation history stored per-session; create, list, switch, and delete sessions from within the chat view. Each session holds an ordered list of messages and metadata (title, timestamps).

### Modified Capabilities

- `chat-view`: Remove the "plain text only in M0" restriction; render assistant messages as Markdown. Add a model-selector dropdown to the chat header. Add session-switcher UI (sidebar or dropdown) that reflects the active session and allows switching.
- `model-provider`: Expose a method to enumerate available models for the active provider so the model-selector widget can populate its list dynamically.

## Impact

- **New storage layer**: Sessions are written to the Obsidian vault (or plugin data dir) as JSON; `Plugin.loadData` / `saveData` extended or a dedicated file approach used.
- **`ChatView` component**: New header row (model selector), Markdown renderer replacing plain-text span, sessions sidebar/list.
- **`ModelProvider` interface**: New optional `listModels()` method; existing implementations updated.
- **Settings**: `model` setting may become session-local rather than global-only; settings tab needs minor adjustments if model moves to per-session.
- **No breaking API changes** to the agent loop or provider streaming interface.
