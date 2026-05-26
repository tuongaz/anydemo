# Multi-flow projects

Design decisions for letting a single SeeFlow project host multiple flows,
with a menu to switch between them in the canvas.

Status: **decided, not implemented**. Pre-launch — no migration required.

## Problem

Today a project = one flow. Every project folder ships exactly one
`flow.json` and the studio binds a `CanvasAdapter` to a single `flowId`
for its lifetime. We want a project to be able to declare multiple flows
that the user can switch between via a menu inside the canvas.

## Hard constraint

**No changes to the existing REST API or the `flow.json` schema.** The new
multi-flow model has to layer on top of:

- `flow.json` keeps its current shape: `{ version, name, nodes[], connectors[] }`.
- Every existing route stays as-is: `/api/flows/:flowId/{nodes,connectors,…}`,
  `/api/projects/:flowId/nodes/:nodeId/files/upload`, etc.
- `CanvasAdapter` stays single-flow-bound (one adapter, one `flowId`).

Anything that would force the API to grow a `:sectionId` discriminator,
or force `flow.json` to nest `nodes` inside a `sections` array, is out.

## Decision

### File layout

Every project has a top-level manifest (`seeflow.json`) and stores each
flow in its own folder under `flows/<id>/`.

```
examples/order-pipeline/
  seeflow.json
  flows/
    main/
      flow.json
      nodes/<nodeId>/...      ← per-flow asset uploads
      scripts/
      detail.md
    retry/
      flow.json
      nodes/<nodeId>/...
    happy-path/
      flow.json
```

- **`seeflow.json` is mandatory.** Scanner errors with a clear message if
  it's missing. No virtual-manifest fallback.
- **`flow.json` at the project root is illegal.** Only
  `flows/<id>/flow.json` is valid. One layout, one code path.
- **`flow.json` itself is unchanged.** Same `FlowSchema` as today.

### Manifest shape (`seeflow.json`)

```jsonc
{
  "version": 1,
  "name": "Order Pipeline",
  "defaultFlow": "main",
  "flows": [
    { "id": "main",        "name": "Main" },
    { "id": "retry",       "name": "Retry" },
    { "id": "happy-path",  "name": "Happy Path", "icon": "smile" }
  ]
}
```

- `id` doubles as the folder name → must be filesystem-safe.
  Validation rule: `^[a-z0-9][a-z0-9-]*$`.
- `id` is unique within a project. Duplicate ids → scanner error.
- No `path` field — it's always `flows/<id>/flow.json`. Inferring keeps
  the manifest concise and prevents drift between the declared path and
  the actual folder.
- `defaultFlow` is the flow opened when the user lands on the project
  without a specific flow in the URL.
- Future project-level config (theme, defaults, plugins) can live
  alongside `flows`. The file name `seeflow.json` mirrors the
  `package.json` / `tsconfig.json` / `biome.json` convention of naming
  the top-level config file after the tool.

## Naming — why `seeflow.json`

| Candidate     | Verdict | Reason |
|---------------|---------|--------|
| `seeflow.json`| **chosen** | Branded; matches `package.json` / `tsconfig.json` convention; room to grow into other project-level settings. |
| `flows.json`  | runner-up | Humble and literal; pick if the file should never grow beyond a flow list. |
| `group.json`  | rejected | "Group" is overloaded (Figma/React Flow use it for node grouping). |
| `canvas.json` | rejected | Collides with `@seeflow/canvas` and React Flow's canvas concept. |
| `board.json`  | rejected | Wrong metaphor (Miro/Trello); introduces a new noun for a flow. |

## Addressing — composite `flowId`

The studio's `registry.resolve(idOrSlug)` already accepts a slug
(`apps/studio/src/registry.ts:188`). We extend that without changing the
resolver: the scanner registers **one `FlowEntry` per flow** in
`seeflow.json`, with a composite slug:

```ts
// Project: order-pipeline (seeflow.json declares 3 flows)
{ id: 'aB3..', slug: 'order-pipeline--main',       repoPath: '…/order-pipeline', flowPath: 'flows/main/flow.json' }
{ id: 'cD4..', slug: 'order-pipeline--retry',      repoPath: '…/order-pipeline', flowPath: 'flows/retry/flow.json' }
{ id: 'eF5..', slug: 'order-pipeline--happy-path', repoPath: '…/order-pipeline', flowPath: 'flows/happy-path/flow.json' }
```

**Slug shape: `<project-slug>--<flow-id>`** (double-dash separator).

Why double-dash and not `:` or `/`:
- `:` URL-encodes to `%3A` — ugly.
- `/` would force Hono route changes (`:flowId` can't contain `/`) or a
  wildcard match.
- `--` is URL-safe, fits in a single `:flowId` route param, and keeps
  every existing route working unchanged.

Slug uniqueness is enforced **per project** — the project slug prefix
namespaces flow ids, so `order-pipeline--retry` and `ecommerce--retry`
coexist fine.

## Resolution flow end-to-end

```
1. User clicks "Retry" in the page-switcher popover.
2. UI knows the slug: 'order-pipeline--retry'.
3. URL updates to /flows/order-pipeline--retry.
4. Web app:
     adapter = createRestAdapter({ baseUrl, flowId: 'order-pipeline--retry' })
     fetch '/api/flows/order-pipeline--retry/graph'      ← existing endpoint
5. Studio: registry.resolve('order-pipeline--retry') → entry
           → reads <repoPath>/flows/retry/flow.json
6. Canvas re-mounts with the new adapter + new nodes/connectors.
```

The canvas package learns nothing about multi-flow. Same `CanvasAdapter`,
same routes, same mutations. The "flow switch" is a host-app concern:
throw away the old adapter, construct a new one with a new `flowId`,
re-render.

## Per-flow asset folder

Today `POST /api/projects/:flowId/nodes/:nodeId/files/upload` writes to
`<project>/nodes/<nodeId>/<filename>` (`packages/canvas/src/adapter/rest.ts:127`).
With multi-flow, each flow owns its own asset folder under its flow
directory:

```
flows/main/nodes/<nodeId>/<filename>
flows/retry/nodes/<nodeId>/<filename>
```

The upload endpoint **does not change** — it's still `:flowId`-scoped.
The server resolves `<entry.repoPath>/<dirname(entry.flowPath)>/nodes/<nodeId>/<filename>`
instead of `<entry.repoPath>/nodes/<nodeId>/<filename>`. Cascade-delete
of a node still works because everything stays under one folder per flow.

## One new endpoint

The page-switcher popover needs the list of flows for a project. This is
the only net-new endpoint:

```
GET /api/projects/:projectSlug/flows
→ {
    flows: [
      { id, slug, name, isDefault, icon? },
      ...
    ]
  }
```

Implementation: read `seeflow.json` for the project (or filter
`registry.list()` by `repoPath`). No existing routes change.

## UI — the switcher

**Figma-style "Pages" popover**, anchored top-left near the project
title. Click → vertical list of flows, each row = name + icon + active
state, footer "+ New flow".

- Scales from 2 to ~50 flows.
- Persist the last-opened flow per project in `localStorage`.
- Reflect the active flow in the URL so deep links work.

Tabs across the top of the canvas were considered (great for ≤6 flows)
but eat vertical space and get crowded fast. A sidebar tree is premature
until we have folders/groups within a project.

## Rename semantics

Since `id` IS the folder name, renaming a flow is a folder rename plus a
manifest update:

```
mv flows/<old-id>/  flows/<new-id>/
edit seeflow.json: flows[].id  old-id → new-id
```

The studio's "rename flow" action does both atomically. UI confirms
before renaming because git history will show the move.

## Migration

**None.** Pre-launch — all four in-repo example projects (and the e2e
fixture) move to the new layout in the same PR that introduces the
scanner change. Expect Playwright baselines under
`apps/studio/e2e/__snapshots__/*-chromium-linux.png` to need
regenerating after the move.

## Rejected alternatives

### `sections` inside `flow.json`

```json
{ "version": 3, "sections": [
  { "id": "main",  "nodes": [...], "connectors": [...] },
  { "id": "retry", "nodes": [...], "connectors": [...] }
]}
```

Rejected because:
- Breaks the `flow.json` schema — explicitly out of scope.
- Breaks the API contract: `/api/flows/:flowId/nodes/:nodeId` becomes
  ambiguous (which section's node?). Forces either a `:sectionId` route
  param or a full-file id scan on every request.
- File bloat + merge contention as projects grow.
- Loses per-flow file watching, per-flow git history, per-flow assets.

### Convention-only (no manifest)

`flows/*/flow.json`, auto-discovered, sorted alphabetically.
Rejected because we lose display ordering, default-flow selection,
per-flow icons, and project-level metadata. We'd build a manifest
eventually anyway.

## Implementation checklist

When this gets built (separate PR):

- [ ] Zod schema for `seeflow.json` in `apps/studio/src/schema.ts`.
- [ ] Scanner: read `seeflow.json`, register one `FlowEntry` per flow
      with composite slug `<project-slug>--<flow-id>`.
- [ ] Scanner: validate `id` against `^[a-z0-9][a-z0-9-]*$` and uniqueness.
- [ ] Scanner: error (don't fall back) if `seeflow.json` is missing or if
      `flow.json` exists at the project root.
- [ ] Upload endpoint: resolve path under `dirname(entry.flowPath)`.
- [ ] New `GET /api/projects/:projectSlug/flows` listing endpoint.
- [ ] `apps/web` page-switcher popover; URL-bound active flow.
- [ ] Migrate the four in-repo example projects to the new layout.
- [ ] Regenerate `*-chromium-linux.png` Playwright baselines.
