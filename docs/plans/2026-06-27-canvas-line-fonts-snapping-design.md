# Canvas: line shape, fonts, and snapping — design

**Date:** 2026-06-27
**Scope:** `@seeflow/canvas` (`packages/canvas`) + schema source of truth (`apps/studio/src/schema.ts`) + vendored schema sync.
**Status:** Design validated via brainstorming. Implementation not yet started.

## Summary

Four features for the canvas:

1. **Line shape** — a plain decorative line in the Shape toolbar (standalone, not attached to nodes).
2. **Fonts** — a curated cross-platform font picker applied per-node.
3. **Snap-straight** — the new line snaps to perfectly horizontal/vertical when nearly straight.
4. **Snap-to-node** — connection drags highlight the candidate target node and connect from a wider radius.

Two of these (3 and 4) extend behavior that **already exists for connectors**; the design reuses that machinery rather than reinventing it.

## Decisions (from brainstorming)

| # | Feature | Decision |
|---|---------|----------|
| 1 | Line shape | **Plain decorative line** — standalone visual element, two draggable endpoints, no arrowheads. Styled color / width / solid-dashed-dotted. Never attaches to nodes. Straight 2-point only (no polyline, curves, labels). |
| 2 | Fonts | **Curated cross-platform list** (~6 stacks), stored as a token, per-node, in the StyleStrip. Applies wherever `fontSize` already applies. |
| 3 | Snap-straight | Apply the existing `snapPinToStraight` logic to the **new line's** endpoints (H/V only, ~8px). Connectors unchanged. |
| 4 | Snap-to-node | **Highlight candidate node + widen radius** on connection drag. |

## Existing-behavior findings

- **#3** — `snapPinToStraight()` in `floating-edge-geometry.ts` already nudges a nearly-H/V connector to exactly straight within `STRAIGHT_SNAP_PX = 8`, used in connection-preview and reconnect drags.
- **#4** — `nodeElNearPoint()` in `seeflow-canvas.tsx` already catches a connection drag that misses the handle but lands within `RECONNECT_BUFFER_PX = 15` of a node body, connecting it with a perimeter pin. Stays under xyflow's `connectionRadius={32}` so direct handle-aim wins.
- No free-standing line concept exists today: every "shape" is a node with a bbox; connectors require both a source and target node.
- No `fontFamily` field anywhere — canvas is hardcoded to Inter / JetBrains Mono in `src/styles/index.css`.

## Section 1 — Architecture & data model

**Line as a node, not an edge.** A free line has no source/target, so it can't be an xyflow edge. New geometric node `type: 'line'`, riding existing node infrastructure (persistence, selection, clipboard, undo, PNG/PDF export).

**Storage.** Standard node `position` + `width` + `height` (the bounding box of its two endpoints, padded to a small minimum so a perfectly H/V line isn't zero-area). New `data` field:

- `points: [[ax, ay], [bx, by]]` — endpoints in **node-local** coords (`0…width`, `0…height`). A diagonal uses opposite corners; an H/V line puts both points on the same local axis.

**Styling reuses existing fields** — no new ones: `borderColor` → stroke, `borderSize` → width, `borderStyle` → solid/dashed/dotted.

**Fonts** add one field to the shared visual shape: `fontFamily?: <token>` where token ∈ `sans | system | serif | mono | rounded | handwritten`. Store the token, not a raw CSS stack; resolve through a `FONT_STACKS` map at render so stacks can be tuned later without touching saved flows. Unset → today's Inter default.

**Schema touch points.** `'line'` type and `fontFamily` live in `apps/studio/src/schema.ts` (source of truth), mirrored in `packages/canvas/src/types.ts`, vendored copy synced via `make sync-seeflow-schema` (CI gates on the sync). So this spans the OSS monorepo, not just `packages/canvas`.

## Section 2 — Line shape: rendering & interaction

**Toolbar.** Add one entry `／ Line` to `TOOLBAR_SHAPES` in `canvas-toolbar.tsx`, in the primary group near rectangle/ellipse. It is a `DrawableNodeType` (`GeometricNodeType | 'linkflow' | 'line'`), so it flows through the existing draw-mode machinery with no new pointer plumbing.

**Drawing.** Reuses the existing `drawStart` / `drawCurrent` pointer flow in `seeflow-canvas.tsx`. On pointer-up, a line commits with `points` built from the drag vector: endpoint A = press point, endpoint B = release point, both converted to node-local coords against their bounding box. A short tap creates a small default-length line. **Shift while drawing** constrains to H/V/45°; the straight-snap (#3) auto-snaps near-H/V even without Shift.

**Rendering.** A new `LineShape` renderer (sibling to the `shapes/` registry components) draws a single `<line>`/`<polyline>` SVG inside the node box, `preserveAspectRatio="none"`, stroke from `borderColor` / `borderSize` / `borderStyle`. No fill, no text, no header chrome. Hit area is a fat transparent stroke over the thin visible one so the line is easy to click.

**Endpoint editing.** A selected line in edit mode shows **two endpoint handles** (small circles at the two local points) instead of the usual corner-resize box — the same `ViewportPortal` approach the connector reconnect-dots already use. Dragging an endpoint updates that point, recomputes bbox + position + the other point's local coords each tick, and commits once on release (one undo entry). No 4-corner resize for lines.

**Non-goals (v1):** no multi-point polyline, no curves, no arrowheads, no label.

## Section 3 — Fonts: picker, rendering, persistence

**Curated set** in `src/lib/font-stacks.ts`, token → cross-platform stack:

| Token | Label | Stack |
|---|---|---|
| `sans` | Sans (Inter) | `"Inter", ui-sans-serif, system-ui, sans-serif` *(default)* |
| `system` | System UI | `system-ui, -apple-system, "Segoe UI", sans-serif` |
| `serif` | Serif | `Georgia, "Times New Roman", serif` |
| `mono` | Mono | `"JetBrains Mono", ui-monospace, monospace` |
| `rounded` | Rounded | `"SF Pro Rounded", "Nunito", system-ui, sans-serif` |
| `handwritten` | Handwritten | `"Comic Sans MS", "Comic Sans", cursive` |

Only Inter + JetBrains Mono are web-loaded today; the rest resolve to fonts already on the OS — no new web-font downloads, no bundle/perf hit.

**Picker UI.** New control in `style-strip.tsx` next to the font-size slider — a `PopoverButton` + the existing `DropdownMenu` `RadioItem` pattern (both in `src/ui/`), each row previewing in its own font. Add `fontFamily` to the `NodeStylePatch` interface so it flows through the strip's apply/preview path.

**Rendering.** Wherever `fontSize` is applied inline today (`geometric-node.tsx`, `editable-edge.tsx` labels), also apply `fontFamily: resolveFontStack(data.fontFamily)`. Unset → omit the property → inherits the canvas default (unchanged for existing flows).

**Scope.** All text-bearing nodes (rectangle/text/sticky/illustrative shape labels) + connector labels — mirroring where `fontSize` works. The line node has no text, so it never shows the control.

## Section 4 — Snapping

**#3 Snap-straight for the line.** Extract a pure helper `snapSegmentToStraight(a, b, thresholdPx, zoom)` that snaps two endpoints to exactly horizontal/vertical when the off-axis delta is under threshold. Called while **drawing** (pointer-move preview + commit) and while **dragging an endpoint**. Connectors keep their existing path. Threshold ~8 screen px (zoom-adjusted). H/V only — no 45° auto-snap (Shift still gives 45° during draw).

**#4 Highlight + widen** — two changes in `seeflow-canvas.tsx`:

1. **Widen the radius.** `RECONNECT_BUFFER_PX = 15` becomes node-size-aware — e.g. `max(BASE_PX, fraction of node's smaller dimension)` — so big nodes catch from farther, tiny nodes don't over-grab. Stays below `connectionRadius={32}`.
2. **Live candidate highlight.** During a connection drag (`connecting` state already exists), each pointer-move hit-tests with the same `nodeElNearPoint()` logic and marks the in-range node via a `data-connect-candidate` attribute, styled in `index.css` (scoped `.seeflow-canvas-root`) as a soft ring/glow. Cleared on move-away / connect-end. Reuses the exact predicate that decides the connection, so what glows is what connects.

Adds one pointer-move listener during drags only + one CSS rule. No schema change for either feature.

## Section 5 — Testing, risks & rollout

**Unit tests** (beside sources, `bun test`):
- `font-stacks.test.ts` — token → stack resolution, default fallback.
- `snap-segment.test.ts` — `snapSegmentToStraight`: snaps within threshold, leaves diagonals alone, both axes, zoom-scaled.
- Line geometry helper — drag vector → `points` + bbox/position, incl. min-size padding for H/V lines and the past-the-origin bbox recompute on endpoint drag.
- Connect-candidate predicate — node-size-aware radius picks the right node; stays under `connectionRadius`.
- StyleStrip — `fontFamily` flows through the `NodeStylePatch` apply/preview path; control hidden for `line`.

**E2E** (Playwright, chromium-linux baselines): draw a line + near-H/V snap; pick a font and confirm render; a connect-candidate glow screenshot. `test:it` rebuilds stale `dist/web`; a bare e2e run won't (bundle-build gotcha).

**Risks / watch-items:**
- Degenerate bbox for axis-aligned lines → min-size padding + endpoint-based hit area.
- New node type → `schema.ts` + canvas types + `make sync-seeflow-schema` in one commit (CI gates on sync).
- CSS edits to `index.css` need the canvas rebuild; dev CSS comes from `dist/style.dev.css`.
- **Hook-shim caveat:** any new `useState` in `seeflow-canvas.tsx` must be appended at the END of the body (test slot indices). Prefer a ref + attribute for the candidate-highlight to avoid a new slot.

**Rollout / cross-package:** all four ship inside the OSS monorepo. Reaching cloud additionally needs the canvas-release lockstep (publish `@tuongaz/seeflow`, bump it in `seeflow-cloud`, bump `SEEFLOW_REF`) — out of scope for this canvas work itself.
