# Freehand Pen Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a freehand pen tool to `@seeflow/canvas` that captures mouse/touch/stylus strokes and renders them as smooth, pressure-variable ink stored as first-class `freehand` nodes.

**Architecture:** A new schema node type `'freehand'` stores a normalized points array in `flow.json`; `position`/`width`/`height`/`color`/`strokeWidth` reuse the existing `style.json` side-table. Rendering uses the optional, dynamic-imported `perfect-freehand` peer dep with a `<polyline>` fallback. A new `{ kind: 'pen' }` `CanvasMode` arms capture; the existing pointer handlers branch to record the full path, project it to flow coords, normalize + RDP-simplify, and commit through the existing `CanvasAdapter.createNode`. Whole-stroke editing only — move/resize/restyle/delete/undo come free from the node system.

**Tech Stack:** Bun, TypeScript (strict + `noUncheckedIndexedAccess`), Zod 3, React 18, @xyflow/react v12, perfect-freehand, Biome, `bun test`, Playwright.

**Working dir:** `.claude/worktrees/canvas-freehand` on branch `feat/canvas-freehand`.

**Design doc:** `docs/plans/2026-06-20-canvas-freehand-design.md` (on `main`).

## Conventions (read once, apply everywhere)

- Tests live beside sources: `foo.ts` + `foo.test.ts`. Run `bun test path/to/foo.test.ts` for one file.
- `bun run format` BEFORE `bun run lint` (Biome): 2-space indent, 100-char width, single quotes, trailing commas, semicolons.
- After ANY edit to `apps/studio/src/schema.ts`, run `make sync-seeflow-schema`.
- Canvas internal imports use **relative paths** with `.ts`/`.tsx` extensions, never `@/`.
- Adding a `useState` in `seeflow-canvas.tsx` shifts the hook-shim test indices — **prefer `useRef`**; if a state slot is unavoidable, APPEND it at the END of the component body (see `packages/canvas/CLAUDE.md`).
- Color tokens flow through `ColorToken` → CSS-var; never hard-code colors.
- Optional peer deps go in `peerDependencies` + `peerDependenciesMeta.<name>.optional` + `devDependencies` + **`tsup.config.ts` `external`** (forgetting `external` doubles the bundle).
- Commit after each task with a `feat:`/`test:`/`chore:` message ending with the Co-Authored-By trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

## Task 1: Schema — add the `freehand` node type

**Files:**
- Modify: `apps/studio/src/schema.ts`
- Test: `apps/studio/src/schema.test.ts`

**Step 1: Write failing tests.** Add to `apps/studio/src/schema.test.ts`:

```ts
import { FlowFreehandNodeSchema, ResolvedFlowSchema, NodeTypeSchema } from './schema.ts';

test('NodeTypeSchema accepts freehand', () => {
  expect(NodeTypeSchema.safeParse('freehand').success).toBe(true);
});

test('FlowFreehandNodeSchema requires >=2 points', () => {
  const ok = FlowFreehandNodeSchema.safeParse({
    id: 'n1',
    type: 'freehand',
    data: { points: [[0, 0, 0.5], [1, 1, 0.5]] },
  });
  expect(ok.success).toBe(true);

  const tooFew = FlowFreehandNodeSchema.safeParse({
    id: 'n1',
    type: 'freehand',
    data: { points: [[0, 0, 0.5]] },
  });
  expect(tooFew.success).toBe(false);
});

test('FlowFreehandNodeSchema rejects unknown data fields (strict)', () => {
  const res = FlowFreehandNodeSchema.safeParse({
    id: 'n1',
    type: 'freehand',
    data: { points: [[0, 0, 0.5], [1, 1, 0.5]], bogus: true },
  });
  expect(res.success).toBe(false);
});
```

> Note: `FlowFreehandNodeSchema` and `NodeTypeSchema` are likely already exported; ensure `FlowFreehandNodeSchema` gets an `export`. Check whether `ResolvedFlowSchema` is exported — if not, drop that import from the test (it's only referenced here for completeness).

**Step 2: Run, verify fail.**
Run: `bun test apps/studio/src/schema.test.ts`
Expected: FAIL (`FlowFreehandNodeSchema` undefined).

**Step 3: Implement.** In `apps/studio/src/schema.ts`:

3a. Add `'freehand'` to the `NodeTypeSchema` enum (around line 215), in the non-geometric list:
```ts
export const NodeTypeSchema = z.enum([
  ...GEOMETRIC_NODE_TYPES,
  'image',
  'html',
  'icon',
  'component',
  'linkflow',
  'freehand',
]);
```

3b. Add the resolved data shape after `ResolvedLinkflowNodeData` (~line 354):
```ts
// Freehand ink stroke. `points` are [x, y, pressure] normalized to the node's
// local box (x/y in 0..1, pressure in 0..1) so resize scales the rendered path.
// color + strokeWidth come from the style side-table (same fields as icons).
const ResolvedFreehandNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  ...NodeCapabilitiesShape,
  points: z
    .array(z.tuple([z.number(), z.number(), z.number()]))
    .min(2),
  color: ColorTokenSchema.optional(),
  strokeWidth: z.number().min(0.5).max(4).optional(),
});
```

3c. Add it to the resolved `NodeSchema` discriminated union (after the `linkflow` entry, ~line 393):
```ts
  z.object({
    ...NodeBaseShape,
    type: z.literal('freehand'),
    data: ResolvedFreehandNodeData,
  }),
```

3d. Add the on-disk flow data after `FlowLinkflowNodeData`'s definition (~after line 642, before `FlowNodeBaseShape`):
```ts
const FlowFreehandNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    ...NodeCapabilitiesShape,
    points: z
      .array(z.tuple([z.number(), z.number(), z.number()]))
      .min(2)
      .describe(
        'Freehand ink samples as [x, y, pressure], normalized to the node box (x/y in 0..1, pressure in 0..1). Authored by the pen tool, not by hand.',
      ),
  })
  .strict();
```

3e. Add the flow node schema after `FlowLinkflowNodeSchema` (~line 710):
```ts
export const FlowFreehandNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('freehand'),
    data: FlowFreehandNodeData,
  })
  .strict();
```

3f. Add `FlowFreehandNodeSchema` to the `FlowNodeSchema` discriminated union (after `FlowLinkflowNodeSchema`, ~line 731).

**Step 4: Run, verify pass.**
Run: `bun test apps/studio/src/schema.test.ts`
Expected: PASS.

**Step 5: Sync + typecheck.**
Run: `make sync-seeflow-schema && bun run --filter @tuongaz/seeflow typecheck` (or `bun run typecheck` from root).
Expected: schema mirror updated, typecheck clean.

**Step 6: Commit.**
```bash
git add apps/studio/src/schema.ts apps/studio/src/schema.test.ts skills/seeflow/vendored/schema.ts
git commit -m "feat(schema): add freehand node type"
```

---

## Task 2: Geometry helpers (pure functions)

**Files:**
- Create: `packages/canvas/src/nodes/freehand-geometry.ts`
- Test: `packages/canvas/src/nodes/freehand-geometry.test.ts`

These are the pure math used by both capture-commit and rendering. `Point` = `[x, y, pressure]`.

**Step 1: Write failing tests** (`freehand-geometry.test.ts`):

```ts
import { describe, expect, test } from 'bun:test';
import {
  boundingBox,
  normalizePoints,
  denormalizePoints,
  simplifyRDP,
  isAccidentalStroke,
  MIN_STROKE_EXTENT,
} from './freehand-geometry.ts';

describe('boundingBox', () => {
  test('computes min/max with padding 0', () => {
    expect(boundingBox([[0, 0, 0.5], [10, 4, 0.5]])).toEqual({ x: 0, y: 0, width: 10, height: 4 });
  });
  test('never returns zero width/height (degenerate line)', () => {
    const b = boundingBox([[5, 5, 0.5], [5, 9, 0.5]]);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
  });
});

describe('normalize/denormalize round-trip', () => {
  test('round-trips within epsilon', () => {
    const pts = [[2, 3, 0.4], [8, 11, 0.9]] as [number, number, number][];
    const box = boundingBox(pts);
    const norm = normalizePoints(pts, box);
    norm.flat().forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    const back = denormalizePoints(norm, box);
    back.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(pts[i]![0], 5);
      expect(p[1]).toBeCloseTo(pts[i]![1], 5);
      expect(p[2]).toBeCloseTo(pts[i]![2], 5);
    });
  });
});

describe('simplifyRDP', () => {
  test('drops collinear midpoints', () => {
    const line = [[0, 0, 0.5], [1, 1, 0.5], [2, 2, 0.5], [3, 3, 0.5]] as [number, number, number][];
    expect(simplifyRDP(line, 0.01).length).toBe(2);
  });
  test('keeps endpoints', () => {
    const pts = [[0, 0, 0.5], [5, 9, 0.5]] as [number, number, number][];
    expect(simplifyRDP(pts, 0.01)).toEqual(pts);
  });
});

describe('isAccidentalStroke', () => {
  test('true when extent below MIN_STROKE_EXTENT on both axes', () => {
    expect(isAccidentalStroke({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
  });
  test('false for an intentional drag', () => {
    expect(isAccidentalStroke({ x: 0, y: 0, width: MIN_STROKE_EXTENT + 1, height: 50 })).toBe(false);
  });
});
```

**Step 2: Run, verify fail.**
Run: `bun test packages/canvas/src/nodes/freehand-geometry.test.ts`
Expected: FAIL (module not found).

**Step 3: Implement** (`freehand-geometry.ts`):

```ts
// Pure geometry for freehand ink strokes. A Point is [x, y, pressure].
export type Point = [number, number, number];
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Strokes below this screen-px extent on BOTH axes are treated as an
// accidental click, not an intentional drawing. Mirrors MIN_DRAW_SIZE.
export const MIN_STROKE_EXTENT = 4;

// Floor for a box dimension so a perfectly straight/vertical stroke still has a
// non-zero box to normalize against (avoids divide-by-zero).
const MIN_BOX_DIM = 1;

export function boundingBox(points: Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, MIN_BOX_DIM),
    height: Math.max(maxY - minY, MIN_BOX_DIM),
  };
}

export function normalizePoints(points: Point[], box: Box): Point[] {
  return points.map(([x, y, p]) => [(x - box.x) / box.width, (y - box.y) / box.height, p]);
}

export function denormalizePoints(points: Point[], box: Box): Point[] {
  return points.map(([nx, ny, p]) => [box.x + nx * box.width, box.y + ny * box.height, p]);
}

export function isAccidentalStroke(box: Box): boolean {
  return box.width < MIN_STROKE_EXTENT && box.height < MIN_STROKE_EXTENT;
}

// Ramer–Douglas–Peucker simplification on the x/y plane; pressure is carried
// from the surviving samples. `epsilon` is in the same units as the points.
export function simplifyRDP(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= epsilon) return [first, last];
  const left = simplifyRDP(points.slice(0, index + 1), epsilon);
  const right = simplifyRDP(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}
```

**Step 4: Run, verify pass.**
Run: `bun test packages/canvas/src/nodes/freehand-geometry.test.ts`
Expected: PASS.

**Step 5: Commit.**
```bash
git add packages/canvas/src/nodes/freehand-geometry.ts packages/canvas/src/nodes/freehand-geometry.test.ts
git commit -m "feat(canvas): add freehand geometry helpers"
```

---

## Task 3: perfect-freehand peer dep + stroke→path helper

**Files:**
- Modify: `packages/canvas/package.json`
- Modify: `packages/canvas/tsup.config.ts`
- Create: `packages/canvas/src/nodes/freehand-stroke.ts`
- Test: `packages/canvas/src/nodes/freehand-stroke.test.ts`

**Step 1: Add the dependency.**
```bash
cd packages/canvas && bun add -d perfect-freehand && cd ../..
```
Then edit `packages/canvas/package.json`:
- Add to `peerDependencies`: `"perfect-freehand": "^1.2.0"`
- Add `"peerDependenciesMeta": { ..., "perfect-freehand": { "optional": true } }`
- Keep it in `devDependencies` (bun add -d did this).

Edit `packages/canvas/tsup.config.ts`: add `'perfect-freehand'` to the `external` array.

**Step 2: Write failing test** (`freehand-stroke.test.ts`):

```ts
import { describe, expect, test } from 'bun:test';
import { strokeOutlineToPath, FREEHAND_STROKE_OPTIONS } from './freehand-stroke.ts';

describe('strokeOutlineToPath', () => {
  test('returns empty string for no points', () => {
    expect(strokeOutlineToPath([])).toBe('');
  });
  test('builds a closed SVG path from an outline polygon', () => {
    const d = strokeOutlineToPath([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(d.startsWith('M')).toBe(true);
    expect(d.trim().endsWith('Z')).toBe(true);
  });
});

test('FREEHAND_STROKE_OPTIONS exposes a base size', () => {
  expect(typeof FREEHAND_STROKE_OPTIONS.size).toBe('number');
});
```

**Step 3: Run, verify fail.**
Run: `bun test packages/canvas/src/nodes/freehand-stroke.test.ts`
Expected: FAIL (module not found).

**Step 4: Implement** (`freehand-stroke.ts`):

```ts
// Centralized perfect-freehand options + outline→SVG-path conversion. Mirrors
// the FIT_VIEW_OPTIONS pattern of keeping tunables in one module-level const.
export const FREEHAND_STROKE_OPTIONS = {
  size: 8,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: true,
};

// Convert perfect-freehand's outline polygon (array of [x, y]) into a closed
// SVG path string. Uses quadratic segments through midpoints for smoothness.
export function strokeOutlineToPath(outline: number[][]): string {
  if (outline.length === 0) return '';
  const d: (string | number)[] = ['M', outline[0]![0], outline[0]![1], 'Q'];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    d.push(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  d.push('Z');
  return d.join(' ');
}
```

**Step 5: Run, verify pass.**
Run: `bun test packages/canvas/src/nodes/freehand-stroke.test.ts`
Expected: PASS.

**Step 6: Commit.**
```bash
git add packages/canvas/package.json packages/canvas/tsup.config.ts packages/canvas/bun.lock packages/canvas/src/nodes/freehand-stroke.ts packages/canvas/src/nodes/freehand-stroke.test.ts
git commit -m "feat(canvas): add perfect-freehand peer dep and stroke-path helper"
```

> Note: lockfile path may be repo-root `bun.lock`; `git add -A packages/canvas package.json bun.lock` if unsure.

---

## Task 4: `FreehandNode` renderer

**Files:**
- Create: `packages/canvas/src/nodes/freehand-node.tsx`
- Test: `packages/canvas/src/nodes/freehand-node.test.tsx`

**Reference template:** `packages/canvas/src/nodes/icon-node.tsx` (closest existing renderer — reads `data.color`/`data.strokeWidth`, resolves color tokens) and `IconifyOrPlaceholder` in `src/components/icon-renderer.tsx` (the optional-peer-dep dynamic-import + fallback pattern).

**Step 1: Write failing tests** (`freehand-node.test.tsx`) — assert it renders an `<svg>` containing either a `<path>` (peer dep present in test env) or a `<polyline>` fallback, and that it reads `data.points`. Model the test on `icon-node.test.tsx`'s render harness. Key assertions:
- Given `data.points` with ≥2 normalized points and `width`/`height`, the component renders an `<svg>` element.
- A `<polyline>` is rendered synchronously (fallback) before the dynamic import resolves, OR a `<path>` once resolved — assert the SVG container + `aria-label` exist regardless.
- `role="img"` and an `aria-label` (from `data.name` or `'Freehand drawing'`) are present.

**Step 2: Run, verify fail.**
Run: `bun test packages/canvas/src/nodes/freehand-node.test.tsx`
Expected: FAIL.

**Step 3: Implement** (`freehand-node.tsx`). Structure:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { COLOR_TOKENS } from '../lib/color-tokens.ts';
import type { ColorToken } from '../types.ts';
import { denormalizePoints, type Point } from './freehand-geometry.ts';
import { FREEHAND_STROKE_OPTIONS, strokeOutlineToPath } from './freehand-stroke.ts';

// Module-singleton dynamic import of the optional peer dep. Resolves to
// getStroke or null (peer dep missing). Mirrors IconifyOrPlaceholder.
type GetStroke = (points: number[][], opts?: Record<string, unknown>) => number[][];
let getStrokePromise: Promise<GetStroke | null> | null = null;
function loadGetStroke(): Promise<GetStroke | null> {
  if (!getStrokePromise) {
    getStrokePromise = import('perfect-freehand')
      .then((m) => m.getStroke as GetStroke)
      .catch(() => null);
  }
  return getStrokePromise;
}

export interface FreehandNodeData {
  points: Point[];
  name?: string;
  width?: number;
  height?: number;
  color?: ColorToken;
  strokeWidth?: number;
}

export function FreehandNode({ data }: NodeProps) {
  const d = data as unknown as FreehandNodeData;
  const width = d.width ?? 100;
  const height = d.height ?? 100;
  const [getStroke, setGetStroke] = useState<GetStroke | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    loadGetStroke().then((g) => {
      if (mounted.current) setGetStroke(() => g);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  const local = denormalizePoints(d.points, { x: 0, y: 0, width, height });
  const colorVar = COLOR_TOKENS[d.color ?? 'default']; // confirm the export shape
  const size = (d.strokeWidth ?? 1) * FREEHAND_STROKE_OPTIONS.size;
  const label = d.name ?? 'Freehand drawing';

  let body: JSX.Element;
  if (getStroke) {
    const outline = getStroke(local, { ...FREEHAND_STROKE_OPTIONS, size });
    body = <path d={strokeOutlineToPath(outline)} fill={colorVar} />;
  } else {
    // Fallback until perfect-freehand resolves (or forever if it's missing).
    body = (
      <polyline
        points={local.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={colorVar}
        strokeWidth={size / 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  return (
    <svg
      role="img"
      aria-label={label}
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width, height, overflow: 'visible' }}
    >
      {body}
    </svg>
  );
}
```

> **Verify before coding:** the exact shape of `COLOR_TOKENS` in `src/lib/color-tokens.ts` (it may map token→CSS-var-name vs token→object). Match what `icon-node.tsx` does to resolve `data.color` to a paint value. Adjust `colorVar` accordingly. Also confirm `JSX.Element` import style matches the file's neighbors (React 18, automatic runtime).

**Step 4: Run, verify pass.**
Run: `bun test packages/canvas/src/nodes/freehand-node.test.tsx`
Expected: PASS.

**Step 5: Commit.**
```bash
git add packages/canvas/src/nodes/freehand-node.tsx packages/canvas/src/nodes/freehand-node.test.tsx
git commit -m "feat(canvas): add FreehandNode renderer with peer-dep fallback"
```

---

## Task 5: Register `freehand` in the `nodeTypes` map

**Files:**
- Modify: `packages/canvas/src/components/seeflow-canvas.tsx`

**Step 1:** Add the import near the other node imports (~line 72-81):
```ts
import { FreehandNode } from '../nodes/freehand-node.tsx';
```

**Step 2:** Add to the `nodeTypes` object (~line 1319-1340), after `linkflow`:
```ts
  freehand: FreehandNode,
```

**Step 3: Typecheck.**
Run: `cd packages/canvas && bun run typecheck && cd ../..`
Expected: clean.

**Step 4: Commit.**
```bash
git add packages/canvas/src/components/seeflow-canvas.tsx
git commit -m "feat(canvas): register freehand in nodeTypes"
```

---

## Task 6: `CanvasMode` pen kind + toolbar pen tool

**Files:**
- Modify: `packages/canvas/src/types.ts`
- Modify: `packages/canvas/src/components/canvas-toolbar.tsx`
- Test: `packages/canvas/src/components/canvas-toolbar.test.tsx`

**Step 1:** Add the pen kind to `CanvasMode` (`types.ts` ~line 294):
```ts
export type CanvasMode =
  | { kind: 'select' }
  | { kind: 'hand' }
  | { kind: 'draw'; shape: DrawableNodeType }
  | { kind: 'draw-icon'; iconName: string }
  | { kind: 'pen' };
```

**Step 2:** Wire a `tool.pen` CommandId in `src/lib/keyboard-shortcuts.ts` (mirror the existing `tool.hand`/`tool.select` entries — find `CommandId` union + `getCommandTooltip` map and add `tool.pen` with label "Pen" and a key if the others have keys, e.g. `P`).

**Step 3: Write failing toolbar test** — assert clicking the pen button calls `onModeChange({ kind: 'pen' })`, and that when `mode.kind === 'pen'` the pen button is active. Model on the existing select/hand button tests in `canvas-toolbar.test.tsx`.

**Step 4: Run, verify fail.**
Run: `bun test packages/canvas/src/components/canvas-toolbar.test.tsx`

**Step 5: Implement.** In `canvas-toolbar.tsx`:
- Import `Pencil` from `lucide-react`.
- Add a pen button to the mode cluster (near the `TOOLBAR_MODES` select/hand render). It toggles like the others: `active ? onModeChange({ kind: 'select' }) : onModeChange({ kind: 'pen' })`, `active = mode.kind === 'pen'`. Use `getCommandTooltip('tool.pen')` for title/aria.
- If `TOOLBAR_MODES` is a typed array of `{ kind: 'select' | 'hand' }`, either widen that type to include `'pen'` or render the pen button explicitly alongside the mapped modes (explicit is simpler and avoids touching the radio typing).

**Step 6: Run, verify pass.**
Run: `bun test packages/canvas/src/components/canvas-toolbar.test.tsx`

**Step 7: Typecheck + commit.**
```bash
cd packages/canvas && bun run typecheck && cd ../..
git add packages/canvas/src/types.ts packages/canvas/src/components/canvas-toolbar.tsx packages/canvas/src/components/canvas-toolbar.test.tsx packages/canvas/src/lib/keyboard-shortcuts.ts
git commit -m "feat(canvas): add pen tool to toolbar and CanvasMode"
```

---

## Task 7: Capture gesture, live preview, and commit

**Files:**
- Modify: `packages/canvas/src/components/seeflow-canvas.tsx`
- Modify: `packages/canvas/src/components/seeflow-canvas.test.tsx` (extend, don't reorder state)

This is the largest task. Add a new prop `onCreateFreehandNode` and branch the pointer handlers on pen mode. **Use refs for the in-progress path; reuse the existing `drawStart`/`drawCurrent` ghost slots for preview bounds if helpful, but DO NOT add a new `useState` mid-body** (hook-shim index rule).

**Step 1:** Add the prop to the canvas props interface (near `onCreateIconNode`, ~line 571):
```ts
  /**
   * Commit a new type:'freehand' node from the pen tool. `position` is the
   * stroke's top-left in flow coords; `points` are normalized to the box.
   */
  onCreateFreehandNode?: (
    position: { x: number; y: number },
    size: { width: number; height: number },
    points: Point[],
  ) => void;
```
Import `Point` from `../nodes/freehand-geometry.ts`.

**Step 2:** Add refs near the existing draw refs (~line 2460):
```ts
  const penPointsRef = useRef<Point[]>([]);
  const penDrawingRef = useRef(false);
```
Derive `penMode`:
```ts
  const penMode = canvasMode.kind === 'pen';
```
Mirror it into a ref like `drawShapeRef` is mirrored (~line 2464 effect block):
```ts
  const penModeRef = useRef(penMode);
  useEffect(() => {
    penModeRef.current = penMode;
  }, [penMode]);
```

**Step 3:** Branch the pointer handlers (`onPointerDown`/`Move`/`Up`, ~line 2615-2724):

- `onPointerDown`: BEFORE the existing `if (!drawShapeRef.current && !drawIconRef.current) return;` guard, add a pen branch:
  ```ts
  if (penModeRef.current) {
    const target = e.target as HTMLElement | null;
    if (!target?.classList.contains('react-flow__pane')) return;
    penDrawingRef.current = true;
    penPointsRef.current = [[e.clientX, e.clientY, e.pressure || 0.5]];
    setDrawCurrent({ x: e.clientX, y: e.clientY }); // reuse ghost slot to force re-render
    setDrawStart({ x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  ```
- `onPointerMove`: add at the top:
  ```ts
  if (penDrawingRef.current) {
    penPointsRef.current.push([e.clientX, e.clientY, e.pressure || 0.5]);
    setDrawCurrent({ x: e.clientX, y: e.clientY });
    return;
  }
  ```
- `onPointerUp`: add at the top, before the existing draw-commit logic:
  ```ts
  if (penDrawingRef.current) {
    penDrawingRef.current = false;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {}
    const raw = penPointsRef.current;
    penPointsRef.current = [];
    setDrawStart(null);
    setDrawCurrent(null);
    const rfInstance = rfInstanceRef.current;
    if (!rfInstance || raw.length < 2) return; // stay in pen mode
    // Project client → flow coords.
    const flowPts: Point[] = raw.map((p) => {
      const f = rfInstance.screenToFlowPosition({ x: p[0], y: p[1] });
      return [f.x, f.y, p[2]];
    });
    const box = boundingBox(flowPts);
    // Accidental click guard uses SCREEN extent (UX threshold).
    const screenBox = boundingBox(raw);
    if (isAccidentalStroke(screenBox)) return;
    const normalized = simplifyRDP(normalizePoints(flowPts, box), 0.005);
    onCreateFreehandNode?.({ x: box.x, y: box.y }, { width: box.width, height: box.height }, normalized);
    // NOTE: do NOT exitDrawMode() — pen stays armed for continuous drawing.
    return;
  }
  ```
  Import `boundingBox`, `isAccidentalStroke`, `normalizePoints`, `simplifyRDP` from `../nodes/freehand-geometry.ts`.

**Step 4:** Render the live preview. Find the ghost render block (~line 5084, `data-ghost-shape`). Add a parallel branch: when `penMode` and `drawStart`/`drawCurrent` are set AND there are ≥2 `penPointsRef.current` points, render an `<svg>` overlay (client-space, `position: fixed`/absolute over the pane) drawing the in-progress stroke via the same `strokeOutlineToPath(getStroke(...))` path. Keep it simple — a `<polyline>` through `penPointsRef.current` client coords is an acceptable v1 preview if wiring getStroke into the overlay is awkward; the COMMITTED node is the source of truth. (If you use a polyline preview, add a code comment noting the slight preview/commit fidelity gap and why it's acceptable here.)

**Step 5:** Add `touch-action: none` to the pane wrapper when `penMode` (or `drawArmed || penMode`). Find where the pane/wrapper style or className is set and gate a `sf:touch-none` class or inline `touchAction`.

**Step 6:** Esc already calls `exitDrawMode()` → `onCanvasModeChange({ kind: 'select' })` via the keyboard effect (~line 2514). Confirm pen mode is covered; if the Esc handler is gated on `drawArmed`, widen the gate to include `penMode`.

**Step 7: Tests.** Extend `seeflow-canvas.test.tsx` to cover the commit math path if reachable through the shim; otherwise the geometry is already unit-tested in Task 2 and the end-to-end path is covered by E2E (Task 10). Add at minimum a test that `onCreateFreehandNode` is invoked when a synthetic pen pointer sequence runs, if the existing harness supports synthetic pointer dispatch (model on existing draw-commit tests).

**Step 8: Run, typecheck.**
Run: `bun test packages/canvas/src/components/seeflow-canvas.test.tsx && cd packages/canvas && bun run typecheck && cd ../..`

**Step 9: Commit.**
```bash
git add packages/canvas/src/components/seeflow-canvas.tsx packages/canvas/src/components/seeflow-canvas.test.tsx
git commit -m "feat(canvas): capture freehand strokes with the pen tool"
```

---

## Task 8: Host wiring in apps/web (`onCreateFreehandNode`)

**Files:**
- Modify: `apps/web/src/pages/demo-view.tsx`

**Step 1:** Add an `onCreateFreehandNode` callback modeled on `onCreateIconNode` (~line 1217). Import `Point` type from `@seeflow/canvas` if exported (see Task 11), else inline `[number, number, number][]`.

```ts
const onCreateFreehandNode = useCallback(
  (
    position: Position,
    size: { width: number; height: number },
    points: [number, number, number][],
  ) => {
    if (!flowId || !adapter) return;
    setEditError(null);
    const id = `node-${shortId()}`;
    const data = { points, width: size.width, height: size.height };
    const payload = { id, type: 'freehand' as const, position, data };
    const optimistic: FlowNode = { id, type: 'freehand', position, data } as FlowNode;
    setNodeOverride(id, optimistic as Partial<FlowNode>);
    setSelectedIds([id]);
    adapter.createNode(payload).catch((err) => {
      dropNodeOverride(id);
      setEditError(err instanceof Error ? err.message : String(err));
      console.error('createNode (freehand) failed', err);
    });
  },
  [flowId, adapter, setNodeOverride, dropNodeOverride],
);
```

**Step 2:** Pass `onCreateFreehandNode={onCreateFreehandNode}` to `<SeeflowCanvas>` (near the other `onCreate*` props, ~line 2711 area).

**Step 3:** Confirm `canvasMode` of kind `'pen'` flows through (demo-view owns `useState<CanvasMode>`). No change needed beyond the type widening from Task 6 — but check any `switch (canvasMode.kind)` / exhaustive handling in demo-view that the new kind doesn't break (e.g. the line that resets to select). Add a `case 'pen':` if an exhaustive switch exists.

**Step 4:** Verify the studio create handler accepts `type: 'freehand'`. Check `apps/studio/src/api.ts` / the node-create route + writer (`apps/studio/src/*` that splits resolved node → flow.json/style.json). If it's a data-driven pass-through validated by the schema, no change. If there is a per-type `switch`, add a `freehand` branch (points stay in flow.json data; width/height/position/color/strokeWidth route to style.json — same as icon). **Grep first:** `grep -rn "type === 'icon'\|case 'icon'" apps/studio/src`.

**Step 5: Typecheck.**
Run: `bun run typecheck` (root).

**Step 6: Commit.**
```bash
git add apps/web/src/pages/demo-view.tsx
git commit -m "feat(web): wire onCreateFreehandNode to the rest adapter"
```

---

## Task 9: Style-strip — color + strokeWidth for freehand

**Files:**
- Modify: `packages/canvas/src/components/style-strip.tsx`
- Test: `packages/canvas/src/components/style-strip.test.tsx`

The strip already renders a color swatch + strokeWidth control for `type === 'icon'` (`firstIconNode`, ~line 243-420). Generalize so freehand gets the same two controls.

**Step 1: Write failing test** — selecting a single `freehand` node shows the color trigger and strokeWidth control, and picking a color calls `onStyleNode(id, { color })`.

**Step 2: Run, verify fail.**

**Step 3: Implement.** Broaden the icon-specific detection to include freehand:
```ts
const pureInkType = pureNode && nodes.every((n) => n.type === 'icon' || n.type === 'freehand');
const firstInkNode = pureInkType
  ? (nodes.find((n) => n.type === 'icon' || n.type === 'freehand') as Extract<FlowNode, { type: 'icon' | 'freehand' }>)
  : undefined;
```
Use `firstInkNode` wherever `firstIconNode` drives the color/strokeWidth controls (the `data.color` / `data.strokeWidth` reads and the `onStyleNode` writes). Keep the icon-only affordances (e.g. "Change icon" via `onRequestIconReplace`) gated on `n.type === 'icon'` so freehand doesn't get a change-icon button.

**Step 4: Run, verify pass + typecheck.**

**Step 5: Commit.**
```bash
git add packages/canvas/src/components/style-strip.tsx packages/canvas/src/components/style-strip.test.tsx
git commit -m "feat(canvas): expose color + strokeWidth for freehand nodes"
```

---

## Task 10: Integration + E2E + visual baseline

**Files:**
- Create/extend: `apps/studio/integration/*.it.ts`
- Create: `apps/studio/e2e/freehand.e2e.ts`

**Step 1: Integration** — create a `freehand` node via the API and assert it round-trips: `data.points` lands in `flow.json`, `position`/`width`/`height` land in `style.json`. Model on existing node-create integration tests; run with `bun run test:it:bun`.

**Step 2: E2E** — Playwright spec: load a flow in edit mode, click the pen tool, dispatch a pointer-down/move(×N)/up sequence on the pane, assert a `[data-canvas-mode="pen"]` is set while armed and that a `freehand` node exists after release. Add ONE visual baseline screenshot of a committed stroke.

**Step 3: Generate the baseline (Docker required, darwin host):**
Run: `bun run test:it:update-snapshots`
Commit only the `*-chromium-linux.png` files (never `*-darwin.png`).

**Step 4: Run the suites.**
Run: `bun run test:it` (integration + e2e orchestrator; rebuilds stale bundles).

**Step 5: Commit.**
```bash
git add apps/studio/integration apps/studio/e2e
git commit -m "test: integration + e2e coverage for freehand pen"
```

---

## Task 11: Public API export + final verification

**Files:**
- Modify: `packages/canvas/src/index.ts`

**Step 1:** Export the new public surface in the matching numbered section of `src/index.ts`, keeping each section sorted:
- `FreehandNode` (if other node renderers are exported — check; many are internal, so only export if a host needs it).
- The `Point` type and `FreehandNodeData` type IF `apps/web` imports them (Task 8). Otherwise keep internal.
- `CanvasMode` already exported (pen kind rides along automatically).

**Step 2: Full gate.**
```bash
bun run format
bun run lint
bun run typecheck
bun test
bun run test:it
```
Expected: all green. (Per memory `feedback_commit_and_test_gating`: unit + integration + e2e all green before done.)

**Step 3:** Rebuild the canvas dist so downstream bundles pick up the renderer:
Run: `bun run --filter @seeflow/canvas build`
(The GitHub Action commits `dist/` on `main`; locally just ensure it builds clean.)

**Step 4: Final commit.**
```bash
git add -A
git commit -m "chore(canvas): export freehand public API and rebuild dist"
```

---

## Done criteria

- [ ] Pen tool in the toolbar arms freehand capture (crosshair cursor, `touch-action: none`).
- [ ] Dragging draws smooth ink that commits as a `freehand` node on release; pen stays armed; Esc exits.
- [ ] Stroke node selects/moves/resizes/restyles (color + width)/deletes/undoes/copy-pastes via existing machinery.
- [ ] Renders in view + mini modes; renders a `<polyline>` fallback when `perfect-freehand` is absent.
- [ ] `flow.json` carries normalized `points`; `style.json` carries box + color + strokeWidth.
- [ ] `make verify-seeflow-schema-sync` passes; unit + integration + e2e all green; visual baseline is chromium-linux.

## Risks / verify-as-you-go

- **`COLOR_TOKENS` shape** (Task 4) — confirm token→paint resolution against `icon-node.tsx` before finalizing.
- **`TOOLBAR_MODES` typing** (Task 6) — widening vs explicit pen button; explicit is lower-risk.
- **Studio writer per-type branch** (Task 8 Step 4) — grep before assuming pass-through.
- **Hook-shim state indices** (Task 7) — use refs; never insert a `useState` mid-body.
- **Live preview fidelity** (Task 7 Step 4) — polyline preview acceptable; committed node is source of truth.
