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
style-strip, detail panel) and every input path inert (no pan, zoom,
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

const adapter = createRestAdapter({ baseUrl: '', demoId: 'my-demo' });

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
- The Embed action and an opt-in "Export to seeflow.dev" item are gated on
  edit mode (view embedders only see PDF / PNG download).
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
  onExportToCloud={() => setExportDialogOpen(true)}
  /* ...other props */
/>
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
