# Detail panel opens only on single selection

## Problem

The built-in `DetailPanel` sidebar opens whenever any node (or connector) is
selected, including multi-selection. The product rule is: the side panel must
appear **only when exactly one entity is selected**. These actions must NOT open
it:

1. Marquee / ghost-selection drag across multiple nodes.
2. Cmd+A select-all.
3. Cmd+Click additive multi-select.

## Root cause

`packages/canvas/src/components/seeflow-canvas.tsx:4169-4170` derives the panel
target unconditionally from the first selected entity:

```ts
const sidebarNodeId = selectedNodeIds[0];
const sidebarConnectorId = selectedConnectorIds[0];
```

All three trigger gestures funnel through the same `onSelectionChange` callback
and simply grow `selectedNodeIds`, so the first element keeps the panel open.
The panel's own `open` flag (`detail-panel.tsx:95`) is purely
`inspectableNode !== null || connector !== null`.

## Design

Gate the target derivation on a single-entity guard. Total selection count
across nodes + connectors must equal 1:

```ts
const isSingleSelection = selectedNodeIds.length + selectedConnectorIds.length === 1;
const sidebarNodeId = isSingleSelection ? selectedNodeIds[0] : undefined;
const sidebarConnectorId = isSingleSelection ? selectedConnectorIds[0] : undefined;
```

When 2+ entities are selected (any combination), both resolve to `undefined`,
so `sidebarNode` / `sidebarConnector` become `null` and the Sheet's `open` is
`false`. This reuses the existing "nothing selected" path exactly — no new
render branch, no new `useState` (no hook-shim slot shift).

The change is action-agnostic: it does not matter how the multi-selection was
formed (marquee, Cmd+A, Cmd+Click) because all three produce the same
`selectedNodeIds` array the guard reads. The single-click path (`length === 1`)
is unchanged. The existing `selectedNodeIds.length >= 2` style-strip path
(seeflow-canvas.tsx:2633) continues to cover multi-select.

### Open rule

Confirmed: panel may open only when **exactly one entity total** is selected —
one node OR one connector, nothing else. Any combination of 2+ hides it.

## Tests

In `packages/canvas/src/components/seeflow-canvas.test.tsx`, US-007 block:

- Keep existing single-select assertions (single node / single connector open).
- Add: `selectedNodeIds: ['a','b']` -> `panel.node` is `null`.
- Add: one node + one connector selected -> both `null`.
- Update the block comment (~line 2596) and derivation comment
  (~lines 4163-4168) which describe targeting "the first selected node".

No per-gesture tests for marquee / Cmd+A / Cmd+Click: they are React Flow input
mechanics that all resolve to the `selectedNodeIds` array, which the unit tests
drive directly. The count guard covers all three.

## Scope (YAGNI)

- No host (`apps/web`) changes — the panel lives inside the canvas and is
  selection-driven.
- No new props, no feature flag.
- Leave the host's `statusReport` computation alone; it is harmless when the
  panel is closed.

## Verification

1. `bun test` (canvas unit tests).
2. `cd packages/canvas && bun run typecheck`.
3. `bun run --filter @seeflow/canvas build` so `apps/web` picks up the change.
4. Manual browser check: marquee, Cmd+A, Cmd+Click all keep the panel closed;
   single click opens it.
