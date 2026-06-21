# ELK-backed auto-layout

Replace the LLM-authored positions and dagre Tidy with one ELK-backed
endpoint that every caller — `/seeflow` skill, `assembleDemo`, the canvas
Tidy button — shares.

## Problem

`/seeflow`-generated flows ship with overlapping nodes and connectors that
cut through unrelated nodes. Today the LLM hand-writes `style.json`
positions using the "longest-path layering" prose in
`skills/seeflow/references/schema.md`. There is no real layout algorithm,
so hub-and-spoke graphs, branches, and duplicated resource nodes wreck
readability. Existing flows show heavy manual drag-correction (decimal
coordinates from user fixes).

The web Tidy button and the studio's `assembleDemo` each use **dagre**
with `nodesep: 60, ranksep: 140`. Dagre lays out layers but does not
route edges around nodes, so dense graphs still draw connectors through
boxes.

## Library choice

**`elkjs`** — the Eclipse Layout Kernel ported to JavaScript. Used by
drawio, Sprotty, VS Code flow diagrams. Pure JS (~500KB), no native
deps, runs under Bun. The `layered` algorithm is the Sugiyama-style
hierarchical layout with crossing minimisation and orthogonal edge
routing — the part that fixes "edges go through nodes."

Dagre stays out: lighter (~50KB) but produces the symptom we are trying
to fix.

## Architecture

One canonical implementation in `apps/studio/src/layout.ts`. Every
caller goes through the same HTTP endpoint:

- `/seeflow` skill — `curl POST /api/layout` in Phase 3 and Phase 5.
- `assembleDemo` (`apps/studio/src/diagram.ts`) — `await computeLayout(...)`.
- Canvas Tidy button — `await adapter.computeLayout(...)`, where the
  REST adapter calls the endpoint.

The canvas package never imports `elkjs`; layout requests route through
the `CanvasAdapter` seam, honouring the package rule that no `fetch`
lives inside the canvas.

### Layout policy

- **Reflow everything every `/seeflow` run.** Existing user-dragged
  positions get overwritten on the next skill run for that slug.
  Predictable, no half-pinned ugly layouts.
- **Tidy is opt-in for existing flows.** Old `style.json` files keep
  working. Pressing Tidy migrates them.
- **Direction:** left-to-right (matches today's convention).
- **Output:** positions + handle sides (`r|l|t|b`). No edge waypoints —
  React Flow renders edges between handles using its own renderer.

### ELK configuration

```
elk.algorithm                              = layered
elk.direction                              = RIGHT
elk.portConstraints                        = FIXED_SIDE
elk.layered.spacing.nodeNodeBetweenLayers  = 220
elk.spacing.nodeNode                       = 140
elk.spacing.edgeNode                       = 60
elk.spacing.edgeEdge                       = 30
elk.spacing.edgeLabel                      = 12
elk.layered.edgeLabels.sideSelection       = SMART_DOWN
elk.edgeRouting                            = ORTHOGONAL
elk.separateConnectedComponents            = true
```

Generous spacing leaves room for connector labels and orthogonal
segments. Disconnected components are stacked vertically with a 60px
gap.

### Node dimensions fed to ELK

- `playNode` / `stateNode` — 220×100
- `shapeNode` — 160×80 (text shape uses 160×40, sticky 160×180)
- `iconNode` — 80×80
- `htmlNode` — declared `width`/`height` or 320×200
- `imageNode` — 200×150

If a node carries explicit `data.width` / `data.height`, those win. The
canvas Tidy handler additionally reads `inst.getInternalNode(id).measured`
for live React Flow dimensions, so resized nodes get accurate gutters.

## Endpoint contract

`POST /api/layout`

### Request

```json
{
  "flow": { "version": 2, "nodes": [...], "connectors": [...] },
  "options": {
    "direction": "RIGHT",
    "spacing": { "layer": 220, "node": 140 }
  }
}
```

`options` is optional; defaults match the ELK config above. Future hook
for top-to-bottom flows without changing the endpoint.

### Response (success)

```json
{
  "ok": true,
  "nodes": {
    "checkout-api":  { "position": { "x": 0,   "y": 240 } },
    "payments":      { "position": { "x": 380, "y": 240 } }
  },
  "connectors": {
    "c1": { "sourceHandle": "r", "targetHandle": "l" }
  }
}
```

Coordinates are integers (rounded post-ELK). Handles use the existing
`r|l|t|b` vocabulary from `schema.md`.

### Response (failure)

```json
{
  "ok": false,
  "issues": [
    { "path": "flow.connectors[3].source", "message": "unknown node id 'foo'" }
  ]
}
```

Matches the existing `/api/validate` issue shape so the skill's error
path reuses the same code.

### Behaviour

- Zod-validates the input first; invalid flows return issues without
  invoking ELK.
- Pure compute — no DB writes, no side effects. Safe to call repeatedly.
- Decorative nodes not in the connector graph (sticky notes, legends)
  get placed in a right-side column at `x = maxLayoutX + 200` instead
  of stacking at `(0,0)`.

## Module: `apps/studio/src/layout.ts`

```ts
import ELK from 'elkjs/lib/elk.bundled.js'
import type { FlowJSON } from './schema'

export type LayoutResult = {
  nodes:      Record<string, { position: { x: number; y: number } }>
  connectors: Record<string, {
    sourceHandle: 'r'|'l'|'t'|'b'
    targetHandle: 'r'|'l'|'t'|'b'
  }>
}

export async function computeLayout(
  flow: FlowJSON,
  options?: LayoutOptions,
): Promise<LayoutResult>
```

Uses `elk.bundled.js` (synchronous, no worker) — Bun supports workers
but the server endpoint is simpler without one. Expected runtime: under
50ms for flows below 50 nodes.

Pipeline:

1. Measure nodes using the defaults above (or explicit dimensions).
2. Build an ELK graph: each node gets four pre-declared ports
   (`r/l/t/b`) so port assignments map back to React Flow handles
   without parsing ELK's port-id naming convention.
3. Apply layout options.
4. `await elk.layout(graph)`.
5. Round positions to integers; read `sourcePort`/`targetPort` ids to
   derive the `r|l|t|b` letter.
6. Append decorative-only nodes in a right-side column.

ELK is deterministic given identical input ordering; sort node and edge
arrays before passing to ELK as a safety net.

## Skill changes

`skills/seeflow/SKILL.md`:

- **Phase 3, step 2** — replace the prose about hand-generating
  positions with:

  ```bash
  LAYOUT=$(curl -fsS -X POST "$STUDIO_URL/api/layout" \
    -H 'content-type: application/json' \
    -d "$(jq -n --slurpfile a "$flowDir/flow.json" '{flow: $a[0]}')")
  echo "$LAYOUT" | jq -e '.ok' >/dev/null \
    || { echo "$LAYOUT" | jq '.issues' >&2; exit 1; }
  echo "$LAYOUT" | jq '{nodes, connectors}' > "$flowDir/style.json"
  ```

- **Phase 5, step 3** — same `curl` after `newTriggerNodes` get spliced.
  Full reflow, no merge.

`skills/seeflow/references/schema.md`:

- Delete the "Deterministic position generation" section.
- Replace with one paragraph: *positions and connector handles come
  from `POST /api/layout`. The skill calls this endpoint in Phase 3 and
  Phase 5; the response is written verbatim to `style.json`. Manual
  position fields stay honoured if present.*

`skills/seeflow/agents/seeflow-node-planner.md`:

- Strip any layout-related guidance. Planner stays pure-reasoning about
  *which* nodes exist; positioning is the studio's job.

## Canvas changes

`packages/canvas/src/adapter/types.ts` — extend `CanvasAdapter`:

```ts
computeLayout(
  nodes: readonly AutoLayoutNode[],
  edges: readonly AutoLayoutEdge[],
  opts?: AutoLayoutOptions,
): Promise<Map<string, {
  position: { x: number; y: number }
  sourceHandle?: 'r'|'l'|'t'|'b'
  targetHandle?: 'r'|'l'|'t'|'b'
}>>
```

`packages/canvas/src/lib/auto-layout.ts` — keep as the type-only home
for `AutoLayoutNode` / `AutoLayoutEdge` / `LayoutDirection`. Delete the
dagre `applyLayout` function and drop `dagre` from
`packages/canvas/package.json`.

`packages/canvas/src/components/seeflow-canvas.tsx` (line 3221) and
`apps/web/src/pages/demo-view.tsx` (line 2291) — both Tidy handlers
replace `applyLayout(...)` with `await adapter.computeLayout(...)`. The
offset-anchoring math that keeps a selection-scoped Tidy from
teleporting the cluster runs on the awaited result. Returned handles
feed the existing `sourcePin`/`targetPin` adapter calls inside the same
batched undo entry, so one Cmd+Z reverts positions and handle changes
together.

`apps/web/src/lib/api.ts` (or wherever the REST adapter lives) —
implement `computeLayout` as a `POST /api/layout` call.

## `assembleDemo` migration

`apps/studio/src/diagram.ts` — replace the dagre block at lines
248–325 with `await computeLayout(...)`. `assembleDemo` becomes async;
its tests get `await`-ed. Same node-dimension defaults move into
`computeLayout`.

## Implementation order

Each step ships independently and leaves the system working.

1. **`apps/studio/src/layout.ts` + tests.** Pure compute, no callers.
2. **`POST /api/layout` endpoint + tests.** Wires `computeLayout` into
   `api.ts`.
3. **`assembleDemo` migration.** Swap dagre for `computeLayout`. Proves
   the new engine on the older code path.
4. **Skill cutover.** Update `SKILL.md` Phase 3 + Phase 5 and the
   `schema.md` prose.
5. **`CanvasAdapter.computeLayout` + REST impl.** Adapter method and
   fetch impl. No behavioural change yet.
6. **Tidy button cutover.** Replace `applyLayout` calls with
   `await adapter.computeLayout`. Apply returned handles via existing
   pin adapter calls.
7. **Delete dagre.** Remove from both `package.json` files, delete
   dagre-using code in `auto-layout.ts`, drop the
   "Deterministic position generation" section from `schema.md`.

## Tests

| Layer | Test |
|---|---|
| `layout.ts` | Snapshot on `examples/order-pipeline` and `examples/ecommerce-platform`; regenerate, eyeball-review |
| `layout.ts` | Determinism: two runs on identical input return identical output |
| `layout.ts` | Edge cases: 0 nodes, 1 node, disconnected components, self-loop, parallel edges |
| `layout.ts` | Decorative-only graph (sticky + image, no connectors) — right-side column, no `(0,0)` pileup |
| `api.ts` | `POST /api/layout` 200 path with a small fixture |
| `api.ts` | `POST /api/layout` 400 path returns `{ok:false, issues:[...]}` matching `/api/validate` shape |
| `diagram.test.ts` | Updated snapshots after `assembleDemo` migration; assert `assembleDemo` is now async |
| `auto-layout.test.ts` | Replaced with type-only tests (or deleted) |
| `seeflow-canvas.tsx` test | Tidy button calls `adapter.computeLayout` once; offset-anchoring still works on awaited result |
| `demo-view.tsx` test | Selection-scoped Tidy doesn't teleport the cluster |

## Migration of existing flows

Old `style.json` files keep working — nothing auto-reflows on load.
Users press Tidy to opt into the new layout. The skill always reflows
on the next `/seeflow` run for a given slug.

Snapshot tests in `diagram.test.ts` will fail after step 3 because ELK
lays out the same input differently than dagre. Regenerate them, review
the canvases visually, commit. A layout-quality metric (edge crossings,
edge-node overlaps) is over-engineering for a one-time migration; if
layout quality regresses later, snapshot diffs catch it.

## What gets deleted

- `dagre` dep from `apps/studio/package.json` and
  `packages/canvas/package.json`.
- `dagre.layout()` blocks in `apps/studio/src/diagram.ts` and
  `packages/canvas/src/lib/auto-layout.ts`.
- "Deterministic position generation" section in
  `skills/seeflow/references/schema.md`.
