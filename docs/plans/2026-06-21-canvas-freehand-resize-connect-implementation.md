# Freehand resize, connect, straight-lines & width — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Make the freehand pen node resizable, connectable, Shift-snappable to
straight lines, and give it an ink-width control in the style strip.

**Architecture:** Reuse the existing `icon-node.tsx` chrome pattern (`ResizeControls` +
`useResizeGesture` + 4 `<Handle>`s) for resize/connect; add a pure `snapToStraightLine`
geometry helper consumed by the existing pen-capture path in `seeflow-canvas.tsx`;
surface the existing `data.strokeWidth` via a slider in the strip's ink branch. **No
schema change.**

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), React 19, `@xyflow/react`
v12, Bun test, Biome, Playwright.

**Design:** `docs/plans/2026-06-21-canvas-freehand-resize-connect-design.md`

**Working dir:** `/Users/tuongaz/dev/seeflow/.claude/worktrees/canvas-freehand-resize`
(branch `feat/canvas-freehand-resize`, based on `origin/main`).

**House rules (CLAUDE.md):** Bun only. Run `bun run format` BEFORE `bun run lint`.
No bare `Infinity` (use `Number.POSITIVE_INFINITY`), no unguarded non-null assertions
(add `// biome-ignore`), no `forEach` (use `for...of`). 2-space indent, single quotes,
trailing commas, 100-char width. Any NEW `useState` in `seeflow-canvas.tsx` MUST be
appended at the END of the component (the `useStateOverrides[N]` hook-shim rule) — this
plan targets ZERO new `useState`.

---

### Task 1: `snapToStraightLine` geometry helper

**Files:**
- Modify: `packages/canvas/src/nodes/freehand-geometry.ts`
- Test: `packages/canvas/src/nodes/freehand-geometry.test.ts`

**Step 1: Write the failing tests**

Add to `freehand-geometry.test.ts`:

```ts
import { snapToStraightLine } from './freehand-geometry.ts';

describe('snapToStraightLine', () => {
  it('snaps a near-horizontal segment to exactly horizontal', () => {
    const [x, y] = snapToStraightLine([0, 0, 0.5], [100, 8, 0.5]);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(0);
  });

  it('snaps a near-vertical segment to exactly vertical', () => {
    const [x, y] = snapToStraightLine([0, 0, 0.5], [6, 100, 0.5]);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(100);
  });

  it('snaps a ~45deg segment onto the diagonal (equal x/y)', () => {
    const [x, y] = snapToStraightLine([0, 0, 0.5], [100, 90, 0.5]);
    expect(x).toBeCloseTo(y, 5);
    expect(x).toBeGreaterThan(0);
  });

  it('preserves the projected length along the snapped ray', () => {
    // pure horizontal input: projected length == dx
    const [x] = snapToStraightLine([10, 10, 0.5], [110, 10, 0.5]);
    expect(x).toBeCloseTo(110);
  });

  it('returns the start point for a zero-length segment', () => {
    const [x, y] = snapToStraightLine([5, 5, 0.5], [5, 5, 0.5]);
    expect(x).toBeCloseTo(5);
    expect(y).toBeCloseTo(5);
  });
});
```

**Step 2: Run to verify it fails**

Run: `bun test packages/canvas/src/nodes/freehand-geometry.test.ts`
Expected: FAIL — `snapToStraightLine` is not exported.

**Step 3: Implement**

Append to `freehand-geometry.ts` (uses the existing `Point` type = `[number, number, number]`):

```ts
/**
 * Snap the segment start→end to the nearest of 8 directions (every 45°:
 * horizontal, vertical, and the four diagonals), projecting `end` onto that
 * ray. Used by the pen tool's Shift-to-straighten gesture. Pressure is carried
 * from `end`. A zero-length segment returns `start` unchanged.
 */
export function snapToStraightLine(start: Point, end: Point): Point {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return [start[0], start[1], end[2]];
  // Quantise the angle to the nearest 45° step.
  const step = Math.PI / 4;
  const snapped = Math.round(Math.atan2(dy, dx) / step) * step;
  // Project the raw segment length onto the snapped unit direction so the
  // straightened stroke keeps roughly the length the user dragged.
  const proj = dx * Math.cos(snapped) + dy * Math.sin(snapped);
  return [start[0] + Math.cos(snapped) * proj, start[1] + Math.sin(snapped) * proj, end[2]];
}
```

**Step 4: Run to verify it passes**

Run: `bun test packages/canvas/src/nodes/freehand-geometry.test.ts`
Expected: PASS (all snap tests + the pre-existing geometry tests).

**Step 5: Commit**

```bash
bun run format && bun run lint
git add packages/canvas/src/nodes/freehand-geometry.ts packages/canvas/src/nodes/freehand-geometry.test.ts
git commit -m "feat(canvas): snapToStraightLine helper for freehand shift-straight"
```

---

### Task 2: Resize + connect chrome on `FreehandNode`

**Files:**
- Modify: `packages/canvas/src/nodes/freehand-node.tsx`
- Test: `packages/canvas/src/nodes/freehand-node.test.tsx`

Reference implementation: `packages/canvas/src/nodes/icon-node.tsx` (copy its
`ResizeControls` + `useResizeGesture` + 4-`Handle` shape; freehand has no label/caption
or inline-edit, so omit those parts).

**Step 1: Write the failing tests**

Add to `freehand-node.test.tsx` (follow the existing render-harness already in that
file — it wraps the node in a `ReactFlowProvider`; reuse it). New cases:

```ts
// selected + onResize wired → ResizeControls render (NodeResizeControl emits
// `.react-flow__resize-control` nodes).
it('renders resize controls when selected and onResize is wired', () => {
  const { container } = renderFreehand({
    selected: true,
    data: { points: [[0, 0, 0.5], [1, 1, 0.5]], width: 100, height: 100, onResize: () => {} },
  });
  expect(container.querySelectorAll('.react-flow__resize-control').length).toBeGreaterThan(0);
});

it('does not render resize controls when unselected', () => {
  const { container } = renderFreehand({
    selected: false,
    data: { points: [[0, 0, 0.5], [1, 1, 0.5]], width: 100, height: 100, onResize: () => {} },
  });
  expect(container.querySelectorAll('.react-flow__resize-control').length).toBe(0);
});

it('renders four connection handles with ids t/l/r/b', () => {
  const { container } = renderFreehand({
    isConnectable: true,
    data: { points: [[0, 0, 0.5], [1, 1, 0.5]], width: 100, height: 100 },
  });
  const ids = Array.from(container.querySelectorAll('.react-flow__handle')).map((h) =>
    h.getAttribute('data-handleid'),
  );
  expect(new Set(ids)).toEqual(new Set(['t', 'l', 'r', 'b']));
});

it('fills the wrapper with a non-preserving viewBox so resize stretches ink', () => {
  const { container } = renderFreehand({
    data: { points: [[0, 0, 0.5], [1, 1, 0.5]], width: 120, height: 60 },
  });
  const svg = container.querySelector('svg[role="img"]') as SVGSVGElement;
  expect(svg.getAttribute('viewBox')).toBe('0 0 120 60');
  expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
  expect(svg.getAttribute('width')).toBe('100%');
});
```

If `freehand-node.test.tsx` lacks a `renderFreehand` helper that passes
`selected`/`isConnectable`/`id` through `NodeProps`, add one mirroring `icon-node.test.tsx`'s
harness (it already exercises `selected` + `isConnectable`).

**Step 2: Run to verify it fails**

Run: `bun test packages/canvas/src/nodes/freehand-node.test.tsx`
Expected: FAIL — no resize controls, no handles, svg has fixed pixel size.

**Step 3: Implement**

Rewrite `freehand-node.tsx`'s `FreehandNode` signature + body to mirror icon-node:

```tsx
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { cn } from '../lib/cn.ts';
import { ResizeControls } from './resize-controls.tsx';
import { useResizeGesture } from './use-resize-gesture.ts';
// ...existing imports (colorTokenStyle, types, geometry, stroke, react hooks)

const MIN_EXTENT = 8;
const HANDLE_CLASS = 'sf:opacity-0 sf:transition-opacity';

export function FreehandNode({
  id,
  data,
  selected,
  isConnectable,
}: NodeProps<FreehandNodeType>): ReactElement {
  const width = data.width ?? 100;
  const height = data.height ?? 100;

  const { onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeEnd: (dims) => data.onResizeEnd?.(id, dims),
    setResizing: data.setResizing,
    nodeId: id,
    alignment: data.resizeAlignment,
  });

  // ...existing getStroke load + denormalize + color + size + label (unchanged)

  return (
    <div
      className="sf:group sf:relative sf:h-full sf:w-full"
      style={{ width, height }}
      data-testid="freehand-node"
      data-node-type="freehand"
    >
      <ResizeControls
        visible={!!selected && !!data.onResize}
        cornerVariant="visible"
        minWidth={MIN_EXTENT}
        minHeight={MIN_EXTENT}
        onResizeStart={onResizeStart}
        onResize={onResizeEvent}
        onResizeEnd={onResizeEnd}
      />
      <Handle type="target" position={Position.Top} id="t" isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')} />
      <Handle type="target" position={Position.Left} id="l" isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')} />
      <svg
        role="img"
        aria-label={label}
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ overflow: 'visible' }}
      >
        {body}
      </svg>
      <Handle type="source" position={Position.Right} id="r" isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')} />
      <Handle type="source" position={Position.Bottom} id="b" isConnectable={isConnectable}
        className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')} />
    </div>
  );
}
```

Notes:
- The `FreehandNodeData` runtime type must include the injected callbacks. Mirror
  icon-node's `IconNodeRuntimeData` (`onResize?`, `onResizeEnd?`, `setResizing?`,
  `resizeAlignment?`). If `FreehandNodeData` in `packages/canvas/src/types.ts` lacks
  these, widen it (they're already injected at runtime by the canvas).
- `denormalizePoints` still uses `{ x: 0, y: 0, width, height }`; the `viewBox`
  matches, so `preserveAspectRatio="none"` stretches to the live wrapper size.
- Keep the perfect-freehand dynamic-import + `<polyline>` fallback exactly as-is.
- Wrap in `memo` with an `arePropsEqual` comparing `selected/data/width/height`
  (copy icon-node's), since handles + resize add render cost.

**Step 4: Run to verify it passes**

Run: `bun test packages/canvas/src/nodes/freehand-node.test.tsx`
Expected: PASS.

**Step 5: Typecheck the package**

Run: `bun run typecheck`
Expected: no errors (watch for `FreehandNodeData` missing the runtime callbacks — widen
the type in `types.ts` if so).

**Step 6: Commit**

```bash
bun run format && bun run lint
git add packages/canvas/src/nodes/freehand-node.tsx packages/canvas/src/nodes/freehand-node.test.tsx packages/canvas/src/types.ts
git commit -m "feat(canvas): make freehand nodes resizable and connectable"
```

---

### Task 3: Shift-to-straighten in the pen-capture path

**Files:**
- Modify: `packages/canvas/src/components/seeflow-canvas.tsx`
  - `onPointerMove` pen branch (~line 2716)
  - `onPointerUp` pen branch (~line 2729)
  - the freehand live-preview overlay (~line 5340)
  - add `penShiftRef` beside `penPointsRef`/`penDrawingRef`/`penModeRef`
- Test: covered by E2E in Task 4 (this is imperative DOM/pointer wiring; the pure
  snapping is already unit-tested in Task 1). No new `useState`.

**Step 1: Add the ref**

Where `penPointsRef` / `penDrawingRef` are declared, add:

```ts
// Tracks whether Shift was held on the most recent pen pointer event, so the
// live preview and the commit can straighten the stroke. A ref (not state) so
// it never adds a useStateOverrides slot.
const penShiftRef = useRef(false);
```

**Step 2: Track Shift on move**

In `onPointerMove`, inside the `if (penDrawingRef.current)` branch, before the
`setDrawCurrent`:

```ts
penShiftRef.current = e.shiftKey;
```

**Step 3: Straighten on commit**

In `onPointerUp`, inside the `if (penDrawingRef.current)` branch, after
`const raw = penPointsRef.current;` (and before `penPointsRef.current = [];`), replace
`raw` with a straightened 2-point path when Shift is held:

```ts
const straight = e.shiftKey && raw.length >= 2;
const samples: Point[] = straight
  ? [raw[0], snapToStraightLine(raw[0], raw[raw.length - 1])]
  : raw;
```

Then use `samples` instead of `raw` for the `flowPts` projection, but KEEP the
accidental-click guard on the original `raw` screen extent (a deliberate short straight
line should still commit, but a true tap should not — `raw` screen extent is the right
signal). Import `snapToStraightLine` from `../nodes/freehand-geometry.ts`. Reset
`penShiftRef.current = false` alongside the existing ref resets.

Guard the index access per `noUncheckedIndexedAccess` (e.g. capture
`const first = raw[0]; const last = raw[raw.length - 1]; if (!first || !last) ...`).

**Step 4: Straight live preview**

In the freehand-preview overlay IIFE, replace the points source so a held Shift previews
the straight segment:

```ts
const source =
  penShiftRef.current && penPointsRef.current.length >= 2
    ? [penPointsRef.current[0], snapToStraightLine(
        penPointsRef.current[0],
        penPointsRef.current[penPointsRef.current.length - 1],
      )]
    : penPointsRef.current;
const pts = source.map(([x, y]) => `${x - offsetX},${y - offsetY}`).join(' ');
```

(Guard the index reads.) The `setDrawCurrent` on each move already forces the re-render
that re-reads `penShiftRef`.

**Step 5: Run unit + typecheck**

Run: `bun test packages/canvas` then `bun run typecheck`
Expected: PASS / no errors. (Behaviour is asserted by Task 4 E2E.)

**Step 6: Commit**

```bash
bun run format && bun run lint
git add packages/canvas/src/components/seeflow-canvas.tsx
git commit -m "feat(canvas): hold Shift to draw straight freehand strokes"
```

---

### Task 4: Width slider in the style strip

**Files:**
- Modify: `packages/canvas/src/components/style-strip.tsx` (the `pureInkType` branch,
  ~line 448)
- Test: `packages/canvas/src/components/style-strip.test.tsx`

Reference: the image-border width control already in this file (`borderWidth` slider via
`Slider` + `onStyleNode` / `onStyleNodePreview`, ~lines 512–655).

**Step 1: Write the failing test**

Add to `style-strip.test.tsx`:

```ts
it('shows a stroke-width slider for a pure-freehand selection', () => {
  renderStrip({
    nodes: [freehandNode({ id: 'f1', strokeWidth: 1 })],
  });
  expect(screen.getByTestId('style-strip-freehand-width')).toBeInTheDocument();
  // color swatch stays; change-icon does not appear for freehand-only
  expect(screen.getByTestId('style-strip-icon-color')).toBeInTheDocument();
  expect(screen.queryByTestId('style-strip-change-icon')).not.toBeInTheDocument();
});

it('writes strokeWidth via onStyleNode when the slider commits', () => {
  const onStyleNode = vi.fn(); // or the project's mock fn helper
  renderStrip({ nodes: [freehandNode({ id: 'f1', strokeWidth: 1 })], onStyleNode });
  // drive the slider's onValueCommit -> expect onStyleNode('f1', { strokeWidth: <n> })
});
```

Match the file's existing test harness/util names (it uses Bun test + Testing Library;
copy the patterns already in `style-strip.test.tsx`, including its node-factory and the
mock-callback style — do NOT introduce `vitest` if the file uses `bun:test`).

**Step 2: Run to verify it fails**

Run: `bun test packages/canvas/src/components/style-strip.test.tsx`
Expected: FAIL — no `style-strip-freehand-width` testid.

**Step 3: Implement**

In the `pureInkType` branch, after the color swatch and before/around the Change-icon
button, render a width slider when the selection contains a freehand node. The branch
already has `firstInkNode` (icon|freehand). Add:

```tsx
const hasFreehand = nodes.some((n) => n.type === 'freehand');
const inkWidth = firstInkNode?.data.strokeWidth ?? 1;
// ...
{hasFreehand ? (
  <Slider
    data-testid="style-strip-freehand-width"
    aria-label="stroke width"
    min={0.5}
    max={4}
    step={0.5}
    value={[inkWidth]}
    onValueChange={([v]) => {
      for (const n of nodes) {
        if (n.type === 'freehand') onStyleNodePreview?.(n.id, { strokeWidth: v });
      }
    }}
    onValueCommit={([v]) => {
      for (const n of nodes) {
        if (n.type === 'freehand') onStyleNode(n.id, { strokeWidth: v });
      }
    }}
  />
) : null}
```

Match the exact `Slider` prop API used by the image-border width control (value shape,
`onValueChange` vs `onValueCommit`, the preview-vs-commit split). The Change-icon button
stays gated on `firstIconNode` (already the case), so freehand-only hides it.

Confirm `NodeStylePatch.strokeWidth` already exists (it does — it's the icon stroke
width) so no patch-type change is needed, and `splitFlow` already routes `strokeWidth`
into `style.json`.

**Step 4: Run to verify it passes**

Run: `bun test packages/canvas/src/components/style-strip.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
bun run format && bun run lint
git add packages/canvas/src/components/style-strip.tsx packages/canvas/src/components/style-strip.test.tsx
git commit -m "feat(canvas): stroke-width control for freehand in style strip"
```

---

### Task 5: E2E coverage + visual baseline

**Files:**
- Modify: `apps/studio/e2e/freehand.e2e.ts`

**Step 1: Add E2E specs**

Extend the existing freehand spec (keep its C2/I1 marquee/pan regression guards):

1. **Resize** — draw/seed a freehand node, select it, assert
   `.react-flow__resize-control` handles appear, drag a corner handle, assert the node's
   measured width/height changed and persisted across a reload (mirror the icon/shape
   resize E2E already in the suite).
2. **Connect** — select a freehand node, drag from its `source` handle (`r` or `b`) onto
   another node, assert a connector is created (one more `.react-flow__edge`).
3. **Shift-straight** — arm the pen (`P`), dispatch a curved pointer path with
   `shiftKey: true` on the move/up events, assert the committed `freehand` node's
   `points` are a straight 2-point segment (or assert the rendered path is a straight
   line within tolerance).

Reuse the pointer-dispatch helpers already in the freehand E2E for the draw gesture.

**Step 2: Run E2E (Docker)**

Per CLAUDE.md, e2e dispatches to the Playwright Docker image on non-Linux hosts (Docker
Desktop must be running). First ensure bundles are fresh (the orchestrator rebuilds
`apps/studio/dist/web/index.html` + `apps/mcp-app/dist/index.html` when stale):

Run: `bun run test:it:e2e`
Expected: the three new specs PASS; existing freehand/marquee/pan guards still PASS.

**Step 3: Regenerate the visual baseline (if the spec has a snapshot)**

If a `freehand` visual snapshot exists/was added:

Run: `bun run test:it:update-snapshots`
Commit only the resulting `*-chromium-linux.png` (never `*-darwin.png`).

**Step 4: Commit**

```bash
git add apps/studio/e2e/freehand.e2e.ts apps/studio/e2e/**/freehand*-chromium-linux.png
git commit -m "test(e2e): freehand resize, connect, and shift-straight coverage"
```

---

### Final gate (before finishing the branch)

Run the full suite on the combined state and confirm green:

```bash
bun run typecheck
bun run lint
bun test
bun run test:it    # integration + e2e (Docker up)
```

Then use **superpowers:finishing-a-development-branch** to merge/PR. Per memory
([[feedback_main_push]]): this is a self-contained canvas feature — once green, the
maintainer pushes to `main` and watches CI + deploy. Shipping to cloud additionally
needs an OSS release + lockstep bump ([[project_cloud_canvas_release_lockstep]]); the
freehand node ships in `@tuongaz/seeflow` so a `make deploy` minor release propagates it
once merged.

## Notes / gotchas

- **No schema change** → do NOT run `make sync-seeflow-schema`; nothing to sync.
- `seeflow-canvas.tsx` hook-shim rule: this plan adds only `useRef`s, no `useState`. Keep
  it that way or the `useStateOverrides[N]` indexing in `seeflow-canvas.test.tsx` breaks.
- Render `data.icon` etc. via existing helpers; not touched here.
- `noUncheckedIndexedAccess`: guard every `raw[0]` / `points[i]` access.
