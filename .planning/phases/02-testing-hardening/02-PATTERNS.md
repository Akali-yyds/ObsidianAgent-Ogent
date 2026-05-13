# Phase 2: Testing & Hardening - Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** 17
**Analogs found:** 14 / 17

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `package.json` | config | batch | `package.json` | exact |
| `vitest.config.ts` | config | transform | `tsconfig.json` | partial |
| `tests/setup.ts` | test | transform | `src/platform.ts` | partial |
| `tests/agents/structured-output.test.ts` | test | request-response | `src/agents/structured-output.ts` | source-match |
| `tests/agents/orchestrator.test.ts` | test | event-driven | `src/agents/orchestrator.ts` | source-match |
| `tests/agents/quote-match.test.ts` | test | transform | `src/agents/quote-match.ts` | source-match |
| `tests/packs/loader.test.ts` | test | file-I/O | `src/packs/loader.ts` | source-match |
| `tests/packs/runtime.test.ts` | test | event-driven | `src/packs/runtime.ts` | source-match |
| `tests/sessions.test.ts` | test | file-I/O | `src/sessions.ts` | source-match |
| `hackathon/eval/run.ts` | utility | batch | `deploy.mjs` | partial |
| `hackathon/eval/fixtures/vault/*.md` | test | file-I/O | none | none |
| `hackathon/eval/fixtures/queries.json` | config | batch | `src/packs/defaults/grounded-research.openai.json` | partial |
| `hackathon/eval/results/.gitkeep` | config | batch | none | none |
| `src/packs/runtime.ts` | service | event-driven | `src/packs/runtime.ts` | exact |
| `src/packs/loader.ts` | service | file-I/O | `src/packs/loader.ts` | exact |
| `src/main.ts` | provider | file-I/O | `src/main.ts` | exact |
| `src/sessions.ts` | store | CRUD | `src/sessions.ts` | exact |
| `src/view.ts` | component | request-response | `src/view.ts` | exact |
| `src/packs/vault-adapter.ts` *(likely new seam file)* | utility | file-I/O | `src/platform.ts` | partial |

## Pattern Assignments

### `package.json`

**Analog:** `package.json`

**Script layout** (lines 1-11):
```json
{
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "node esbuild.config.mjs production",
    "deploy": "node esbuild.config.mjs production && node deploy.mjs",
    "lint": "eslint --ext .ts src"
  }
}
```

**Use for Phase 2:** extend the existing flat script block; add `test`, `test:watch`, `test:coverage`, and `eval` beside existing script names rather than introducing nested task runners.

---

### `vitest.config.ts`

**Primary analog:** `tsconfig.json`

**Compiler/bundler defaults** (lines 2-20):
```json
"compilerOptions": {
  "target": "ES2022",
  "module": "ESNext",
  "moduleResolution": "Bundler",
  "strict": true,
  "resolveJsonModule": true,
  "noEmit": true
}
```

**Supplemental analog:** `esbuild.config.mjs` (lines 1-34)
```js
import esbuild from "esbuild";
import process from "node:process";

const isProd = process.argv[2] === "production";
```

**Use for Phase 2:** keep config ESM-style, target current Node/TS settings, and preserve JSON import support because tests/eval will load pack JSON and fixture JSON.

---

### `tests/setup.ts`

**Primary analog:** `src/platform.ts`

**Narrow boundary pattern** (lines 1-9):
```ts
import { Platform } from "obsidian";

export function isMobile(): boolean {
  return Platform.isMobileApp;
}
```

**Supplemental analog:** `src/main.ts` (lines 21-58)
```ts
const sessionsDir = `${this.manifest.dir}/sessions`;
if (!(await this.app.vault.adapter.exists(sessionsDir))) {
  await this.app.vault.adapter.mkdir(sessionsDir);
}
```

**Use for Phase 2:** keep the Obsidian seam narrow and explicit; centralize the mocked `Platform`, `App`, `vault.adapter`, and `metadataCache` behavior once in test setup.

---

### `tests/agents/structured-output.test.ts`

**Analog:** `src/agents/structured-output.ts`

**Imports + schema validator pattern** (lines 1-16):
```ts
import Ajv, { type ErrorObject } from "ajv";
import type { ChatMessage } from "../types";
import type { RunStructuredStepOptions } from "./types";

const ajv = new Ajv({ allErrors: true, strict: false });
```

**Retry contract to assert** (lines 19-41):
```ts
for (let attempt = 0; attempt < 2; attempt++) {
  const rawText = await collectStructuredText(attemptMessages, opts);
  const parsed = parseJsonPayload(rawText);
  ...
  if (attempt === 0 && lastFailure) {
    await opts.onRetry?.(lastFailure);
    attemptMessages = buildRepairMessages(...);
  }
}

return toFailure(lastFailure);
```

**Failure shape to assert** (lines 106-113):
```ts
return {
  ok: false,
  attempts: 2,
  rawText: failure?.rawText ?? "",
  reason: failure?.reason ?? "Structured output failed",
  validationErrors: failure?.validationErrors,
};
```

**Use for Phase 2:** tests should assert exact two-attempt behavior, repair-message retry, schema-error propagation, and trimmed accumulated text.

---

### `tests/agents/orchestrator.test.ts`

**Analog:** `src/agents/orchestrator.ts`

**Ordered event emission** (lines 14-19):
```ts
for (const step of opts.steps) {
  await opts.onEvent?.({ kind: "step", stepId: step.id, label: step.label, state: "pending" });
}
for (const step of opts.steps) {
  await opts.onEvent?.({ kind: "step", stepId: step.id, label: step.label, state: "running" });
```

**Fail-fast behavior** (lines 37-45, 54-64):
```ts
if (!result.ok) {
  await opts.onEvent?.({ kind: "step", stepId: structuredStep.id, state: "failed", message: result.reason });
  return { ok: false, context, failedStepId: structuredStep.id, error: result };
}
...
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  await opts.onEvent?.({ kind: "step", stepId: step.id, state: "failed", message: err.message });
  return { ok: false, context, failedStepId: step.id, error: err };
}
```

**Use for Phase 2:** assert full event sequence (`pending -> running -> complete/failed`), structured retry event forwarding, and no later-step execution after first failure.

---

### `tests/agents/quote-match.test.ts`

**Analog:** `src/agents/quote-match.ts`

**Core deterministic logic** (lines 1-8):
```ts
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function quotePresent(noteBody: string, quote: string): boolean {
  const normalizedQuote = normalizeWhitespace(quote);
  if (!normalizedQuote) return false;
  return normalizeWhitespace(noteBody).includes(normalizedQuote);
}
```

**Use for Phase 2:** cover whitespace collapsing, empty quote rejection, positive substring matches, and negative near-match cases.

---

### `tests/packs/loader.test.ts`

**Analog:** `src/packs/loader.ts`

**Default-pack install pattern** (lines 16-27):
```ts
const packDir = `${pluginDir}/packs`;
if (!(await app.vault.adapter.exists(packDir))) {
  await app.vault.adapter.mkdir(packDir);
}
const listing = await app.vault.adapter.list(packDir).catch(() => ({ files: [] as string[] }));
if (jsonFiles.length > 0) return;
```

**Validation + typed error pattern** (lines 29-45, 51-74):
```ts
const validate = ajv.compile<AgentPack>(agentPackSchema);
...
if (!validate(parsed)) {
  const errors = (validate.errors ?? []).map(...).join("; ");
  throw new PackValidationError(`Invalid pack at ${path}: ${errors}`);
}
...
if (!provider.baseUrl.trim() || !provider.model.trim() || !provider.apiKey.trim()) {
  throw new PackValidationError(`Invalid pack at ${path}: provider ${agent.provider} must declare baseUrl, apiKey, and model`);
}
```

**Use for Phase 2:** mock `vault.adapter.exists/list/read/write/mkdir`; assert sorted JSON loading, Ajv-backed validation errors, and early rejection of placeholder provider config.

---

### `tests/packs/runtime.test.ts`

**Analog:** `src/packs/runtime.ts`

**Pipeline assembly pattern** (lines 70-169):
```ts
const retrieverStep = opts.pack.steps.find((step) => step.id === "retriever");
const synthesizerStep = opts.pack.steps.find((step) => step.id === "synthesizer");
const verifierStep = opts.pack.steps.find((step) => step.id === "verifier");
...
const pipeline = await runPipeline<GroundedResearchContext>({
  initialContext: { query: opts.query, activeFilePath: opts.activeFilePath, pack: opts.pack },
  steps: [ ... ],
  onEvent: async (event) => { ... }
});
```

**Error surfacing pattern** (lines 171-190, 193-213):
```ts
if (!pipeline.ok) {
  const message = pipeline.error instanceof Error ? pipeline.error.message : pipeline.error.reason;
  throw new Error(message);
}
...
if (!providerConfig.baseUrl.trim() || !providerConfig.apiKey.trim() || !providerConfig.model.trim()) {
  throw new PackConfigError(`Pack ${pack.id} provider ${agent.provider} must declare baseUrl, apiKey, and model`);
}
```

**Brief collection pattern** (lines 222-245):
```ts
let text = "";
for await (const event of agent.run({ ... })) {
  if (event.kind === "text") text += event.text;
}
return text.trim();
```

**Use for Phase 2:** test deterministic provider/agent fakes, event forwarding, verifier-enabled vs verifier-disabled execution, and returned eval payload fields before UI formatting.

---

### `tests/sessions.test.ts`

**Primary analog:** `src/sessions.ts`

**Session init and migration pattern** (lines 77-103):
```ts
for (const s of rawSessions) {
  if (Array.isArray(s.turns) && s.turns.length > 0) {
    await this.cb.writeTurns(s.id, s.turns).catch(() => {});
  }
}
...
this.activeTurns = await this.cb.readTurns(this.activeId).catch(() => []);
```

**Mutation + persistence pattern** (lines 170-199):
```ts
await Promise.all([
  this.cb.writeTurns(id, turns),
  this.cb.persistIndex(this.meta, this.activeId),
]);
```

**Supplemental analog:** `src/main.ts` (lines 32-58)
```ts
readTurns: async (id) => {
  try {
    const text = await this.app.vault.adapter.read(`${sessionsDir}/${id}.json`);
    const parsed = JSON.parse(text) as { turns?: unknown };
    return Array.isArray(parsed.turns) ? (parsed.turns as StoredTurn[]) : [];
  } catch {
    return [];
  }
},
```

**Use for Phase 2:** cover visible recovery for corrupted JSON, backup-preserving behavior, active-session fallback, and persistence ordering.

---

### `hackathon/eval/run.ts`

**Primary analog:** `deploy.mjs`

**CLI shape** (lines 1-25):
```js
import { copyFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

function getVaultPath() {
  ...
  console.error("Error: vault path not configured...");
  process.exit(1);
}
```

**Supplemental analog:** `src/packs/runtime.ts` (lines 83-169)
```ts
const pipeline = await runPipeline<GroundedResearchContext>({ ... });
```

**Use for Phase 2:** keep eval as a simple Node entrypoint with clear process-level failures, then call a reusable runtime seam instead of embedding pack logic directly in the CLI file.

---

### `hackathon/eval/fixtures/queries.json`

**Analog:** `src/packs/defaults/grounded-research.openai.json`

**Committed JSON formatting pattern** (lines 1-63):
```json
{
  "id": "grounded-research.openai",
  "name": "Grounded Research (OpenAI)",
  "description": "...",
  "support": { "mobile": false },
  "providers": { ... },
  "agents": { ... },
  "steps": [ ... ]
}
```

**Use for Phase 2:** keep fixture JSON checked in, pretty-printed, and schema-like: stable top-level keys, no comments, predictable ordering for diff review.

---

### `src/packs/runtime.ts`

**Analog:** `src/packs/runtime.ts`

**What to preserve**:
- step lookup + `PackConfigError` guardrails (lines 70-81)
- pipeline context enrichment via `apply` functions (lines 89-146)
- UI-safe event adaptation (lines 148-168)
- provider construction in one place (lines 193-208)

**Phase 2 change direction:** extend this file rather than duplicating runtime logic elsewhere; add the verifier toggle and eval-visible intermediate outputs at this seam.

---

### `src/packs/loader.ts`

**Analog:** `src/packs/loader.ts`

**What to preserve**:
- Ajv validation with repo-wide `strict: false` setting (lines 7, 33-45)
- explicit custom error type (lines 9-14)
- adapter-based file I/O with `.catch(() => ({ files: [] }))` recovery (lines 16-23, 29-32)

**Phase 2 change direction:** harden provider validation here or immediately downstream for placeholder OpenAI keys (`replace-me`) so failures stay explicit and deterministic.

---

### `src/main.ts`

**Analog:** `src/main.ts`

**Session storage callback pattern** (lines 21-58):
```ts
this.sessionStore = new SessionStore({
  persistIndex: async (meta, activeId) => {
    await this.saveData({ ...this.settings, sessions: meta, activeSessionId: activeId });
  },
  readTurns: async (id) => { ... },
  writeTurns: async (id, turns) => { ... },
  deleteTurns: async (id) => { ... },
});
```

**Settings load/init pattern** (lines 110-129):
```ts
const data = (await this.loadData()) as (Partial<PluginSettings> & { sessions?: unknown; activeSessionId?: unknown }) | null;
...
await this.sessionStore.init(rawSessions, activeId);
```

**Phase 2 change direction:** keep all disk access in these callbacks; add visible corruption handling and backup behavior here instead of spreading raw adapter access into UI code.

---

### `src/sessions.ts`

**Analog:** `src/sessions.ts`

**What to preserve**:
- one in-memory active session plus callback-driven persistence (lines 67-75)
- metadata normalization during `init` (lines 84-102)
- batch persistence with `Promise.all` for turn updates (lines 170-178)

**Phase 2 change direction:** keep recovery logic inside the store boundary so tests can exercise it without booting the whole plugin.

---

### `src/view.ts`

**Analog:** `src/view.ts`

**Mobile guard + recovery UI** (lines 299-359, 373-385):
```ts
const mobileBlocked = packMode && this.isMobileBlockedPack();
...
if (mobileBlocked) {
  this.packMobileBannerEl.createEl("div", {
    cls: "open-agent-pack-banner",
    text: "Grounded Research is available on desktop only for now.",
  });
}
...
return this.availablePacks.filter((pack) => !isMobile() || pack.support.mobile);
```

**Pack error handling** (lines 809-885):
```ts
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  ...
  if (error instanceof PackConfigError) {
    this.activePackError = `Grounded Research couldn’t finish... (${message})`;
  }
}
...
if (err instanceof AuthError) {
  turn.error = "Authentication failed — check your API key.";
  return;
}
```

**Phase 2 change direction:** keep pack failures mapped to actionable user recovery states in the view, not raw exception dumps.

---

### `src/packs/vault-adapter.ts` *(likely new seam file)*

**Analog:** `src/platform.ts`

**Boundary pattern** (lines 1-9):
```ts
import { Platform } from "obsidian";

export function isMobile(): boolean {
  return Platform.isMobileApp;
}
```

**Use for Phase 2:** mirror this tiny-wrapper style for a vault adapter interface the eval CLI can fake; keep Obsidian-specific calls behind a narrow exported surface.

## Shared Patterns

### AJV validation
**Sources:** `src/agents/structured-output.ts` lines 10-41; `src/packs/loader.ts` lines 33-45
```ts
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile<TValue>(opts.schema.schema);
...
if (!validate(parsed)) {
  throw new PackValidationError(...);
}
```
Apply to: Vitest fixtures that assert schema failures, eval query/result validation, any new runtime seam returning structured data.

### Fail-loud typed errors
**Sources:** `src/types.ts` lines 109-137; `src/view.ts` lines 866-885
```ts
export class AuthError extends Error { ... }
export class RateLimitError extends Error { ... }
export class NetworkError extends Error { ... }
export class ProviderError extends Error { ... }
```
Apply to: runtime hardening; preserve typed errors in lower layers, map them to user-facing copy only at the view boundary.

### Adapter-based file I/O
**Sources:** `src/main.ts` lines 21-58; `src/packs/loader.ts` lines 16-27
```ts
if (!(await app.vault.adapter.exists(dir))) {
  await app.vault.adapter.mkdir(dir);
}
const listing = await app.vault.adapter.list(dir).catch(() => ({ files: [] as string[] }));
```
Apply to: session corruption recovery, fixture loading, eval output directory creation.

### Event-forwarding pipeline
**Sources:** `src/agents/orchestrator.ts` lines 14-64; `src/packs/runtime.ts` lines 148-168
```ts
await opts.onEvent?.({ kind: "step", ... state: "running" });
...
await opts.onEvent?.({ kind: "structured_retry", ... });
```
Apply to: eval reporting and runtime tests; assert ordered event streams instead of UI strings.

### Narrow runtime seams for non-Obsidian callers
**Sources:** `src/platform.ts` lines 1-9; `src/view.ts` lines 373-385
```ts
return this.availablePacks.filter((pack) => !isMobile() || pack.support.mobile);
```
Apply to: new eval adapter/seam files; keep environment checks centralized and mockable.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `hackathon/eval/fixtures/vault/*.md` | test | file-I/O | No committed fixture corpus exists yet. |
| `hackathon/eval/results/.gitkeep` | config | batch | No generated-results directory pattern exists yet. |
| `tests/*` as a suite-wide style | test | mixed | No test files exist in the repo; use source-under-test contracts plus Vitest defaults from research. |

## Metadata

**Analog search scope:** `src/`, repo root config (`package.json`, `tsconfig.json`, `*.mjs`), `hackathon/`
**Files scanned:** 19
**Pattern extraction date:** 2026-05-13
