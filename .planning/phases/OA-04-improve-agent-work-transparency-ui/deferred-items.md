# Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Out-of-scope typecheck | `./node_modules/.bin/tsc --noEmit` still fails in `src/main.ts` because `this.manifest.dir` is typed as `string | undefined` in existing `ensureDefaultPacks` / `loadPacks` calls unrelated to Plan 04-01 changes. | Deferred | 2026-05-14 |
