# Multi-flow projects — implementation design

Implementation design for letting a single SeeFlow project host multiple
flows, with a menu to switch between them in the canvas.

Status: **decided, not implemented**. Pre-launch — no migration required.

Builds on the earlier "Multi-flow projects" decision doc but **revises
two of its hard constraints** after brainstorming:

1. The API is rewritten to a proper `/api/projects/:project/flows/:flow/…`
   hierarchy. The composite-slug (`<project-slug>--<flow-id>`) idea is
   dropped — pre-launch is the right time to do this properly.
2. "Export to seeflow.dev" exports the **whole project** as a multi-flow
   bundle, not just one flow. Requires a sibling PR in the
   `seeflow-viewer` repo.

## Problem

Today a project = one flow. Every project folder ships exactly one
`flow.json` and the studio binds a `CanvasAdapter` to a single `flowId`
for its lifetime. We want a project to be able to declare multiple flows
that the user can switch between via a menu inside the canvas.

## File layout

Every project has a top-level manifest (`seeflow.json`) and stores each
flow in its own folder under `flows/<id>/`.

```
.seeflow/order-pipeline/
  seeflow.json
  flows/
    main/
      flow.json
      nodes/<nodeId>/...
      .tmp/                ← per-flow scratch
    retry/
      flow.json
      nodes/<nodeId>/...
    happy-path/
      flow.json
      nodes/<nodeId>/...
```

- **`seeflow.json` is mandatory.** Scanner errors with a clear message if
  it's missing. No virtual-manifest fallback.
- **`flow.json` at the project root is illegal.** Only
  `flows/<id>/flow.json` is valid. One layout, one code path.
- **`flow.json` itself is unchanged.** Same `FlowSchema` as today.
- **`projects:create` writes `seeflow.json` + `flows/main/flow.json` in
  one shot.** A brand-new project always has one flow named `main`.
  Additional flows go through `flows:create`.

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

- `id` doubles as the folder name → filesystem-safe.
  Validation rule: `^[a-z0-9][a-z0-9-]*$`.
- `id` is unique within a project. Duplicate ids → scanner error.
- No `path` field — always inferred as `flows/<id>/flow.json`.
- `defaultFlow` is the flow opened when the user lands on the project
  without a specific flow in the URL.
- Project-level config (theme, defaults, plugins) can live alongside
  `flows` in future versions.

## Addressing — proper hierarchy

The studio API rewrites every flow-scoped route under
`/api/projects/:project/flows/:flow/…`. No composite slugs, no
backwards-compat aliases (pre-launch).

### `FlowEntry` (registry)

```ts
interface FlowEntry {
  id: string;             // internal short id (unchanged)
  projectSlug: string;    // derived from seeflow.json.name, unique
  flowSlug: string;       // = manifest entry's id
  name: string;
  description?: string;
  icon?: string;
  isDefault: boolean;
  repoPath: string;       // project root
  flowPath: string;       // flows/<flowSlug>/flow.json
  lastModified: number;
  valid: boolean;
}
```

`registry.resolve(idOrSlug)` keeps working as today (resolves a single
identifier to a `FlowEntry`). The slug is now `flowSlug` (without
project prefix) — uniqueness inside the registry is enforced by the
`(projectSlug, flowSlug)` tuple.

### HTTP routes

```
GET    /api/projects                                  list projects
GET    /api/projects/:project                         project metadata
GET    /api/projects/:project/flows                   list flows
POST   /api/projects/:project/flows                   create flow
PATCH  /api/projects/:project/flows/:flow             rename
DELETE /api/projects/:project/flows/:flow             delete

GET    /api/projects/:project/flows/:flow/graph
POST   /api/projects/:project/flows/:flow/nodes
PATCH  /api/projects/:project/flows/:flow/nodes/:nid
DELETE /api/projects/:project/flows/:flow/connectors/:cid
POST   /api/projects/:project/flows/:flow/nodes/:nid/files/upload
GET    /api/projects/:project/files/<path>            project-scoped assets
```

Per-flow asset uploads resolve under
`<repoPath>/flows/<flow>/nodes/<nodeId>/<filename>`. Cascade-delete of a
node follows the same anchor.

`DELETE /api/projects/:project/flows/:flow` refuses if it's the only
flow or the default-with-no-replacement.

### CLI

Every flow-scoped verb takes `--project --flow` explicitly. No sticky
defaults, no environment variables, no `<project>/<flow>` shorthand.

```
seeflow projects:create --path <dir> --name <name>
seeflow projects:list
seeflow flows:create   --project <p> --flow <id> --name <name>
seeflow flows:rename   --project <p> --flow <id> [--new-id <x>] [--name <n>]
seeflow flows:delete   --project <p> --flow <id>
seeflow nodes:patch    --project <p> --flow <f> --node <n> --body '{...}'
seeflow flows:layout   --project <p> --flow <f>
seeflow e2e            --project <p> --flow <f>
```

### MCP

Every flow-scoped MCP tool takes `project` and `flow` as separate string
args, each with its own schema description, so the model picks them
correctly. `projects:*` tools don't take `flow`.

### Canvas adapter

```ts
createRestAdapter({ baseUrl, project, flow })
// composes: `${baseUrl}/api/projects/${project}/flows/${flow}/…`
```

Switching flows in the UI throws away the old adapter and constructs a
new one — canvas remounts. The canvas package itself learns nothing
about multi-flow.

## UI — the switcher

Figma-style "Pages" popover, anchored top-left near the project title.
Click → vertical list of flows, each row = name + icon + active state,
footer "+ New flow", per-row rename/delete affordances.

- Scales from 2 to ~50 flows.
- Persist the last-opened flow per project in `localStorage`.
- Reflect the active flow in the URL: `/projects/<project>/flows/<flow>`.

Tabs across the top of the canvas were considered (great for ≤6 flows)
but eat vertical space and get crowded fast. A sidebar tree is premature
until we have folders/groups within a project.

### Rename semantics

Since `id` IS the folder name, renaming the `id` is a folder rename plus
a manifest update:

```
mv flows/<old-id>/  flows/<new-id>/
edit seeflow.json: flows[].id  old-id → new-idj
```

`PATCH /api/projects/:project/flows/:flow` does both atomically.
Renaming `name` (display label) is a manifest-only edit and is cheap.

## MCP App impact

`apps/mcp-app/` is a separate Vite single-file bundle that mounts the
SeeFlow canvas inside Claude Desktop's MCP-Apps host iframe. The studio
serves the built `dist/index.html` as the `ui://seeflow/canvas` MCP
resource (`apps/studio/src/mcp-ui.ts`). It's a peer consumer of the
studio API and the canvas adapter — every change that lands for
`apps/web/` lands here too.

Specific impacts:

- **`WidgetState`** (`apps/mcp-app/src/bridge.ts` and its mirror
  `CanvasWidgetState` in `apps/studio/src/mcp-ui.ts`) gains a required
  `projectSlug` field on the `navigate` variant. The iframe no longer
  needs `GET /api/flows` + slug lookup — it has both slugs directly
  from the host.
- **Flow resolution** in `apps/mcp-app/src/App.tsx` collapses from
  "index + match + fetch by id" to a single
  `GET /api/projects/:project/flows/:flow`.
- **Adapter construction** in App.tsx switches from
  `createRestAdapter({ baseUrl, flowId })` to
  `createRestAdapter({ baseUrl, project, flow })` — same shape change
  as `apps/web/`.
- **MCP server emission** (`apps/studio/src/mcp.ts:373`, `:396`,
  `:440-441`, `:473`) — every `canvasMetaFor({ kind: 'navigate', ... })`
  call site now populates both `projectSlug` and `flowSlug`.
- **MCP tool surface** — every flow-scoped tool in `mcp.ts` takes
  `{ project, flow }` instead of `{ flowId }`. Schema descriptions on
  each field guide the model to fill the right slot.
- **Visual baselines** — `apps/studio/e2e/mcp-app.e2e.ts-snapshots/`
  regenerated alongside the rest of the Playwright suite.

The `apps/mcp-app/dist/index.html` bundle is rebuilt
(`bun run --filter @seeflow/mcp-app build`) before the e2e snapshot
regeneration step.

## Cloud export — whole project

"Export to seeflow.dev" exports the **whole project**: one click, one
share URL hosting all flows with an internal switcher.

### New zip shape

```
seeflow.json
flows/<id>/flow.json
flows/<id>/files/<path>          (image binaries referenced by nodes)
preview.png                      (optional)
```

The studio builds this by:
1. Fetching `GET /api/projects/:project` for the manifest.
2. For each flow, fetching `GET /api/projects/:project/flows/:flow/graph`
   and walking image nodes for `data.path`.
3. Streaming the file bytes via
   `GET /api/projects/:project/files/<path>` (or per-flow upload path).

### Cloud API — sibling PR in `seeflow-viewer`

The studio change is **blocked on** these landing in the `seeflow-viewer`
repo:

- `POST /api/projects` — unpacks the new zip, stores in S3, returns
  `{ url: 'seeflow.dev/project/<uuid>' }`.
- `GET /api/projects/<uuid>` — metadata.
- `GET /api/projects/<uuid>/files/<proxy+>` — asset proxy.
- Viewer UI gets a flow switcher; URL shape
  `seeflow.dev/project/<uuid>/flow/<flow-id>`.

Existing `POST /api/flows` + `/flow/<uuid>` URLs **stay untouched** —
already-shared single-flow URLs keep working forever.

### Rollout

The studio export change is behind a feature flag
(`VITE_SEEFLOW_PROJECT_EXPORT=1`). Old single-flow "Export to
seeflow.dev" stays the default until cloud-side is verified live, then
the flag flips on and the old code path is removed.

## Commit sequence (one studio PR)

| # | Commit | Notes |
|---|---|---|
| 1 | Schema + scanner + migration | Atomic: schema, scanner, 4 examples + e2e fixture. |
| 2 | API rewrite + adapter | All new nested routes; adapter takes `{project, flow}`; old `/api/flows/:flowId/…` deleted. Upload + asset paths re-anchored. |
| 3 | Manifest CRUD + CLI + MCP | HTTP CRUD endpoints, `flows:create/rename/delete` CLI verbs, `projects:create` writes manifest, MCP shim regenerated with `{project, flow}` arg pairs. |
| 4 | Page-switcher UI | Popover, URL routing `/projects/<project>/flows/<flow>`, localStorage, full CRUD wiring, canvas remount on switch. |
| 5 | Project export (studio, flagged) | New bundle shape, POSTs `seeflow.dev/api/projects`. Behind `VITE_SEEFLOW_PROJECT_EXPORT` until sibling cloud PR lands. |
| 6 | Playwright baselines | Regenerate `*-chromium-linux.png` after UI lands. |
| 7 | Skill update | `skills/seeflow/` + `skills/seeflow-lookup/` — see below. |

Each commit is independently typecheck-clean and test-clean.

## Skill update (commit 7)

The `/seeflow` skill bakes the old `<host>/.seeflow/<flow-name>/flow.json`
layout into prose and example paths. With this change that exact path
becomes illegal — every reference needs updating.

### `skills/seeflow/SKILL.md`

- **Project layout convention** (L20–34): replace tree with new shape
  (`<host>/.seeflow/<project>/seeflow.json` + `flows/<flow>/flow.json` +
  `flows/<flow>/nodes/<id>/`).
- **Conventions table**: add `$projectSlug` and `$flowSlug` (default
  `main` for skill-created projects). Move `$SEEFLOW_TMP` under the
  flow folder: `$repoPath/flows/$flowSlug/.tmp/`.
- **Pipeline**: P3 calls `projects:create` which now writes `seeflow.json`
  + `flows/main/flow.json` in one shot.
- **Common mistakes**: add "Calling `flows:create` instead of
  `projects:create` for a brand-new project" and re-anchor the
  "Passing `<slug>/scripts/…`" example at `flows/<flowSlug>/nodes/<id>/`.
- **LEARN.md placement** unchanged (`$PWD/.seeflow/LEARN.md`, shared
  across all projects + flows in host).

### `skills/seeflow/references/`

- **`cli.md`** — every command example gains `--project --flow`. Add
  new verbs (`flows:create`, `flows:rename`, `flows:delete`,
  `projects:list`).
- **`schema.md`** — per-node sidecar paths re-anchored at
  `<repoPath>/flows/<flowSlug>/nodes/<id>/`.
- **`phases/p3-scaffold.md`** — `projects:create` invocation, normalize
  step, the "register --flow flow.json" fallback path all updated. New
  no-fallback rule: a `flow.json` at project root in an existing path =
  abort and surface a migration message.
- **`phases/p5-patch-overlays.md`** + **`phases/p6-validation.md`** —
  `nodes:patch`, `flows:layout`, `e2e` all gain `--project --flow`.
- **`learn-format.md`** + **`operations.md`** — quick audit pass for
  stray path strings.

### `skills/seeflow/agents/seeflow-*.md`

Each sub-agent prompt that constructs file paths or CLI calls (planner,
play-designer, status-designer) needs the new path anchor + `--project
--flow` flags in any example invocations.

### `skills/seeflow/test/`

Audit fixtures, update any that reference the old layout, regenerate
snapshots if the skill has them.

### `skills/seeflow-lookup/SKILL.md`

- Canvas URL pattern at L31 (`$STUDIO_URL/d/<slug>`) → update to the new
  URL shape (`/projects/<project>/flows/<flow>` or the short-link form
  the web app exposes).
- One-liner: project listings come from `projects:list`, flow listings
  from `flows:list --project <p>` (the catalog command surfaced by
  `seeflow help` remains source of truth).
- Matching logic note: a topic might match a project, a flow, or both —
  surface both tiers when ambiguous.

## Rejected alternatives

### Composite slug `<project>--<flow>` (original plan)

Rejected because the proper-hierarchy rewrite is cheap pre-launch and
yields:
- Cleaner REST shape with no `--` separator leaking into URLs.
- Better MCP ergonomics — `project` and `flow` get separate schema
  descriptions, so the model picks them correctly.
- Cleaner CLI — `--project` and `--flow` are independently completable
  and validatable.

### `sections` inside `flow.json`

Rejected because it breaks the `flow.json` schema, breaks the API
contract (`/nodes/:nodeId` becomes ambiguous), bloats one file, and
loses per-flow file watching + per-flow git history + per-flow assets.

### Convention-only (no manifest)

`flows/*/flow.json`, auto-discovered, sorted alphabetically. Rejected
because we lose display ordering, default-flow selection, per-flow
icons, and project-level metadata. We'd build a manifest eventually
anyway.

### Export active flow only (preserve current cloud behavior)

Rejected because a multi-flow project's natural unit of sharing is the
project, not one flow. One Export click → one URL with the same
switcher the user built locally is the right experience.

## Implementation checklist

When this gets built (separate PR):

- [ ] Zod schema for `seeflow.json` in `apps/studio/src/schema.ts`.
- [ ] Scanner: read `seeflow.json`, register one `FlowEntry` per flow.
- [ ] Scanner: validate `id` against `^[a-z0-9][a-z0-9-]*$` and uniqueness.
- [ ] Scanner: error (don't fall back) if `seeflow.json` is missing or
      if `flow.json` exists at project root.
- [ ] Rewrite all flow-scoped HTTP routes under `/api/projects/:project/flows/:flow/…`.
- [ ] Update `packages/canvas/src/adapter/rest.ts` to take `{project, flow}`.
- [ ] Re-anchor upload + cascade-delete paths under `flows/<flow>/nodes/<nodeId>/`.
- [ ] HTTP CRUD endpoints for flows (`POST/PATCH/DELETE /api/projects/:project/flows[/:flow]`).
- [ ] CLI: `projects:create` writes manifest + first flow; new `flows:create/rename/delete`.
- [ ] Every flow-scoped CLI verb gains `--project --flow` flags.
- [ ] MCP shim regenerated — every flow-scoped tool takes `project` + `flow` args.
- [ ] `apps/web` page-switcher popover; URL-bound active flow.
- [ ] Migrate 4 in-repo example projects + e2e fixture to new layout.
- [ ] Project export: new zip shape, new POST URL, feature flag.
- [ ] Sibling PR in `seeflow-viewer` for cloud-side endpoints + viewer
      switcher.
- [ ] Regenerate `*-chromium-linux.png` Playwright baselines.
- [ ] Update `skills/seeflow/` (SKILL.md, references, agents, test).
- [ ] Update `skills/seeflow-lookup/SKILL.md`.
