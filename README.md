# Obsidian AI Agent

AI agent inside Obsidian — vault-aware, MCP-capable, BYOK, cross-platform.

> M0 (this milestone): plugin scaffold, settings, chat view, single OpenAI-compatible provider, no tools yet.

## Install (dev)

```bash
npm install
npm run dev          # esbuild watch, writes main.js
```

Copy `main.js` and `manifest.json` into a test vault at `<vault>/.obsidian/plugins/ai-agent/`, then enable the plugin in Settings → Community Plugins.

## Build

```bash
npm run build        # production bundle
```

## Mobile

Same bundle works on iOS/Android. Sideload by syncing the plugin folder via Obsidian Sync or any file sync to the mobile vault's `.obsidian/plugins/ai-agent/`.

## Spec workflow

This repo uses [OpenSpec](https://github.com/Fission-AI/OpenSpec). See `openspec/changes/` for in-flight proposals and `openspec/specs/` for the canonical spec (populated when changes are archived).
