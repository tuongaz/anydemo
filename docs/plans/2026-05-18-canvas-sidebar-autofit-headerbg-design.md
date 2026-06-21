# Canvas: sidebar incorporation, auto-fit-view, per-token header background

**Date:** 2026-05-18
**Package:** `@seeflow/canvas`
**Status:** Design

## Summary

Three improvements to `@seeflow/canvas`, shipped as one bundle:

1. **Sidebar moves into the canvas package.** The studio's `DetailPanel` relocates from `apps/web/src/components/detail-panel.tsx` into `packages/canvas/src/components/detail-panel.tsx` and is rendered internally by `<SeeflowCanvas>` (driven by the selection props it already receives). Host apps no longer compose a sibling sidebar.
2. **Auto-fit-view as an opt-in prop.** New `autoFitView` prop on `<SeeflowCanvas>` (default `false`). When enabled, fits the viewport on initial mount and when external sources (SSE, adapter) add or remove nodes — never on local user adds.
3. **Per-token header background.** `COLOR_TOKEN_MAP` gains a `headerBackground` field per token; header-bearing nodes (shape rectangle, state) read that instead of `bg-muted/30`. Reads as a clearly darker shade on all 8 tokens.

`CanvasAdapter` gains two optional methods: `openFile(path)` / `revealFile(path)`. `createRestAdapter` implements them against the existing studio endpoints. `react-markdown` (^10) and `remark-gfm` (^4) become peer deps for the sidebar's status section.

## Architecture

### Sidebar incorporation

`DetailPanel` is currently a sibling component composed in `apps/web/src/pages/demo-view.tsx`. After this change it lives inside the canvas package and is rendered by `<SeeflowCanvas>` as part of its layout.

**File moves** (use `git mv` to preserve blame):
- `apps/web/src/components/detail-panel.tsx` → `packages/canvas/src/components/detail-panel.tsx`
- `apps/web/src/components/detail-panel.test.tsx` → `packages/canvas/src/components/detail-panel.test.tsx`

**Rewire imports.** The relocated file:
- Imports `DemoNode`, `Connector`, `StatusReport` from `../types.ts` (already re-exported from the canvas barrel).
- Imports UI primitives (`Button`, `Sheet*`, `StatusBadge`, `cn`, `getStoredDetailPanelWidth`, `setStoredDetailPanelWidth`, `startResizeGesture`) via relative paths.
- Replaces direct `openProjectFile` / `revealProjectFile` calls with `adapter.openFile(path)` / `adapter.revealFile(path)`.

**Render inside `<SeeflowCanvas>`.** The canvas grows a `<DetailPanel>` child in its flex layout (the slot currently occupied by the sibling sidebar in `demo-view.tsx`). New props on `SeeflowCanvasProps`:

```ts
interface SeeflowCanvasProps {
  // ...existing...
  /** Hide the built-in sidebar entirely (view-mode embeds, custom inspectors). Default: false. */
  disableSidebar?: boolean;
  /** Status report keyed lookup for the selected node. Mirrors current detail-panel prop. */
  statusReport?: StatusReport & { ts: number };
  /** Sidebar field-edit callbacks. Forwarded to <DetailPanel>. */
  onNameChange?: (nodeId: string, name: string) => void;
  onDescriptionChange?: (nodeId: string, value: string) => void;
  onDetailChange?: (nodeId: string, value: string) => void;
}
```

The panel reads `selectedNodeIds[0]` / `selectedConnectorIds[0]` and looks up the target in the existing `nodes` / `connectors` props.

**Resize handle** (width-resize gesture using `clampDetailPanelWidth`, `getStoredDetailPanelWidth`, `setStoredDetailPanelWidth`, `startResizeGesture`) moves into the canvas component. `DETAIL_PANEL_WIDTH_KEY` stays the same so existing users keep their width.

**Migration in `demo-view.tsx`.** Delete the `<DetailPanel>` JSX, the `import { DetailPanel }` line, and the resize-handle JSX. Pass the existing callbacks (`onNameChange`, `onDescriptionChange`, `onDetailChange`, `statusByNode[selectedNodeId]`) into `<SeeflowCanvas>`.

### Auto-fit-view

```ts
type AutoFitViewConfig = {
  onMount?: boolean;             // default true (when autoFitView truthy)
  onExternalNodeChange?: boolean; // default true
};

interface SeeflowCanvasProps {
  autoFitView?: boolean | AutoFitViewConfig;
  /** Host bumps this counter when nodes change from an external source (SSE, adapter). */
  autoFitViewSignal?: number;
}
```

**Mount trigger.** A `useEffect` runs once after `rfInstanceRef.current` is initialized and `nodes.length > 0`. Guarded by `didMountFitRef` so re-renders don't re-fit. Calls `rfInstanceRef.current.fitView(FIT_VIEW_OPTIONS)`.

**External-change trigger.** `useEffect([autoFitViewSignal])` calls `fitView` when the signal increments. Studio bumps the signal on each SSE `node:created` / `node:deleted` event.

**Why a signal counter and not array-diffing.** The canvas can't reliably tell a "user dragged a new shape" change from an "adapter pushed a new node" change by looking at `nodes` alone — both produce the same prop change. The host knows the source; the signal is the simplest way for the host to tell the canvas "this update was external."

**Interaction-guard defer.** If a trigger fires while the user is mid-drag or mid-resize (existing `isResizing` ref + React Flow's drag state), the fit is deferred until the interaction ends, then runs once via a pending-fit ref.

**Canonical options.** `FIT_VIEW_OPTIONS` is a single module-level constant — `{ padding: 0.15, duration: 300, includeHiddenNodes: false }` — used by both the manual Fit View button and the auto-fit effects. Prevents drift.

### Per-token header background

`packages/canvas/src/lib/color-tokens.ts`:

```ts
const COLOR_TOKEN_MAP: Record<ColorToken, {
  border: string;
  background: string;
  headerBackground: string;  // NEW
  edge: string;
}> = {
  default: { ..., headerBackground: 'hsl(var(--muted))' },
  slate:   { ..., headerBackground: 'hsl(215, 15%, 10%)' },
  blue:    { ..., headerBackground: 'hsl(214, 30%, 10%)' },
  green:   { ..., headerBackground: 'hsl(142, 25%, 9%)' },
  amber:   { ..., headerBackground: 'hsl(43, 30%, 10%)' },
  red:     { ..., headerBackground: 'hsl(0, 25%, 10%)' },
  purple:  { ..., headerBackground: 'hsl(270, 20%, 11%)' },
  pink:    { ..., headerBackground: 'hsl(330, 20%, 10%)' },
};
```

Pattern: header lightness ≈ body lightness − 4 (same hue/saturation, just darker). On `default` (white card), solid `--muted` gives the clearest gray.

**New `colorTokenStyle` kind:**
```ts
export type NodeHeaderColorStyle = Pick<CSSProperties, 'backgroundColor'>;
export function colorTokenStyle(token: ColorToken | undefined, kind: 'node-header'): NodeHeaderColorStyle;
```

**Call sites.**

`shape-node.tsx` (line ~424) — header div:
```diff
- className="relative flex shrink-0 items-center border-b bg-muted/30 px-2 py-1.5"
+ className="relative flex shrink-0 items-center border-b px-2 py-1.5"
+ style={colorTokenStyle(data.color, 'node-header')}
```

`state-node.tsx` (line ~154) — same change.

### Adapter changes

`packages/canvas/src/adapter/types.ts`:

```ts
export interface CanvasAdapter {
  // ...existing...
  openFile?(path: string): Promise<void>;
  revealFile?(path: string): Promise<void>;
}
```

Both optional — sidebar UI checks for the methods and hides the "Open" / "Reveal" buttons when undefined.

`createRestAdapter` in `packages/canvas/src/adapter/rest.ts` implements them against the studio's existing endpoints (read `apps/web/src/lib/api.ts` to confirm exact route shape during implementation; the adapter needs `projectId` in addition to `demoId`).

### Peer dependencies

`packages/canvas/package.json`:

```json
"peerDependencies": {
  "@xyflow/react": "*",
  "lucide-react": "*",
  "react": "*",
  "react-dom": "*",
  "react-markdown": "^10",
  "remark-gfm": "^4"
}
```

`react-dom` was documented in the README but missing from `package.json` — fixed here. `react-markdown` / `remark-gfm` versions match what `apps/web` already installs (^10.1.0 / ^4.0.1) so no apps/web change needed.

README peer-deps section gets a one-liner: "`react-markdown` and `remark-gfm` are required for the built-in sidebar's status section."

## Build sequence

Each step is independently committable and must pass `bun run typecheck` + `bun test`.

1. **Color tokens.** Extend `COLOR_TOKEN_MAP` with `headerBackground`, add `'node-header'` kind to `colorTokenStyle`, export `NodeHeaderColorStyle`, swap `bg-muted/30` for inline style in `shape-node.tsx` + `state-node.tsx`, update tests. Smallest blast radius; lands first.
2. **Adapter file methods.** Add optional `openFile` / `revealFile` to `CanvasAdapter`. Implement in `createRestAdapter`. No UI consumers yet.
3. **Sidebar relocation.** `git mv` detail-panel files into `packages/canvas/src/components/`. Rewire imports to relative paths and types from `../types.ts`. Swap `openProjectFile` / `revealProjectFile` for adapter calls. Add peer deps + README note. Export `DetailPanel` from `src/index.ts`. Update test imports. Do **not** yet render it inside `<SeeflowCanvas>` — `demo-view.tsx` keeps composing it as a sibling. Confirms the move works in isolation.
4. **Render sidebar inside `<SeeflowCanvas>`.** Add `disableSidebar`, status, and field-edit-callback props to `SeeflowCanvasProps`. Render `<DetailPanel>` as part of the canvas's flex layout. Move the resize-handle JSX into the canvas. Remove `<DetailPanel>` JSX + resize handle from `demo-view.tsx`. End-to-end smoke check (`bun run dev`): open a demo, click nodes, edit fields, resize the panel — behavior must match before/after.
5. **Auto-fit-view.** Add `autoFitView` + `autoFitViewSignal` props, `FIT_VIEW_OPTIONS` constant, mount-fit effect, signal-fit effect with interaction-guard. Tests in `seeflow-canvas.test.tsx`. Studio wires SSE `node:created` / `node:deleted` to bump the signal and passes `autoFitView={true}`.

## Tests

- `color-tokens.test.ts`: `colorTokenStyle(undefined, 'node-header')` returns `{ backgroundColor: 'hsl(var(--muted))' }`; each non-default token returns its `headerBackground`.
- `shape-node.test.tsx` / `state-node.test.tsx`: header section asserts inline `backgroundColor` style rather than the `bg-muted/30` class.
- `detail-panel.test.tsx` (moved): imports rewire to `../adapter/types.ts`; constructs a fake adapter instead of mocking `@/lib/api`.
- `seeflow-canvas.test.tsx`:
  - `autoFitView={false}` (default) → no fit on mount.
  - `autoFitView={true}` + nodes on mount → exactly one `fitView` call with `FIT_VIEW_OPTIONS`.
  - `autoFitView={true}` + `nodes.length === 0` on mount → no call.
  - Bumping `autoFitViewSignal` triggers one `fitView`.
  - Bumping `autoFitViewSignal` while `isResizing` is true defers the call; clearing `isResizing` flushes it once.
- `rest.ts` (adapter): `openFile` / `revealFile` hit the right URLs with the right payload.

## Risks and mitigations

- **Markdown peer dep is heavy** — `react-markdown` + `remark-gfm` add ~30KB gzipped. Already installed in `apps/web`; net-neutral for the only current consumer. Hosts that want to avoid it can set `disableSidebar` and ship their own inspector.
- **Auto-fit yank during user actions** — mitigated by the `autoFitViewSignal` design (only external sources bump it) plus the interaction-guard defer.
- **Default-token header on light theme** — the `default` token uses `hsl(var(--muted))` (solid CSS var) instead of an HSL-tuned darker shade, so light themes get the right gray rather than a dark band.
- **Breaking changes** — only `apps/web` consumes the package today (workspace-only), so the new required-prop / API-surface changes are fine; no SemVer concerns yet.

## Out of scope (YAGNI)

- Connector-edge color tokens do not grow a `headerBackground` field (edges have no header).
- Sidebar does not become collapsible-to-icon — current width-resize behavior unchanged.
- No new sidebar tabs / sections; this is a move-and-render-internally task, not a redesign.
- `placeholder-card`, `image-node`, `icon-node`, `play-node`, `html-node` have no header today and are not gaining one.
