# Connector heads + Connector-Path merge — design

Date: 2026-06-13

## Goals

1. **Merge "Connector Path" into the "Connector" control.** Path (`curve` | `step`)
   is already a connector field in the schema; this is a UI consolidation in the
   style strip, not a data change.
2. **Support different connector head shapes** (arrow, database, diamond, circle)
   in addition to today's single closed arrowhead.

Code lives in `packages/canvas` (the canvas package); `apps/web` only embeds it.

## Decisions

- **Head model: keep `direction`, add one shared `headShape` field.** `direction`
  (`forward|backward|both|none`) still decides *which ends* get a head; `headShape`
  decides *what shape*. Simplest for the user (one new concept, the familiar
  Direction control is untouched) and forward-compatible toward per-end shapes
  later. This is the deliberate simpler choice vs. the industry-standard per-end
  model (draw.io / Excalidraw / tldraw all use independent `headStart`/`headEnd`).
- **No migration.** `headShape` is optional; absent ⇒ `'arrow'` ⇒ pixel-identical
  to today. Every existing flow.json keeps working untouched.
- **Shape set v1:** `arrow` (default) + ER crow's-foot endpoints `one` (single
  tick), `many` (fork), `optional-many` (hollow circle + fork) + filled UML-ish
  `diamond` / `circle`. (The cylinder `database` glyph was dropped in favor of
  the ER crow's-foot marks.)

## Schema (`apps/studio/src/schema.ts`)

```ts
const ConnectorHeadShapeSchema = z.enum(['arrow', 'database', 'diamond', 'circle']);
// in ConnectorVisualBaseShape:
headShape: ConnectorHeadShapeSchema.optional(),   // default 'arrow'
export type ConnectorHeadShape = z.infer<typeof ConnectorHeadShapeSchema>;
```

Mirror into `FlowConnectorSchema`. Run `make sync-seeflow-schema` (CI gates on
`make verify-seeflow-schema-sync`). Field rides the MCP tool surface
(`seeflow_add_connector` / `seeflow_patch_connector`) automatically.

## Rendering (`packages/canvas`)

Note: the SVG-`<marker>` approach was abandoned during implementation. React
Flow v12 paints every edge in a single inner `<svg>` it fully re-renders, and it
strips foreign `<defs>` injected there; cross-`<svg>`-root marker refs don't
paint in Chrome (gradients do, markers don't). Verified empirically via DOM
probes. Final approach:

- **Arrow (default):** keeps React Flow's native `MarkerType.ArrowClosed` marker
  — pixel-identical to today, colored per-edge.
- **Custom shapes (one/many/optional-many/diamond/circle):** drawn as
  React-owned SVG inside the edge's own `<g>` by `EditableEdge`, via
  `ConnectorHeadGlyph` (`packages/canvas/src/edges/head-glyph.tsx`). The
  crow's-foot marks are stroke-only; diamond is filled, circle is a hollow ring.
  Persists across re-renders, colors directly from the edge stroke, rotates to
  the endpoint's inward normal. Toggle icons live in `ui/line-style-icons.tsx`.
- **Path trim:** `EditableEdge` pulls the path endpoint back along the face's
  outward normal by each glyph's `HEAD_TRIM` length so the line terminates AT
  the marker (clean terminator) instead of running through it — the drawn-glyph
  equivalent of a native marker's `refX` offset. `one` trims by 0 (the tick
  crosses the line).
- `connector-to-edge.ts`: `headShape === 'arrow'` → native `markerStart/markerEnd`
  per `direction` (unchanged). Custom shapes set `data.headShape` +
  `data.headStart`/`data.headEnd` and leave the native marker slots empty (the
  two paths are mutually exclusive). `DerivedEdge.markerStart/markerEnd` stay
  `EdgeMarker`.

## Style strip (`packages/canvas/src/components/style-strip.tsx`)

Pure-connector column collapses 5 buttons → 3: **Color · Connector · Text · Direction**.

- **Connector** popover gains a *Path* section (Curve / Zigzag) below Style + Width.
  Delete the standalone `style-strip-path` button.
- **Direction** popover gains a *Head shape* section (Arrow / Database / Diamond /
  Circle), disabled when `direction === 'none'`.
- Add `headShape` to `ConnectorStylePatch`; `applyConnectorHeadShape` fans out to
  all selected connectors via `onStyleConnector` (mirrors `applyConnectorDirection`).
- New glyph icons in `line-style-icons.tsx`; `HEAD_SHAPE_OPTIONS` toggle list.

## Wiring

Patch is generic: `demo-view` `onStyleConnector` → `adapter.updateConnector(id, patch)`
forwards the whole patch to the REST PATCH, schema-validated. No per-field plumbing.
`rememberConnectorStyle` already serializes the whole patch, so `headShape` joins the
remembered default for free. `packages/canvas/src/types.ts` re-exports schema types,
so `Connector` picks up `headShape` automatically.

## Tests

- `connector-to-edge.test.ts`: `{direction:'forward', headShape:'database'}` →
  `markerEnd === 'url(#sf-head-database)'`; absent headShape → arrow URL;
  `direction:'none'` → no markers.
- `style-strip` test: Path now under Connector popover; head-shape fan-out;
  disabled when direction none.
- schema round-trip test for `headShape`.
- e2e visual baseline (chromium-linux) of a database-headed connector; confirm
  PNG/PDF export captures `url(#)` markers + `context-stroke`.

Gate on `format` → `lint` → `typecheck` → `bun test` → integration all green.
