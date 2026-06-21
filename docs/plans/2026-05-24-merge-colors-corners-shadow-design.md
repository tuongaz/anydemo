# Merge Colors + Corners, add Shadow slider

**Date:** 2026-05-24
**Scope:** `packages/canvas/` style strip + detail panel + renderers, plus `apps/studio/src/schema.ts`.

## Goal

1. Collapse the standalone `Corners` popover into the `Colors` popover so a node's appearance lives behind one trigger.
2. Add a new `Shadow` slider (0–5 preset elevations) inside the same popover, theme-aware for light + dark.

## Schema

Add one field to `NodeVisualBaseShape` in `apps/studio/src/schema.ts`:

```ts
shadow: z.number().int().min(0).max(5).optional(),
```

`undefined` keeps each renderer's existing baseline (`sf:shadow-sm` on rectangle, `sf:shadow-md` on geometric sticky, none elsewhere) so no flow renders differently after the upgrade. Setting `0` explicitly removes the shadow.

The same field lands on the `NodeStylePatch` type in `style-strip.tsx` and the parallel patch type in `detail-panel.tsx`.

## Theme-aware shadow tokens

Declared once in `packages/canvas/src/styles/index.css` under `.seeflow-canvas-root`, paired with a dark override:

```css
.seeflow-canvas-root {
  --node-shadow-0: none;
  --node-shadow-1: 0 1px 2px 0 rgb(0 0 0 / 0.08);
  --node-shadow-2: 0 4px 6px -1px rgb(0 0 0 / 0.10);
  --node-shadow-3: 0 10px 15px -3px rgb(0 0 0 / 0.12);
  --node-shadow-4: 0 20px 25px -5px rgb(0 0 0 / 0.15);
  --node-shadow-5: 0 25px 50px -12px rgb(0 0 0 / 0.25);
}
.seeflow-canvas-root.dark {
  --node-shadow-1: 0 1px 2px 0 rgb(0 0 0 / 0.40);
  --node-shadow-2: 0 4px 6px -1px rgb(0 0 0 / 0.50);
  --node-shadow-3: 0 10px 15px -3px rgb(0 0 0 / 0.55);
  --node-shadow-4: 0 20px 25px -5px rgb(0 0 0 / 0.60);
  --node-shadow-5: 0 25px 50px -12px rgb(0 0 0 / 0.70);
}
```

## Style strip — merged Colors popover

Drop `style-strip.tsx:692-711` (the standalone Corners popover) and the parallel block in the `pureImageType` branch. Extend the existing Colors popover body to render four sections in this order:

```
Color / Border color   ← swatch grid (already present)
Fill                   ← swatch grid (already present, pureNode && !isTextShape)
Corners                ← slider, hasNodes && !isTextShape
Shadow                 ← slider, hasNodes && !isTextShape, min=0 max=5
```

Gating for the new sections matches the deleted Corners popover (`hasNodes && !isTextShape`). The Shadow slider reuses `SliderControl` with `min=0 max=5 step=1` and no `suffix` so the readout reads as a level number. Indeterminate handling mirrors `cornerRadiusIndeterminate`.

Trigger glyph and tooltip remain unchanged (border+fill swatch + "Colors") per the brainstorm decision. The existing `style-strip-corner-radius` test id moves into the merged popover; `style-tab-corner-radius-slider` stays on the slider itself so existing e2e selectors keep resolving.

Image branch (`style-strip.tsx:398-504`) gets the symmetric merge: image-border-color stays, the image-corner-radius popover folds into a merged Colors popover that also owns the image shadow slider. Border style and border width keep their own popovers (they describe line shape, not depth/color).

## Detail panel mirror

`packages/canvas/src/components/detail-panel.tsx` exposes a parallel set of style sections. Apply the same merge: drop the standalone Corners block, add Corners + Shadow inside the Colors block. Patch type gains `shadow?: number`.

## Renderers

Five files, identical surgical change. Pattern using `rectangle-node.tsx` as the example:

```ts
const shadowClass = data.shadow !== undefined ? '' : 'sf:shadow-sm';

const containerStyle: CSSProperties = {
  // ...existing fields...
  ...(data.shadow !== undefined
    ? { boxShadow: `var(--node-shadow-${data.shadow})` }
    : {}),
};
```

Files:

- `nodes/rectangle-node.tsx` — replace `sf:shadow-sm` with the conditional class.
- `nodes/geometric-node.tsx` — sticky variant keeps `sf:shadow-md` baseline; only override when `data.shadow !== undefined`.
- `nodes/html-node.tsx` — add the conditional `boxShadow` line.
- `nodes/component-node.tsx` — same.
- `nodes/image-node.tsx` — same.

`lib/node-defaults.ts` propagates `shadow` through last-used inheritance the same way `cornerRadius` does today.

## Tests

- `style-strip.test.tsx` — drop the "Corners popover opens independently" assertions; add tests that Corners and Shadow render inside the Colors popover, that Shadow commits `shadow: N` via `onStyleNode`, and that mixed selections show `Mixed` until the user touches the slider.
- `detail-panel.test.tsx` — mirror the same shifts.
- Per-renderer tests (`rectangle-node.test.tsx`, `image-node.test.tsx`, `component-node.test.tsx`, `html-node.test.tsx`) — assert `data.shadow = 3` produces `boxShadow: var(--node-shadow-3)` and drops the default shadow class where one existed.

## Visual baselines

`apps/studio/e2e/` snapshots that capture the style strip will drift because the standalone Corners button is gone. Regenerate via `bun run test:it:update-snapshots` after implementation, commit the `*-chromium-linux.png` files only.

## Out of scope

- No backfill on existing flows — `undefined → existing baseline class` handles that for free.
- No per-shadow color picker — the theme-aware CSS variables already split light/dark.
- No new node types touched; icons and text shapes stay shadowless.
