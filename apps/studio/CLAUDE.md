# apps/studio

Bun + Hono backend, CLI, MCP server. Source of truth for the Zod schema (`src/schema.ts`).

## Rules

- **Schema sync:** any edit to `src/schema.ts` MUST be followed by `make sync-seeflow-schema` (copies into `skills/seeflow/vendored/schema.ts`). CI gates on `make verify-seeflow-schema-sync`.
- **Hono on Bun:** import `hono/bun`, never `@hono/node-server`. SSE uses `streamSSE` from `hono/streaming`; the handler MUST terminate its `while` loop on an `ended` flag so `await res.text()` in tests resolves.
- **CLI subcommand dispatch** (`src/cli.ts`): the long `if (sub === '…') { … } else if …` chain starting at the `sub === 'help'` branch is the registration point. Each branch is paired with a `runFoo()` helper at the end of the file. Heavy modules (e.g. `./icons/*`) load lazily via `await import(...)` inside the runner — matches `runSchema`, `runE2e`, etc.
- **CLI manifest:** every new subcommand needs a matching entry in `src/cli-manifest.ts` (`COMMAND_MANIFEST`) plus an extension to the name-list assertion in `src/cli-manifest.test.ts`. Parent commands (e.g. `icons`) stay implicit; register the leaves as `<parent>:<action>`.
- **Top-level constants used by CLI runners:** function declarations hoist but top-level `const` does not. If `runFoo()` is invoked from the dispatch chain and references a module-top `const`, declare the const ABOVE that chain (or inline it inside the function). Bun throws "Cannot access X before initialization" at runtime; TypeScript does NOT catch it.
- **`SEEFLOW_WORKSPACE` (NOT `SEEFLOW_HOME`)** overrides `seeflowHome()` — use it in tests + smoke runs that touch `~/.seeflow/`.
- **`writeFileAtomic`** (`src/atomic-write.ts`) does NOT `mkdir -p` the parent. Callers must `mkdirSync(dir, { recursive: true })` first, or skip the write when no state changed.

## Icon packs (`src/icons/`)

- Cache root: `seeflowHome()/icons/`. Anchored helpers in `paths.ts` (`iconCacheRoot`, `iconVendorRoot`, `iconLockPath`, `iconIndexPath`). Tests inject `deps.cacheRoot` directly into the installer/remove module — don't read from `iconCacheRoot()` inside `installer.ts` or `remove.ts`.
- **Per-vendor lock:** `withVendorLock(lockPath, fn)` in `lock.ts` serializes concurrent installs of the same vendor in-process. Identity-track the wrapped promise with `const tracked = run.catch(() => undefined)` and use that single instance both as the map value AND in the cleanup check — `.catch()` returns a fresh promise each call, so comparing freshly-created promises leaks map entries.
- **Vendor types are NOT shared:** `IconVendor` in `packages/canvas/src/lib/icon-id.ts` carries 5 vendors (lucide, aws, gcp, azure, iconify) because the canvas resolves all of them. `IconVendor` in `apps/studio/src/icons/paths.ts` carries 2 (aws, azure) because only those have caches. Keep them distinct — do NOT cross-import.
- **Adding a vendor:** create `normalize-<vendor>.ts`, add a `VendorDescriptor` entry in `vendors.ts` (real URL + license + canonicalName), extend the studio's `IconVendor`, mirror the change in `list-helper.ts` (`summarizePacks` array), and add an integration test in `apps/studio/integration/icons-install.it.ts` using the `createApp + Bun.serve({port: 0})` in-process pattern (the subprocess `spawnStudio` harness can't accept injected `iconFetcher`/`iconCacheRoot`).
- **Job registry:** `createJobRegistry()` in `jobs.ts` is created ONCE at server boot (`src/server.ts`'s `createApp`) so SSE replays survive across requests. Don't re-create it per route.

## Tests

- **Unit:** `foo.ts` + `foo.test.ts`. Filesystem-touching unit tests use `mkdtempSync` + `rmSync` in `beforeEach`/`afterEach`.
- **Integration:** `integration/*.it.ts`. Default harness is `spawnStudio` (subprocess CLI) in `integration/support/studio-harness.ts`. When the test needs injected `createApp` options (e.g. `iconFetcher`, `iconCacheRoot`, fake spawner), bypass `spawnStudio` and use `createApp({...}) + Bun.serve({ port: 0, hostname: '127.0.0.1' })` directly. Use `staticRoot: join(cacheRoot, '__nosuch_static__')` to skip the SPA bundle requirement, and `disableWatcher: true` to avoid leaking fs handles.
- **E2E:** `e2e/*.e2e.ts` run via `apps/studio/scripts/run-e2e.ts`. `--update-snapshots` is a value-taking flag — put the spec path BEFORE the flag, not after. Visual baselines are pinned to chromium-linux; regenerate with `bun run test:it:update-snapshots` (Docker required on darwin).

## Workflow

- Lint/format: `bun run format` BEFORE `bun run lint` (Biome).
- Typecheck: `bun run typecheck` from the repo root fans across workspaces.
- Bun's directory discovery skips `*.it.ts` — use `bun run test:it:bun` for integration, not bare `bun test`.
