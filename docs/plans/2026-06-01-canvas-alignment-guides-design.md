# Canvas alignment guides design

Date: 2026-06-01
Status: Design approved, not yet implemented
Package: `@seeflow/canvas`

## Summary

Add Miro/Figma-style alignment guides + snap to `@seeflow/canvas`. While a user drags or resizes a node (or a multi-node selection), render colored guidelines when the moving rect's edges/centers align with other nodes, and snap the position into exact alignment within a small screen-space threshold. Equal-spacing distribution guides included.

## Goals

- 6 alignment lines per pair: top, bottom, left, right, horizontal-center, vertical-center.
- Equal-spacing distribution guides (Figma pink lines).
- Snap the moving rect (or selection bounding box) into alignment within ~6 screen pixels.
- Modifier-key suppress (`Cmd` on mac, `Ctrl` on win) to temporarily disable for a single gesture.
- Cover both node drag and node resize.

## Non-goals (v1)

- Snapping to viewport center / canvas edges.
- Snapping to a background grid.
- Keyboard nudge alignment.
- Equalizing spacing on **resize** (read-only spacing guides during resize).
- A persistent chrome toggle button — modifier-suppress only.

## API surface

`CanvasFeatureOverrides` in `packages/canvas/src/index.ts` gets two new optional fields:

```ts
enableAlignmentGuides?: boolean;
alignmentSnapThreshold?: number;  // screen px, default 6
```

Mode preset defaults in `resolveFlags`:

| Mode | `enableAlignmentGuides` |
| ---- | ----------------------- |
| edit | `true`  |
| view | `false` |
| mini | `false` |

No `CanvasAdapter` changes. No new public components — the overlay is internal.

## Architecture

New subsystem under `packages/canvas/src/alignment/`:

```
src/alignment/
  geometry.ts              // pure: rects → guides + snap offsets
  geometry.test.ts
  use-alignment-guides.ts  // React hook: gesture lifecycle, RAF batching, state
  use-alignment-guides.test.ts
  alignment-overlay.tsx    // SVG layer inside ReactFlow's ViewportPortal
  alignment-overlay.test.tsx
```

### Data flow — drag

1. `handleNodeDragStart` / `handleSelectionDragStart` → `alignment.beginGesture(draggedIds)`. The hook captures a frozen snapshot of all **non-dragged** node rects into a ref (recomputed once per gesture, not per frame).
2. Snap interception happens in `onNodesChange`: when a position change arrives with `change.dragging === true`, the hook computes a snap delta via `computeGuides(...)` and rewrites `change.position` before forwarding to the existing handler.
3. The hook commits the active `GuideLine[]` to internal state, throttled via `requestAnimationFrame` (one commit per paint regardless of drag event rate).
4. `AlignmentOverlay`, mounted inside `<ViewportPortal>` from `@xyflow/react`, renders the active guides as SVG `<line>`s in world coordinates. `vector-effect="non-scaling-stroke"` keeps stroke width at 1 screen pixel at any zoom.
5. `handleNodeDragStop` / `handleSelectionDragStop` → `alignment.endGesture()`. Clears guides + snapshot.

Snapping inside `onNodesChange` (rather than per-callback) keeps the integration centralized — a single mutation point that already exists in `seeflow-canvas.tsx`.

### Data flow — resize

`use-resize-gesture.ts` exposes which edges of the rect are being dragged. The alignment hook gets a parallel API:

- `beginResize(nodeId, activeEdges)`
- `applyResizeSnap(rawRect) → { snappedRect, guides }`
- `endResize()`

Only the moving edges snap (e.g. dragging the right handle only snaps the right edge — left stays fixed). Spacing guides are **rendered if applicable but never adjust the resize delta** — equalizing on resize is too aggressive.

## Geometry algorithm

`geometry.ts` is fully pure, independently unit-testable.

```ts
type Rect = { id: string; x: number; y: number; w: number; h: number };

type GuideLine =
  | { kind: 'v'; x: number; y1: number; y2: number; refIds: string[] }
  | { kind: 'h'; y: number; x1: number; x2: number; refIds: string[] }
  | { kind: 'spacing-v'; x1: number; x2: number; y: number; gap: number }
  | { kind: 'spacing-h'; y1: number; y2: number; x: number; gap: number };

type SnapResult = {
  snappedX: number;
  snappedY: number;
  guides: GuideLine[];
};

export function computeGuides(
  moving: Rect,
  refs: Rect[],
  thresholdWorld: number,
): SnapResult;
```

### Edge & center pass (6 anchors)

For each axis independently:

- X anchors of moving rect: `left`, `centerX`, `right`.
- Y anchors of moving rect: `top`, `centerY`, `bottom`.
- For each ref rect, compare its three anchor values against the moving rect's three.
- If `|mAnchor - rAnchor| <= threshold`, the pair is a candidate. Pick the single closest candidate per axis; ties go to centers (Figma convention).
- Snap delta: `rAnchor - mAnchor`. Guide line spans from the topmost to the bottommost involved rect.

### Spacing pass

Runs only after the edge pass picks a snap on at least one axis (cheap hot path).

- On the X axis, filter ref rects whose Y-projections overlap the moving rect's Y-projection.
- Sort by X. Compute gaps between consecutive pairs **and** the gap between the moving rect and each neighbor.
- If any gap pair matches within threshold, emit a `spacing-h` guide and (drag-only, not resize) adjust `snappedX` to equalize.
- Same shape on Y.
- Complexity: O(n log n) per axis. n is "visible non-dragged nodes" — realistically <50.

### Ranking

If both an edge-snap and a spacing-snap want the same axis, **edge wins** — it's the stronger perceptual signal.

### Threshold

`THRESHOLD_PX = 6` constant. Converted per frame to world units:

```ts
thresholdWorld = thresholdPx / viewport.zoom;
```

Configurable via `alignmentSnapThreshold` prop, otherwise default 6.

### Multi-selection drag

Treat the selection's outer bounding box as one logical `Rect`. Internal relative positions of dragged nodes stay fixed; the bounding box is what aligns to other rects. The snap delta applies uniformly to every node in the selection.

## Rendering

`AlignmentOverlay` is mounted as a child of `<ViewportPortal>` from `@xyflow/react`. Children of `ViewportPortal` render inside the transformed viewport `<g>`, so coordinates are in world space — no manual zoom math.

```tsx
<ViewportPortal>
  <AlignmentOverlay guides={guides} />
</ViewportPortal>
```

### Styling (design.html tokens)

| Guide kind     | Color                                                              | Stroke width      | Notes |
| -------------- | ------------------------------------------------------------------ | ----------------- | ----- |
| Edge / center  | `--sf-accent`                                                      | `non-scaling-stroke`, 1px | Opacity 0.9 |
| Spacing        | Reuse existing rose/pink token if present in design.html; else add `--sf-alignment-spacing` (grep design.html first — do not invent) | `non-scaling-stroke`, 1px | Perpendicular "T" caps at endpoints, gap-px label badge in middle via `<foreignObject>` |

### Performance

- Overlay re-renders only when `guides` array reference changes.
- The hook commits a new array only when the *set* of active guides changes (cheap structural compare keyed by `kind|anchor|refIds.join`).
- Per-frame drag callbacks where the snap result is identical to the previous frame do zero React work.
- Idle canvas (no drag in flight): zero overlay nodes in the DOM (`guides.length === 0` short-circuits the render).

### A11y

`aria-hidden="true"` on the overlay. Guides are pure visual affordance. Keyboard users can't drag, so there's nothing to expose.

## Wiring into `seeflow-canvas.tsx`

The hook owns its own internal `useState` slots — they sit inside the hook's scope and **do not** affect `SeeflowCanvas`'s top-level `useStateOverrides[N]` indexing. The current 14-slot order stays intact, satisfying the hook-shim test discipline (see `packages/canvas/CLAUDE.md`).

Integration sketch:

```ts
const alignment = useAlignmentGuides({
  enabled: flags.enableAlignmentGuides,
  thresholdPx: flags.alignmentSnapThreshold ?? 6,
  viewport,           // useReactFlow().getViewport()
  rfNodesRef,         // existing ref already in the file
});

// handleNodeDragStart → alignment.beginGesture(draggedIds)
// onNodesChange → const adjusted = alignment.interceptChanges(changes, e);
// handleNodeDragStop / handleSelectionDragStop → alignment.endGesture()

// resize gesture:
// onResizeStart → alignment.beginResize(nodeId, activeEdges)
// per-frame → alignment.applyResizeSnap(rawRect)
// onResizeEnd → alignment.endResize()
```

### Modifier suppress

The hook reads `e.metaKey || e.ctrlKey` on each frame from the drag/resize event. When true:

- `interceptChanges` returns the raw changes unchanged.
- `guides` state is committed as `[]`.

No persistent state — purely per-frame.

## Tests

### Unit

- `geometry.test.ts` — ~25 cases:
  - Each of the 6 edge/center snaps in isolation.
  - Threshold boundary: exactly at threshold (snaps), threshold + 1 (does not).
  - Tie-breaks: edge vs center, edge vs spacing.
  - Spacing detection: 3-, 4-, 5-rect configurations.
  - Projection-overlap gating (spacing should not fire on rects whose Y-projections don't overlap).
  - Multi-selection bounding-box snap.
  - Resize-mode flag: spacing detected but does not adjust the snap.

- `use-alignment-guides.test.ts`:
  - RAF batching: 10 drag events in one frame → 1 state commit.
  - Modifier-key suppress: subsequent frame clears guides and returns raw delta.
  - Gesture lifecycle: begin → guides; end → guides cleared, snapshot dropped.

- `alignment-overlay.test.tsx`:
  - Renders the right number of `<line>`s per guide kind.
  - Every `<line>` carries `vector-effect="non-scaling-stroke"`.
  - Renders nothing when `guides=[]`.
  - Spacing guide includes the gap-px label.

### Component integration

- `seeflow-canvas.test.tsx` — append one new case at the bottom of the file (no new `useState` slots in the component, so existing index-based assertions stay valid):
  - With `enableAlignmentGuides: true`, a simulated drag that lands within threshold of another node commits a snapped `position` to `onNodesChange`.

### E2E

- `apps/studio/e2e/` — one happy-path Playwright case:
  - Open a flow with two nodes.
  - Drag one near the other.
  - Assert the SVG guide is visible mid-drag.
  - Drop. Assert final position equals the aligned coordinate.
- Visual baseline pinned to `chromium-linux` per repo convention.

## Out of scope (documented in code comments)

- Snapping to viewport center / canvas edges.
- Snapping to a background grid (canvas has no visible grid today).
- Keyboard nudge alignment.
- Equalizing spacing on resize.
- Persistent chrome toggle button.

## Performance budget

Drag callback stays under 1ms/frame at 100 nodes.

- Edge/center pass: O(n) per axis.
- Spacing pass: O(n log n) per axis.
- n = visible non-dragged nodes, realistically <50.

If this ever becomes a bottleneck we can spatially index the reference rects. YAGNI for v1.

## Open items resolved during brainstorming

| Question | Decision |
| -------- | -------- |
| Guides only, or guides + snap? | Guides + snap (Miro default) |
| Default on or off? | Flag exists; ON in edit, OFF in view/mini |
| Equal-spacing? | Yes — full Miro/Figma parity |
| Multi-drag behavior? | Snap the selection's bounding box |
| Threshold strategy? | Fixed screen pixels, default 6 |
| Runtime toggle? | Modifier-key suppress (Cmd/Ctrl) |
| Resize scope? | Drag + resize both in v1 |
