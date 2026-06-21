# Canvas Extraction — Phase 4: Orchestrator & Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Prerequisite:** Phase 3 merged to `main`.

**Goal:** Refactor `demo-canvas.tsx` (3,663 lines) so it stops calling REST endpoints and app-only hooks directly, then move it into `@seeflow/canvas` as `<SeeflowCanvas>` with a `mode: 'view' | 'edit'` flag and a `CanvasAdapter` contract.

**Architecture:** This phase is the hard one. The orchestrator currently reads `useNodeRuns()` / `useNodeStatuses()` / `usePendingOverrides()` and calls 10+ REST mutations directly. Both must become props before the file can leave `apps/web`. Strategy: **refactor in place** in 5 sub-tasks (still in `apps/web`), then move the refactored file into the package as a final 6th sub-task. Each sub-task is its own commit (potentially its own PR — see end of plan).

**Why refactor in place:** The `@/` alias doesn't resolve from `packages/canvas/`. Moving the file before fixing imports would mean dozens of broken imports all at once. Refactoring in place keeps every commit green.

**Tech Stack:** Bun, React, `@xyflow/react`, TypeScript discriminated unions.

---

## Pre-flight: choose PR strategy

**Sub-tasks 1–4 are independently shippable.** Two ways to land them:

| Strategy | Description |
|---|---|
| **One big PR** | All 6 sub-tasks in one branch, one PR. Faster to ship, harder to review. |
| **Five PRs** | Sub-task 1 (adapter), 2 (REST → adapter), 3 (runtime → prop), 4 (mode flag), 5–6 (move). Slower, much easier review. |

**Recommendation: Five PRs.** A 3,663-line file refactor done in one PR is a guaranteed reviewer-overload.

Confirm with the user before starting.

---

## Sub-task 1: Define the `CanvasAdapter` interface and `createRestAdapter` factory

**What:** Introduce the interface types and the REST factory in `apps/web` (will move into the package in sub-task 6). No behavior change yet — `demo-canvas.tsx` still calls REST directly.

**Files:**
- Create: `apps/web/src/lib/canvas-adapter.ts` (interface + types)
- Create: `apps/web/src/lib/canvas-adapter-rest.ts` (the factory)
- Create: `apps/web/src/lib/canvas-adapter-rest.test.ts`

**Step 1: Write the failing test**

`apps/web/src/lib/canvas-adapter-rest.test.ts`:

```ts
import { describe, expect, it, mock } from 'bun:test';
import { createRestAdapter } from './canvas-adapter-rest';

describe('createRestAdapter', () => {
  it('createNode POSTs to /api/demos/:demoId/nodes and returns the parsed response', async () => {
    const fakeNode = { id: 'n1', kind: 'shape', position: { x: 0, y: 0 } };
    const fetchMock = mock((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify(fakeNode), { status: 200 }))
    );
    const adapter = createRestAdapter({
      baseUrl: 'http://example.com',
      demoId: 'demo-1',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await adapter.createNode({ kind: 'shape', position: { x: 0, y: 0 } });
    expect(result).toEqual(fakeNode);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.com/api/demos/demo-1/nodes',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
```

**Step 2: Run — expect FAIL**

```bash
bun test apps/web/src/lib/canvas-adapter-rest.test.ts
```

Expected: FAIL — `createRestAdapter` is not defined.

**Step 3: Implement the interface and factory**

`apps/web/src/lib/canvas-adapter.ts`:

```ts
import type {
  Connector, DemoNode, EdgePin, NodeData, ReorderOp, ShapeKind,
} from '@seeflow/canvas';

export interface CreateNodeInput { /* mirror the REST POST body */ }
export interface UpdateNodePatch { /* mirror the REST PATCH body */ }
export interface CreateConnectorInput { /* ... */ }
export interface UpdateConnectorPatch { /* ... */ }

export interface CanvasAdapter {
  createNode(input: CreateNodeInput): Promise<DemoNode>;
  updateNode(id: string, patch: UpdateNodePatch): Promise<DemoNode>;
  deleteNode(id: string): Promise<void>;
  reorderNode(id: string, beforeId: string | null): Promise<void>;
  createConnector(input: CreateConnectorInput): Promise<Connector>;
  updateConnector(id: string, patch: UpdateConnectorPatch): Promise<Connector>;
  deleteConnector(id: string): Promise<void>;
  uploadImage(file: File): Promise<{ url: string; width: number; height: number }>;
  playNode?(id: string): Promise<void>;
}
```

`apps/web/src/lib/canvas-adapter-rest.ts`:

```ts
import type { CanvasAdapter, CreateNodeInput, /* ... */ } from './canvas-adapter';

export interface RestAdapterOptions {
  baseUrl: string;
  demoId: string;
  fetch?: typeof fetch;
}

export function createRestAdapter(opts: RestAdapterOptions): CanvasAdapter {
  const f = opts.fetch ?? fetch;
  return {
    async createNode(input) {
      const res = await f(`${opts.baseUrl}/api/demos/${opts.demoId}/nodes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`createNode failed: ${res.status}`);
      return res.json();
    },
    // … other methods mirroring apps/studio routes
  };
}
```

Look at `apps/web/src/lib/api.ts` for the exact REST surface. Every existing exported REST function (`createNode`, `updateNode`, ...) becomes an adapter method. Use the same patch shapes already present in `api.ts`.

**Step 4: Run — expect PASS**

```bash
bun test apps/web/src/lib/canvas-adapter-rest.test.ts
```

Expected: green.

**Step 5: Add a test for one more method** (so you have at least 2 passing); commit.

```bash
git add apps/web/src/lib/canvas-adapter.ts apps/web/src/lib/canvas-adapter-rest.ts apps/web/src/lib/canvas-adapter-rest.test.ts
git commit -m "feat(canvas): introduce CanvasAdapter interface and REST factory"
```

---

## Sub-task 2: Wire `demo-canvas.tsx` to use the adapter for mutations

**What:** Replace every direct REST call in `demo-canvas.tsx` (and `demo-view.tsx` if it's where mutations are invoked) with `props.adapter.method(...)`. Page-level component (`demo-view.tsx`) instantiates `createRestAdapter` and passes it down.

**Files:**
- Modify: `apps/web/src/components/demo-canvas.tsx`
- Modify: `apps/web/src/pages/demo-view.tsx`

**Step 1: Add `adapter: CanvasAdapter` to the demo-canvas prop type**

Required prop in this sub-task (we'll make it optional under `mode='view'` later in sub-task 4).

**Step 2: Find every REST call inside demo-canvas**

```bash
grep -n "createNode\|updateNode\|deleteNode\|reorderNode\|createConnector\|updateConnector\|deleteConnector\|uploadImage\|playNode" apps/web/src/components/demo-canvas.tsx
```

**Step 3: Replace each call**

For each match:

```ts
// Before:
await createNode({ /* ... */ });

// After:
await props.adapter.createNode({ /* ... */ });
```

**Step 4: Drop unused imports**

After all replacements, remove the now-unused imports from `@/lib/api`. Keep type-only imports.

**Step 5: Instantiate the adapter in `demo-view.tsx`**

```tsx
const adapter = useMemo(
  () => createRestAdapter({ baseUrl: '', demoId: demo.id }),
  [demo.id],
);

return <DemoCanvas demo={demo} adapter={adapter} {/* ... */} />;
```

**Step 6: Verify behavior**

```bash
bun test
bun run typecheck
bun run dev   # smoke test mutations
```

Manually create a node, update a node's position, delete a connector. Each should still work — under the hood it's the same REST call.

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor(canvas): route demo-canvas mutations through CanvasAdapter"
```

---

## Sub-task 3: Replace runtime hook reads with a `runtime` prop

**What:** Today `demo-canvas.tsx` reads `useNodeRuns()`, `useNodeStatuses()`, `usePendingOverrides()` directly. After this sub-task, it accepts a `runtime` prop and never calls those hooks. `demo-view.tsx` reads the hooks and passes the result down.

**Files:**
- Modify: `apps/web/src/components/demo-canvas.tsx`
- Modify: `apps/web/src/pages/demo-view.tsx`
- Modify: `apps/web/src/lib/canvas-adapter.ts` (add `CanvasRuntime` type)

**Step 1: Define `CanvasRuntime` type**

Add to `apps/web/src/lib/canvas-adapter.ts`:

```ts
import type { NodeData, /* StatusReport / RunResult — wherever they live */ } from '@seeflow/canvas';

export interface CanvasRuntime {
  runs?: Map<string, RunResult>;
  statuses?: Map<string, StatusReport>;
  pendingOverrides?: Map<string, Partial<NodeData>>;
}
```

(`RunResult` and `StatusReport` may currently live in `apps/web/src/hooks/use-node-runs.ts` etc. Move the type definitions into `@seeflow/canvas` first — this is a small precursor commit. Hooks themselves stay in `apps/web` because they read from `useStudioEvents()`.)

**Step 2: Add `runtime?: CanvasRuntime` to demo-canvas props**

Optional — older callers might not pass it.

**Step 3: Replace every hook read**

```bash
grep -n "useNodeRuns\|useNodeStatuses\|usePendingOverrides" apps/web/src/components/demo-canvas.tsx
```

For each match:

```ts
// Before:
const runs = useNodeRuns();
const status = runs.get(node.id);

// After:
const status = props.runtime?.runs?.get(node.id);
```

The hook imports get deleted from `demo-canvas.tsx`.

**Step 4: Pass `runtime` from `demo-view.tsx`**

```tsx
const runs = useNodeRuns();
const statuses = useNodeStatuses();
const pendingOverrides = usePendingOverrides();

return (
  <DemoCanvas
    demo={demo}
    adapter={adapter}
    runtime={{ runs, statuses, pendingOverrides }}
    {/* ... */}
  />
);
```

**Step 5: Verify**

```bash
bun test
bun run typecheck
bun run dev   # smoke: SSE event arrives → node updates as before
```

A useful smoke check: trigger a node play and watch the status badge flip. If it doesn't update, runtime isn't being passed.

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(canvas): replace runtime hook reads with CanvasRuntime prop"
```

---

## Sub-task 4: Introduce the `mode` prop + feature overrides

**What:** Add `mode: 'view' | 'edit'` to demo-canvas props. Wire it into conditional rendering and disabled states. Make `adapter` optional under `mode='view'` via a discriminated union.

**Files:**
- Modify: `apps/web/src/components/demo-canvas.tsx`
- Modify: `apps/web/src/pages/demo-view.tsx` (pass `mode='edit'`)

**Step 1: Define the discriminated-union prop type**

```ts
interface BaseProps {
  demo: Demo;
  runtime?: CanvasRuntime;
  onSelectionChange?: (sel: Selection) => void;
  onError?: (err: unknown, op: string) => void;
  // Fine-grained overrides — all optional
  showToolbar?: boolean;
  showStyleStrip?: boolean;
  showDetailPanel?: boolean;
  showStatusBadges?: boolean;
  showResizeHandles?: boolean;
  enableKeyboard?: boolean;
  enableContextMenu?: boolean;
  enableDragDrop?: boolean;
  enableImageDrop?: boolean;
  enableZoom?: boolean;
  enablePan?: boolean;
  storageKey?: string;
}

export type SeeflowCanvasProps =
  | (BaseProps & { mode: 'edit'; adapter: CanvasAdapter })
  | (BaseProps & { mode: 'view'; adapter?: CanvasAdapter });
```

**Step 2: Resolve effective flags**

Introduce a helper:

```ts
function resolveFlags(props: SeeflowCanvasProps) {
  const isEdit = props.mode === 'edit';
  return {
    showToolbar:        props.showToolbar        ?? isEdit,
    showStyleStrip:     props.showStyleStrip     ?? isEdit,
    showDetailPanel:    props.showDetailPanel    ?? isEdit,
    showStatusBadges:   props.showStatusBadges   ?? true,
    showResizeHandles:  props.showResizeHandles  ?? isEdit,
    enableKeyboard:     props.enableKeyboard     ?? isEdit,
    enableContextMenu:  props.enableContextMenu  ?? isEdit,
    enableDragDrop:     props.enableDragDrop     ?? isEdit,
    enableImageDrop:    props.enableImageDrop    ?? isEdit,
    enableZoom:         props.enableZoom         ?? true,
    enablePan:          props.enablePan          ?? true,
  };
}
```

**Step 3: Gate rendering on the flags**

Wrap each piece of chrome in its flag:

```tsx
{flags.showToolbar && <CanvasToolbar … />}
{flags.showStyleStrip && selection && <StyleStrip … />}
{flags.showDetailPanel && selection && <DetailPanel … />}
```

Same for handlers — wrap `onConnect`, `onEdgesDelete`, edge-related handlers in an `if (!isEdit) return;` guard.

**Step 4: Implement the view-mode node-drag behavior**

Per the design: in view mode, node drag is **local-only**, no adapter call.

```tsx
const handleNodesChange = useCallback((changes: NodeChange[]) => {
  setNodes((nodes) => applyNodeChanges(changes, nodes));

  if (props.mode === 'view') return; // local-only — no persistence

  for (const c of changes) {
    if (c.type === 'position' && !c.dragging) {
      props.adapter.updateNode(c.id, { position: c.position }).catch((err) =>
        props.onError?.(err, 'updateNode')
      );
    }
  }
}, [props]);
```

**Step 5: Disable connector edits in view mode**

In view mode:
- `onConnect` no-op (prevents creating new edges).
- `edgesDeletable={false}` on `<ReactFlow>`.
- Editable-edge's inline-edit label is rendered read-only (pass a prop down).
- Edge context menu does not open.

**Step 6: Disable node create/delete in view mode**

- Toolbar isn't shown (already gated).
- Drop-to-create handler exits early when `mode === 'view'`.
- Delete keyboard shortcut is gated by `enableKeyboard`.

**Step 7: Test mode='view' behavior**

```bash
bun run dev
```

Temporarily pass `mode='view'` from `demo-view.tsx`. Verify: toolbar gone, nodes draggable but no network calls (check the network tab — should be zero PATCH requests on drag), connectors locked. Revert to `mode='edit'` for the rest of the session.

Add unit tests for `resolveFlags` (pure function, easy to test) and ideally one render test that mounts `<DemoCanvas mode='view' />` and asserts toolbar isn't rendered.

**Step 8: Verify**

```bash
bun test
bun run typecheck
```

**Step 9: Commit**

```bash
git add -A
git commit -m "feat(canvas): add mode prop with view/edit presets and overrides"
```

---

## Sub-task 5: Move the orchestrator into `@seeflow/canvas`

**What:** Rename `demo-canvas.tsx` → `seeflow-canvas.tsx`, move it into the package, rewrite its imports to relative paths. The component is now self-contained.

**Files:**
- Move: `apps/web/src/components/demo-canvas.tsx` → `packages/canvas/src/components/seeflow-canvas.tsx`
- Move: `apps/web/src/components/demo-canvas.test.tsx` → `packages/canvas/src/components/seeflow-canvas.test.tsx`
- Move: `apps/web/src/lib/canvas-adapter.ts` → `packages/canvas/src/adapter/types.ts`
- Move: `apps/web/src/lib/canvas-adapter-rest.ts` → `packages/canvas/src/adapter/rest.ts`
- Move: `apps/web/src/lib/canvas-adapter-rest.test.ts` → `packages/canvas/src/adapter/rest.test.ts`
- Modify: `apps/web/src/components/canvas.tsx` (rewire — see Phase 5)
- Modify: `packages/canvas/src/index.ts`

**Step 1: Inventory remaining `@/` imports in demo-canvas**

```bash
grep -n "from '@/" apps/web/src/components/demo-canvas.tsx
```

Expected: all are `@seeflow/canvas` (because previous phases moved the dependencies). If any `@/` imports remain — STOP. Those are app-coupling seams that must be cut first (in the same sub-task or as a precursor commit).

**Step 2: Rename + move**

```bash
git mv apps/web/src/components/demo-canvas.tsx packages/canvas/src/components/seeflow-canvas.tsx
git mv apps/web/src/components/demo-canvas.test.tsx packages/canvas/src/components/seeflow-canvas.test.tsx 2>/dev/null || true
git mv apps/web/src/lib/canvas-adapter.ts packages/canvas/src/adapter/types.ts
git mv apps/web/src/lib/canvas-adapter-rest.ts packages/canvas/src/adapter/rest.ts
git mv apps/web/src/lib/canvas-adapter-rest.test.ts packages/canvas/src/adapter/rest.test.ts
```

**Step 3: Rename the exported symbol**

In `seeflow-canvas.tsx`, rename `DemoCanvas` → `SeeflowCanvas`. Use the editor's "rename symbol" or:

```bash
# Inside the moved file only:
sed -i '' 's/DemoCanvas/SeeflowCanvas/g' packages/canvas/src/components/seeflow-canvas.tsx
sed -i '' 's/DemoCanvas/SeeflowCanvas/g' packages/canvas/src/components/seeflow-canvas.test.tsx 2>/dev/null || true
```

**Step 4: Rewrite imports inside moved files**

Same patterns as previous phases:
- `from '@seeflow/canvas'` → `from '../...'` (relative, since the file is now in the package — don't self-import the barrel)
- `from '@/hooks/...'` → must be gone (if not, STOP — fix in `apps/web` first)
- `from '@/lib/api'` (functions) → must be gone (if not, fix)

For the adapter files moved to `packages/canvas/src/adapter/`:
- `from '@seeflow/canvas'` → `from '../types'` (for canvas schema types)
- `from './canvas-adapter'` (internal) → `from './types'`

Sweep:

```bash
grep -rln "from '@/" packages/canvas/src/components/seeflow-canvas.tsx packages/canvas/src/adapter
```

Expected: no output.

**Step 5: Update package barrel**

`packages/canvas/src/index.ts`:

```ts
export * from './components/seeflow-canvas';
export * from './adapter/types';
export * from './adapter/rest';
```

**Step 6: Verify build**

```bash
bun run typecheck
```

Expected: green. `apps/web` will currently be broken — it still imports `DemoCanvas`. Sub-task 6 fixes that.

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor(canvas): move orchestrator into @seeflow/canvas as SeeflowCanvas"
```

**Note:** This commit intentionally leaves `apps/web` broken at the type level. Sub-task 6 is the immediate follow-up — do not push or PR between sub-task 5 and 6.

---

## Sub-task 6: Wire `apps/web` to consume `<SeeflowCanvas>`

**This sub-task is the same work as Phase 5 — they merge here, since the move happens in this PR.** See `2026-05-18-canvas-phase-5-wire-apps-web.md` for the full step-list.

The short version:

**Step 1: Update `apps/web/src/components/canvas.tsx`** to import from `@seeflow/canvas`:

```tsx
import { SeeflowCanvas, createRestAdapter } from '@seeflow/canvas';
// existing app-level imports for runtime hooks, demo fetch, etc.

export function Canvas({ demo }: { demo: Demo }) {
  const adapter = useMemo(
    () => createRestAdapter({ baseUrl: '', demoId: demo.id }),
    [demo.id],
  );
  const runs = useNodeRuns();
  const statuses = useNodeStatuses();
  const pendingOverrides = usePendingOverrides();

  return (
    <SeeflowCanvas
      mode="edit"
      demo={demo}
      adapter={adapter}
      runtime={{ runs, statuses, pendingOverrides }}
    />
  );
}
```

**Step 2: Delete dead code**

The page's old direct imports of `createNode`, `updateNode`, etc. are no longer needed. Strip them.

**Step 3: Update Tailwind content config**

`apps/web/tailwind.config.ts` content array needs to include the package:

```ts
content: [
  './src/**/*.{ts,tsx}',
  '../../packages/canvas/src/**/*.{ts,tsx}',
],
```

(If a build tool already discovers this via auto-content, skip — but verify in the smoke test.)

**Step 4: Verify**

```bash
bun test
bun run typecheck
bun run format
bun run lint
bun run dev
```

Smoke test exhaustively — this is the moment of truth. Every interaction from prior phases' smoke tests + edge cases:
- Open demo, render all node kinds.
- Drag, drop image, draw edge, edit label, resize, multi-select, scale-group, auto-layout.
- Trigger play, see SSE-driven status update.
- Refresh the page mid-session — state restores correctly.

**Step 5: Final commit + PR**

```bash
git add -A
git commit -m "feat(canvas): wire apps/web to consume <SeeflowCanvas>"
gh pr create --title "feat(canvas): phase 4 — orchestrator + adapter (final)" ...
```

---

## Notes for the executor

- **Big risk surface.** This phase touches the 3,663-line core. Run the smoke test after EVERY sub-task, not just at the end.
- **Watch for cyclic imports.** When the orchestrator joins the package, its imports of `./nodes`, `./edges`, `./components/*` must be acyclic. If a sibling component reaches back into `seeflow-canvas.tsx`, that's a cycle — refactor the cycle out before completing sub-task 5.
- **Don't move `useNodeRuns` and friends into the package.** Those hooks read SSE state owned by `apps/web`'s `useStudioEvents`. They stay in `apps/web`.
- **`onError` is the only surface for adapter failures.** The canvas does not render toasts. The web app's existing toast wiring catches via `onError`.
- **If a sub-task's tests start passing again only after a hack** (e.g., `as any` to silence the discriminated-union complaint), STOP. The hack means the types lied. Find the real fix.
