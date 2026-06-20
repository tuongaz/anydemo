# Freehand resize, connect, straight-lines & width in `@seeflow/canvas`

**Date:** 2026-06-21
**Status:** Design approved, pending implementation
**Scope:** `packages/canvas` (`freehand-node.tsx`, `freehand-geometry.ts`, `seeflow-canvas.tsx`, `style-strip.tsx`)
**Builds on:** `docs/plans/2026-06-20-canvas-freehand-design.md` (shipped as `@tuongaz/seeflow@0.3.0`)

## Goal

Round out the freehand pen node so it behaves like every other node: **resizable**
(corner handles), **connectable** (connectors can attach), drawable as **straight
lines** while holding **Shift**, and with an ink-**width** control in the style strip.

## Why now

The shipped freehand node renders a bare `<svg>` with no chrome. It can be drawn,
moved, recolored, deleted, and undone, but you cannot resize it or attach connectors,
and the only style control is a color swatch.

## Key architectural facts (verified against `origin/main`)

- The canvas **already injects** `onResize`, `onResizeEnd`, `setResizing`, and
  `resizeAlignment` into **every** node's runtime data (the per-node `buildNode`
  block in `seeflow-canvas.tsx`), freehand included. FreehandNode *receives* these
  callbacks today — it just never uses them.
- The global `nodesConnectable` gate and the per-node `connectable=false`
  (unselected) logic already apply uniformly. Handles "just work" the moment the
  renderer emits `<Handle>`s.
- `data.strokeWidth` (range 0.5–4) already exists for freehand and round-trips
  through `splitFlow` into `style.json`. The renderer already multiplies it by
  `FREEHAND_STROKE_OPTIONS.size`.
- Connectors reference node-id + handle-id (`t`/`l`/`r`/`b`) as separate schema
  entities.

**Consequence: no schema change, no `make sync-seeflow-schema`.** The whole feature
lives in four files in `packages/canvas`.

---

## Section 1 — Resize & connect (the chrome)

`freehand-node.tsx` adopts the `icon-node.tsx` pattern verbatim (icon is the existing
chromeless-but-resizable-and-connectable node):

- Wrap the `<svg>` in a positioned container
  `<div className="sf:group sf:relative sf:h-full sf:w-full" data-testid="freehand-node">`.
- Add the resize gesture:
  ```ts
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeEnd: (dims) => data.onResizeEnd?.(id, dims),
    setResizing: data.setResizing,
    nodeId: id,
    alignment: data.resizeAlignment,
  });
  ```
  and render `<ResizeControls visible={!!selected && !!data.onResize} cornerVariant="visible"
  minWidth={MIN} minHeight={MIN} onResizeStart={…} onResize={…} onResizeEnd={…} />`.
  `MIN` small (e.g. 8px) since ink can be tiny.
- Add four `<Handle>`s mirroring icon-node: `type="target"` at `Position.Top` (id `t`)
  and `Position.Left` (id `l`); `type="source"` at `Position.Right` (id `r`) and
  `Position.Bottom` (id `b`). Each `isConnectable={isConnectable}`,
  `className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')}` so they're invisible
  until selected.
- **Live-resize fix.** Today the `<svg>` is pinned to `data.width/height`, which only
  updates on resize-*stop* — so the ink wouldn't scale mid-drag. Make the svg fill the
  wrapper instead: `width="100%" height="100%" viewBox="0 0 {W} {H}"
  preserveAspectRatio="none"`, dropping the fixed-pixel `style`. The wrapper's CSS
  size (driven live by xyflow during the gesture) then stretches the ink, and the
  normalized points keep the geometry scale-correct.
- Resize is **free per-axis** (matches icon); stretching/distorting ink is expected.
- Keep the `memo` + `arePropsEqual` (selected/data/width/height) shape from icon-node.

`NodeProps<FreehandNodeType>` now also reads `selected`, `isConnectable`, and `id`
(currently only `data`).

---

## Section 2 — Shift = straight lines

Entirely in the pen-capture path in `seeflow-canvas.tsx`; still produces a `points[]`
array, so no schema impact.

- New pure helper in `freehand-geometry.ts`:
  ```ts
  // Snap the segment start→end to the nearest of 8 directions (every 45°:
  // horizontal, vertical, and the four diagonals), projecting `end` onto that ray.
  export function snapToStraightLine(start: Point, end: Point): Point
  ```
  Unit-tested in isolation.
- **During the gesture** (`onPointerMove`): when `e.shiftKey` is held, render the live
  preview as a straight segment from the stroke's first captured point to
  `snapToStraightLine(first, current)` instead of the freeform path — what you see is
  what commits.
- **On commit** (`onPointerUp`): if Shift is held, replace the captured path with a
  2-point stroke `[first, snapToStraightLine(first, last)]` *before* the existing
  normalize → RDP → min-extent pipeline. Min-extent still rejects an accidental click.
- Shift is read live per-event: start freehand, then hold Shift to straighten — the
  preview updates on the next move; release to return to freeform.

---

## Section 3 — Width control in the style strip

The "Border toolbar shows width" ask. Dashed/dotted is explicitly **out of scope**
(perfect-freehand fills an outline polygon, so `stroke-dasharray` has nothing to bite
on); the meaningful control is ink thickness, already stored as `data.strokeWidth`.

- Split the existing `pureInkType` branch in `style-strip.tsx`:
  - **Color swatch** — stays for both icon + freehand (already works).
  - **Width slider** — add a `strokeWidth` slider for selections that include
    freehand, reusing the `Slider` + `onStyleNode({ strokeWidth })` /
    `onStyleNodePreview({ strokeWidth })` plumbing the image-border-width control
    already uses. Live-drag previews; commits one coalesced undo entry on release.
  - **Change-icon button** — stays gated on `firstIconNode` (icon-only), so a
    pure-freehand selection never shows it.
- No `borderStyle`/dash control. No new schema field; `strokeWidth` already
  round-trips through `splitFlow` into `style.json`.

---

## Section 4 — Testing & rollout

**Unit (`bun test`, beside sources):**

- `freehand-geometry.test.ts` — `snapToStraightLine`: snaps to each of the 8
  directions, picks the nearest, projects length correctly, handles zero-length.
- `freehand-node.test.tsx` — renders `ResizeControls` when `selected && data.onResize`;
  renders four `<Handle>`s with ids `t/l/r/b`; handles hidden (`opacity-0`) when
  unselected; svg fills the wrapper (`100%` + `viewBox` + `preserveAspectRatio="none"`).
- `seeflow-canvas.test.tsx` — hook-shim suite. **Any new `useState` slot must be
  appended at the END** (CLAUDE.md `useStateOverrides[N]` rule). Shift-snap uses refs +
  the existing preview slot, so target **no new `useState`**.
- `style-strip.test.tsx` — pure-freehand selection shows color swatch + width slider,
  hides Change-icon.

**E2E (`apps/studio/e2e/freehand.e2e.ts`, chromium-linux):**

- Resize: select a freehand node, drag a corner handle, assert width/height changed and
  persisted.
- Connect: drag from a freehand source handle to another node, assert a connector
  commits.
- Shift-straight: arm pen, draw with Shift held, assert the committed stroke is a
  straight 2-point segment.
- Keep the existing C2/I1 marquee/pan regression guards.

**Rollout order:** (1) chrome — resize + connect; (2) shift-snap helper + capture;
(3) width slider; (4) tests + regenerate the visual baseline under Docker. No schema
sync needed.

## Out of scope (explicit)

- Dashed / dotted ink.
- Per-point vertex reshaping.
- Aspect-lock on resize.
- Handle-position customization / more than the 4 bounding-box handles.
