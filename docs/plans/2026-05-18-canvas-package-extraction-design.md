# Canvas package extraction

**Date:** 2026-05-18
**Status:** Design

## Goal

Move all canvas-rendering and editor UI from `apps/web/` into `@seeflow/canvas` so other services can embed the canvas. The package becomes a full-featured React canvas library with view/edit modes; data fetching and live event subscriptions stay in the consumer.

## Current state

`@seeflow/canvas` today exports only schema types, color tokens, and the icon registry. All canvas components — 23+ files including a 3,663-line `demo-canvas.tsx` orchestrator — live in `apps/web/src/`. The orchestrator is tightly coupled to REST mutations (`createNode`, `updateNode`, ...), SSE-fed runtime hooks (`useNodeRuns`, `useNodeStatuses`), and app-level keyboard shortcuts.

## Architecture

`@seeflow/canvas` owns rendering, editing UX, and the visual orchestrator. It does **not** own data fetching, persistence, or event subscriptions — those flow in as props through an adapter interface and a `runtime` prop.

### Package layout

```
packages/canvas/src/
  index.ts                       # public barrel
  types.ts                       # existing — schema types
  lib/
    color-tokens.ts              # existing
    icon-registry.ts             # existing
    connector-to-edge.ts         # moved from apps/web
    floating-edge-geometry.ts    # moved
    canvas-drop.ts               # moved
    auto-layout.ts               # moved (dagre)
    node-defaults.ts             # moved
    last-used-style.ts           # moved (storage key configurable)
    keyboard-shortcuts.ts        # moved
  nodes/                         # play, state, shape, image, icon, html + shapes/ + resize-controls + use-resize-gesture
  edges/                         # editable-edge
  components/
    seeflow-canvas.tsx           # NEW — orchestrator (refactored demo-canvas.tsx)
    canvas-toolbar.tsx           # moved
    style-strip.tsx              # moved
    detail-panel.tsx             # moved
    selection-resize-overlay.tsx # moved
  adapter/
    types.ts                     # CanvasAdapter interface
    rest-adapter.ts              # createRestAdapter factory
  hooks/
    use-canvas-state.ts          # internal — node/edge state, undo/redo
```

Stays in `apps/web/`: route components (`demo-view.tsx`), SSE subscription, and a thin `<Canvas>` wrapper that instantiates the REST adapter and forwards `runtime` from existing hooks.

### Dependencies

- **Peer deps:** `react`, `react-dom`, `@xyflow/react`, `lucide-react`
- **New runtime dep:** `dagre`
- **Tailwind:** classes kept inline in components. Consumers add `packages/canvas/src/**/*.{ts,tsx}` to their `tailwind.config` content array. (Alternative: ship compiled CSS — deferred unless a non-Tailwind consumer appears.)

## Public API

```tsx
import { SeeflowCanvas, createRestAdapter } from '@seeflow/canvas'

<SeeflowCanvas
  mode="edit"                    // 'view' | 'edit' — preset
  demo={demo}
  adapter={restAdapter}          // required in 'edit', optional in 'view'
  runtime={{                     // optional live state from SSE/etc.
    runs,                        //   Map<nodeId, RunResult>
    statuses,                    //   Map<nodeId, StatusReport>
    pendingOverrides,            //   Map<nodeId, Partial<NodeData>>
  }}
  selection={{ nodeId, connectorId }}
  onSelectionChange={...}
  onError={(err, op) => ...}

  // Fine-grained overrides
  showToolbar={true}
  showStyleStrip={true}
  showDetailPanel={true}
  showStatusBadges={true}
  showResizeHandles={true}
  enableKeyboard={true}
  enableContextMenu={true}
  enableDragDrop={true}          // node creation by drag from toolbar
  enableImageDrop={true}
  enableZoom={true}
  enablePan={true}

  storageKey="seeflow"           // localStorage prefix
  className="..."
  initialViewport={{ x, y, zoom }}
/>
```

`SeeflowCanvasProps` is a TS discriminated union on `mode`: edit requires `adapter`, view makes it optional.

### Mode presets

**`mode="edit"`** — all `show*` and `enable*` flags default `true`. Adapter required.

**`mode="view"`** — full editor chrome hidden:
- Nodes are draggable **locally only**. No adapter call, no persistence. Refresh restores persisted positions.
- Connectors are fully locked: no create, edit, delete, re-route.
- No node create/delete, no resize, no toolbar, no style-strip, no detail-panel.
- Zoom, pan, and status badges remain enabled.
- Adapter not required.

Internally the canvas always holds nodes in `useState`; the difference is whether position changes also call `adapter.updateNode(...)`.

### Barrel exports

`SeeflowCanvas`, `CanvasAdapter`, `createRestAdapter`, all existing types from `types.ts`, color tokens, icon registry, plus low-level primitives (`PlayNode`, `ShapeNode`, `EditableEdge`) for advanced composition.

## Adapter contract

```ts
// packages/canvas/src/adapter/types.ts

export interface CanvasAdapter {
  // Nodes
  createNode(input: CreateNodeInput): Promise<DemoNode>
  updateNode(id: string, patch: UpdateNodePatch): Promise<DemoNode>
  deleteNode(id: string): Promise<void>
  reorderNode(id: string, beforeId: string | null): Promise<void>

  // Connectors
  createConnector(input: CreateConnectorInput): Promise<Connector>
  updateConnector(id: string, patch: UpdateConnectorPatch): Promise<Connector>
  deleteConnector(id: string): Promise<void>

  // Assets
  uploadImage(file: File): Promise<{ url: string; width: number; height: number }>

  // Execution (optional)
  playNode?(id: string): Promise<void>
}
```

Patch types mirror the existing REST patches in `apps/studio` and live in `@seeflow/canvas` so adapters never depend on studio.

**`createRestAdapter({ baseUrl, demoId, fetch? })`** — the SeeFlow reference implementation. Demo ID is bound at creation. Optional `fetch` for auth headers and testing.

**Errors:** adapter methods reject on failure. The canvas catches, reverts optimistic updates, and calls `onError(err, op)`. The canvas does not render toasts — the consumer surfaces errors.

## Runtime state

`runtime` is read-only. The canvas never writes to it. Status badges, run indicators, and pending-state highlights read from these maps by node ID. The consumer keeps them fresh — in SeeFlow's case, `apps/web` updates them from SSE.

## Migration phases

Each phase compiles, type-checks, and tests green before the next. No re-export shims — imports update in the same phase as the move. Each phase is a separate PR.

### Phase 1 — Pure utilities

Move to `packages/canvas/src/lib/`: `connector-to-edge.ts`, `floating-edge-geometry.ts`, `canvas-drop.ts`, `auto-layout.ts`, `node-defaults.ts`, `last-used-style.ts` (parameterize the localStorage key), `keyboard-shortcuts.ts`. Move tests alongside. Update all `apps/web` imports. Delete old files. Add `dagre` to package deps.

### Phase 2 — Node & edge components

Move `apps/web/src/components/nodes/**` and `apps/web/src/components/edges/**` (with tests) into the package. Each node currently reads runtime data from its `data` prop; that shape is preserved — the orchestrator (Phase 4) populates `data` from `runtime`. Update web imports.

### Phase 3 — Chrome components

Move `canvas-toolbar.tsx`, `style-strip.tsx`, `selection-resize-overlay.tsx`, and the detail panel. These already take callback props for their actions; minimal refactor.

### Phase 4 — Orchestrator & adapter

Refactor `demo-canvas.tsx` (3,663 lines) into `packages/canvas/src/components/seeflow-canvas.tsx`:

- Define `CanvasAdapter` and `createRestAdapter` (initially co-located in `apps/web`, moves into the package once stable).
- Replace every direct REST call with `adapter.method(...)`.
- Replace every `useNodeRuns()` / `useNodeStatuses()` read with `props.runtime?.runs.get(id)` etc.
- Wire `mode` and override flags into conditional rendering and disabled states.
- Position-drag handler branches on `mode`: in `view` it updates local state only; in `edit` it calls `adapter.updateNode`.
- Discriminated-union prop type for `mode: 'view' | 'edit'`.

### Phase 5 — Wire apps/web

`apps/web/src/components/canvas.tsx` becomes a thin wrapper: instantiates `createRestAdapter`, passes `runtime` from existing SSE hooks, renders `<SeeflowCanvas mode="edit" .../>`. Delete orphaned files. Run full test suite and a `bun run dev` smoke test.

## Out of scope

- Storybook or isolated demo environment for the package (no stories exist today).
- Publishing to npm — the package stays `private: true`, workspace-only.
- Schema tightening on `NodeData.kind` (mentioned in the inventory but separate work).
- A non-React canvas binding.

## Open questions

None blocking. Tailwind-vs-CSS shipping decision is revisitable once a non-Tailwind consumer appears.
