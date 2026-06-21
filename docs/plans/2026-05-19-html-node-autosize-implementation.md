# HTML Node Auto-Size Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `htmlNode` instances auto-size to their HTML content on first paint (capped at 800×600 by a measuring container). Once the user drags the resize handle, persist explicit dimensions. A new "Fit to content" button on the htmlNode chrome resets back to auto-size.

**Architecture:**
- New optional field `autoSize: z.boolean()` on `HtmlNodeDataSchema`. Default behavior (field absent) is `autoSize === true`.
- Studio adapter (`mergeNodeUpdates` in `apps/studio/src/operations.ts`) enforces the invariant `autoSize === true ⊻ (width and height set on disk)`. Writing `width` / `height` flips `autoSize: false`; writing `autoSize: true` strips `width` / `height`.
- Canvas renderer (`packages/canvas/src/nodes/html-node.tsx`) forks layout on `userSized = isResizing || !autoSize`. Auto-size mode mounts an `inline-block` "measuring container" with `maxWidth: 800, maxHeight: 600` and `overflow: auto`; React Flow's wrapper sizes around it. User-sized mode keeps the existing behavior (outer wrapper pins `width` / `height`, inner fills).
- A debounced (150 ms) `ResizeObserver` calls `useReactFlow().updateNodeInternals(id)` on settle so React Flow re-reads the node's bounding rect and edges reposition. The observer never calls `onResize` and never writes to disk — auto-sized dimensions stay runtime-only.
- A new `maximize-2` icon button (top-right of the htmlNode chrome, htmlNode-only) calls a new host callback `onHtmlNodeFitToContent` which routes through the adapter's `updateNode(id, { autoSize: true })`.

**Tech Stack:** TypeScript, React 18, React Flow (`@xyflow/react`), Zod, Tailwind v4 (`sf:` prefix), Bun (test runner + builder), Hono backend, Lucide icons.

**Branch:** `ralph/tailwind-v4-upgrade` — work directly on this branch, NO worktree, NO new branch.

**Design source of truth:** This plan. Architectural decisions were finalized in a prior brainstorming session and must not be re-derived. If something here looks wrong, stop and ask — do not silently re-decide.

---

## Pre-flight

### Task 0.1: Baseline checks

**Step 1: Inspect tree state**

Run:
```bash
git status
git rev-parse --abbrev-ref HEAD
```
Expected: branch is `ralph/tailwind-v4-upgrade`. Status may show unrelated changes under `apps/studio/dist/web/` and `apps/web/index.html` from a prior canvas build — these are OK to leave alone.

**Step 2: Baseline typecheck + tests**

```bash
bun run typecheck
bun test packages/canvas
bun test apps/studio
```
Expected: all pass. Note the existing pass count for `packages/canvas` and `apps/studio` so you can confirm later phases add tests without regressing.

If anything is failing on this baseline, stop and report — the plan assumes a green baseline.

---

## Phase 1 — Schema + adapter normalization (`apps/studio`)

### Task 1.1: Export `HtmlNodeDataSchema` for direct unit tests

`HtmlNodeDataSchema` is currently un-exported (declared at `apps/studio/src/schema.ts:231`). Phase 1 tests parse it directly, so export it.

**Files:**
- Modify: `apps/studio/src/schema.ts:231`

**Step 1: Edit**

Change:
```ts
const HtmlNodeDataSchema = z.object({
```
to:
```ts
export const HtmlNodeDataSchema = z.object({
```

**Step 2: Verify**

```bash
bun run typecheck
```
Expected: pass.

**Step 3: Commit**

```bash
git add apps/studio/src/schema.ts
git commit -m "refactor(studio/schema): export HtmlNodeDataSchema for unit tests"
```

### Task 1.2: Add `autoSize` field to `HtmlNodeDataSchema` (TDD)

**Files:**
- Modify: `apps/studio/src/schema.ts` (the `HtmlNodeDataSchema` body that starts at line 231)
- Modify: `apps/studio/src/schema.test.ts` (append a new `describe`)

**Step 1: Write the failing test**

Append to `apps/studio/src/schema.test.ts`:

```ts
import { HtmlNodeDataSchema } from './schema.ts';

describe('HtmlNodeDataSchema autoSize', () => {
  it('parses with autoSize: true and no width/height', () => {
    const r = HtmlNodeDataSchema.safeParse({ htmlPath: 'snip.html', autoSize: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.autoSize).toBe(true);
  });

  it('parses with autoSize: false plus width/height', () => {
    const r = HtmlNodeDataSchema.safeParse({
      htmlPath: 'snip.html',
      autoSize: false,
      width: 480,
      height: 320,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.autoSize).toBe(false);
      expect(r.data.width).toBe(480);
      expect(r.data.height).toBe(320);
    }
  });

  it('parses with autoSize absent (field is optional)', () => {
    const r = HtmlNodeDataSchema.safeParse({ htmlPath: 'snip.html' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.autoSize).toBeUndefined();
  });

  it('rejects non-boolean autoSize', () => {
    const r = HtmlNodeDataSchema.safeParse({ htmlPath: 'snip.html', autoSize: 'yes' });
    expect(r.success).toBe(false);
  });
});
```

**Step 2: Run, verify failure**

```bash
bun test apps/studio/src/schema.test.ts -t "HtmlNodeDataSchema autoSize"
```
Expected: the first three tests pass coincidentally (Zod ignores unknown fields by default for non-`.strict()` schemas, so `autoSize: true` is silently dropped) but `expect(r.data.autoSize).toBe(true)` fails. The fourth test ("rejects non-boolean") fails because `autoSize: 'yes'` is accepted as an unknown field. Confirm these are the failure modes before continuing.

**Step 3: Add the field**

In `apps/studio/src/schema.ts`, modify the `HtmlNodeDataSchema` body to include `autoSize`. Place it after `icon` and before the spread of `NodeVisualBaseShape`:

```ts
export const HtmlNodeDataSchema = z.object({
  htmlPath: z.string().min(1).refine(isCleanRelativePath, {
    message: 'htmlPath must be a relative path under .seeflow/ (no absolute / traversal)',
  }),
  name: z.string().optional(),
  icon: z.string().optional(),
  // When true (or absent), the renderer measures the HTML content and React
  // Flow sizes the wrapper around it (capped at 800×600 by the renderer's
  // measuring container styles). The studio adapter (`mergeNodeUpdates`)
  // enforces the invariant that `autoSize === true` and persisted
  // `width`/`height` never coexist: writing width/height flips autoSize to
  // false; writing autoSize: true strips width/height.
  autoSize: z.boolean().optional(),
  ...NodeVisualBaseShape,
  ...NodeDescriptionBaseShape,
});
```

**Step 4: Run, verify pass**

```bash
bun test apps/studio/src/schema.test.ts -t "HtmlNodeDataSchema autoSize"
bun test apps/studio
```
Expected: 4 new tests pass; full studio suite still green.

**Step 5: Commit**

```bash
git add apps/studio/src/schema.ts apps/studio/src/schema.test.ts
git commit -m "feat(studio/schema): add optional autoSize to HtmlNodeDataSchema"
```

### Task 1.3: Add `autoSize` to `NodePatchBodySchema` (TDD)

The patch body schema rejects unknown top-level keys (`.strict()` at line 101 in `operations.ts`). Without this task, the PATCH endpoint would reject `{ autoSize: true }` before it ever reached `mergeNodeUpdates`.

**Files:**
- Modify: `apps/studio/src/operations.ts` (around lines 63–101 for the schema, and the `NODE_DATA_PATCH_KEYS` array at lines 108–128)
- Test: `apps/studio/src/operations.test.ts` (CREATE — no existing test file for this module)

**Step 1: Create the test file with a failing test**

Create `apps/studio/src/operations.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { NodePatchBodySchema, mergeNodeUpdates } from './operations.ts';

describe('NodePatchBodySchema autoSize', () => {
  it('accepts autoSize: true', () => {
    const r = NodePatchBodySchema.safeParse({ autoSize: true });
    expect(r.success).toBe(true);
  });

  it('accepts autoSize: false alongside width/height', () => {
    const r = NodePatchBodySchema.safeParse({ autoSize: false, width: 480, height: 320 });
    expect(r.success).toBe(true);
  });

  it('rejects non-boolean autoSize', () => {
    const r = NodePatchBodySchema.safeParse({ autoSize: 'yes' });
    expect(r.success).toBe(false);
  });
});
```

**Step 2: Run, verify failure**

```bash
bun test apps/studio/src/operations.test.ts -t "NodePatchBodySchema autoSize"
```
Expected: all three tests fail because `.strict()` rejects the unknown `autoSize` key.

**Step 3: Add the field**

In `apps/studio/src/operations.ts`, add `autoSize: z.boolean().optional(),` to `NodePatchBodySchema`. Place it after `height` (line 76) to keep size-related fields together:

```ts
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    autoSize: z.boolean().optional(),
    shape: z.enum(['rectangle', 'ellipse', 'sticky', 'text']).optional(),
```

Then add `'autoSize'` to `NODE_DATA_PATCH_KEYS` (lines 108–128) — order it next to `width` / `height`:

```ts
const NODE_DATA_PATCH_KEYS = [
  'name',
  'borderColor',
  'backgroundColor',
  'borderSize',
  'borderWidth',
  'borderStyle',
  'fontSize',
  'textColor',
  'cornerRadius',
  'width',
  'height',
  'autoSize',
  'shape',
  // ... rest unchanged
] as const satisfies ReadonlyArray<keyof NodePatchBody>;
```

**Step 4: Run, verify pass**

```bash
bun test apps/studio/src/operations.test.ts
bun test apps/studio
```
Expected: 3 new tests pass; full studio suite still green.

**Step 5: Commit**

```bash
git add apps/studio/src/operations.ts apps/studio/src/operations.test.ts
git commit -m "feat(studio/operations): accept autoSize on NodePatchBody"
```

### Task 1.4: Enforce the `autoSize` invariant in `mergeNodeUpdates` (TDD)

This is the critical normalization step. After this task, the adapter guarantees that on-disk htmlNode data never has `autoSize === true` together with `width` or `height`.

**Files:**
- Modify: `apps/studio/src/operations.ts` (`mergeNodeUpdates` function around line 130)
- Modify: `apps/studio/src/operations.test.ts` (append `mergeNodeUpdates` describe block)

**Step 1: Write the failing tests**

Append to `apps/studio/src/operations.test.ts`:

```ts
describe('mergeNodeUpdates autoSize invariant', () => {
  it('flips autoSize to false when width is written', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'htmlNode',
      data: { htmlPath: 'a.html' },
    };
    mergeNodeUpdates(node, { width: 480, height: 320 });
    expect(node.data).toMatchObject({ autoSize: false, width: 480, height: 320 });
  });

  it('strips width/height when autoSize: true is written', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'htmlNode',
      data: { htmlPath: 'a.html', autoSize: false, width: 480, height: 320 },
    };
    mergeNodeUpdates(node, { autoSize: true });
    const data = node.data as Record<string, unknown>;
    expect(data.autoSize).toBe(true);
    expect(data.width).toBeUndefined();
    expect(data.height).toBeUndefined();
    expect('width' in data).toBe(false);
    expect('height' in data).toBe(false);
  });

  it('autoSize: true wins when both autoSize: true and width are in the same patch', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'htmlNode',
      data: { htmlPath: 'a.html' },
    };
    mergeNodeUpdates(node, { autoSize: true, width: 500, height: 300 });
    const data = node.data as Record<string, unknown>;
    expect(data.autoSize).toBe(true);
    expect('width' in data).toBe(false);
    expect('height' in data).toBe(false);
  });

  it('autoSize: false alone (no width/height) is a no-op normalization-wise', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'htmlNode',
      data: { htmlPath: 'a.html' },
    };
    mergeNodeUpdates(node, { autoSize: false });
    expect((node.data as Record<string, unknown>).autoSize).toBe(false);
  });

  it('leaves non-htmlNode patches unaffected (no spurious autoSize on shapeNode resize)', () => {
    const node: Record<string, unknown> = {
      id: 'n1',
      type: 'shapeNode',
      data: { shape: 'rectangle' },
    };
    mergeNodeUpdates(node, { width: 200, height: 100 });
    const data = node.data as Record<string, unknown>;
    expect(data.width).toBe(200);
    expect(data.height).toBe(100);
    expect('autoSize' in data).toBe(false);
  });
});
```

**Step 2: Run, verify failure**

```bash
bun test apps/studio/src/operations.test.ts -t "autoSize invariant"
```
Expected: tests 1, 2, 3, 5 fail; test 4 may pass coincidentally. Confirm the failure modes match the missing normalization logic.

**Step 3: Implement the normalization in `mergeNodeUpdates`**

In `apps/studio/src/operations.ts`, replace the body of `mergeNodeUpdates` to add the two normalization rules. The current function (lines 130–169) loops through `NODE_DATA_PATCH_KEYS` and writes each defined key into `data`. Add two post-loop rules, gated on `node.type === 'htmlNode'`:

```ts
export const mergeNodeUpdates = (node: Record<string, unknown>, updates: NodePatchBody): void => {
  if (updates.position !== undefined) {
    node.position = updates.position;
  }
  const dataAny = node.data;
  const data: Record<string, unknown> =
    dataAny && typeof dataAny === 'object' && !Array.isArray(dataAny)
      ? (dataAny as Record<string, unknown>)
      : {};
  let touchedData = false;
  for (const key of NODE_DATA_PATCH_KEYS) {
    if (updates[key] === undefined) continue;
    if ((key === 'description' || key === 'detail') && updates[key] === '') {
      if (key in data) {
        delete data[key];
        touchedData = true;
      }
      continue;
    }
    if (key === 'icon' && updates[key] === null) {
      if (key in data) {
        delete data[key];
        touchedData = true;
      }
      continue;
    }
    data[key] = updates[key];
    touchedData = true;
  }

  // htmlNode-only invariant enforcement:
  //   autoSize === true ⊻ (width and height set).
  // autoSize: true is the dominant signal — it strips width/height even if
  // the same patch tried to write them. Writing width/height implicitly
  // flips autoSize to false.
  if (node.type === 'htmlNode') {
    if (updates.autoSize === true) {
      if ('width' in data) {
        delete data.width;
        touchedData = true;
      }
      if ('height' in data) {
        delete data.height;
        touchedData = true;
      }
    } else if (updates.width !== undefined || updates.height !== undefined) {
      data.autoSize = false;
      touchedData = true;
    }
  }

  if (touchedData) {
    node.data = data;
  }
};
```

**Step 4: Run, verify pass**

```bash
bun test apps/studio/src/operations.test.ts
bun test apps/studio
```
Expected: all 5 new normalization tests pass; full studio suite still green.

**Step 5: Commit**

```bash
git add apps/studio/src/operations.ts apps/studio/src/operations.test.ts
git commit -m "feat(studio/operations): enforce autoSize invariant in mergeNodeUpdates"
```

---

## Phase 2 — Canvas renderer: layout fork (no observer yet)

This phase splits the renderer into two layout modes (auto-size vs user-sized) without wiring the ResizeObserver. A visual smoke test confirms auto-sized htmlNodes render at content's natural size (capped at 800×600 by CSS). The observer comes in Phase 3.

### Task 2.1: Add `autoSize` to the runtime type

**Files:**
- Modify: `packages/canvas/src/nodes/html-node.tsx:15-28` (`HtmlNodeRuntimeData` type)

The `data.autoSize` field comes from `HtmlNodeData` (already extended in Phase 1's schema). It will flow through `HtmlNodeRuntimeData` automatically because that type extends `HtmlNodeData`. **No type change is strictly needed here** — confirm by reading the existing type:

```ts
export type HtmlNodeRuntimeData = HtmlNodeData & {
  onResize?: (...);
  setResizing?: (on: boolean) => void;
  projectId?: string;
} & Record<string, unknown>;
```

Since `HtmlNodeData` is generated from `HtmlNodeDataSchema` (re-exported as `HtmlNodeData` via `z.infer` in `apps/studio/src/schema.ts:430`) and the canvas package imports it via the studio schema package... actually wait — verify the import path.

**Step 1: Trace the import**

```bash
grep -n "import.*HtmlNodeData\|from.*schema" packages/canvas/src/types.ts | head -5
```

If `HtmlNodeData` flows from `apps/studio/src/schema.ts` into `packages/canvas/src/types.ts`, no type change is needed in the canvas package. If the canvas defines its OWN `HtmlNodeData` type (decoupled from the studio's schema), add `autoSize?: boolean` to it.

**Step 2: Take action based on what you found**

- If canvas re-exports / re-imports from the studio: nothing to change here, move to Task 2.2.
- If canvas defines its own duplicate type: add `autoSize?: boolean` to the canvas-side `HtmlNodeData` in `packages/canvas/src/types.ts` and commit:
  ```bash
  git add packages/canvas/src/types.ts
  git commit -m "feat(canvas/types): add optional autoSize to HtmlNodeData"
  ```

### Task 2.2: Fork the renderer layout on `autoSize` (TDD)

**Files:**
- Modify: `packages/canvas/src/nodes/html-node.tsx`
- Modify: `packages/canvas/src/nodes/html-node.test.tsx`

**Step 1: Write failing tests**

Look at the existing test file's pattern (`packages/canvas/src/nodes/html-node.test.tsx`) — it uses a synchronous hook-shim (`renderWithHooks`) and walks the JSX tree with `findElement` / `findAll`. Reuse that pattern.

Find the existing `describe('HtmlNode'` block (search for it) and append the new tests inside it:

```ts
describe('HtmlNode autoSize', () => {
  beforeEach(() => {
    _setHtmlContentForTest('proj-1', 'snip.html', { kind: 'loaded', html: '<p>hello</p>' });
  });
  afterEach(() => {
    _clearHtmlContentCacheForTest();
  });

  it('defaults to auto-size when data.autoSize is undefined and renders the measuring container', () => {
    const tree = renderWithHooks(() =>
      HtmlNode({
        id: 'n1',
        data: { htmlPath: 'snip.html', projectId: 'proj-1' },
        selected: false,
        isConnectable: true,
      } as unknown as NodeProps<HtmlNodeType>),
    );
    const measure = findElement(
      tree,
      (el) =>
        el.props['data-testid'] === 'html-node-content' &&
        typeof el.props.style === 'object' &&
        (el.props.style as CSSProperties).maxWidth === 800,
    );
    expect(measure).not.toBeNull();
    const style = (measure?.props.style ?? {}) as CSSProperties;
    expect(style.maxWidth).toBe(800);
    expect(style.maxHeight).toBe(600);
    expect(style.overflow).toBe('auto');
  });

  it('renders measuring container when autoSize: true is explicit', () => {
    const tree = renderWithHooks(() =>
      HtmlNode({
        id: 'n1',
        data: { htmlPath: 'snip.html', projectId: 'proj-1', autoSize: true },
        selected: false,
        isConnectable: true,
      } as unknown as NodeProps<HtmlNodeType>),
    );
    const measure = findElement(tree, (el) => el.props['data-testid'] === 'html-node-content');
    expect(measure).not.toBeNull();
    const style = (measure?.props.style ?? {}) as CSSProperties;
    expect(style.maxWidth).toBe(800);
    expect(style.maxHeight).toBe(600);
  });

  it('renders user-sized layout when autoSize: false with width/height', () => {
    const tree = renderWithHooks(() =>
      HtmlNode({
        id: 'n1',
        data: {
          htmlPath: 'snip.html',
          projectId: 'proj-1',
          autoSize: false,
          width: 480,
          height: 320,
        },
        selected: false,
        isConnectable: true,
      } as unknown as NodeProps<HtmlNodeType>),
    );
    // In user-sized mode the inner body uses h-full/w-full (no measuring container).
    const body = findElement(tree, (el) => el.props['data-testid'] === 'html-node-content');
    expect(body).not.toBeNull();
    const style = (body?.props.style ?? {}) as CSSProperties;
    // No max-width cap in user-sized mode — outer wrapper owns dims.
    expect(style.maxWidth).toBeUndefined();
    // Outer wrapper carries the explicit width/height
    const outer = findElement(tree, (el) => el.props['data-testid'] === 'html-node');
    const outerStyle = (outer?.props.style ?? {}) as CSSProperties;
    expect(outerStyle.width).toBe(480);
    expect(outerStyle.height).toBe(320);
  });
});
```

**Step 2: Run, verify failure**

```bash
bun test packages/canvas/src/nodes/html-node.test.tsx -t "HtmlNode autoSize"
```
Expected: the first two tests fail (no measuring container with maxWidth/maxHeight exists yet); the third may pass coincidentally because the existing renderer already pins width/height when `sized`.

**Step 3: Implement the layout fork**

Edit `packages/canvas/src/nodes/html-node.tsx`. The full new component body should be:

```tsx
function HtmlNodeImpl({ id, data, selected, isConnectable }: NodeProps<HtmlNodeType>) {
  const { isResizing, onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    setResizing: data.setResizing,
  });

  // Resolve auto-size from data; field absent → true (auto-size is the default
  // for new htmlNodes per the studio adapter invariant). isResizing temporarily
  // forces user-sized layout so the drag has dimensions to grab against from
  // the first frame, before the autoSize: false write echoes back from disk.
  const autoSize = data.autoSize ?? true;
  const userSized = isResizing || !autoSize;

  // Theming style — same fields as before, but the size fallback now only
  // applies during the placeholder phase (see below).
  const containerStyle: CSSProperties = {
    ...(data.backgroundColor !== undefined
      ? { backgroundColor: colorTokenStyle(data.backgroundColor, 'node').backgroundColor }
      : {}),
    ...(data.borderColor !== undefined
      ? { borderColor: colorTokenStyle(data.borderColor, 'node').borderColor }
      : {}),
    ...(data.borderSize !== undefined ? { borderWidth: data.borderSize } : {}),
    ...(data.borderStyle !== undefined ? { borderStyle: data.borderStyle } : {}),
    ...(data.cornerRadius !== undefined ? { borderRadius: data.cornerRadius } : {}),
    ...(data.fontSize !== undefined ? { fontSize: `${data.fontSize}px` } : {}),
    ...colorTokenStyle(data.textColor, 'text'),
    ...(userSized
      ? { width: data.width, height: data.height }
      : {}),
  };

  useEffect(() => {
    ensureTailwindLoaded();
  }, []);

  const content = useHtmlContent(data.projectId, data.htmlPath);

  let body: ReactNode;
  if (content.kind === 'loaded') {
    // Auto-size: inline-block measuring container with content caps.
    //   - inline-block lets the container shrink-wrap horizontally so wide
    //     diagrams stay wide while prose wraps at the 800px cap.
    //   - overflow: auto so content that exceeds the 600px height cap scrolls
    //     inside the cap instead of blowing the bounding box.
    // User-sized: outer wrapper owns dims, inner fills h-full/w-full and
    // scrolls.
    body = userSized ? (
      <div
        data-testid="html-node-content"
        className="sf:h-full sf:w-full sf:overflow-auto"
        {...injectSanitizedHtml(content.html)}
      />
    ) : (
      <div
        data-testid="html-node-content"
        className="sf:inline-block"
        style={{ maxWidth: 800, maxHeight: 600, overflow: 'auto' }}
        {...injectSanitizedHtml(content.html)}
      />
    );
  } else if (content.kind === 'missing') {
    body = <PlaceholderCard message={`Missing: ${data.htmlPath}`} variant="destructive" />;
  } else if (content.kind === 'error') {
    body = <PlaceholderCard message={`Error: ${content.message}`} variant="destructive" />;
  } else {
    body = <PlaceholderCard message="Loading…" />;
  }

  // Transient placeholder fallback: while content hasn't loaded AND we're in
  // auto-size mode, the measuring container isn't present, so React Flow has
  // nothing to size to. Fall back to HTML_DEFAULT_SIZE for this brief window
  // so the placeholder card has a sensible bounding box.
  const placeholderFallback =
    !userSized && content.kind !== 'loaded'
      ? { width: HTML_DEFAULT_SIZE.width, height: HTML_DEFAULT_SIZE.height }
      : {};

  const outerStyle: CSSProperties = { ...containerStyle, ...placeholderFallback };

  return (
    <div
      className={cn(
        'sf:group sf:relative sf:overflow-hidden',
        userSized ? 'sf:h-full sf:w-full' : '',
      )}
      style={outerStyle}
      data-testid="html-node"
    >
      <ResizeControls
        visible={!!selected && !!data.onResize && !data.locked}
        cornerVariant="visible"
        minWidth={MIN_W}
        minHeight={MIN_H}
        onResizeStart={onResizeStart}
        onResize={onResizeEvent}
        onResizeEnd={onResizeEnd}
      />
      {data.locked ? <LockBadge /> : null}
      <Handle type="target" position={Position.Top}    id="t" isConnectable={isConnectable} className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')} />
      <Handle type="target" position={Position.Left}   id="l" isConnectable={isConnectable} className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')} />
      {body}
      <Handle type="source" position={Position.Right}  id="r" isConnectable={isConnectable} className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')} />
      <Handle type="source" position={Position.Bottom} id="b" isConnectable={isConnectable} className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')} />
      {data.name !== undefined && data.name !== '' ? (
        <div
          data-testid="html-node-label"
          className="sf:-bottom-5 sf:absolute sf:right-0 sf:left-0 sf:truncate sf:text-center sf:text-[11px] sf:text-muted-foreground"
        >
          {data.icon ? (
            <div className="sf:flex sf:items-center sf:justify-center sf:gap-1">
              <Icon name={data.icon} size={12} aria-hidden />
              <span className="truncate">{data.name}</span>
            </div>
          ) : (
            data.name
          )}
        </div>
      ) : null}
    </div>
  );
}
```

Key changes from the original:
- Removed the old `sized` variable; replaced with `autoSize` + `userSized`.
- `containerStyle` no longer pins `HTML_DEFAULT_SIZE` when unsized — instead, the new `placeholderFallback` adds it ONLY during the pre-load window in auto-size mode.
- `body` renders in two layouts: `inline-block` measuring container (auto-size) vs `h-full w-full` (user-sized).

**Step 4: Run, verify pass**

```bash
bun test packages/canvas/src/nodes/html-node.test.tsx
bun test packages/canvas
```
Expected: 3 new autoSize tests pass; existing html-node tests still pass; full canvas suite green.

**Step 5: Visual smoke test (manual)**

```bash
bun run dev
```
Then in the browser:
1. Open an existing demo with an htmlNode (or create one).
2. The node should size to its content's natural dimensions (capped at 800×600).
3. The existing manual resize handles should still work — drag a corner; the node should follow the drag.

Don't worry yet that the post-resize state isn't persisting `autoSize: false` (Phase 1 handles that on the studio side, but a clean drag/release commits width/height which the studio adapter will normalize). What you're confirming here is that the layout fork doesn't crash and the auto-size mode visually grows past 320×200 for content that's bigger than that.

If the visual is broken (e.g., the node has zero size, or content is clipped), stop and debug before continuing.

**Step 6: Commit**

```bash
git add packages/canvas/src/nodes/html-node.tsx packages/canvas/src/nodes/html-node.test.tsx
git commit -m "feat(canvas/html-node): fork layout on autoSize (no observer yet)"
```

---

## Phase 3 — Debounced ResizeObserver + edge reposition

The renderer needs to tell React Flow when the auto-sized content's dimensions change, so edges connected to handle positions reposition correctly. Strategy: extract the observer logic into a pure helper (testable without React), then wire it from a `useEffect` in `html-node.tsx`.

The hook-shim in `html-node.test.tsx` no-ops `useEffect`, so observer behavior cannot be tested through the renderer. We test the extracted helper instead.

### Task 3.1: Create the `debouncedResizeObserver` helper (TDD)

**Files:**
- Create: `packages/canvas/src/lib/debounced-resize-observer.ts`
- Create: `packages/canvas/src/lib/debounced-resize-observer.test.ts`

**Step 1: Write the failing tests**

Create `packages/canvas/src/lib/debounced-resize-observer.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { debouncedResizeObserver } from './debounced-resize-observer.ts';

// Test-controlled ResizeObserver: stores fired callbacks so tests can trigger
// them on demand. Each instance keeps its callback for `fire()` invocation.
class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(public cb: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  fire() {
    this.cb([], this as unknown as ResizeObserver);
  }
}

beforeEach(() => {
  TestResizeObserver.instances = [];
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    TestResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  TestResizeObserver.instances = [];
});

describe('debouncedResizeObserver', () => {
  it('calls onSettle once after debounce window expires on a single fire', async () => {
    const el = {} as unknown as Element;
    const onSettle = mock(() => {});
    const cleanup = debouncedResizeObserver(el, 50, onSettle);
    const obs = TestResizeObserver.instances[0]!;
    expect(obs.observed).toContain(el);

    obs.fire();
    expect(onSettle).toHaveBeenCalledTimes(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(onSettle).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('coalesces multiple fires within the debounce window into one onSettle', async () => {
    const el = {} as unknown as Element;
    const onSettle = mock(() => {});
    const cleanup = debouncedResizeObserver(el, 50, onSettle);
    const obs = TestResizeObserver.instances[0]!;

    obs.fire();
    await new Promise((r) => setTimeout(r, 10));
    obs.fire();
    await new Promise((r) => setTimeout(r, 10));
    obs.fire();
    expect(onSettle).toHaveBeenCalledTimes(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(onSettle).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('fires onSettle again for a late observer fire after the first settle', async () => {
    const el = {} as unknown as Element;
    const onSettle = mock(() => {});
    const cleanup = debouncedResizeObserver(el, 30, onSettle);
    const obs = TestResizeObserver.instances[0]!;

    obs.fire();
    await new Promise((r) => setTimeout(r, 50));
    expect(onSettle).toHaveBeenCalledTimes(1);

    // Simulates a late reflow (Tailwind hydration / image load) — second
    // settle expected.
    obs.fire();
    await new Promise((r) => setTimeout(r, 50));
    expect(onSettle).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('cleanup disconnects the observer and prevents pending settle from firing', async () => {
    const el = {} as unknown as Element;
    const onSettle = mock(() => {});
    const cleanup = debouncedResizeObserver(el, 50, onSettle);
    const obs = TestResizeObserver.instances[0]!;
    obs.fire();
    cleanup();
    expect(obs.disconnected).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(onSettle).toHaveBeenCalledTimes(0);
  });
});
```

**Step 2: Run, verify failure**

```bash
bun test packages/canvas/src/lib/debounced-resize-observer.test.ts
```
Expected: all four tests fail with module-not-found.

**Step 3: Implement the helper**

Create `packages/canvas/src/lib/debounced-resize-observer.ts`:

```ts
/**
 * Attach a ResizeObserver to `el` and call `onSettle` once size changes stop
 * arriving for `delayMs`. Coalesces bursts of reflows (e.g., Tailwind utility
 * hydration on mount, late-loading images) into a single settle. Each later
 * burst fires `onSettle` again.
 *
 * Used by `html-node.tsx` in auto-size mode: each settle calls
 * `useReactFlow().updateNodeInternals(nodeId)` so React Flow re-reads the
 * node's bounding rect from the DOM. The helper itself is React-free so it
 * can be unit-tested without the hook-shim infrastructure.
 *
 * Returns a cleanup function: disconnects the observer, clears any pending
 * timer. Safe to call multiple times.
 */
export function debouncedResizeObserver(
  el: Element,
  delayMs: number,
  onSettle: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cleaned = false;

  const observer = new ResizeObserver(() => {
    if (cleaned) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (cleaned) return;
      onSettle();
    }, delayMs);
  });
  observer.observe(el);

  return () => {
    if (cleaned) return;
    cleaned = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    observer.disconnect();
  };
}
```

**Step 4: Run, verify pass**

```bash
bun test packages/canvas/src/lib/debounced-resize-observer.test.ts
bun test packages/canvas
```
Expected: all 4 helper tests pass; full canvas suite green.

**Step 5: Commit**

```bash
git add packages/canvas/src/lib/debounced-resize-observer.ts packages/canvas/src/lib/debounced-resize-observer.test.ts
git commit -m "feat(canvas/lib): add debouncedResizeObserver helper"
```

### Task 3.2: Wire the observer into `html-node.tsx`

**Files:**
- Modify: `packages/canvas/src/nodes/html-node.tsx`

This task has no new unit tests because the hook-shim doesn't run `useEffect`. The behavior is verified end-to-end in Phase 5.

**Step 1: Add the imports and effect**

In `packages/canvas/src/nodes/html-node.tsx`:

1. Add `useRef` and add `useReactFlow` import:
   ```tsx
   import { Handle, type Node, type NodeProps, Position, useReactFlow } from '@xyflow/react';
   import { type CSSProperties, type ReactNode, memo, useEffect, useRef } from 'react';
   ```

2. Add the helper import:
   ```tsx
   import { debouncedResizeObserver } from '../lib/debounced-resize-observer.ts';
   ```

3. Inside `HtmlNodeImpl`, after the existing `useEffect(() => { ensureTailwindLoaded(); }, [])`, add:

   ```tsx
   const measureRef = useRef<HTMLDivElement | null>(null);
   const { updateNodeInternals } = useReactFlow();

   useEffect(() => {
     // Auto-size only: observe the measuring container and tell React Flow
     // to re-read this node's bounding rect once size changes settle. We
     // don't write width/height to disk here — auto-sized dimensions are
     // runtime-only by design.
     if (autoSize !== true) return;
     if (content.kind !== 'loaded') return;
     const el = measureRef.current;
     if (el === null) return;
     return debouncedResizeObserver(el, 150, () => {
       updateNodeInternals(id);
     });
   }, [autoSize, content.kind, id, updateNodeInternals]);
   ```

   (Note: dep `autoSize` is the resolved boolean, not `data.autoSize`. Reading the resolved value keeps the effect aware of the `?? true` default.)

4. Attach the ref to the measuring container. In the auto-size branch of `body`:

   ```tsx
   body = userSized ? (
     <div
       data-testid="html-node-content"
       className="sf:h-full sf:w-full sf:overflow-auto"
       {...injectSanitizedHtml(content.html)}
     />
   ) : (
     <div
       ref={measureRef}
       data-testid="html-node-content"
       className="sf:inline-block"
       style={{ maxWidth: 800, maxHeight: 600, overflow: 'auto' }}
       {...injectSanitizedHtml(content.html)}
     />
   );
   ```

**Step 2: Update `arePropsEqual` to recognize `autoSize` changes**

The memoization comparator at `html-node.tsx:163` currently uses reference-equality on `data`. That's fine — when `autoSize` changes the parent will pass a new `data` reference. Skim it to confirm no special-case is needed. Move on.

**Step 3: Run unit tests**

```bash
bun test packages/canvas
```
Expected: full canvas suite green. (The observer behavior isn't covered here; that's Phase 5's job.)

**Step 4: Typecheck**

```bash
bun run typecheck
```
Expected: pass.

**Step 5: Commit**

```bash
git add packages/canvas/src/nodes/html-node.tsx
git commit -m "feat(canvas/html-node): wire debounced ResizeObserver → updateNodeInternals"
```

---

## Phase 4 — Fit-to-content button + host wiring

A new icon button on the htmlNode's chrome (top-right corner, htmlNode-only) flips the node back to auto-size by patching `{ autoSize: true }` through the adapter. The studio's `mergeNodeUpdates` (Phase 1) strips `width` and `height` on receipt.

### Task 4.1: Add `onFitToContent` to the runtime data type

**Files:**
- Modify: `packages/canvas/src/nodes/html-node.tsx:15-28` (`HtmlNodeRuntimeData`)

**Step 1: Extend the type**

```ts
export type HtmlNodeRuntimeData = HtmlNodeData & {
  onResize?: (
    nodeId: string,
    dims: { width: number; height: number; x: number; y: number },
  ) => void;
  setResizing?: (on: boolean) => void;
  projectId?: string;
  // When wired (edit mode only), the renderer's "Fit to content" button calls
  // this. The host's handler PATCHes { autoSize: true } through the adapter,
  // which strips width/height server-side per the autoSize invariant.
  onFitToContent?: (nodeId: string) => void;
} & Record<string, unknown>;
```

**Step 2: Typecheck**

```bash
bun run typecheck
```
Expected: pass.

**Step 3: Commit**

```bash
git add packages/canvas/src/nodes/html-node.tsx
git commit -m "feat(canvas/html-node): add onFitToContent runtime callback type"
```

### Task 4.2: Add the FitToContent button (TDD)

**Files:**
- Modify: `packages/canvas/src/nodes/html-node.tsx` (component file)
- Modify: `packages/canvas/src/nodes/html-node.test.tsx`

**Step 1: Write failing tests**

Append to `html-node.test.tsx`:

```ts
describe('HtmlNode fit-to-content button', () => {
  beforeEach(() => {
    _setHtmlContentForTest('proj-1', 'snip.html', { kind: 'loaded', html: '<p>x</p>' });
  });
  afterEach(() => {
    _clearHtmlContentCacheForTest();
  });

  const baseData = {
    htmlPath: 'snip.html',
    projectId: 'proj-1',
    autoSize: false,
    width: 480,
    height: 320,
  } as const;

  it('is hidden when not selected', () => {
    const tree = renderWithHooks(() =>
      HtmlNode({
        id: 'n1',
        data: { ...baseData, onFitToContent: () => {} },
        selected: false,
        isConnectable: true,
      } as unknown as NodeProps<HtmlNodeType>),
    );
    const btn = findElement(tree, (el) => el.props['data-testid'] === 'html-node-fit-to-content');
    expect(btn).toBeNull();
  });

  it('is hidden when locked', () => {
    const tree = renderWithHooks(() =>
      HtmlNode({
        id: 'n1',
        data: { ...baseData, onFitToContent: () => {}, locked: true },
        selected: true,
        isConnectable: true,
      } as unknown as NodeProps<HtmlNodeType>),
    );
    const btn = findElement(tree, (el) => el.props['data-testid'] === 'html-node-fit-to-content');
    expect(btn).toBeNull();
  });

  it('is hidden when autoSize is already true', () => {
    const tree = renderWithHooks(() =>
      HtmlNode({
        id: 'n1',
        data: {
          htmlPath: 'snip.html',
          projectId: 'proj-1',
          autoSize: true,
          onFitToContent: () => {},
        },
        selected: true,
        isConnectable: true,
      } as unknown as NodeProps<HtmlNodeType>),
    );
    const btn = findElement(tree, (el) => el.props['data-testid'] === 'html-node-fit-to-content');
    expect(btn).toBeNull();
  });

  it('is hidden when onFitToContent is not wired (view/mini mode)', () => {
    const tree = renderWithHooks(() =>
      HtmlNode({
        id: 'n1',
        data: { ...baseData /* no onFitToContent */ },
        selected: true,
        isConnectable: true,
      } as unknown as NodeProps<HtmlNodeType>),
    );
    const btn = findElement(tree, (el) => el.props['data-testid'] === 'html-node-fit-to-content');
    expect(btn).toBeNull();
  });

  it('is visible when selected + unlocked + user-sized + callback wired', () => {
    const tree = renderWithHooks(() =>
      HtmlNode({
        id: 'n1',
        data: { ...baseData, onFitToContent: () => {} },
        selected: true,
        isConnectable: true,
      } as unknown as NodeProps<HtmlNodeType>),
    );
    const btn = findElement(tree, (el) => el.props['data-testid'] === 'html-node-fit-to-content');
    expect(btn).not.toBeNull();
  });

  it('click calls data.onFitToContent with the node id', () => {
    const onFit = mock(() => {});
    const tree = renderWithHooks(() =>
      HtmlNode({
        id: 'n1',
        data: { ...baseData, onFitToContent: onFit },
        selected: true,
        isConnectable: true,
      } as unknown as NodeProps<HtmlNodeType>),
    );
    const btn = findElement(tree, (el) => el.props['data-testid'] === 'html-node-fit-to-content');
    expect(btn).not.toBeNull();
    // Invoke the onClick handler the JSX tree exposes.
    (btn?.props as { onClick?: () => void }).onClick?.();
    expect(onFit).toHaveBeenCalledTimes(1);
    expect(onFit).toHaveBeenCalledWith('n1');
  });
});
```

Make sure `mock` is imported from `bun:test` at the top of the file (it likely already is — check imports).

**Step 2: Run, verify failure**

```bash
bun test packages/canvas/src/nodes/html-node.test.tsx -t "fit-to-content"
```
Expected: all 6 tests fail — the button doesn't exist yet.

**Step 3: Implement the button**

In `packages/canvas/src/nodes/html-node.tsx`, near the top of the file (after the existing imports), add the Lucide icon import:

```tsx
import { Maximize2 } from 'lucide-react';
```

(If `lucide-react` isn't directly imported elsewhere in this file, check `packages/canvas/src/ui/icon.tsx` or `packages/canvas/src/nodes/lock-badge.tsx` for an existing pattern — they likely use the same import shape.)

Add a small component at the bottom of the file (after `HtmlNodeImpl` but before the `arePropsEqual` / `memo` export):

```tsx
function FitToContentButton({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}): ReactNode {
  if (!visible) return null;
  return (
    <button
      type="button"
      data-testid="html-node-fit-to-content"
      title="Fit to content"
      aria-label="Fit to content"
      className="sf:absolute sf:top-1 sf:right-1 sf:z-10 sf:flex sf:h-5 sf:w-5 sf:cursor-pointer sf:items-center sf:justify-center sf:rounded sf:bg-background/80 sf:text-muted-foreground sf:opacity-0 sf:transition-opacity sf:hover:text-foreground sf:group-hover:opacity-100 sf:focus:opacity-100"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Maximize2 size={12} aria-hidden />
    </button>
  );
}
```

Then render it inside the main return of `HtmlNodeImpl`. Place it right after the `<LockBadge />` line so it lives in the same chrome layer:

```tsx
      {data.locked ? <LockBadge /> : null}
      <FitToContentButton
        visible={
          !!selected &&
          !data.locked &&
          !autoSize &&
          !isResizing &&
          typeof data.onFitToContent === 'function'
        }
        onClick={() => data.onFitToContent?.(id)}
      />
```

**Step 4: Run, verify pass**

```bash
bun test packages/canvas/src/nodes/html-node.test.tsx
bun test packages/canvas
```
Expected: all 6 new fit-to-content tests pass; full canvas suite green.

**Step 5: Typecheck**

```bash
bun run typecheck
```
Expected: pass.

**Step 6: Commit**

```bash
git add packages/canvas/src/nodes/html-node.tsx packages/canvas/src/nodes/html-node.test.tsx
git commit -m "feat(canvas/html-node): add Fit to content button"
```

### Task 4.3: Wire `onHtmlNodeFitToContent` prop through SeeflowCanvas

**Files:**
- Modify: `packages/canvas/src/components/seeflow-canvas.tsx`

The canvas component owns runtime data injection (`sourceNodes` builder at line ~2467). Add a prop and inject it into htmlNode runtime data.

**Step 1: Add the prop type**

In the `SeeflowCanvasProps` interface (find it via `grep -n "onNodeResize?:" packages/canvas/src/components/seeflow-canvas.tsx` — should be around line 358), add immediately after the resize callbacks:

```ts
  /**
   * htmlNode-only: invoked when the user clicks the "Fit to content" button
   * on a user-sized htmlNode. The host's handler typically PATCHes
   * { autoSize: true } through the adapter; the studio's mergeNodeUpdates
   * then strips width/height to maintain the autoSize invariant.
   */
  onHtmlNodeFitToContent?: (nodeId: string) => void;
```

**Step 2: Destructure the prop**

In the component's prop destructuring (around line 1632), add `onHtmlNodeFitToContent` next to `onNodeResize`.

**Step 3: Inject into runtime data**

In the `buildNode` function (around line 2468), inside the `data: { ... }` object, add — only-meaningful-for-htmlNode but harmless if injected on every node:

```ts
        data: {
          ...merged.data,
          projectId,
          onRetryUpload: onRetryImageUpload,
          status: dataStatusFor(runs, merged.id),
          errorMessage: dataErrorMessageFor(runs, merged.id),
          statusReport: statusByNode?.[merged.id],
          onPlay: onPlayNode,
          onResize: onNodeResize,
          setResizing,
          onFitToContent: merged.type === 'htmlNode' ? onHtmlNodeFitToContent : undefined,
          // ... rest unchanged
        },
```

The `merged.type === 'htmlNode'` gate keeps the data shape clean — other node types don't pick up an unused callback.

**Step 4: Update the dependency arrays**

The `sourceNodes = useMemo(...)` and `useCallback` blocks below it likely reference `onNodeResize`. Find the matching dependency arrays (around lines 2578) and add `onHtmlNodeFitToContent` to each one that includes `onNodeResize`.

**Step 5: Typecheck + tests**

```bash
bun run typecheck
bun test packages/canvas
```
Expected: both pass.

**Step 6: Commit**

```bash
git add packages/canvas/src/components/seeflow-canvas.tsx
git commit -m "feat(canvas): pass onHtmlNodeFitToContent through to htmlNode runtime data"
```

### Task 4.4: Wire the host callback in `apps/web` (TDD)

The host owns optimistic updates and undo. Mirror the existing `onNodeResize` pattern from `apps/web/src/pages/demo-view.tsx:500-560`.

**Files:**
- Modify: `apps/web/src/pages/demo-view.tsx`

**Step 1: Add the callback**

Locate the `onNodeResize = useCallback(...)` block (around line 500). Right after it, add:

```ts
  const onHtmlNodeFitToContent = useCallback(
    (nodeId: string) => {
      if (!demoId || !adapter) return;
      const node = demoNodes?.find((n) => n.id === nodeId);
      if (!node) return;
      const prev = {
        autoSize: (node.data as { autoSize?: boolean }).autoSize,
        width: node.data.width,
        height: node.data.height,
      };
      const next = { autoSize: true };
      // Optimistic strip: hide the persisted dims locally so the renderer
      // immediately switches to auto-size layout while the PATCH is in flight.
      setNodeOverride(nodeId, {
        data: { autoSize: true, width: undefined, height: undefined },
      } as Partial<DemoNode>);
      setEditError(null);
      markMutation();
      pushUndo({
        do: async () => {
          await adapter.updateNode(nodeId, next);
        },
        undo: async () => {
          await adapter.updateNode(nodeId, prev);
        },
        coalesceKey: `node:${nodeId}:fit-to-content`,
      });
      adapter.updateNode(nodeId, next).catch((err) => {
        dropNodeOverride(nodeId);
        dropUndoTop();
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode (fit-to-content) failed', err);
      });
    },
    [
      demoId,
      adapter,
      demoNodes,
      setNodeOverride,
      dropNodeOverride,
      pushUndo,
      dropUndoTop,
      setEditError,
      markMutation,
    ],
  );
```

**Step 2: Pass the prop to SeeflowCanvas**

Find the `<SeeflowCanvas onNodeResize={onNodeResize} ... />` JSX (around line 2984). Add the new prop alongside it:

```tsx
          onNodeResize={onNodeResize}
          onHtmlNodeFitToContent={onHtmlNodeFitToContent}
```

If there are multiple `<SeeflowCanvas>` mounts in this file, only wire it through in edit-mode mounts (mirror what `onNodeResize` does — `view` and `mini` mounts should pass `undefined` or omit the prop).

**Step 3: Typecheck + tests**

```bash
bun run typecheck
bun test apps/web
```
Expected: both pass.

**Step 4: Commit**

```bash
git add apps/web/src/pages/demo-view.tsx
git commit -m "feat(web/demo-view): wire onHtmlNodeFitToContent host callback"
```

---

## Phase 5 — End-to-end browser verification

The unit tests prove individual pieces work. Phase 5 confirms the full loop: load → measure → display → user resize → persist → fit → re-measure.

### Task 5.1: Manual smoke test — auto-size on first paint

**Step 1: Start the dev server**

```bash
bun run dev
```
Wait for the studio (4321) and Vite (5173) to both start.

**Step 2: Create or open a demo with an htmlNode**

Either use an existing demo or create one and drop an htmlNode. Author an HTML file at `<project>/.seeflow/<name>.html` with content tall enough to test the cap:

```html
<div style="padding: 16px; width: 500px;">
  <h2>Auto-size test</h2>
  <p>This block is 500px wide.</p>
  <p>It should grow vertically until ~600px height, then scroll inside.</p>
  <ul>
    <li>Line one</li>
    <li>Line two</li>
    <li>... (add 30 more lines)</li>
  </ul>
</div>
```

**Step 3: Verify**

- The node should appear at the content's natural dimensions (≈500px × N-px, capped at 600 vertically).
- Edges connect to the correct handle positions (top/right/bottom/left of the actual node bounds, not 320×200).
- No console errors.

If the node renders at 320×200 (the legacy placeholder) and stays there, the observer isn't firing — check that `data.autoSize` resolves to `true` (open React DevTools and inspect the htmlNode component's data prop).

### Task 5.2: Manual smoke test — late-reflow re-fit

**Step 1: Trigger a late reflow**

Edit the HTML file while the studio is watching. Add or remove a large block of content. The file watcher should push the new HTML to the node within ~1s.

**Step 2: Verify**

- The node grows / shrinks to fit the new content (within the 800×600 caps).
- Edges reposition correctly.

### Task 5.3: Manual smoke test — user resize persists

**Step 1: Resize**

Select the htmlNode. Drag the bottom-right resize handle. Release.

**Step 2: Inspect disk state**

```bash
cat <project>/.seeflow/seeflow.json | grep -A 10 htmlNode
```

Expected: the node's `data` now contains `autoSize: false`, `width: N`, `height: N`. No stray `autoSize: true`.

**Step 3: Reload the page**

The node should reload at the persisted size (not the content's intrinsic size). The fit-to-content button should now be visible in the top-right corner of the chrome on hover/select.

### Task 5.4: Manual smoke test — fit-to-content round trip

**Step 1: Click the fit button**

Hover or select the user-sized htmlNode from Task 5.3. The `maximize-2` icon should appear in the top-right corner. Click it.

**Step 2: Verify**

- The node immediately switches back to its content's intrinsic size.
- Inspect `seeflow.json` again — `data.autoSize` is `true`; `width` and `height` are absent.
- The fit button is no longer visible (auto-size mode).
- Edges reposition correctly.

### Task 5.5: Run the full suite one more time

```bash
bun run typecheck
bun run lint
bun test
```

Expected: all green. If anything failed, fix it before considering the feature complete.

### Task 5.6: Final commit (if any cleanup needed)

If the manual testing surfaced small fixes, commit them. Otherwise, the feature is complete.

---

## Known risks (read once before starting)

1. **`ResizeObserver` not present in Bun's default test env.** The helper tests in Phase 3 install a `TestResizeObserver` class on `globalThis.ResizeObserver` in `beforeEach`. If you see "ResizeObserver is not defined" in any non-helper test, the renderer test is somehow exercising the observer effect — that shouldn't happen with the hook-shim, but double-check `html-node.test.tsx` doesn't import the helper transitively in a way that runs its constructor.

2. **Late Tailwind hydration after the first settle.** `ensureTailwindLoaded()` injects the CDN script on mount; utility classes hydrate ~ms later, causing a second reflow. The helper handles this by firing `onSettle` again. Phase 3 task 3.1 includes a test for this (`fires onSettle again for a late observer fire`). Confirm visually in Phase 5 task 5.1 that the node settles into its post-Tailwind size — not its pre-Tailwind, smaller size.

3. **Optimistic strip vs server echo.** When the user clicks Fit to content, the host calls `setNodeOverride(nodeId, { data: { autoSize: true, width: undefined, height: undefined } })`. The studio's PATCH then strips `width`/`height` on disk. When the SSE echo arrives with the canonical state, the override should drop cleanly. If you see the node briefly flicker back to user-sized between the optimistic update and the SSE echo, the override drop is missing — review `dropNodeOverride` semantics in `demo-view.tsx`.

4. **The 150 ms debounce vs the user's resize gesture.** During a user drag, `isResizing` is true and `userSized` resolves to true → the measuring container is unmounted → the observer's effect cleanup runs → no `updateNodeInternals` fights the drag. Confirmed by design but worth a manual smoke if you see jitter.

5. **No worktree.** The user explicitly asked to work on `ralph/tailwind-v4-upgrade` directly. Do not create a worktree, do not branch, do not rebase onto `main` mid-stream.

---

## Done criteria

- All unit tests added in Phases 1–4 pass.
- Full suites pass: `bun run typecheck`, `bun run lint`, `bun test`.
- Manual smoke tests in Phase 5 pass (5.1 through 5.4).
- `seeflow.json` after a clean drop → auto-size → resize → fit cycle contains no `autoSize: true` paired with `width`/`height`, and no `width`/`height` paired with `autoSize: false` that should be `true`.
- Eight commits land on `ralph/tailwind-v4-upgrade` (Task 1.1, 1.2, 1.3, 1.4, 2.2, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4 — count may vary by ±1 if Task 2.1 requires a separate commit).
