# Remove Live Share — Design

**Status:** approved, ready for implementation
**Date:** 2026-06-01
**Decision:** Live Share is being turned off in the app. Full rip across all three layers (host studio, peer SPA, AWS relay source). AWS resources stay running; manual `cdk destroy` is deferred.

## Why

Live Share has not been working as expected. Rather than patch, we are removing the feature and the surface it lives on.

## Scope decisions

| Question | Decision |
|---|---|
| Disable scope | **Rip it out completely** (not feature-flag, not UI-only) |
| Other share-menu items (PDF / PNG / Cloud export / Embed) | **Keep** |
| `@seeflow/canvas` public API (`onLiveShare`, `IoAdapter`) | **Option B — full rip + major bump** |
| AWS relay (`seeflow-viewer/cloud`) | **Delete source, defer `cdk destroy`** |
| Land style (seeflow) | Push directly to `main` per [[feedback_main_push]] |
| Workspace | Implement in-session on `main` |

## Surface map

The feature spans three layers:

```
seeflow (host studio)  ──host RPC──▶  seeflow-viewer/cloud (AWS relay)  ──WS──▶  seeflow-viewer (peer SPA at /share/:token)
```

### Layer 1 — `seeflow` (this repo)

**`apps/web` — delete:**

- `src/components/live-share-dialog.tsx` (+ test)
- `src/hooks/use-live-share-audit.ts`
- `src/hooks/use-share-state.ts`

**`apps/web` — edit:**

- `src/App.tsx`: remove `LiveShareDialog` mount, `liveShareOpen`, `shareState`, `shareActive`, `useShareState` import; keep other callbacks (`onDownloadPdf`, `onDownloadPng`, `onExportToCloud`) on the `share` object.
- `src/components/header.tsx` (+ test): remove `onLiveShare` from `HeaderShareCallbacks`.

**`apps/studio` — delete:**

- `src/share.ts`
- `src/share-rpc-schema.ts`
- `src/share/` (entire dir: `sse-frame.ts`, `sse-outbound-queue.ts`, `sse-rate-limit.ts`, `sse-tap.ts`, all `.test.ts`)
- `integration/share-co-edit.it.ts`, `share-files.it.ts`, `share-host-peer.it.ts`, `share-phase8.it.ts`, `share-rpc-schema-sync.it.ts`, `share-sse-bridge.it.ts`
- `e2e/share-sse-live.e2e.ts`

**`apps/studio` — edit:**

- `src/api.ts`: remove `/api/share/start|stop|kick|...` routes; remove `share?: ShareController` option; remove `broadcastHostEdit` plumbing on patch routes; drop `ShareController` / `RpcOp` / `AttributionEvent` / `ShareState` imports.
- `src/server.ts`: remove `createShareController`, `resolveHostDisplayName`, `SEEFLOW_SHARE_RELAY_URL`, `SEEFLOW_SHARE_URL_BASE`, `DEFAULT_SHARE_URL_BASE`, the `share` option.

**`packages/canvas` — Option B (breaking major):**

- DELETE `src/adapter/io-adapter.ts` (+ test), `src/adapter/io-adapter-wrap.ts` (+ test), the `adapter/` directory.
- EDIT `src/index.ts`: drop `IoAdapter` / `wrapIoAdapter` re-exports.
- EDIT `src/components/share-menu.tsx`: remove `onLiveShare` from `ShareMenuProps`, the `Users` icon import, `LIVE_SHARE_LABEL`, the `showLiveShare` computation, the Live Share `<DropdownMenuItem>`, and the live-share branch of the early-return guard.
- EDIT `src/components/seeflow-canvas.tsx`: remove `ioAdapter` prop, the `onLiveShare` pass-through to `<ShareMenu>`, and the doc comments referencing US-035 / US-036 / Live Share.
- Update tests in `src/components/seeflow-canvas.test.tsx` (and `share-menu.test.tsx` if present).
- Bump `@seeflow/canvas` **major** in `packages/canvas/package.json`.
- `CHANGELOG.md`: `BREAKING: remove Live Share surface (onLiveShare prop, IoAdapter, wrapIoAdapter)`.

**Other:**

- `apps/mcp-app/` — grep for `IoAdapter` / `onLiveShare`; fold into the canvas step if hit.
- `skills/seeflow/vendored/schema.ts` — `make sync-seeflow-schema` after the studio schema edits if any Zod types shift.
- Strip orphaned env-var docs for `SEEFLOW_SHARE_*` in `README.md` and any per-package `CLAUDE.md`.

### Layer 2 — `seeflow-viewer` (sibling repo)

**SPA — delete:**

- `src/pages/share-session.tsx`, `share-session.identity.test.tsx`, `share-session.io.test.tsx`, `share-session.sse-wiring.test.tsx`, `share-session.test.tsx`, `share-session-edit.ts`
- `src/components/edit-canvas.tsx`, `presence-sidebar.tsx` (+ test), `connection-status-badge.tsx` (+ test), `display-name-modal.tsx`
- `src/lib/share-client.ts` (+ all `share-client.*.test.ts`), `share-api.ts` (+ test), `share-sse-frame.ts`, `share-rpc-schema.ts`

**SPA — edit:**

- `src/app.tsx`: remove `<Route path="/share/:token" element={<ShareSession />} />` + import.
- `package.json`: bump `@seeflow/canvas` to the new major after publish.

**Not touched:** `enableShare` prop on `view-canvas.tsx` / `flow-view.tsx` — despite the misleading name it gates `showShareMenu` + `enableEmbed` (download/embed), not Live Share. Rename is out of scope.

**Cloud (CDK + Lambda) — delete source only:**

- DELETE `cloud/lambda/share/` (entire dir).
- DELETE `cloud/bin/share-smoke.ts`, `cloud/bin/share-smoke-runner.sh`.
- EDIT `cloud/lib/seeflow-stack.ts`: remove all share resources (DDB tables, WS API Gateway, Lambda functions, IAM grants, env wiring).
- DELETE `cloud/lib/seeflow-stack.share.test.ts`.
- **Do not** run `cdk deploy` or `cdk destroy` as part of this work. `cdk diff` will show every share resource as `to delete` — that is expected and intentional.

## Sequencing

1. **`seeflow`** — rip web → rip studio → rip canvas (Option B) + major bump + CHANGELOG. One commit per step. Push to `main`, watch CI + deploy through. **Do not publish canvas yet.**
2. **`seeflow-viewer`** — rip SPA share code → rip cloud source. Point `@seeflow/canvas` dep at the local workspace build to typecheck against the new major.
3. **Publish `@seeflow/canvas` new major** to npm.
4. **`seeflow-viewer`** — re-pin `@seeflow/canvas` to the published version; final commit + push.
5. **Deferred manual op** — user runs `cdk diff` and, when ready, `cdk destroy` (or surgical resource removal) to tear down the AWS relay. Out of scope for this work; documented for future-you.

## Verification gates (per [[feedback_commit_and_test_gating]])

After each rip in a repo, before moving on:

```
bun run format && bun run lint && bun run typecheck && bun test && bun run test:it && bun run test:it:e2e
```

All green before declaring that repo done.

## Out of scope

- Renaming the misleading `enableShare` prop in `seeflow-viewer`.
- Refactoring `apps/studio/src/api.ts` patch routes beyond removing `broadcastHostEdit`.
- Any unrelated cleanup the rip surfaces.
- Running `cdk destroy` against AWS.

## Risks

- **Forgotten consumer of `IoAdapter`.** Pre-publish, grep both repos and `apps/mcp-app/` for `IoAdapter` / `wrapIoAdapter` / `onLiveShare` and fail the implementation if any non-test reference remains.
- **AWS resources orphaned.** Documented; user owns the manual destroy.
- **Snapshot drift.** Visual baselines for the header may change once the Share menu loses the Live Share item. Regenerate via `bun run test:it:update-snapshots` and commit `*-chromium-linux.png` (per `CLAUDE.md`).
