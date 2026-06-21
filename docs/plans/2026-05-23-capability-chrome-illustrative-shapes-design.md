# Capability chrome on illustrative shapes — design

**Date:** 2026-05-23
**Status:** Design approved, ready for implementation plan
**Builds on:** `b8fe6c5` (flat-node-types refactor)

## Problem

The flat-node-types refactor moved `playAction` / `statusAction` / `stateSource` onto every node's `data` at the schema level, but the renderer continues to draw capability chrome (play button + status badge) only on `rectangle` nodes. A user who sets `statusAction` on a `database` node today gets a valid flow that spawns the script and emits `StatusReport`s, but the badge only appears in the sidebar — the node itself shows no inline signal.

This story closes that gap for the **5 illustrative shapes**: `database`, `server`, `queue`, `cloud`, `user`. Ellipse, sticky, and text remain chrome-less in v1.

## Goals

- A `database` (or `server`/`queue`/`cloud`/`user`) node with `playAction` set renders an inline play button.
- The same node with an arriving `statusReport` renders an inline status badge.
- A node with no capabilities renders byte-identical to today.
- No schema change, no migration, no feature flag.

## Non-goals

- Capability chrome on `ellipse`, `sticky`, `text`. Their geometry (curved/rotated/borderless) needs a separate placement decision; deferred to a follow-up.
- Capability chrome on `image`, `html`, `icon`. Out of scope.
- Refactoring rectangle's bespoke header/body/footer chrome layout. Rectangle keeps its existing structure.
- Per-shape chrome placement (e.g. chrome floating right of the `user` glyph). Single uniform skirt for all 5.

## Architecture

**The skirt model.** `GeometricNode` gains a conditional horizontal row pinned to the bottom of the wrapper, rendered only when the node is an illustrative shape AND (`data.playAction` is set OR `data.statusReport` exists). When the skirt renders, the `illustrativeOverlay` SVG fills `wrapperHeight - SKIRT_HEIGHT` instead of `100%`. The wrapper's bounding box, resize handles, and bottom handle Y-position are unchanged — so connectors stay anchored even when status first arrives; the SVG glyph just visually shortens by ~32px.

**Skirt layout** — one flex row, transparent background, `padding: 4px 8px`, `height: 32px`:

```
[StatusBadge (left) ─── flex spacer ─── PlayButton (right)]
```

- StatusBadge omitted when no `statusReport`.
- PlayButton omitted when no `playAction`.
- If both omitted → skirt itself is omitted (the conditional rule).

**Why skirt-below and not floating-overlay or hover-only:**
- Floating top-right overlay clashes with cylinder rim, cloud bumps, and the user's head circle.
- Hover-only fails discoverability — a live status badge a user needs to see shouldn't require hover.
- Skirt below is uniform across all 5 silhouettes and mirrors how a diagram tool annotates a glyph.

**Why shrink the SVG instead of growing the node:** keeps the bounding box invariant so connectors don't shift when status first arrives. Cylinder visually shortens, total node height stays put.

## Component reuse

- `PlayButton` (currently inline at `rectangle-node.tsx:52`) is extracted into `packages/canvas/src/nodes/lib/play-button.tsx`. Pure presentational, props unchanged: `{ visualStatus, disabled, buttonLabel, isError, onClick }`. Both renderers import from there.
- `StatusBadge` is already its own component (`nodes/status-badge.tsx`) — no change.
- `deriveVisualStatus` is already exported from `nodes/lib/visual-status.ts` — no change.

## Type changes

`GeometricNodeRuntimeData` formally adds:

```ts
status?: NodeStatus;
errorMessage?: string;
statusReport?: StatusReport & { ts: number };
onPlay?: (nodeId: string) => void;
```

These fields are already being threaded onto every node's runtime data by `seeflow-canvas.tsx:2548-2570` — they were just typed only on `RectangleNodeData`. No data-flow change; only types catch up.

## Files modified

1. **`packages/canvas/src/nodes/lib/play-button.tsx`** (new) — extracted `PlayButton` component.
2. **`packages/canvas/src/nodes/rectangle-node.tsx`** — delete inline `PlayButton`, import from `./lib/play-button.tsx`. Behavior + existing tests unchanged.
3. **`packages/canvas/src/nodes/geometric-node.tsx`** — extend runtime data type, add `useChromeSkirt(shape, data)` derived value, shrink `illustrativeOverlay` height when skirt active, render skirt as sibling.
4. **`packages/canvas/src/nodes/geometric-node.test.tsx`** — new chrome-matrix tests (see below).
5. **`apps/studio/e2e/canvas.e2e.ts`** — two new snapshot entries; existing `database-chromium-linux.png` untouched as the no-capability regression guard.

## Data flow

Already plumbed end-to-end — only the renderer terminal end is new:

```
status-runner (SSE) → seeflow-canvas (statusByNode map)
                    → node.data.statusReport
                    → GeometricNode reads + renders skirt
                    → StatusBadge displays state + summary

User click PlayButton → data.onPlay(id)
                     → seeflow-canvas.onPlayNode
                     → POST /flows/:f/nodes/:n/play (unchanged)
```

The `arePropsEqual` memo at `geometric-node.tsx:444` already triggers a re-render when `data` reference changes; `seeflow-canvas` rebuilds `data` per render so status updates reach the renderer with no memo changes.

## Tests

### Unit tests (`geometric-node.test.tsx`)

| Case | Assertion |
|---|---|
| `database` no caps | no skirt; SVG fills wrapper; bottom handle at `y = height` |
| `database` + `playAction` | skirt present, PlayButton visible, no StatusBadge, SVG height = `h - 32` |
| `database` + `statusReport` (state: ok) | skirt present, StatusBadge visible, no PlayButton |
| `database` + both | skirt present, both visible, justify-between |
| `server`/`queue`/`cloud`/`user` + both | parameterized; same chrome structure across shapes |
| `ellipse` + `playAction` | **no skirt** (out of scope); test pins the limitation |
| Click PlayButton on database | `data.onPlay` called with node id once |
| `visualStatus === 'active'` | PlayButton disabled, `data-status="active"` |
| `visualStatus === 'error'` | shake class applied; `errorMessage` surfaces as tooltip |

### E2E snapshots (chromium-linux baselines)

- `database-with-status-chromium-linux.png` — database + statusReport ok
- `database-with-play-chromium-linux.png` — database + playAction idle
- Existing `database-chromium-linux.png` left untouched (no-capability regression guard).

## Edge cases

- **Tiny nodes:** if a user resizes a database below ~60px height with the skirt active, the 32px skirt would crowd the SVG. Enforce `minHeight = SKIRT_HEIGHT + 40` in `useResizeGesture` *only* when the skirt is active.
- **Status arrives mid-resize:** the SVG reflows since `illustrativeOverlay` reads `data.width`/`data.height` per render. A test asserts the resize gesture completes without throwing when `statusReport` arrives mid-drag.
- **`statusReport` cleared (script ended):** skirt collapses cleanly; if `playAction` is also unset, skirt disappears entirely.

## Rollout

Single feature commit: `feat(canvas): capability chrome on illustrative shapes`. No schema bump, no migration, no flag. Flows that already declare `statusAction` on a database (validating today but rendering no chrome) will start rendering the badge on next refresh — the intended fix.

## Deferred

- Capability chrome on `ellipse`/`sticky`/`text` (placement TBD — skirt-below doesn't directly apply).
- Capability chrome on `image`/`html`/`icon`.
- Per-shape chrome variants (e.g. user-glyph chrome on the right side).
