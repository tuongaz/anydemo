# Milestone 2 — Multi-select overlay chrome (padded rect + 4 corner boxes)

**Status:** Not started · **Depends on:** M1 · **Risk:** Low (no mutation yet)

## Previous milestone — summary

M1 added `type:'group'` + `data.childIds` end-to-end (schema, persistence,
canvas types, parity gates) and a static `group-node.tsx` renderer that paints a
padded titled container behind its members with correct z-order. Groups can be
hand-authored and round-trip through reload.

## Lessons carried forward

**From M1's handoff (read these — they bite the overlay too):**
- **M1.z-order — mechanism is an explicit negative per-node zIndex.** `type:'group'`
  nodes get `node.zIndex = GROUP_NODE_Z_INDEX` (`= -1`, exported from
  `nodes/group-node.tsx`) in `seeflow-canvas.tsx` `buildNode`. It's negative
  (not just "low") because edges are pinned at zIndex 0 and every other node is
  undefined→0. `elevateNodesOnSelect={false}` + the
  `.react-flow__node.selected:not(.react-flow__node-group)` carve-out in
  `index.css` keep it stable on selection. **The overlay's padded rect renders
  via `ViewportPortal` at a HIGH CSS z-index (≈1500) — it is NOT a node, so the
  group's `-1` does not affect it. But verify the overlay sits above a selected
  group's box AND above its members.**
- **M1.css — v1 group CSS leak.** v1's dead `.react-flow__node-group` rules were
  still in `index.css` (removed in M1). xyflow auto-applies
  `.react-flow__node-group` to `type:'group'` nodes. Before adding overlay CSS,
  `rg "react-flow__node-group"` and don't collide.
- **M1.exhaustive-maps — adding/relying on a node type ripples.** `'group'` had
  to be added to `operations.ts SEMANTIC_KEYS_BY_TYPE` and `layout.ts
  DEFAULT_DIMENSIONS` (both `Record<NodeType,…>`). If the overlay introduces any
  per-type map, include `group`.
- **M1.overlay-input lacks `type`.** Confirmed still true: `OverlayInputNode`
  (`selection-resize-overlay.tsx`) carries only `{id,position,data:{width,height}}`.
  The "show overlay for a single group" gating (design §12.5) needs the type —
  thread it from `seeflow-canvas.tsx` (which has the resolved nodes), do NOT try
  to read it off the overlay's current input shape.
- **M1.dims — `computeUnionRect` reads only `data.width/height`** and skips nodes
  lacking it. Group renderer falls back to a default box (320×220) when unsized,
  but the OVERLAY must still resolve auto-sized members via measured dims
  (design §12.1). Don't assume `data.width/height` is present.

- **L0.1** Freezing `oldRect` alone is not enough for scaling — but this
  milestone renders chrome only, no scaling. We set up the frozen-baseline
  structure now so M3 can't get it wrong.
- **L0.4** Never patch xyflow's selection stream; consume the resulting selection.
- The overlay must not steal clicks from nodes underneath (pointer-events only on
  handles/icon).

## Goal

Make the **transient + group selection overlay visible**: a padded dashed
rectangle (req #1, "a bit extra padding") with **4 corner boxes** (req #2),
zoom/pan-correct, appearing for 2+ loose nodes OR a single selected group.
**Handles are inert this milestone** (no resize yet) — this de-risks M3 by
locking the rendering/positioning/gating first.

**User-testable outcome:** Marquee-select 2+ nodes → a padded dashed rect with 4
corner handles appears and tracks zoom/pan; deselect → it vanishes. Select a
single group → same chrome around the group's padded box.

## Scope

**In:** restore the deleted JSX in `SelectionResizeOverlay` (currently
`return null` at `:407`); render padded rect + 4 corners (drop the 4 edge
handles — request asks 4 corners); zoom-compensated handle size; gating for
"2+ loose nodes OR one group"; pointer-events neutralization on the rect.

**Out:** functional resize/drag (M3); the create/ungroup icon (M4 wires the
button; this milestone may render a placeholder slot but no action); group
move/resize (M5).

## Implementation steps

1. In `selection-resize-overlay.tsx`, replace `return null` (`:407`) with the
   restored render: a `ViewportPortal` containing a div at `paddedRect`
   (`:277-282`), `position:absolute`, dashed border, `zIndex:1500`,
   `pointerEvents:'none'` on the rect itself.
2. Render **4 corner** handles using the existing `ANCHOR_OFFSET`/`ANCHOR_CURSOR`
   maps but only `['nw','ne','se','sw']` (define `CORNER_ANCHORS`). Each handle:
   `pointerEvents:'auto'`, `HANDLE_BOX_PX` size, zoom-compensated via `--rf-zoom`
   (read the same way `resize-controls.tsx` does, `:51-58`), `cursor` from
   `ANCHOR_CURSOR`. **Keep the pointer handlers wired** (`onHandlePointerDown`
   etc. already exist) but in this milestone they may `setPreviewRect` to show
   the rect following the cursor WITHOUT dispatching `onMultiResize` — i.e. visual
   feedback only. (Make the dispatch a no-op or omit `onMultiResize` wiring until
   M3.)
3. **Padding:** bump `SELECTION_OVERLAY_PADDING` from 8 → **12** (req #1 "a bit
   extra padding"). Pin the value in a test.
4. **Gating + overlay input (design §12.5):** `OverlayInputNode` has no `type`,
   so thread an `isGroupSelection`/`groupId` flag from `seeflow-canvas.tsx`.
   Extend gating to show for (a) `selected.length >= 2` (loose) OR (b) a single
   selected group. **Build `selectionOverlayNodes` (`:3227`) correctly:** for a
   loose selection it is the selected nodes; for a single group it is the group's
   **members** (resolved from `childIds`) plus the group box — so the rect hugs
   the right geometry (M5 will scale members from this set).
4a. **Dimension resolution (design §12.1):** the rect math must resolve each
   node's size via `rfInstance.getInternalNode(id)?.measured ?? data.width/height
   ?? fallback` — NOT `data.width/height` alone (which excludes auto-sized
   html/component nodes). Resolve dims in `seeflow-canvas.tsx` (it has
   `rfInstance`) and pass them into `OverlayInputNode`, or extend the type. Add a
   test with an auto-sized member so the rect encloses it.
5. Mount/keep mounted in `seeflow-canvas.tsx` (`:5402-5407`), gated on
   `flags.showResizeHandles`. The overlay node set already flows via
   `selectionOverlayNodes` (`:3227`).
6. Top-right icon **slot**: render an empty 32×32 placeholder anchored to the
   rect's NE corner so M4 can drop the button in; no behavior yet.
7. **A11y (design §12.11):** give each corner handle an `aria-label`
   (e.g. `"Resize selection"`); keyboard-driven resize is out of scope (note it
   as a decision). Decorative glyphs `aria-hidden`. Mirrors the existing
   `inspector-toggle.tsx`/`node-header.tsx` convention.

## Guardrails
- Rect = `pointer-events:none`; only handles + (future) icon are interactive.
  Mirror `nodesselection-rect` neutralization (`index.css:491`).
- Handle screen-size must stay constant across zoom (`--rf-zoom` compensation) —
  a v1 detail that was easy to miss.
- Do NOT wire `onMultiResize` yet. Keep the gesture inert so M3 owns the risky
  part in isolation.

## Tests
- **Unit:** `computeUnionRect` + padded-rect math at padding 12; corner-only
  anchor set; gating (2 loose → true, 1 loose → false, 1 group → true, 0 → false).
- **Component:** overlay renders 4 handles at correct offsets; rect has
  `pointer-events:none`; absent when gating fails; zoom compensation applied.
- **Visual baseline (optional here, required by M9):** overlay around a 2-node
  selection.

## User Acceptance Test (manual)
1. `bun run dev`. Marquee-select 2 nodes → padded dashed rect + 4 corner boxes.
2. Zoom in/out and pan → handles stay constant screen-size and hug the padded
   union. Boxes do NOT resize anything yet (expected).
3. Click empty pane → overlay disappears.
4. Select a single group (from M1) → same chrome appears around its padded box.

## Definition of Done
- Gates green (format/lint/typecheck/test).
- UAT passes; handles visible & inert; padding visibly larger than before.
- Lessons handoff filled in.

## Lessons-learned handoff (M2 — DONE)

- **`--rf-zoom` compensation — read it the CSS way, not in JS.** The overlay is
  drawn in flow space via `ViewportPortal`; handle box size / border / corner
  radius use `calc(<px>px / var(--rf-zoom, 1))` inline (a tiny `invZoom(px)`
  helper), exactly like `resize-controls.tsx`. `--rf-zoom` is set on
  `.seeflow-canvas-root` by seeflow-canvas's viewport effect
  (`onMove`/`onInit`). **Verified live:** handle on-screen size stayed **10×10
  px across zoom 0.885 → 1.53** (a 1.7× swing). There is NO JS read of the zoom
  in the overlay — don't add one; the CSS var is the single source. (At the very
  bottom of the zoom-out range a node can lack `--rf-zoom` until the first
  viewport event; the `, 1` fallback keeps the handle a sane size meanwhile.)
- **Pointer-events leakage — none.** The rect div is `pointer-events:none`
  (mirrors `.react-flow__nodesselection-rect`); only the 4 handles are
  `pointer-events:auto`. Verified live: rect `pointer-events: none`, handle
  `pointer-events: auto`, and clicking nodes / empty pane through the overlay
  region still selects/deselects normally. xyflow's multi-select drag-to-move
  underneath is unaffected.
- **Frozen-baseline `DragState` IS ready for M3 — `startNodes` added now.**
  `DragState` already carries `oldRect` (frozen union rect) **and**
  `startNodes: FrozenNode[]` (a per-node `{id,position,width,height}` snapshot
  captured at pointer-down via `resolveNodeSize`). M2 doesn't read `startNodes`
  (the gesture is inert) but it is populated so M3's `scaleNodesWithinRect(
  startNodes, oldRect, newRect)` is a drop-in. **M3 MUST scale from `startNodes`,
  never the live `selectedNodes`** — that's the L0.1 compounding trap. The
  pointer handlers (`onHandlePointerMove`/`Up`) currently only `setPreviewRect`;
  M3 adds the end-only `onMultiResize` dispatch in `onHandlePointerUp` reading
  the frozen pair.

### New lessons (M2)

- **L2.1 — `OverlayInputNode` now carries resolved dims + `type`.** Added
  top-level `width?`/`height?` (caller-resolved `measured ?? data ?? fallback`,
  §12.1) preferred over `data.width/height`, plus `type?`. `computeUnionRect` /
  `computeSelectionResizeUpdates` resolve via a private `resolveNodeSize(n)`
  (top-level first, `data.*` fallback). Old callers/tests that only set `data`
  still work. The host (`seeflow-canvas.tsx`) does the measured resolution
  because only it has `rfInstance.getInternalNode`.
- **L2.2 — single-group overlay payload = members + the group box.** For a
  single selected group, `selectionOverlayNodes` resolves `group.data.childIds`
  to member nodes AND appends the group node, so the rect hugs the right
  geometry and M5 can scale members from this same set. Gating is threaded as a
  separate `isGroupSelection` boolean prop (NOT inferred from the array) —
  `selectionEligibleForOverlay(selected, isGroupSelection)` returns true for ≥1
  node when it's a group (a 1-member group still gets chrome), ≥2 otherwise.
- **L2.3 — the overlay can't be unit-rendered with a naïve dispatcher shim.**
  Unlike the node renderers, it calls `useReactFlow()`, which pulls xyflow's
  `StoreContext` + `BatchContext` + zustand `useSyncExternalStore`. The
  component-render test (`selection-resize-overlay.test.tsx`) provides a
  self-contained merged store stub + a `useSyncExternalStore` that just runs the
  snapshot. **Do NOT `mock.module('@xyflow/react')`** — Bun module mocks are
  process-global and would corrupt every other test file's xyflow in the same
  `bun test` run.
- **L2.4 (DX gotcha) — `bun run --filter @seeflow/canvas build` runs `rm -rf
  dist`, deleting `dist/style.dev.css`** that the running dev server serves;
  tailwind `--watch` does NOT regenerate it on deletion, so the studio renders a
  blank scriptless-CSS page until you re-run `build:css:dev`. The M2 gate only
  needs `build:js` (no `rm -rf`). Only run the full `build` (or `build:web`) when
  you must refresh the **served web bundle** for a browser screenshot — and
  regenerate `style.dev.css` afterward if a dev server is live.
- **L2.5 — stable testids exist for the overlay.** `selection-overlay` (rect),
  `selection-overlay-handle-{nw,ne,se,sw}` (corners), `selection-overlay-icon-slot`
  (the empty M4 placeholder). Each handle also has `data-anchor` +
  `aria-label="Resize selection"`. Use these for E2E/visual assertions.

### Decisions

- **A11y:** corner handles are `role="button"` + `tabIndex={-1}` +
  `aria-label="Resize selection"`. Keyboard-driven resize is explicitly **out of
  scope** (pointer-only) per design §12.11 — `tabIndex={-1}` keeps them out of
  the tab order while satisfying Biome's focusable-interactive rule. The icon
  slot is `aria-hidden` (decorative until M4 fills it).
- **Edge handles dropped:** `CORNER_ANCHORS = ['nw','ne','se','sw']` is the only
  rendered set (req #2). The 8-anchor `ANCHOR_OFFSET`/`ANCHOR_CURSOR` maps are
  kept whole (still keyed by all 8) so M3/M5 can reintroduce edges cheaply if a
  product call ever wants them; only the render iterates `CORNER_ANCHORS`.

- **➡ Copied into `03-proportional-resize.md` "Lessons carried forward".**
