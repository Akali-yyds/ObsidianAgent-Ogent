## ADDED Requirements

### Requirement: Plugin loads on desktop and mobile
The plugin SHALL load successfully in Obsidian desktop (Electron) and Obsidian mobile (iOS and Android) without errors. The plugin SHALL NOT import Node-only modules (`child_process`, `fs`, `path`, etc.) at module top level.

#### Scenario: Desktop load
- **WHEN** the user enables the plugin in Obsidian desktop
- **THEN** the plugin activates without errors and registers its view, settings tab, and commands

#### Scenario: Mobile load
- **WHEN** the user enables the plugin in Obsidian mobile (iOS or Android)
- **THEN** the plugin activates without errors and registers its view, settings tab, and commands

#### Scenario: No Node-only top-level imports
- **WHEN** the bundle is inspected after build
- **THEN** it MUST NOT contain top-level `require()` or `import` statements for Node built-ins (`child_process`, `fs`, `path`, `os`, `crypto`)

### Requirement: Single bundle build
The plugin SHALL build to a single `main.js` plus `manifest.json` and optional `styles.css` via esbuild.

#### Scenario: Build succeeds
- **WHEN** the developer runs `npm run build`
- **THEN** esbuild produces `main.js` at the project root with no errors

### Requirement: Plugin manifest declares mobile compatibility
The `manifest.json` SHALL set `isDesktopOnly: false`.

#### Scenario: Manifest inspected
- **WHEN** the manifest is read by Obsidian
- **THEN** `isDesktopOnly` is `false` so mobile users can install the plugin

### Requirement: Plugin lifecycle hooks are implemented
The plugin SHALL implement `onload` to register its view, settings tab, and commands, and `onunload` to clean up registered handlers and abort any in-flight streams.

#### Scenario: Unload cancels work
- **WHEN** the user disables the plugin while a stream is in progress
- **THEN** the in-flight HTTP request is aborted and no further state mutations occur
