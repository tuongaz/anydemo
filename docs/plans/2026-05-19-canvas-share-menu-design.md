# Canvas Share Menu — In-Canvas + Embed

**Date:** 2026-05-19
**Scope:** `packages/canvas/`, with a small migration in `apps/web/src/pages/demo-view.tsx`.

## Goal

Move the existing `ShareMenu` (currently in `apps/web/src/components/share-menu.tsx`) into
`@seeflow/canvas` so every consumer of `<SeeflowCanvas>` gets PDF / PNG export and a new
**Embed** action automatically. The studio's host-specific "Export to seeflow.dev" stays
opt-in through a callback prop and is hidden in view mode.

## Behavior matrix

| Item                   | edit                                      | view                       | mini |
| ---------------------- | ----------------------------------------- | -------------------------- | ---- |
| Download PDF           | yes                                       | yes                        | —    |
| Download PNG           | yes                                       | yes                        | —    |
| Embed (iframe snippet) | yes *(only if `projectId` is set)*        | no *(force-hidden)*        | —    |
| Export to seeflow.dev  | yes *(only if `onExportToCloud` is set)*  | no *(force-hidden)*        | —    |

The whole menu is hidden in `mini` mode (consistent with the existing `showControls: false`
default), and a new `showShareMenu` override lets hosts kill it surgically in any mode.

## Public API changes

```ts
// packages/canvas/src/index.ts — re-exports from the canvas component
interface SeeflowCanvasBaseProps {
  // …existing
  /**
   * Edit-mode-only callback. When set AND mode === 'edit', the share menu
   * shows an "Export to seeflow.dev" item. Force-hidden in view mode even
   * if the callback is supplied.
   */
  onExportToCloud?: () => void;
}

interface CanvasFeatureOverrides {
  // …existing
  /** Gates the top-right Share menu. Default ON for edit + view, OFF for mini. */
  showShareMenu?: boolean;
}

interface SeeflowCanvasHandle {
  exportPdf: () => Promise<void>;
  exportPng: () => Promise<void>;
  openEmbedDialog: () => void;
}
```

`SeeflowCanvas` becomes a `forwardRef` component so the host can call the export actions
from the command palette (`demo.exportPdf`, `demo.exportPng`) without re-implementing
capture.

## Embed URL

The iframe `src` is built from the existing `projectId` prop. The host is hardcoded:

```ts
const EMBED_HOST = 'https://seeflow.dev/embed';
// snippet src: `${EMBED_HOST}/${projectId}`
```

No new prop. When `projectId` is unset, the Embed item is hidden. The dedicated
`/embed/<id>` route is hosted at `seeflow.dev` — out of scope for this work.

## File layout

```
packages/canvas/
  src/
    components/
      share-menu.tsx            # NEW. Ported from apps/web with Embed added.
      share-menu.test.tsx       # NEW. Ported + extended.
      embed-dialog.tsx          # NEW. Radix Dialog with copy-snippet textarea.
      embed-dialog.test.tsx     # NEW.
      seeflow-canvas.tsx        # MODIFIED. forwardRef + top-right Panel mount.
    lib/
      export-image.ts           # NEW. Moved from apps/web/src/lib/export-png.ts.
      export-image.test.ts      # NEW (thin filter test).
      build-embed-snippet.ts    # NEW. Pure URL escape + template.
      build-embed-snippet.test.ts # NEW.
    hooks/
      use-canvas-export.ts      # NEW. Wraps capture + dynamic jspdf + filename.
    index.ts                    # MODIFIED. Export new types + SeeflowCanvasHandle.
```

## Embed dialog UX

When the user clicks **Embed**, a Radix `Dialog` opens (portaled through
`useCanvasPortalContainer()` per the canvas's portal rule).

```
┌─ Embed this canvas ──────────────────────┐
│                                          │
│  Paste this snippet into your HTML:      │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ <iframe                            │  │  read-only <textarea>,
│  │   src="https://seeflow.dev/.../id" │  │  auto-selects on focus
│  │   width="100%" height="600"        │  │
│  │   style="border:0"                 │  │
│  │   allow="fullscreen"               │  │
│  │   loading="lazy"                   │  │
│  │ ></iframe>                         │  │
│  └────────────────────────────────────┘  │
│                                          │
│              [Copy snippet] [Close]      │
└──────────────────────────────────────────┘
```

Snippet builder (pure, unit-testable):

```ts
function buildEmbedSnippet(url: string): string {
  return [
    '<iframe',
    `  src="${escapeAttr(url)}"`,
    '  width="100%"',
    '  height="600"',
    '  style="border:0"',
    '  allow="fullscreen"',
    '  loading="lazy"',
    '></iframe>',
  ].join('\n');
}
```

- URL is HTML-attribute-escaped (`&`, `"`, `<`) to defend against weird ids.
- Copy uses `navigator.clipboard.writeText`. Failure path selects the textarea and
  inlines "Press ⌘C to copy" — no toast (canvas has no toast system).
- "Copied!" label flips back after 1.5s.

## Dynamic import strategy

`jspdf` is the only heavy dep (~350KB). Lazy-load it inside the click handler:

```ts
const exportPdf = async () => {
  const captured = await captureViewport();
  if (!captured) return;
  const { default: jsPDF } = await import('jspdf');
  // …same orientation + addImage + save as today
};
```

`html-to-image` stays statically imported (small).

## Placement

The share menu renders inside a React Flow `Panel position="top-right"`. It is paired
with future canvas-owned top-right affordances (none today). The host's existing
`<RestartDemoButton>` remains outside the canvas at the page level; the canvas does
not absorb it.

Critically: the existing `viewportExportFilter` in `export-image.ts` already excludes
`react-flow__panel` from PNG/PDF captures, so the in-canvas Share button does not
appear in exported images.

## Migration in `apps/web/`

1. Delete `src/components/share-menu.tsx` and `src/components/share-menu.test.tsx`.
2. Delete `src/lib/export-png.ts` (the canvas owns capture now).
3. In `src/pages/demo-view.tsx`:
   - Remove the absolute-positioned `<ShareMenu>` JSX at lines ~3040-3047.
   - Remove `captureViewportFramed`, `exportFileName`, `onExportPng`, `onExportPdf`
     local definitions (~lines 2645-2703).
   - Add `const canvasRef = useRef<SeeflowCanvasHandle>(null)`.
   - Re-point the command-palette refs:
     `onExportPdfRef.current = () => canvasRef.current?.exportPdf();`
     `onExportPngRef.current = () => canvasRef.current?.exportPng();`
   - Pass `ref={canvasRef}` and
     `onExportToCloud={demoId ? () => setExportDialogOpen(true) : undefined}` to
     `<SeeflowCanvas>`. (`projectId={demoId}` is already passed.)
4. Update `packages/canvas/README.md` with the new props + handle.
5. Run `bun run --filter @seeflow/canvas build` and commit the `dist/` snapshot —
   the GitHub Action commits `dist/` on `main` for external consumers
   (per `packages/canvas/CLAUDE.md`).

## Tests

**Canvas package**

- `share-menu.test.tsx`
  - All 10 existing assertions ported.
  - Embed hidden when `projectId` is undefined.
  - Embed hidden when `mode === 'view'` even with `projectId` set.
  - "Export to seeflow.dev" hidden when `mode === 'view'` even with the callback.
  - Whole menu hidden when `mode === 'mini'` or `showShareMenu: false`.
- `embed-dialog.test.tsx`
  - Snippet text matches expected template for a given URL.
  - Copy invokes `navigator.clipboard.writeText` with the full snippet.
  - Copy-failure path selects the textarea and renders the fallback hint.
- `build-embed-snippet.test.ts`
  - HTML-attribute escape covers `&`, `"`, `<`.
- `export-image.test.ts`
  - `viewportExportFilter` excludes `react-flow__minimap`, `react-flow__controls`,
    `react-flow__panel`.
- `seeflow-canvas` tests
  - Imperative handle exposes `exportPdf` / `exportPng` / `openEmbedDialog`.
  - Share menu is mounted in edit + view, not mini.

## Out of scope

- The actual `/embed/<id>` route at `seeflow.dev`. The canvas only emits the URL.

## Open follow-ups (after this lands)

- If the studio later wants to override the host (e.g., `https://staging.seeflow.dev`),
  promote `EMBED_HOST` to a prop. For now it stays hardcoded.
- If embedders want to customize iframe width / height defaults, expose options on
  the dialog. For now the snippet is `width="100%" height="600"`.
