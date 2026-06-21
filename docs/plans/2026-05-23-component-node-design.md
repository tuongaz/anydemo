# Component node — json-render-powered reactive UI on the canvas

Date: 2026-05-23
Status: Implemented

## Summary

Add a new flat node type, `'component'`, whose payload is a
[json-render](https://github.com/vercel-labs/json-render) spec. The canvas
renders the spec via a fixed, SeeFlow-shipped catalog (~25 shadcn-styled
primitives plus `Chart` / `Markdown` / `CodeBlock` / `Metric` / `Table`).
Authors write a JSON spec under `nodes/<id>/spec.json` declaring a flat
element tree, optional initial state, and a small action vocabulary; the
runtime renders it, owns the state tree, and dispatches actions (either
local state mutations or script spawns reusing the existing
`ScriptActionSchema` plumbing).

The change is purely additive — the existing 12-tag flat schema, the style
sidecar split, and the capability mixin (`playAction`/`statusAction`/
`stateSource`) all carry over unchanged. The new type sits alongside `html`
and `icon` as a per-type variant; capabilities apply to it like every other
type.

## Goals

- Authors can hand-edit `spec.json` to compose UI from a fixed catalog of
  schema-validated components.
- Components are reactive: prop bindings read from a per-node state tree;
  actions mutate it.
- Two action kinds: declarative `set` (instant, client-side) and `script`
  (spawns a real subprocess, reuses every safety guarantee the existing play
  / status runner already provides).
- Catalog conformance (component names, prop shapes, script paths) is
  enforced by `ResolvedFlowSchema.superRefine`, so bad specs fail
  validation at the studio boundary rather than at render time.
- The renderer leans on `@json-render/shadcn` for the base 16 primitives
  and adds 9 SeeFlow-specific components on top.

## Non-goals

- Per-flow or per-node catalogs. The catalog is shipped, not authored.
- Persisted state. The state tree is volatile: `spec.state` seeds it; page
  reload / canvas remount / global Restart resets it.
- An authoring UI (visual editor) for specs. Authors edit `spec.json`
  directly in v1.
- Sandboxing of script actions — same trust model as `playAction` today.
- Cross-node state syncing (no SSE state mirror).

## Locked decisions

1. **Catalog is built-in (A1).** `@json-render/shadcn` provides the base
   16 primitives. SeeFlow adds 9 custom entries on top. No per-flow / per-node
   catalog files.
2. **Full reactive runtime (I3).** Specs may use `$state`, `$cond`, `watch`,
   `$action` bindings — not just static props.
3. **Spec lives in a sidecar (S1).** `nodes/<id>/spec.json` is the sole
   source of truth on disk; the resolver inlines it into
   `data.spec` when serving the `ResolvedFlow`. The on-disk
   `FlowComponentNodeData` has no `spec` field.
4. **Initial state from spec, mutations volatile (P2).** `spec.state` seeds
   on mount; mutations live in React state; reload resets.
5. **Hybrid actions (X3).** `ComponentActionSchema` is a discriminated
   union: `{ kind: 'set', path, value }` for local mutations or the
   existing `ScriptActionSchema` for spawn-backed actions.
6. **Wrapper chrome opt-in (W1, defaults off).** `'component'` reuses
   `NodeVisualBaseShape`. Visual fields live in `style.json` sidecar; no
   entry = no chrome.
7. **Capability chrome universal.** `'component'` gets the play
   button / status pill on the node frame like every other type, per the
   in-flight refactor making capability chrome universal. The spec's own
   interactivity is independent and can coexist.
8. **Type tag is `'component'`** (single word, matching the flat-types
   naming convention) — not `'componentNode'`.

## Architecture

### Pieces and where they live

```
apps/studio/
  src/
    schema.ts                         # add 'component', ComponentSpecSchema,
                                      # ComponentActionSchema, catalog superRefine
    catalog/component-catalog.ts      # defineCatalog (Zod-only, React-free)
    component-spec-resolver.ts        # externalize on write, inline on read
    component-action-runner.ts        # POST /api/.../actions/:name → spawn

packages/canvas/
  src/nodes/
    component-node.tsx                # canvas node wrapper + capability chrome
    component-runtime.tsx             # <Renderer> + state store + dispatch
  src/registry/
    component-registry.tsx            # defineRegistry — shadcn + SeeFlow extras

<project>/                            # author-owned per-flow
  flow.json                           # component entry by id; no spec field
  style.json                          # optional visual overrides
  nodes/<id>/
    spec.json                         # json-render spec + state + actions
    actions/<name>.{ts,sh,py,...}     # script-kind action files (optional)
```

The catalog file lives in `apps/studio/` (not `packages/canvas/`) so the
studio's schema validator can import it without pulling in React. The
registry in `packages/canvas/` imports the same catalog and implements each
entry against shadcn (via `@json-render/shadcn`) plus the SeeFlow extras.

## Schema additions (`apps/studio/src/schema.ts`)

```ts
// --- New shared types ---------------------------------------------------

export const ComponentSpecElementSchema = z.object({
  type: z.string().min(1),
  props: z.record(z.string(), z.unknown()).optional(),
  children: z.array(z.string()).optional(),
  watch: z.record(z.string(), z.unknown()).optional(),
});

export const ComponentActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('set'),
    path: z.string().min(1),   // JSON Pointer
    value: z.unknown(),        // literal or {$param}/{$state}
  }),
  ScriptActionSchema,
]);

export const ComponentSpecSchema = z.object({
  root: z.string().min(1),
  elements: z.record(z.string(), ComponentSpecElementSchema),
  state: z.record(z.string(), z.unknown()).optional(),
  actions: z.record(z.string(), ComponentActionSchema).optional(),
});

// --- Per-type data ------------------------------------------------------

const ResolvedComponentNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,          // merged in from style.json
  ...NodeCapabilitiesShape,        // play/status/stateSource come free
  spec: ComponentSpecSchema,       // populated by the resolver
  autoSize: z.boolean().optional(),
});

const FlowComponentNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    ...NodeCapabilitiesShape,
    autoSize: z.boolean().optional(),
    // No `spec` — sidecar is the source of truth.
  })
  .strict();

// --- Discriminated-union entries ---------------------------------------

export const NodeTypeSchema = z.enum([
  ...GEOMETRIC_NODE_TYPES, 'image', 'html', 'icon', 'component',
]);

// In NodeSchema (Resolved):
z.object({ ...NodeBaseShape, type: z.literal('component'),
           data: ResolvedComponentNodeData });

// In FlowNodeSchema (on-disk):
export const FlowComponentNodeSchema = z
  .object({ ...FlowNodeBaseShape, type: z.literal('component'),
            data: FlowComponentNodeData })
  .strict();
```

### superRefine additions on `ResolvedFlowSchema`

For each `'component'` node:

- Every `data.spec.elements[*].type` must exist in `componentCatalog.components`.
- Every `data.spec.elements[*].props` must satisfy that component's Zod prop
  schema (issues are re-pathed into the spec for friendly error messages).
- Every script-kind action's `scriptPath` must start with `nodes/<id>/`
  (mirrors the existing `image` path rule).

## `spec.json` example

A tabbed status panel with a refresh button:

```json
{
  "root": "panel",
  "state": {
    "/tab": "metrics",
    "/lastRefresh": null,
    "/queueDepth": 0
  },
  "actions": {
    "switchTab": { "kind": "set", "path": "/tab", "value": { "$param": "to" } },
    "refresh": {
      "kind": "script",
      "interpreter": "bun",
      "scriptPath": "nodes/abc/actions/refresh.ts",
      "timeoutMs": 5000
    }
  },
  "elements": {
    "panel":        { "type": "Card",   "props": { "title": "Queue Status" },
                      "children": ["tabs", "refresh-btn"] },
    "tabs":         { "type": "Tabs",   "props": {
                        "value": { "$state": "/tab" },
                        "items": [
                          { "id": "metrics", "label": "Metrics" },
                          { "id": "logs",    "label": "Logs" }
                        ],
                        "onChange": { "$action": "switchTab" }
                      },
                      "children": ["depth-metric"] },
    "depth-metric": { "type": "Metric", "props": {
                        "label": "Depth",
                        "value": { "$state": "/queueDepth" }
                      } },
    "refresh-btn":  { "type": "Button", "props": {
                        "label": "Refresh",
                        "onClick": { "$action": "refresh" }
                      } }
  }
}
```

Conventions:

- **`/path` strings = JSON Pointer** into the state tree. Matches json-render's
  native `$state` / `watch` convention.
- **`{ "$state": "/path" }`** — read a state value into a prop, resolved at
  render time.
- **`{ "$action": "name" }`** — bind a prop slot (`onClick`, `onChange`) to a
  registered action. The runtime wraps it as
  `(payload) => dispatch(name, payload)`. The payload is available inside the
  action as `{ "$param": "..." }`.
- **`{ "$cond": {...}, "$then": ..., "$else": ... }`** and **`watch:`** —
  json-render-native, passed through unchanged.
- **Actions live in the same file as the spec** — keeps `flow.json` semantic-
  only and scopes the action name space to the spec.

## Runtime behavior

### Mount lifecycle (per `component` node)

1. ResolvedFlow arrives via the existing API; `data.spec` is already inlined.
2. `<ComponentRuntime spec={data.spec} nodeId={id}>` wraps the tree. Each
   node owns its own runtime — no cross-node state leakage.
3. State store seeds from `spec.state ?? {}`.
4. Action dispatcher is built from `spec.actions ?? {}`.
5. `<Renderer spec registry state dispatch />` renders against
   `componentRegistry` from `@json-render/react`.

### Prop resolution pass (every render)

The runtime walks `spec.elements[*].props`. Each value is either a literal
(passed through) or a reference (`$state`, `$cond`, `$action`). References
resolve against the current state snapshot and the dispatcher before being
handed to the registry component. `$action` resolves to
`(payload) => dispatch(actionName, payload)`; components don't know whether
the handler is local or script-backed.

### Action dispatch — `set` actions

- Resolve `value` against `$param` / `$state` references using the call
  payload + current state.
- Deep-set the state tree at `path`.
- Trigger a re-render; bound props re-resolve.
- Fully synchronous, no I/O.

### Action dispatch — `script` actions

- Frontend POSTs to `POST /api/projects/:id/nodes/:nodeId/actions/:name`
  with the call payload as the body.
- Server resolves `scriptPath`, applies the existing symlink/realpath
  defense, spawns with the payload on stdin (default 5s timeout, override
  via per-action `timeoutMs`).
- Script writes a JSON object to stdout. Server parses, returns as HTTP
  response.
- Client deep-merges the response into the state tree → re-render.
- Errors (non-zero exit, parse failure, timeout) write to
  `/__errors/<actionName>` so authors can bind `$state` to error messages.
  The studio also logs to its existing per-node log stream.

### Capability chrome

`'component'` renders capability chrome (play button, status pill) on the
node frame like every other type, per the in-flight universal-chrome
refactor. The frame-level chrome invokes the node's top-level `playAction`
/ `statusAction` (`NodeCapabilitiesShape` fields), which is independent of
the spec's own interactivity. Authors can wire both: a frame play button to
seed the node, plus spec-level `Button`s wired to `script` actions.

## Catalog (~25 components)

| Group | Components | Source |
|---|---|---|
| Layout | `Card`, `Separator`, `Tabs`, `Accordion` | shadcn |
| Display | `Badge`, `Avatar`, `Progress`, `Skeleton`, `Label` | shadcn |
| Display (extras) | `Heading`, `Text`, `Icon` | SeeFlow |
| Data viz | `Chart` (bar/line/area/pie), `Table`, `Metric` | SeeFlow |
| Code / prose | `CodeBlock`, `Markdown` | SeeFlow |
| Inputs | `Button`, `Input`, `Checkbox`, `Switch`, `Select`, `Textarea`, `Slider` | shadcn |

**Excluded**: any portaling component (Dialog, Sheet, Toast, Popover,
HoverCard, Tooltip) — they break out of the React Flow node bounding box.

The catalog file (`apps/studio/src/catalog/component-catalog.ts`) is the
single source of truth — both the studio's superRefine and the canvas's
registry import from it. The catalog depends only on `@json-render/core` +
`zod`, keeping the studio bundle React-free.

## Studio additions

### Spec resolver (`component-spec-resolver.ts`)

- **On write**: persist `data.spec` to `nodes/<id>/spec.json` (atomic
  temp+rename, pretty-printed). Strip `data.spec` from the in-memory node
  before persisting to `flow.json` (the strict on-disk schema has no
  `spec` field).
- **On read**: for each `'component'` node, read `spec.json`, parse, attach
  to `data.spec`. Missing file → emit a `ResolvedFlow` validation error at
  `nodes/<id>/data/spec` so the frontend renders a clean error rather than
  a blank node.
- **On node delete**: `removeNodeDir` already nukes `nodes/<id>/` — covers
  `spec.json` and the `actions/` subdir for free.

### Action runner (`component-action-runner.ts`)

`POST /api/projects/:id/nodes/:nodeId/actions/:actionName`:

```ts
const node = await getNode(projectId, nodeId);
if (node.type !== 'component') return 400;
const action = node.data.spec.actions?.[actionName];
if (!action) return 404;
if (action.kind !== 'script') return 400;  // 'set' is client-only

const payload = await req.json();
const result = await spawnScript({
  cwd: projectRoot,
  interpreter: action.interpreter,
  args: action.args,
  scriptPath: action.scriptPath,            // realpath-checked
  stdin: JSON.stringify(payload),
  timeoutMs: action.timeoutMs ?? 5000,
});
if (result.exitCode !== 0) return 500 { error: result.stderr };
return 200 with JSON.parse(result.stdout);
```

Reuses the existing `spawnScript` primitive (same symlink/realpath defense,
same logging stream, same timeout machinery as play/status/reset).

### NodePatch wiring

- Extend `ALLOWED_PATCH_FIELDS_BY_TYPE` to allow `spec` and `autoSize` for
  `'component'`.
- `mergeNodeUpdates`: when `data.spec` is in a patch body, the resolver
  write hook persists it to `spec.json` and strips it from the merged
  record before the strict-schema validation.

### Auto-exposed surfaces

`seeflow schema node` and the MCP tool surface get `'component'` for free
via the existing schema reflection — no per-type wiring required.

## Dependencies (additive)

| Package | Why | Approx min-gzip |
|---|---|---|
| `@json-render/core` | catalog + runtime primitives | ~5 KB |
| `@json-render/react` | `<Renderer>` adapter | ~8 KB |
| `@json-render/shadcn` | 16 shadcn-styled implementations | ~25 KB (subset) |
| `recharts` | `Chart` (lazy) | ~50 KB |
| `react-markdown` + `remark-gfm` | `Markdown` (lazy) | ~25 KB |
| `shiki` | `CodeBlock` (lazy) | ~30 KB |

`@json-render/shadcn` brings the Radix dependency tree it needs. Lazy-load
`recharts` / `react-markdown` / `shiki` from the registry so canvases
without those components don't pay the cost.

## What is NOT changing

- No new SSE channel — script-action responses come back over HTTP. SSE
  stays for status reports.
- No new auth/permissions story — the spawn defense is identical to
  play/status.
- No new storage location — everything under `nodes/<id>/`, cleaned by
  existing cascades.
- No flat-types schema changes beyond adding `'component'`.

## Testing surface (per implementation plan, not this design)

- Schema: round-trip Flow ↔ ResolvedFlow with `'component'` nodes, catalog
  superRefine rejects unknown components, mismatched props, and script
  paths outside `nodes/<id>/`.
- Resolver: write → read → render round-trip; missing-file error path.
- Action runner: `set` (client-only) vs `script` (HTTP round-trip);
  realpath defense; timeout; stderr surfacing.
- Catalog: snapshot the rendered output for each component at default
  props (chromium-linux baseline, per CLAUDE.md).
- E2E: a component node with at least one `set` action and one `script`
  action; verify state updates round-trip.

## Open questions deferred to implementation

- Exact state-store choice (`useReducer` keyed by Pointer vs.
  zustand-per-instance) — depends on what the canvas already uses for local
  state.
- Whether `Avatar` ships shadcn-backed or SeeFlow-custom (depends on the
  shadcn impl's portaling behavior).
- Lazy-load granularity for the heavy components (per-component vs.
  per-group bundle).
