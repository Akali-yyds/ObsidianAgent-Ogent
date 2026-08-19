# Contributing to Ogent

Thanks for helping improve Ogent. Please keep pull requests focused and explain
the user-facing behavior that changed.

## Development

1. Install dependencies with `npm ci`.
2. Run `npm run lint`.
3. Run `npm test -- --run`.
4. Run `npm run build` before submitting a change.

Do not commit API keys, private vault content, `data.json`, generated bundles,
personal session files, or local vault configuration. Obsidian plugin changes
should use the public Obsidian API and clean up registered events and resources
when a view or plugin closes.

## Pull requests

Include a short testing note and update `manifest.json` and `versions.json` for
user-facing releases. Release artifacts are generated from the production build
and should contain `main.js`, `manifest.json`, and `styles.css`.
