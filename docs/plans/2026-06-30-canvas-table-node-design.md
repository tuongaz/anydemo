# Canvas Table Node — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorm)
**Scope:** `packages/canvas` + `apps/studio` schema. Additive feature, no flag.

## Summary

Add a Miro-style **visual table** as a new canvas node type (`type: 'table'`).
It is a whiteboard/diagramming element — a grid of plain-text cells with
table-level styling — not a spreadsheet, data grid, or live data-bound view.
Users drop a table from the toolbar, edit cells inline, drag column/row borders
to resize, and add/remove rows and columns via hover "+" rails and a per-cell
menu.

### Decisions locked in brainstorm

| Question | Decision |
| --- | --- |
| Table kind | **Visual grid (Miro-style)** — cells hold text; not data-bound |
| Cell richness | **Plain text + table-level style**; per-cell color deferred |
| Sizing/resize | **Drag column/row borders** — per-column widths + per-row heights |
| Add/remove UX | **Hover "+" on edges + per-cell menu** (insert/delete row & column) |
| Library | **Custom build — no table dependency** |
| Persistence | **Coarse whole-`data` `updateNode`** (no granular adapter ops) |
| Delete semantics | Cell selected → clear text; node selected → delete table |

## Data model

New node type `table`, discriminated by the top-level `type` field like every
other node. Follows the existing **semantic (flow.json) vs visual (style.json)**
split used by geometric nodes (which externalize `width`/`height`).

**Semantic (flow.json)** — structure & content:

```ts
{
  columns: Array<{ id: string }>,    // order = array order
  rows:    Array<{ id: string }>,    // order = array order
  cells:   Record<string, string>,   // key `${rowId}:${colId}` -> text; empty omitted
  headerRow?: boolean,               // first row rendered as a header
}
```

**Visual (style.json, resolved into the node)** — sizing & styling:

```ts
{
  colWidths:  Record<string, number>,  // by column id
  rowHeights: Record<string, number>,  // by row id
  borderColor?, borderSize?, borderStyle?,
  fontSize?, fontFamily?, textAlign?,
  headerBg?: ColorToken, cornerRadius?, shadow?,
}
```

**Rationale**

- **Stable ids over a 2D `string[][]`** — inserting a column in the middle,
  deleting a row, or resizing must not churn array indices. Ids keep each cell's
  text attached to the right place across structural edits.
- **Sparse `cells` map** — empty cells are simply absent; no padding.
- **Derived size** — `width = Σ colWidths + borders`, `height = Σ rowHeights +
  borders`. No separate `width`/`height` field to keep in sync.
- **flow.json/style.json symmetry** — structure is semantic, sizing/styling is
  visual, matching the resolver pattern so the on-disk/in-memory schemas stay
  symmetric.

**Defaults on create:** 3 columns × 3 rows, ~120px wide × ~40px tall cells,
`headerRow: true`. A drag-create distributes the dragged width/height across the
seed columns/rows; a plain click uses the defaults.

## Rendering & interactions

New component `packages/canvas/src/nodes/table-node.tsx`, registered in the
`nodeTypes` map in `seeflow-canvas.tsx`. Rendered as a plain HTML `<table>` /
CSS grid with Tailwind `sf:` classes (no SVG) so text selection and
`contentEditable` work natively. Grid track sizes come from
`colWidths`/`rowHeights`; React Flow handles position/zoom.

**Cell editing** — mirrors the inline-name edit on `rectangle-node`:

- Single-click selects a cell; double-click or Enter enters `contentEditable`.
- Tab / Shift-Tab move across cells; Enter commits + moves down; Esc cancels.
- Commit writes whole `data` via `adapter.updateNode(id, patch)` — optimistic
  override first, SSE echo reconciles. No new adapter method.

**Resize (drag borders)** — ~5px hover hit-zones on each column/row boundary,
marked `nodrag` so they don't move the node:

- Drag updates the single `colWidths[id]` / `rowHeights[id]` live (local state),
  commits on pointer-up.
- Min cell width/height clamp (~40px) so borders stay grabbable and header
  visible.

**Add/remove (hover "+" rails + cell menu):**

- Hover the right edge → "+" rail appends a column; bottom edge → appends a row.
- A caret on cell hover (or right-click) opens: insert-column-before/after,
  insert-row-above/below, delete-column, delete-row, toggle-header-row.
- Each action is a pure transform over `{columns, rows, cells, colWidths,
  rowHeights}` → one `updateNode`. Deleting a column drops its `cells` +
  `colWidths` entries (same for rows).

**Mode gating** — all editing/hover affordances are `edit`-mode only. In `view`
and `mini` the table renders static, consistent with existing interactivity
gating.

**Delete semantics** — cell selected: clear the cell's text. Whole node
selected: standard node delete (removes the table).

## Toolbar, creation & persistence

**Toolbar** (`packages/canvas/src/components/canvas-toolbar.tsx`): add a `table`
entry with a `Table`/`Grid3x3` Lucide icon, placed in the secondary-primary
group next to Sticky / Text / Link (structural element, not a decorative glyph).

**Creation flow** — reuses the existing drag-to-create path:

1. Click the table tool → mode `{ kind: 'draw', shape: 'table' }`.
2. Drag on canvas → `onCreateShapeNode('table', flowMin, dims)`.
3. Host builds the node via new `buildNewTableData(dims, lastUsedStyle)` in
   `node-defaults.ts` — seeds 3×3, distributes dragged width/height.
4. `setNodeOverride` for instant render → `adapter.createNode(payload)` → SSE
   echo reconciles.
5. Add a minimal table outline to the drag-ghost preview in `seeflow-canvas.tsx`
   alongside the existing shape ghosts.

**Persistence** — no new adapter methods. Every structural edit (resize,
add/remove row/col, cell text) is a whole-`data` `updateNode(id, patch)`. Coarse
but correct: table `data` is small (ids + short strings), conflicts are
last-write-wins like other nodes, and undo/redo works for free via
`wrapAdapterWithHistory`'s `updateNode` inverses.

**Style strip** — existing per-node style controls (font, border, colors) apply
as table-level style; only the header-row toggle is table-specific.

## Why custom (no library)

The popular table libs solve a different problem than a whiteboard table:

- **TanStack Table** — headless data grid (sorting/filtering/pagination/column
  models over typed rows). We have plain text cells and free-form structure;
  we'd use ~0% of it and still build all rendering/resize/edit ourselves.
- **AG Grid / react-data-grid** — heavyweight, own DOM/styling/virtualization;
  would fight the `sf:` Tailwind prefix and the React Flow node lifecycle, bloat
  the peer-dep-conscious embeddable canvas bundle, and (AG Grid) add a license
  question.
- **react-grid-layout** — drag/resize dashboard tiles, not table cells. Wrong
  primitive.

What we need is small and well-trodden: a CSS-grid/`<table>` driven by
`colWidths`/`rowHeights`, `contentEditable` cells, and pointer handlers for
border-drag (~30 lines, against React Flow's `nodrag` convention). A few hundred
lines total, fully owned, matching codebase idioms. **No new runtime peer dep,
no license question, no bundle hit.**

## Testing

**Pure transforms first (TDD)** — `table-ops.ts` + `table-ops.test.ts`, beside
the node, no React/canvas needed:

- `addColumn` / `insertColumnAt` / `deleteColumn` (drops orphaned `cells` +
  `colWidths`)
- `addRow` / `insertRowAt` / `deleteRow`
- `resizeColumn` / `resizeRow` (min clamp)
- `toggleHeaderRow`, `setCell`
- `deriveTableSize` (Σ widths/heights + borders)

**Schema tests** — round-trip a `table` node through `FlowSchema` ⇄
`ResolvedFlowSchema` (flow.json + style.json), asserting structure stays
semantic and sizing stays visual.

**Edge cases**

- Delete the **last** row or column → blocked (min 1×1).
- Wide/tall tables → cells wrap; min cell width ~40px keeps borders grabbable.
- Empty `cells` map → all-blank grid, no crash on missing keys.
- `view`/`mini` render fully static (existing mode tests).
- Copy/paste + undo/redo smoke test (inherits node-level behavior).

**Integration / e2e**

- One integration test: create a table via the adapter, reload, assert persisted.
- Optional Playwright e2e: create-drag + add-column, with a **chromium-linux**
  visual baseline (per canvas testing rules).

## Required chores & rollout

- **Schema sync:** editing `apps/studio/src/schema.ts` requires
  `make sync-seeflow-schema` to update the vendored copy at
  `skills/seeflow/vendored/schema.ts`. CI gates on
  `make verify-seeflow-schema-sync`.
- **Public API:** export `TableNode` / types as needed from
  `packages/canvas/src/index.ts`.
- **Rollout:** additive, no feature flag. Ships when the canvas package is
  released; for cloud, the `SEEFLOW_REF` / `@tuongaz/seeflow` version bump chain
  must run in lockstep (see root `CLAUDE.md`).

## File touch list

| File | Change |
| --- | --- |
| `apps/studio/src/schema.ts` | Add `table` to node type union + table data schemas (semantic/visual) |
| `skills/seeflow/vendored/schema.ts` | Synced via `make sync-seeflow-schema` |
| `packages/canvas/src/nodes/table-node.tsx` | New node component |
| `packages/canvas/src/nodes/table-ops.ts` (+ `.test.ts`) | Pure structural transforms |
| `packages/canvas/src/components/seeflow-canvas.tsx` | Register in `nodeTypes`; drag-ghost preview |
| `packages/canvas/src/components/canvas-toolbar.tsx` | Toolbar entry |
| `packages/canvas/src/lib/node-defaults.ts` | `buildNewTableData` |
| `packages/canvas/src/index.ts` | Public exports |
| `apps/studio/integration/*.it.ts` | Create/reload integration test |
| `apps/studio/e2e/*.e2e.ts` | Optional create + add-column e2e |
