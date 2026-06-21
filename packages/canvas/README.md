# @seeflow/canvas

The React Flow canvas behind [SeeFlow](https://github.com/tuongaz/seeflow) —
node shapes, edges, toolbar, style strip, keyboard shortcuts, and the
`<SeeflowCanvas>` host. Embed it in any host app via a small `CanvasAdapter`
interface.

## Install

Shipped as a workspace dep inside the SeeFlow monorepo:

```jsonc
{ "dependencies": { "@seeflow/canvas": "workspace:*" } }
```

## Peer dependencies

The host app must provide:

- `react` (^18)
- `react-dom` (^18) — required by Radix UI primitives
- `@xyflow/react` (^12)
- `lucide-react` (icons)
- `react-markdown` (^10) and `remark-gfm` (^4) — required for the built-in sidebar's status section

## Styling

Two imports — that's the whole setup. No Tailwind configuration, no CSS
variables, no font setup. The package ships pre-compiled styles
(`dist/style.css`) with all utilities under the `sf-` prefix and tokens scoped
to `.seeflow-canvas-root`, so the consumer's `:root` and global stylesheet stay
untouched.

```tsx
import '@seeflow/canvas/style.css';
import { SeeflowCanvas } from '@seeflow/canvas';
```

## Quickstart — view mode

Read-only navigable canvas. No adapter required.

```tsx
import { SeeflowCanvas } from '@seeflow/canvas';

<SeeflowCanvas
  mode="view"
  nodes={nodes}
  connectors={connectors}
  selectedNodeIds={[]}
  selectedConnectorIds={[]}
/>;
```

## Quickstart — mini mode (thumbnails)

Static preview — every chrome affordance off (no Controls cluster, toolbar,
style-strip, detail panel, MiniMap) and every input path inert (no pan, zoom,
selection, or node drag). `autoFitView` defaults to `true` so the flow
self-frames inside whatever box you drop it into. No adapter required.

```tsx
import { SeeflowCanvas } from '@seeflow/canvas';

<div style={{ width: 240, height: 160 }}>
  <SeeflowCanvas
    mode="mini"
    nodes={nodes}
    connectors={connectors}
    selectedNodeIds={[]}
    selectedConnectorIds={[]}
  />
</div>;
```

Mini mode is just the floor — `CanvasFeatureOverrides` still composes, so a
thumbnail that wants live-state badges can pass `showStatusBadges={true}`
without leaving mini mode.

## Quickstart — edit mode

Edit mode requires a `CanvasAdapter` — the seam through which the canvas
persists every mutation.

```tsx
import { SeeflowCanvas, createRestAdapter } from '@seeflow/canvas';

const adapter = createRestAdapter({ baseUrl: '', project: 'my-project', flow: 'main' });

<SeeflowCanvas
  mode="edit"
  adapter={adapter}
  nodes={nodes}
  connectors={connectors}
  selectedNodeIds={selection.nodes}
  selectedConnectorIds={selection.connectors}
  onSelectionChange={onSelectionChange}
  onCreateShapeNode={onCreateShapeNode}
/>;
```

## CanvasAdapter

The `CanvasAdapter` interface in
[`src/adapter/types.ts`](./src/adapter/types.ts) is the full mutation
contract — create / update / delete nodes and connectors, reorder, upload
image, optional play. `createRestAdapter` in
[`src/adapter/rest.ts`](./src/adapter/rest.ts) is the built-in REST
implementation targeting the SeeFlow studio's HTTP endpoints; implement your
own adapter to plug the canvas into a different backend.

## Share menu — PDF / PNG / Embed export

`<SeeflowCanvas>` ships a top-right ShareMenu that exposes Download PDF,
Download PNG, and an iframe Embed snippet. Capture lives in the canvas via
[`useCanvasExport`](./src/hooks/use-canvas-export.ts), so every embedder gets
the same fit-view + snapshot + jspdf pipeline for free — no setup required.

- The menu renders in `mode='edit'` and `mode='view'`, and is suppressed in
  `mode='mini'`. Override with `showShareMenu={true|false}` to force it on or
  off for a specific surface.
- The Embed action is **opt-in** — pass `enableEmbed={true}` to surface the
  iframe-snippet item. Works in both `mode='edit'` and `mode='view'`, but
  still requires a `projectId`. The default is off because Embed is a
  SeeFlow-studio-specific affordance; most embedders of this package should
  keep it hidden.
- An opt-in "Export to seeflow.dev" item is also gated on edit mode (view
  embedders only see PDF / PNG download).
- Pass `onExportToCloud` to enable the "Export to seeflow.dev" item — when
  the prop is omitted the item is hidden. Use this to launch your own
  upload-to-cloud dialog.
- Pass `projectId` so the embed snippet URL resolves to
  `https://seeflow.dev/embed/<projectId>`.

```tsx
<SeeflowCanvas
  mode="edit"
  adapter={adapter}
  projectId="my-demo"
  enableEmbed={true}
  onExportToCloud={() => setExportDialogOpen(true)}
  /* ...other props */
/>
```

## Grouping

A **group** is a first-class node (`type: 'group'`) that owns membership via
`data.childIds: string[]`. Member node positions stay **absolute** — the model is
`childIds`, never xyflow `parentId`, so the rest of the canvas treats members as
ordinary nodes (no reparenting, no relative coordinates, no array-ordering
invariant).

The canvas renders groups, draws the multi-select overlay (padded rect + 4
corner resize handles + a ＋ create / ⊟ ungroup icon), and owns the
double-click enter/exit **isolation** interaction (edit mode only — a group
still renders read-only in `view`/`mini`). The actual create / ungroup / move /
resize / delete / clipboard **mutations are composed by the host** inside a
`history.batch(...)` using the exported pure ops, so undo/redo and optimistic
overrides stay in the host's hands:

```ts
import {
  computeGroupBox,            // absolute bbox over members (+ padding + title band)
  selectGroupableSet,         // eligible new-group members (loose, ungrouped, not a group)
  selectGroupSelection,       // selected group ids
  planGroupShortcutAction,    // ⌘G / ⌘⇧G oracle → 'group' | 'ungroup' | { none: reason }
  computeGroupMoveUpdates,    // group-drag fan-out (frozen baseline + delta)
  isMemberOfGroup,            // isolation membership oracle
  expandSelectionWithGroupMembers, // copy: pull a group's members into the copy set
  remapGroupChildIds,         // paste: rewrite a pasted group's childIds via the id map
  planGroupAwareDeletion,     // delete: prune-before-delete ordering plan
} from '@seeflow/canvas';
```

Wire the host callbacks `onCreateGroup(memberIds)` and `onUngroup(groupId)` (edit
mode) to enable the affordances; grouping has no master flag, so leaving them
unset disables the feature on that surface.

**Server-side membership integrity (when using the studio adapter):** every write
re-validates the whole flow, and a `superRefine` rejects a group whose `childIds`
references a missing node, another group (no nesting), or a node already in
another group. Therefore deleting a **member** must prune the owning group's
`childIds` (`updateNode(groupId, { childIds })`) **before** `deleteNode(member)`;
`planGroupAwareDeletion` produces that ordered plan. Deleting a **group** needs no
prune — its `childIds` die with it and members survive as loose nodes. Empty
groups (`childIds: []`) are allowed and persist as labeled zones.

## MiniMap — outline / high-level box

`<SeeflowCanvas>` renders React Flow's bottom-right `<MiniMap>` as a high-level
outline of the whole flow — handy on large canvases where the viewport only
shows a slice.

- Default ON for `mode='edit'` and `mode='view'`; OFF for `mode='mini'` (the
  canvas IS the thumbnail). Override with `showMiniMap={true|false}` to force
  it on or off on any surface.
- The minimap is themed under `.seeflow-canvas-root` so the background,
  viewport mask, and node fills track the canvas's light / dark tokens.
- PDF / PNG export already excludes the minimap from captured snapshots, so
  enabling it does not affect downloaded artwork.

```tsx
// Hide the minimap on a specific embed surface:
<SeeflowCanvas mode="view" showMiniMap={false} /* ... */ />;
```

### Imperative handle (`SeeflowCanvasHandle`)

`<SeeflowCanvas>` is a `forwardRef` component. Pass a `ref` to drive PDF / PNG
export, open the embed dialog, or capture a preview thumbnail from a command
palette / keyboard shortcut / external menu — no need to mirror the export
workflow in the host.

```tsx
import { useRef } from 'react';
import { SeeflowCanvas, type SeeflowCanvasHandle } from '@seeflow/canvas';

const canvasRef = useRef<SeeflowCanvasHandle>(null);

<SeeflowCanvas ref={canvasRef} /* ... */ />;

// Trigger from a command palette:
canvasRef.current?.exportPdf();      // download PDF
canvasRef.current?.exportPng();      // download PNG
canvasRef.current?.openEmbedDialog(); // open iframe snippet dialog (no-op when ShareMenu is hidden)

// Capture a preview thumbnail without triggering a download:
const dataUrl = await canvasRef.current?.capturePreview();
```
