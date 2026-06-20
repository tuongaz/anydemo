# Canvas: clipboard/image paste, Link-node header, shape stroke fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix four canvas issues: (1) OS-clipboard node copy/paste + paste-image-from-clipboard, (2) Link node shows a header bar with icon + title, (3) triangle bottom edge renders thin, (4) hexagon top/bottom edges render thin.

**Architecture:**
- **Shapes (3,4):** polygon edges sitting on the SVG `viewBox` boundary get half their stroke clipped. Pad the `viewBox` so the stroke + miter tips fall inside the viewport. Same fix for the latent parallelogram bug.
- **Link header (2):** linkflow data already carries `name`/`icon` via `NodeSemanticBase`. Render the shared `<NodeHeader>` in all three states; wire `onNameChange`/`onIconChange` into the linkflow runtime data in `buildNode`.
- **Clipboard (1):** native `copy`/`paste` DOM events on the canvas wrapper (permission-free), owned by the host (`apps/web/demo-view.tsx`). Copy writes a JSON envelope to `clipboardData`; paste branches on image-file vs seeflow-JSON. Reuse existing `buildPastePayload`, `handleCanvasFileDrop`, and `onCreateImageFromFile`.

**Tech Stack:** Bun, TypeScript (strict + noUncheckedIndexedAccess), React 18, @xyflow/react v12, Tailwind v4 (`sf:` prefix), Biome, bun:test, Playwright (chromium-linux baselines).

**Conventions (apply to every task):**
- `bun run format` BEFORE `bun run lint`. 2-space indent, 100-col, single quotes, trailing commas, semicolons.
- Tests live beside sources (`foo.ts` + `foo.test.ts`).
- After any `packages/canvas` source edit, rebuild before typechecking the studio/web: `bun run --filter @seeflow/canvas build`.
- Canvas internal imports are relative (`'../lib/foo.ts'`), never `@/`.
- New `SeeflowCanvas` `useState` goes at the END of the body (hook-shim test index rule). We add none here, but be aware.
- Each phase is one or more focused commits. Order: Phase A (shapes) → Phase B (link header) → Phase C (clipboard). Build momentum on the low-risk shape fix first.

---

## Phase A — Shape stroke clipping (Items 3 & 4)

Fixes triangle, hexagon, and parallelogram. Root cause: `viewBox="0 0 W H"` + `preserveAspectRatio="none"` clips the half of any boundary-aligned edge's stroke that falls outside the viewport. Fix: pad the viewBox by a margin `m` derived from stroke width so the whole stroke lands inside.

**Shared helper first** so the three shapes stay DRY.

### Task A1: Add a `paddedViewBox` helper

**Files:**
- Modify: `packages/canvas/src/nodes/shapes/types.ts`
- Test: `packages/canvas/src/nodes/shapes/types.test.ts` (create if missing)

**Step 1: Write the failing test**

Add to `types.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { paddedViewBox } from './types.ts';

describe('paddedViewBox', () => {
  it('insets the viewBox by the stroke-derived margin on all sides', () => {
    // margin = strokeWidth (so half-stroke + miter clears the edge)
    expect(paddedViewBox(100, 60, 2)).toBe('-2 -2 104 64');
  });

  it('uses DEFAULT_STROKE_WIDTH-scaled margin when strokeWidth is large', () => {
    expect(paddedViewBox(200, 100, 6)).toBe('-6 -6 212 112');
  });

  it('never produces a zero-area viewBox for tiny shapes', () => {
    // width/height are always >0 in practice; guard is defensive
    expect(paddedViewBox(10, 10, 2)).toBe('-2 -2 14 14');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/canvas && bun test src/nodes/shapes/types.test.ts`
Expected: FAIL — `paddedViewBox` is not exported.

**Step 3: Write minimal implementation**

Add to `packages/canvas/src/nodes/shapes/types.ts` (below `DEFAULT_STROKE_WIDTH`):

```ts
/**
 * Build a viewBox padded by `strokeWidth` on every side. Boundary-aligned
 * polygon edges (e.g. a triangle base on `y=height`) otherwise have the outer
 * half of their stroke — and any miter tip — clipped by the SVG viewport,
 * rendering at half thickness. Padding the viewBox by the full stroke width
 * pulls the whole stroke inside the visible region. With
 * `preserveAspectRatio="none"` the padded box still maps onto the full wrapper,
 * so the glyph only loses a sub-pixel margin.
 */
export function paddedViewBox(width: number, height: number, strokeWidth: number): string {
  const m = strokeWidth;
  return `${-m} ${-m} ${width + 2 * m} ${height + 2 * m}`;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/canvas && bun test src/nodes/shapes/types.test.ts`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add packages/canvas/src/nodes/shapes/types.ts packages/canvas/src/nodes/shapes/types.test.ts
git commit -m "feat(canvas): add paddedViewBox helper for shape stroke clipping"
```

### Task A2: Apply `paddedViewBox` to triangle, hexagon, parallelogram

**Files:**
- Modify: `packages/canvas/src/nodes/shapes/triangle.tsx`
- Modify: `packages/canvas/src/nodes/shapes/hexagon.tsx`
- Modify: `packages/canvas/src/nodes/shapes/parallelogram.tsx`
- Test: `packages/canvas/src/nodes/shapes/triangle.test.tsx`, `hexagon.test.tsx`, `parallelogram.test.tsx` (create whichever are missing; check first with `ls packages/canvas/src/nodes/shapes/`)

**Step 1: Write the failing tests**

For each shape, render it and assert the `<svg>`'s `viewBox` is padded. Example for triangle (`triangle.test.tsx`):

```tsx
import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TriangleShape } from './triangle.tsx';

describe('TriangleShape', () => {
  it('pads the viewBox so the boundary-aligned base stroke is not clipped', () => {
    const html = renderToStaticMarkup(
      <TriangleShape width={100} height={60} borderSize={2} />,
    );
    expect(html).toContain('viewBox="-2 -2 104 64"');
  });
});
```

Mirror for hexagon (`width=100 height=60 borderSize=2` → `viewBox="-2 -2 104 64"`) and parallelogram. Use whatever render helper the sibling shape tests already use — check `diamond.test.tsx` if it exists; otherwise `renderToStaticMarkup` from `react-dom/server` as above.

**Step 2: Run tests to verify they fail**

Run: `cd packages/canvas && bun test src/nodes/shapes/`
Expected: FAIL — current markup contains `viewBox="0 0 100 60"`.

**Step 3: Write minimal implementation**

In each of the three files, import `paddedViewBox` and swap the viewBox literal. Triangle example:

```tsx
import {
  BG_FALLBACK,
  BORDER_FALLBACK,
  DEFAULT_STROKE_WIDTH,
  type ShapePartProps,
  dashFor,
  paddedViewBox,
} from './types.ts';
```

then change:

```tsx
viewBox={`0 0 ${width} ${height}`}
```

to:

```tsx
viewBox={paddedViewBox(width, height, strokeWidth)}
```

`strokeWidth` is already computed in each component (`const strokeWidth = borderSize ?? DEFAULT_STROKE_WIDTH;`). Do NOT change the `points` — only the viewBox. Leave `diamond.tsx` untouched.

**Step 4: Run tests to verify they pass**

Run: `cd packages/canvas && bun test src/nodes/shapes/`
Expected: PASS.

**Step 5: Typecheck + lint + commit**

```bash
cd packages/canvas && bun run typecheck && cd ../..
bun run format && bun run lint
git add packages/canvas/src/nodes/shapes/
git commit -m "fix(canvas): pad shape viewBox so triangle/hexagon/parallelogram edges render full-width

Boundary-aligned polygon edges had half their stroke clipped by the SVG
viewport. Pad the viewBox by the stroke width so the whole stroke stays inside."
```

### Task A3: Refresh shape visual baselines

**Files:**
- Snapshots under `apps/studio/e2e/**/*-chromium-linux.png` covering the shape palette (search: `grep -rl "triangle\|hexagon\|parallelogram\|shape" apps/studio/e2e`).

**Step 1:** Identify which e2e spec renders these shapes. Run: `grep -rln "triangle\|hexagon\|parallelogram" apps/studio/e2e`.

**Step 2:** Regenerate baselines (Docker Desktop must be running):

Run: `bun run test:it:update-snapshots`
Expected: updated `*-chromium-linux.png` for the affected specs.

**Step 3:** Sanity-check the diff visually (the bottom/top edges should now match the side edges). Commit only the chromium-linux PNGs:

```bash
git add apps/studio/e2e/**/*-chromium-linux.png
git commit -m "test(e2e): refresh shape baselines after viewBox padding fix"
```

> If Docker is unavailable, STOP and report — do not commit darwin snapshots.

---

## Phase B — Link node header + icon (Item 2)

Render `<NodeHeader>` on all three linkflow states; title = `data.name` (empty → placeholder, no flow-name fallback); icon = `data.icon` (editable when selected). Move the resolved flow name to a secondary line in linked-healthy.

### Task B1: Wire `onIconChange` to linkflow in `buildNode`

`onNameChange` already reaches linkflow (the gate only excludes `ellipse`). `onIconChange` is gated to `rectangle`/`component` only — add `linkflow`.

**Files:**
- Modify: `packages/canvas/src/components/seeflow-canvas.tsx:3093`
- Test: `packages/canvas/src/components/seeflow-canvas.test.tsx`

**Step 1: Write the failing test**

Find the existing `buildNode`/runtime-data test block in `seeflow-canvas.test.tsx` (search `onIconChange`). Add a case asserting a `type:'linkflow'` node in edit mode receives `data.onIconChange` defined, and a `type:'text'` node receives `undefined`. Follow the existing harness pattern in that file (it uses the hook-shim `callSeeflowCanvas`/`renderWithHooks`). If the existing test enumerates node types in a table, add `linkflow` to the "icon editable" set.

**Step 2: Run test to verify it fails**

Run: `cd packages/canvas && bun test src/components/seeflow-canvas.test.tsx`
Expected: FAIL — linkflow currently gets `undefined`.

**Step 3: Write minimal implementation**

At `seeflow-canvas.tsx:3093` change:

```ts
if (merged.type !== 'rectangle' && merged.type !== 'component') return undefined;
```

to:

```ts
if (
  merged.type !== 'rectangle' &&
  merged.type !== 'component' &&
  merged.type !== 'linkflow'
)
  return undefined;
```

**Step 4: Run test to verify it passes**

Run: `cd packages/canvas && bun test src/components/seeflow-canvas.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/canvas/src/components/seeflow-canvas.tsx packages/canvas/src/components/seeflow-canvas.test.tsx
git commit -m "feat(canvas): wire onIconChange into linkflow runtime data"
```

### Task B2: Render `<NodeHeader>` in the linkflow node (all three states)

**Files:**
- Modify: `packages/canvas/src/nodes/linkflow-node.tsx`
- Test: `packages/canvas/src/nodes/linkflow-node.test.tsx`

**Design details:**
- Add to `LinkflowNodeRuntimeData`: `onNameChange?: (nodeId: string, name: string) => void;` and `onIconChange?: (nodeId: string, icon: string | null) => void;` (mirror the rectangle node's runtime data).
- Import `NodeHeader` from `./lib/node-header.tsx`.
- A shared `header` element rendered at the top of each state's container:

```tsx
const header = (
  <NodeHeader
    nodeId={id}
    name={data.name ?? ''}
    icon={data.icon}
    selected={selected}
    fontSize={data.fontSize}
    backgroundColor={data.backgroundColor}
    onNameChange={data.onNameChange}
    onIconChange={data.onIconChange}
    testId="linkflow-header"
  />
);
```

- **Unlinked:** container becomes `flex-col`; render `{header}` then the existing dashed "Link to a flow" pill in a body wrapper below.
- **Broken:** convert the outer `<button>` to a `<div>` (so the header's icon-picker / inline-edit aren't swallowed). Render `{header}`, then a body `<button>` (or click-target div) carrying the existing `onClick={() => data.onOpenPicker?.('edit')}`, the AlertTriangle, last-known slug, and "Linked flow missing" text. Keep `data-testid="linkflow-node"` + `data-linkflow-state="broken"` on the OUTER div for test stability; move the click handler to the inner element.
- **Linked-healthy:** render `{header}` at the top; in the body keep the pencil (re-target) + "Open" (follow) buttons, and render the resolved flow name as a SECONDARY line (smaller, muted) — move `data-testid="linkflow-flow-name"` to that secondary line. The header title slot is now `data.name`.
- `containerStyle` stays on the outer wrapper. Switch the linked-healthy + unlinked outer wrappers to `flex-col` and drop the `items-center`/`gap-3` that assumed a single row.

**Size bump:** update

```ts
export const LINKFLOW_DEFAULT_SIZE = { width: 240, height: 100 } as const;
export const LINKFLOW_MIN_SIZE = { width: 160, height: 80 } as const;
```

to give room for the header bar, e.g. `height: 132` (default) and `height: 96` (min). Pick the value that keeps the linked-healthy header + body legible; verify against `design/design.html` spacing tokens.

**Step 1: Write the failing tests**

In `linkflow-node.test.tsx` add cases (follow the file's existing render harness):
1. Unlinked state renders `[data-testid="linkflow-header"]` AND the link button.
2. Broken state renders the header AND `linkflow-broken-label`, and the outer element is NOT a `<button>` (so header controls work).
3. Linked-healthy renders the header with the empty-name placeholder when `data.name` is unset, and renders `linkflow-flow-name` as a secondary line (still present).
4. Header title reflects `data.name` when set (e.g. `'My Link'`), and does NOT fall back to the resolved flow name.

**Step 2: Run tests to verify they fail**

Run: `cd packages/canvas && bun test src/nodes/linkflow-node.test.tsx`
Expected: FAIL — no header rendered.

**Step 3: Write the implementation** per the design details above.

**Step 4: Run tests to verify they pass**

Run: `cd packages/canvas && bun test src/nodes/linkflow-node.test.tsx`
Expected: PASS.

**Step 5: Full canvas test + typecheck**

Run: `cd packages/canvas && bun test && bun run typecheck`
Expected: PASS (watch for any existing linkflow assertions that depended on the old single-row layout — update them to match the new structure, keeping behavior assertions, not snapshotting incidental classNames).

**Step 6: Commit**

```bash
cd ../.. && bun run format && bun run lint
git add packages/canvas/src/nodes/linkflow-node.tsx packages/canvas/src/nodes/linkflow-node.test.tsx
git commit -m "feat(canvas): give linkflow node a header bar with icon + editable title"
```

### Task B3: Rebuild canvas + refresh linkflow baselines

**Step 1:** Rebuild the canvas bundle (web/studio consume `dist/`):

Run: `bun run --filter @seeflow/canvas build`

**Step 2:** Find linkflow e2e specs: `grep -rln "linkflow" apps/studio/e2e`. Regenerate baselines:

Run: `bun run test:it:update-snapshots`

**Step 3:** Commit the rebuilt dist (if the repo tracks it on branches — check `git status`) and the chromium-linux PNGs:

```bash
git add packages/canvas/dist apps/studio/e2e/**/*-chromium-linux.png
git commit -m "test(e2e): refresh linkflow baselines + rebuild canvas for header change"
```

> Verify `packages/canvas/dist` is tracked before adding — if `.gitignore`d on branches, skip it; CI's publish action handles dist on main.

---

## Phase C — Clipboard: OS copy/paste + paste image (Item 1)

Native `copy`/`paste` DOM listeners in the host (`demo-view.tsx`). Copy writes a JSON envelope; paste branches image-file → image node, seeflow-JSON → node paste. Reuse `buildPastePayload` (node paste) and `handleCanvasFileDrop` (image paste).

### Task C1: Clipboard envelope encode/decode (pure)

**Files:**
- Modify: `apps/web/src/lib/clipboard.ts`
- Test: `apps/web/src/lib/clipboard.test.ts`

**Step 1: Write the failing test**

Add to `clipboard.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { encodeClipboard, parseClipboard, SEEFLOW_CLIPBOARD_MIME } from './clipboard';

describe('clipboard envelope', () => {
  const nodes = [{ id: 'a', position: { x: 0, y: 0 } }] as const;
  const connectors = [{ id: 'c', source: 'a', target: 'a' }] as const;

  it('round-trips nodes + connectors through encode/parse', () => {
    const text = encodeClipboard({ nodes, connectors });
    expect(parseClipboard(text)).toEqual({ nodes, connectors });
  });

  it('returns null for non-seeflow text', () => {
    expect(parseClipboard('hello world')).toBeNull();
    expect(parseClipboard('{"foo":1}')).toBeNull();
    expect(parseClipboard('not json {')).toBeNull();
  });

  it('returns null when the envelope marker/version is wrong', () => {
    expect(parseClipboard(JSON.stringify({ nodes, connectors }))).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && bun test src/lib/clipboard.test.ts`
Expected: FAIL — exports missing.

**Step 3: Write minimal implementation**

Append to `apps/web/src/lib/clipboard.ts`:

```ts
/** Marker so a foreign clipboard string (a copied tweet, a file path) never
 *  parses as a paste-able flow fragment. Bump `v` if the envelope shape changes. */
const CLIPBOARD_MARKER = '__seeflow_clipboard__';
export const SEEFLOW_CLIPBOARD_MIME = 'text/plain';

export interface ClipboardEnvelope<N extends PasteableNode, C extends PasteableConnector> {
  nodes: readonly N[];
  connectors: readonly C[];
}

export function encodeClipboard<N extends PasteableNode, C extends PasteableConnector>(
  payload: ClipboardEnvelope<N, C>,
): string {
  return JSON.stringify({ [CLIPBOARD_MARKER]: 1, nodes: payload.nodes, connectors: payload.connectors });
}

export function parseClipboard<N extends PasteableNode, C extends PasteableConnector>(
  text: string,
): ClipboardEnvelope<N, C> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj[CLIPBOARD_MARKER] !== 1) return null;
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.connectors)) return null;
  return { nodes: obj.nodes as N[], connectors: obj.connectors as C[] };
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && bun test src/lib/clipboard.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
cd ../.. && git add apps/web/src/lib/clipboard.ts apps/web/src/lib/clipboard.test.ts
git commit -m "feat(web): clipboard envelope encode/parse for OS-clipboard node copy"
```

### Task C2: Paste-dispatch decision (pure)

A pure function deciding what a paste event should do, so the DOM handler stays thin and testable.

**Files:**
- Create: `apps/web/src/lib/paste-dispatch.ts`
- Test: `apps/web/src/lib/paste-dispatch.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';
import { decidePasteAction } from './paste-dispatch';

const imageItem = { kind: 'file', type: 'image/png' };
const textItem = { kind: 'string', type: 'text/plain' };

describe('decidePasteAction', () => {
  it('ignores when an editable surface is focused', () => {
    expect(decidePasteAction({ isEditable: true, items: [imageItem], text: '' }).kind).toBe('ignore');
  });

  it('chooses image when clipboard holds an image file', () => {
    expect(decidePasteAction({ isEditable: false, items: [imageItem], text: '' }).kind).toBe('image');
  });

  it('prefers image over text when both present', () => {
    expect(
      decidePasteAction({ isEditable: false, items: [imageItem, textItem], text: '{...}' }).kind,
    ).toBe('image');
  });

  it('chooses nodes when text parses as a seeflow envelope', () => {
    const text = '{"__seeflow_clipboard__":1,"nodes":[],"connectors":[]}';
    const action = decidePasteAction({ isEditable: false, items: [textItem], text });
    expect(action.kind).toBe('nodes');
    if (action.kind === 'nodes') expect(action.payload.nodes).toEqual([]);
  });

  it('ignores plain non-seeflow text', () => {
    expect(decidePasteAction({ isEditable: false, items: [textItem], text: 'hi' }).kind).toBe('ignore');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/web && bun test src/lib/paste-dispatch.test.ts`
Expected: FAIL — module missing.

**Step 3: Write minimal implementation**

```ts
import type { PasteableConnector, PasteableNode } from './clipboard';
import { parseClipboard } from './clipboard';

export interface PasteItemMeta {
  kind: string; // 'file' | 'string'
  type: string; // MIME
}

export interface DecidePasteInput {
  isEditable: boolean;
  items: readonly PasteItemMeta[];
  text: string;
}

export type PasteAction<
  N extends PasteableNode = PasteableNode,
  C extends PasteableConnector = PasteableConnector,
> =
  | { kind: 'ignore' }
  | { kind: 'image' }
  | { kind: 'nodes'; payload: { nodes: readonly N[]; connectors: readonly C[] } };

export function decidePasteAction(input: DecidePasteInput): PasteAction {
  if (input.isEditable) return { kind: 'ignore' };
  const hasImage = input.items.some(
    (it) => it.kind === 'file' && it.type.toLowerCase().startsWith('image/'),
  );
  if (hasImage) return { kind: 'image' };
  const parsed = parseClipboard(input.text);
  if (parsed) return { kind: 'nodes', payload: parsed };
  return { kind: 'ignore' };
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/web && bun test src/lib/paste-dispatch.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
cd ../.. && git add apps/web/src/lib/paste-dispatch.ts apps/web/src/lib/paste-dispatch.test.ts
git commit -m "feat(web): pure paste-dispatch decision (image vs nodes vs ignore)"
```

### Task C3: Wire native `copy`/`paste` listeners in `demo-view.tsx`

**Files:**
- Modify: `apps/web/src/pages/demo-view.tsx`
- Test: integration/e2e (Task C4) — the listener body is a thin wiring layer over the pure functions already covered.

**Context to reuse (read these first):**
- `onCopyNodes(ids)` / `onPasteNodes(flowPos|null)` already exist (`demo-view.tsx:1622`, `:1645`). `onPasteNodes` already calls `buildPastePayload` + optimistic overrides + POST batch.
- `onCreateImageFromFile(args)` (`:1369`) creates an image node from a `File`.
- `handleCanvasFileDrop` + `computeImageDims` + `extractImageFiles` exported from `@seeflow/canvas` (used today by the canvas drop path). `clipboardData` IS a `DataTransfer`, so the image-paste path can call `handleCanvasFileDrop` directly.
- `selectedNodeIds` / `demoNodes` / `demoConnectors` are in scope (used by the Cmd+D path at `:1769`).
- Editable detection: reuse the same predicate the canvas uses (`isEditableTarget` / `isEditableActive`) — check `document.activeElement`. Find the existing helper (`grep -rn "isEditable" apps/web packages/canvas/src/lib/keyboard-shortcuts.ts`).

**Step 1:** Add an `isEditableActive()` helper local to demo-view (or import the canvas's exported one if available) that returns true when `document.activeElement` is an input/textarea/contentEditable.

**Step 2:** Add a `useEffect` (only when `flowId && adapter`) registering `copy` + `paste` on `window` (or the canvas wrapper). Sketch:

```tsx
useEffect(() => {
  if (!flowId || !adapter) return;

  const onCopy = (e: ClipboardEvent) => {
    if (isEditableActive() || selectedNodeIds.length === 0 || !e.clipboardData) return;
    const sel = new Set(selectedNodeIds);
    const nodes = demoNodes.filter((n) => sel.has(n.id));
    const connectors = demoConnectors.filter((c) => sel.has(c.source) && sel.has(c.target));
    if (nodes.length === 0) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', encodeClipboard({ nodes, connectors }));
    // same-tab fast path so paste works even if the OS clipboard is unreadable
    onCopyNodes(selectedNodeIds);
  };

  const onPaste = (e: ClipboardEvent) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const items = Array.from(cd.items).map((it) => ({ kind: it.kind, type: it.type }));
    const action = decidePasteAction({
      isEditable: isEditableActive(),
      items,
      text: cd.getData('text/plain'),
    });
    if (action.kind === 'ignore') return;
    e.preventDefault();
    if (action.kind === 'image') {
      // Reuse the drop pipeline; clipboardData is a DataTransfer. Drop at the
      // viewport center (no cursor coords on a keyboard paste).
      const rfInstance = canvasRef.current?.getReactFlowInstance?.(); // see note
      void handleCanvasFileDrop({
        dataTransfer: cd,
        clientPos: viewportCenterClientPos(),
        rfInstance,
        computeDims: computeImageDims,
        dispatch: onCreateImageFromFile,
      });
      return;
    }
    // action.kind === 'nodes' — paste from OS clipboard (cross-tab). Stash the
    // parsed payload into the same channel onPasteNodes reads, then paste.
    pasteFromEnvelope(action.payload); // see Step 3
  };

  window.addEventListener('copy', onCopy);
  window.addEventListener('paste', onPaste);
  return () => {
    window.removeEventListener('copy', onCopy);
    window.removeEventListener('paste', onPaste);
  };
}, [flowId, adapter, selectedNodeIds, demoNodes, demoConnectors, onCopyNodes, onCreateImageFromFile]);
```

**Step 3 — reconcile the node-paste path.** `onPasteNodes` currently reads `clipboardRef.current`. For cross-tab paste the payload comes from the OS clipboard envelope. Choose the SIMPLEST reconciliation:
- Refactor `onPasteNodes` to accept an optional explicit payload: `onPasteNodes(flowPos, payload?)`. When `payload` is given, use it; else fall back to `clipboardRef.current`. Then `pasteFromEnvelope(p) = onPasteNodes(null, p)`.
- This keeps the existing in-app same-tab path intact (Cmd+D, right-click) and adds the OS-clipboard path. Update the `onPasteNodes` signature + its one internal `clipboardRef` read accordingly; keep `buildPastePayload` usage unchanged.

**Step 4 — viewport center + rfInstance access.** The image-paste path needs an rfInstance and a center client position. Options (pick one, prefer least new surface area):
- (a) Add an imperative `capturePaste`-style method? No — too heavy. Instead compute center from the canvas wrapper's `getBoundingClientRect()` (query `.seeflow-canvas-root` or the known wrapper testid) for `clientPos`, and expose the rfInstance via a small addition to `SeeflowCanvasHandle` (e.g. `screenToFlow(clientPos)` or `pasteImageFiles(dataTransfer)`).
- **Recommended:** add a host-facing canvas handle method `pasteImageFromClipboard(dataTransfer: DataTransfer)` to `SeeflowCanvasHandle` that internally runs `handleCanvasFileDrop` with the canvas's own `rfInstanceRef` + its wrapper center. This keeps `screenToFlowPosition` + wrapper geometry INSIDE the canvas (where they live) and gives the host a one-call entry. Wire per the canvas CLAUDE.md "Imperative ref handle" rule: add to BOTH `UseCanvasExportApi` and `SeeflowCanvasHandle`, `useImperativeHandle` deps, and update the US-014 imperative-handle test. Then demo-view calls `canvasRef.current?.pasteImageFromClipboard(cd)` in the image branch.

> Decision point for the implementer: confirm whether `demo-view` already holds a `SeeflowCanvasHandle` ref (`grep -rn "SeeflowCanvasHandle\|canvasRef" apps/web/src`). If yes, the recommended handle method is cleanest. If no ref exists, compute center + use a newly-exposed `screenToFlow` handle method instead. Either way, geometry stays in the canvas.

**Step 5 — disable the now-duplicate canvas keydown copy/paste for C/V.** With native `copy`/`paste` owning C/V, stop the canvas's keydown chord from ALSO firing copy/paste (double-paste). `demo-view` passes `onCopySelection`/`onPasteSelection` into the canvas (used by `handleClipboardShortcut`). Set those to `undefined` so the chord no-ops for C/V, while keeping Cmd+D duplicate (handled separately at `:1769`) and Cmd+A. Verify Cmd+D still works after this change (it uses `onCopyNodes`+`onPasteNodes` directly, not the canvas chord).

> Edge: ensure removing `onCopySelection`/`onPasteSelection` doesn't break the right-click context-menu Copy/Paste (those use `onCopyNode`/`onPasteAt`, different props — confirm with `grep`).

**Step 6:** Typecheck both workspaces (rebuild canvas first if the handle changed):

```bash
bun run --filter @seeflow/canvas build
bun run typecheck
```

**Step 7:** Format, lint, commit:

```bash
bun run format && bun run lint
git add apps/web/src/pages/demo-view.tsx packages/canvas/src
git commit -m "feat: OS-clipboard node copy/paste + paste-image-from-clipboard

Native copy/paste DOM events own Cmd+C/V; image files paste as image nodes,
seeflow JSON envelopes paste cross-tab. Cmd+D/Cmd+A stay on the keydown path."
```

### Task C4: Integration / e2e coverage for clipboard

**Files:**
- Create/extend: `apps/studio/e2e/*.e2e.ts` (Playwright can synthesize clipboard via `page.evaluate` dispatching a `ClipboardEvent` with a `DataTransfer`, or via the clipboard API with permissions granted).

**Step 1: Write e2e tests**
1. Copy a node (Cmd+C), paste (Cmd+V) → a second node appears offset; assert node count +1.
2. Paste a synthesized image `ClipboardEvent` → an image node appears (assert `[data-node-type="image"]` count +1). Use a tiny PNG `File` in a `DataTransfer`.
3. (If feasible) cross-tab: open a second page, copy in page A, paste in page B → node appears. If Playwright clipboard isolation makes this flaky, assert the envelope is written to the clipboard in page A instead and cover cross-tab parsing in the C1/C2 unit tests (already done).

**Step 2: Run**

Run: `bun run test:it:e2e` (Docker Desktop running)
Expected: PASS. Refresh any baselines the new nodes shift: `bun run test:it:update-snapshots`.

**Step 3: Commit**

```bash
git add apps/studio/e2e
git commit -m "test(e2e): cover OS-clipboard copy/paste + image paste"
```

---

## Final gate (before finishing the branch)

Run the full suite from the worktree root:

```bash
bun run --filter @seeflow/canvas build   # ensure dist is fresh
bun run typecheck                          # all workspaces green
bun test                                   # unit — 0 fail
bun run format && bun run lint             # clean
bun run test:it                            # integration + e2e (Docker running)
```

All green → use superpowers:finishing-a-development-branch to open the PR (or push to main per the user's workflow preference). Per project memory: one commit per fix is already satisfied by the phase structure; gate on unit + integration (+ e2e) all green before declaring done.

## Out of scope (do NOT implement)
- Copying an image node's bytes OUT to the OS clipboard for other apps.
- Cross-PROJECT image-node paste (the `path` references the source project's file — leave broken; same-project paste is fine).
- Normalizing the diamond viewBox.
