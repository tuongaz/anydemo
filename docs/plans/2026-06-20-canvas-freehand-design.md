# Freehand (handwriting / pen) support in `@seeflow/canvas`

**Date:** 2026-06-20
**Status:** Design approved, pending implementation
**Scope:** `packages/canvas` + schema in `apps/studio/src/schema.ts`

## Goal

Add a freehand pen tool to the canvas: capture freehand strokes (mouse / touch /
stylus) and render them as smooth, pressure-variable ink. Strokes are first-class
nodes so they inherit selection, move, resize, restyle, delete, undo/redo,
copy/paste, persistence, and export with zero new plumbing.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| What "hand writing" means | Freehand pen/ink drawing (not OCR, not stylus text input) |
| Data model | A new schema-defined `freehand` **node type** |
| Rendering | **perfect-freehand** (~5kb, zero-dep) as an optional, dynamic-imported peer dep |
| Post-draw editing | **Whole-stroke only** — no per-point reshaping, no eraser (YAGNI) |

## Key architectural fact

SeeFlow persists each node across **two files**:

- `flow.json` (`FlowSchema`) — structural/semantic content: `id`, `type`, and a
  per-type `data` bag (name/description/detail/icon, capabilities, per-type fields).
- `style.json` (`StyleSchema`) — presentation side-table keyed by node id:
  `position`, `width`, `height`, colors, and — already present for icon nodes —
  **`color` (ColorToken) and `strokeWidth` (0.5–4)**.

Consequence: freehand reuses the existing style plumbing for position, size,
color, and width. The only schema addition is a `points` field in `flow.json`.

---

## Section 1 — Data model & schema

New flat node type `'freehand'`, **separate from `GEOMETRIC_NODE_TYPES`** (it
carries `points` and has no header/label/handle chrome).

`flow.json` — new per-type data:

```ts
const FlowFreehandNodeData = z.object({
  ...NodeSemanticBaseShape,   // optional name/description/detail (sidebar)
  ...NodeCapabilitiesShape,   // optional play/status — free, consistent
  points: z.array(z.tuple([z.number(), z.number(), z.number()]))  // [x, y, pressure]
    .min(2),
}).strict();
```

- Points are **normalized to the node's local box**: each `x`, `y` in `0..1`,
  `pressure` in `0..1`. Normalization is what makes resize "just work" — scaling
  the box scales the rendered path, no point rewriting.
- Pressure comes from `PointerEvent.pressure`, falling back to perfect-freehand's
  velocity simulation when a mouse reports `0`.

`style.json` — **no change**. `position`, `width`, `height`, `color`,
`strokeWidth` already exist and map directly onto perfect-freehand's box + fill +
base size.

Registration touch-points:

- `NodeTypeSchema` enum — add `'freehand'`.
- `ResolvedFreehandNodeData` (in-memory variant).
- `FlowFreehandNodeSchema` + add it to the `FlowNodeSchema` **and**
  `ResolvedFlowSchema` discriminated unions.
- `make sync-seeflow-schema` (mirror into `skills/seeflow/vendored/schema.ts`);
  CI gates on `make verify-seeflow-schema-sync`.

Out of scope: no sidecar file (unlike html/image/component). Point arrays are pure
data, RDP-simplified at commit time, so inline in `flow.json` is fine.

---

## Section 2 — Rendering (`FreehandNode`)

New `src/nodes/freehand-node.tsx`, registered in the `nodeTypes` map in
`seeflow-canvas.tsx`.

Render path:

1. Read `data.points` (0..1) + resolved `width`/`height`; denormalize to local px.
2. Feed to `getStroke()` from perfect-freehand, parameterized by `size` (from style
   `strokeWidth`) plus fixed `thinning`/`smoothing`/`streamline` constants held in a
   module-level `FREEHAND_STROKE_OPTIONS` (mirrors how `FIT_VIEW_OPTIONS` centralizes
   config).
3. Convert the outline polygon to an SVG path `d`; render one
   `<path fill={colorVar}>` inside an `<svg>` filling the node box (`viewBox` = local
   box, `width/height: 100%`).

perfect-freehand is an **optional peer dep**, dynamic-imported like
`mermaid`/`recharts`/`shiki`:

- `peerDependencies` + `peerDependenciesMeta['perfect-freehand'].optional = true` +
  `devDependencies` + **`tsup.config.ts` `external`** (CLAUDE.md: forgetting
  `external` doubles `dist/index.js`).
- Module-singleton dynamic import with `.catch(() => null)`; until it resolves,
  fall back to a plain `<polyline>` through the raw points (the
  `IconifyOrPlaceholder` pattern).

Color resolves through the existing `ColorToken` → CSS-var path (same `COLOR_TOKENS`
the style-strip writes). No node chrome: no header/border/resize box by default;
selection uses the standard React Flow selection outline over the bounding box
(whole-stroke selection). Renders identically in `edit`/`view`/`mini` — only
*creating* strokes is edit-only.

---

## Section 3 — Pen tool & capture gesture

Entering pen mode: add a `'pen'` armed tool to the toolbar (a `Pencil` Lucide icon,
new `tool.pen` CommandId for tooltip/shortcut). Clicking it arms freehand capture and
sets a crosshair cursor.

Capture: the existing `onPointerDown/Move/Up` in `seeflow-canvas.tsx` only record
start+current corners for box-drag node creation. Freehand needs the full path, so we
branch on the armed pen tool:

- `onPointerDown` (on `.react-flow__pane`): begin a stroke, push first
  `{x, y, pressure}` (client coords), `setPointerCapture` (wrapped in try/catch — the
  existing code already does this for synthetic test events).
- `onPointerMove`: append each sample to `strokePointsRef`; update a live-preview so
  the in-progress stroke renders immediately.
- `onPointerUp`: commit.

Live preview reuses the existing ghost-overlay slot (today `drawStart`/`drawCurrent`
render `canvas-draw-ghost`), rendering the in-progress stroke through the same
`getStroke()` path in screen space so what you draw is exactly what commits (the
"ghost matches placed node" / connection-preview-mirrors-commit discipline).

Commit (`onPointerUp`):

1. Project every captured client point through `rfInstance.screenToFlowPosition` →
   flow coords (same zoom-correct projection the box-create path uses).
2. Compute bounding box → `position` + `width`/`height`.
3. Normalize points into the box (0..1); **simplify via RDP** to drop redundant
   samples.
4. Discard as an accidental click if below a min length/extent threshold (mirrors
   `MIN_DRAW_SIZE`).
5. **Stay in pen mode** for continuous drawing (drawing multiple strokes is the common
   case). **Esc** or reselecting Select exits — a deliberate difference from shape
   tools, which exit after one commit.

`touch-action: none` on the pane while pen is armed so touch/stylus drawing doesn't
pan the canvas.

---

## Section 4 — Persistence, adapter & history

Creation routes through the adapter seam (canvas never calls `fetch` directly).
Existing `CanvasAdapter.createNode(input: NodeCreateInput)` already takes `type`,
`position`, `width`, `height`, `data`. Freehand reuses it:
`createNode({ type: 'freehand', position, width, height, data: { points } })`.
Confirm whether `NodeCreateInput` needs a typed `points` passthrough or its existing
`data` bag already carries it. **No new adapter method.**

Studio write path: the create handler splits the resolved node into `flow.json`
(`data.points` + semantic) and `style.json` (`position`/`width`/`height`/`color`/
`strokeWidth`) via the existing resolver/writer — the same split every node goes
through. Because we reused existing style fields, no writer changes for color/width.
Verify the writer is data-driven (no per-type branch needed); add a `freehand` branch
only if per-type handling exists.

History/undo: creation/move/resize/restyle/delete flow through the already-wrapped
adapter, so undo/redo come free via `wrapAdapterWithHistory`. Because freehand uses
the existing `createNode`/`patchNode`/`deleteNode` (not a new optional adapter field),
**no `wrap-adapter.ts` change** is needed. Confirm during implementation.

Restyle: the style-strip already writes `color` + `strokeWidth` via `onStyleNode` and
already branches per node type (icons show exactly color + strokeWidth — the same
control set freehand wants). Reuse that branch → **no new style plumbing**.

MCP/CLI: once in the schema, `seeflow_add_node` + validation accept `freehand`
automatically. Programmatic point authoring is niche; the value is the interactive
pen.

---

## Section 5 — Testing, accessibility & rollout

Unit (beside sources, `bun test`):

- `freehand-node.test.tsx` — denormalize→`getStroke`→path render; missing-peer-dep
  fallback to `<polyline>`; color/strokeWidth resolution; renders in all three modes.
- `freehand-geometry.ts` + test — bounding box, normalize/denormalize round-trip, RDP
  simplification, min-extent click rejection (pure functions).
- `schema.test.ts` — `FlowFreehandNodeSchema` accept/reject (≥2 points, normalized
  ranges), discriminated-union round-trip.
- `seeflow-canvas.test.tsx` — hook-shim suite. **Any new `useState` slot must be
  appended at the END** of the component body (CLAUDE.md `useStateOverrides[N]` rule).
  Prefer a `useRef` + the existing ghost-state slot to avoid adding a slot at all.

Integration (`apps/studio/integration/*.it.ts`): create a freehand node via the API,
assert the `flow.json`/`style.json` split round-trips.

E2E (`apps/studio/e2e/*.e2e.ts`, Playwright): arm pen, dispatch a pointer path, assert
a `freehand` node commits; a visual baseline pinned to chromium-linux (regenerate via
Docker `test:it:update-snapshots`).

Accessibility: the SVG path gets `role="img"` + `aria-label` from `data.name` (or
"Freehand drawing"). Pen-tool button gets tooltip/aria via the CommandId registry.

Schema sync gate: `make sync-seeflow-schema` after the schema edit; CI gates on
`make verify-seeflow-schema-sync`.

## Rollout order

1. Schema + `make sync-seeflow-schema`.
2. Renderer + peer dep + missing-dep fallback.
3. Toolbar pen tool + CommandId.
4. Capture gesture + live preview + commit (RDP, min-extent, stay-armed).
5. Style-strip wiring (color + strokeWidth branch).
6. Tests + visual baselines.

Each step is independently shippable and testable.

## Out of scope (explicit)

- Handwriting → text recognition (OCR).
- Stylus-to-text input into fields.
- Per-point vertex reshaping.
- Eraser tool / stroke splitting.
- Separate non-node ink/annotation layer.
- Sidecar file storage for points.
