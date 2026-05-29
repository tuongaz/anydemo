# Move Share Button to Top-Right Header

**Date:** 2026-05-30
**Status:** Approved (design)
**Scope:** `apps/web` only. `@seeflow/canvas` public API is unchanged.

## Summary

The Share affordance currently lives in the canvas's top-right cluster (`ShareMenu` from `@seeflow/canvas`). Move it into the studio's app header — between `ProjectSwitcher` and `Settings` — and hide the in-canvas instance via `showShareMenu={false}`. The library component stays in the public API for embedders. Same menu items, same callbacks, new location.

## Goals

- Share trigger appears in `Header` between `ProjectSwitcher` and `Settings`, only when a flow is open.
- In-canvas ShareMenu is hidden in the studio.
- No regression in PDF / PNG download or Export-to-seeflow.dev.
- No change to embedders consuming `@seeflow/canvas`.

## Non-goals

- Move `FlowSwitcher` out of the canvas's `topRightSlot`.
- Enable Embed in the studio.
- Restyle the Share trigger.

## Architecture

`<Header>` and `<DemoView>` are siblings inside `App.tsx`. The Share button needs the canvas's imperative handle (`SeeflowCanvasHandle`) for PDF/PNG and the cloud-export dialog state for Export-to-cloud — both currently owned by `DemoView`. Lift them up one level rather than introduce a portal or new context.

State moves:

| State | Today | After |
| --- | --- | --- |
| `canvasRef` (`SeeflowCanvasHandle`) | `DemoView` | `App.tsx`, passed as prop into `DemoView` |
| `exportDialogOpen` + `<ExportDialog>` | `DemoView` | `App.tsx`, mounted next to `Header` |

`DemoView`'s existing call sites that read `canvasRef` (e.g. command-palette PDF/PNG at `demo-view.tsx:2044`/`2048`) keep working unchanged — the ref is just received as a prop.

## Component changes

### `apps/web/src/components/header.tsx`

New optional prop bag. When `share` is provided, render the existing `ShareMenu` from `@seeflow/canvas` between `ProjectSwitcher` and `Settings`. When absent, no Share trigger renders (StudioHome case).

```ts
export interface HeaderProps {
  projects: ProjectSummary[];
  currentProjectSlug?: string;
  onProjectCreated?: (result: CreateProjectResult) => void;
  onUnregisterProject?: (projectSlug: string) => Promise<void>;
  share?: {
    onDownloadPdf: () => Promise<unknown> | unknown;
    onDownloadPng: () => Promise<unknown> | unknown;
    onExportToCloud: () => void;
  };
}
```

`ShareMenu` props in the header: `mode="edit"`, `enableEmbed={false}` (mirrors current studio config). `projectId` is omitted — Embed item would not render anyway since `enableEmbed` is off.

### `apps/web/src/App.tsx`

- Declare `canvasRef = useRef<SeeflowCanvasHandle>(null)`.
- Declare `[exportDialogOpen, setExportDialogOpen] = useState(false)`.
- Compute `share` only when a flow is loaded:
  ```ts
  const share = flowId
    ? {
        onDownloadPdf: () => canvasRef.current?.exportPdf(),
        onDownloadPng: () => canvasRef.current?.exportPng(),
        onExportToCloud: () => setExportDialogOpen(true),
      }
    : undefined;
  ```
- Pass `share` into `<Header>` and `canvasRef` into `<DemoView>`.
- Render `<ExportDialog open={exportDialogOpen} onOpenChange={setExportDialogOpen} flowId={flowId} … />` adjacent to `<main>`.

### `apps/web/src/pages/demo-view.tsx`

- Remove local `canvasRef` declaration; accept it as a prop.
- Remove `exportDialogOpen` state and the `<ExportDialog>` render.
- On `<SeeflowCanvas>`:
  - Add `showShareMenu={false}`.
  - Drop the `onExportToCloud` prop (no longer wired here).
  - `enableEmbed={false}` already present — unchanged.
- `FlowSwitcher` in `topRightSlot` — unchanged.

## Data flow

```
App.tsx
├── canvasRef (useRef)
├── exportDialogOpen (useState)
├── <Header share={…} />                  ← reads canvasRef via callbacks
├── <DemoView canvasRef={canvasRef} />    ← forwards into <SeeflowCanvas ref={…} />
└── <ExportDialog open={exportDialogOpen} … />
```

## Tests

- **`export-picker.e2e.ts`** — `data-testid="share-menu-trigger"` and `share-menu-export-cloud` are reused, so selectors keep working. Assertions tied to the trigger's DOM ancestor (canvas vs. header) need updating.
- **Visual baselines** — regenerate via `bun run test:it:update-snapshots`. Pin to `chromium-linux` per repo CLAUDE.md. Affects:
  - `canvas.e2e.ts`
  - `theme.e2e.ts`
  - Any other e2e taking full-page screenshots showing the header or canvas top-right.
- **New `header.test.tsx`** — covers:
  - Share renders only when `share` prop is provided.
  - Clicking each item calls the matching callback.
  - Share absent when `share` is `undefined`.
- **`demo-view`** unit tests — any assertion about `ExportDialog` rendered inside `DemoView` moves to App-level tests, or is rescoped.

## Edge cases

- **Ref population timing.** `canvasRef.current?.exportPdf()` already null-guards. Share callbacks are safe to invoke any time after mount.
- **Flow switching.** `SeeflowCanvas` is keyed on `${project}/${flow}` and remounts on switch. The ref re-attaches on the new instance; nothing to wire.
- **No flow open (StudioHome).** `flowId` is null → `share` is `undefined` → no Share trigger renders → `ShareMenu`'s internal `return null` rule is moot.
- **Error handling.** Unchanged. PDF/PNG errors surface inside the canvas's `useCanvasExport` hook. Cloud-export errors surface inside `ExportDialog`.

## Risks

- Hook-shim test slot ordering in `seeflow-canvas.tsx` (per `packages/canvas/CLAUDE.md`) only matters when adding `useState` inside the canvas. This change touches one prop (`showShareMenu`) and adds no state, so the slot order is untouched.
- Lifting state to `App.tsx` means a top-level rerender when `exportDialogOpen` flips. Acceptable — the dialog open state was already triggering a `DemoView` rerender via the same closure.
