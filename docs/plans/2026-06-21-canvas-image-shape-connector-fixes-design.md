# Canvas fixes: shapes, images, color, connectors — design

Date: 2026-06-21
Status: validated, ready to implement

Six isolated issues, each independently root-caused by a subagent with `file:line`
evidence (no guessing). This doc records the proven cause and the chosen fix for
each. Each becomes its own commit, gated on the full unit + integration suite.

---

## 1. Shape proportion-lock (Shift = perfect square/circle; aspect-lock on resize)

**Cause:** draw width/height are independent (drag bounding box) in
`packages/canvas/src/components/seeflow-canvas.tsx` `onPointerUp` commit branch
(~2843–2900); resize w/h come straight from xyflow per-handle with no aspect lock
(`packages/canvas/src/nodes/use-resize-gesture.ts:178`). xyflow's
`keepAspectRatio` **cannot** be toggled live — it re-runs `resizer.update()` and
zeros the d3 `startValues` mid-gesture (documented hazard at
`use-resize-gesture.ts:71-81`).

**Fix:**
- **Draw:** mirror the pen-tool Shift pattern (`drawShiftRef` + grace window like
  `penShiftHeldAtRef`/`PEN_SHIFT_GRACE_MS`). When Shift held, square the drag box
  in **screen px** (`side = max(w,h)`, preserve drag direction) before
  `screenToFlowPosition`. Apply identically in the `drawGhostRect` useMemo so
  preview == commit.
- **Resize:** compute aspect-lock manually in `useResizeGesture.onResizeEvent`
  (and `onResizeEnd`). Capture start ratio in `onResizeStart`; extend
  `modifierFrom` to expose `shiftKey`; when held, rewrite the non-dominant
  dimension to `dominant * startRatio`, adjusting x/y for top/left handles. Wins
  over alignment-snap when Shift held (mirrors the Cmd/Ctrl snap-bypass).

## 2. Image double-click caption (paste + drag already ship)

**Cause:** image node renders no text and has no `caption` field. Paste
(`paste-dispatch.ts`) and drag-drop (`canvas-drop.ts`) already work — no change.

**Fix:** add optional `caption` to the schema in **four lockstep places**:
`ResolvedImageNodeData` + `FlowImageNodeData` (`.strict()`) in
`apps/studio/src/schema.ts`, `ImageNodeData` in `packages/canvas/src/types.ts`,
then `make sync-seeflow-schema` for the vendored copy. Render an `InlineEdit`
caption row at the **bottom** of `image-node.tsx` (restructure outer container to
`flex flex-col`, caption outside the `overflow-hidden` chrome), mirroring the
rectangle-node double-click-to-edit pattern. Inject `onCaptionChange` in
`buildNode` (gated `isEditMode && type==='image'`); host patches `data.caption`
via adapter so it's an undo entry.

## 3. Delete image → undo loses it + replace UX (sidebar upload AND drag-on-top)

**Cause (proven):** image bytes are a file on disk referenced only by
`data.path`. Delete hard-`rmSync`s the node dir
(`apps/studio/src/node-files.ts:95-97`, via `deleteNodeImpl`); undo restores only
the node row (`wrap-adapter.ts:280-285`) pointing at the now-deleted file. The
adapter exposes no file inverse.

**Fix:** make file deletion reversible via tombstone + same-id rehydrate (no
adapter/history contract change):
- `removeNodeDir`: rename `nodes/<id>/` → `nodes/.deleted-<id>-<ts>/` instead of
  `rmSync` (same pattern flow-delete already uses at `api.ts:1364-1367`).
- `createNodeImpl`: when recreating a node whose id matches a tombstone, rename
  it back. Undo recreates with the same id → file transparently restored.
- GC tombstones on a TTL / next clean flow write.

**Replace UX (both):**
- Sidebar: `image` branch in `detail-panel.tsx` with a "Replace image" file
  input → new `onReplaceImage(nodeId, file)` callback → host `uploadImage` +
  `updateNode({path})` wrapped in a `history.batch('replace-image')`.
- Drag-on-top: in `onWrapperDrop`, hit-test the drop point against image nodes;
  if it lands on one, route to the same replace path instead of new-node grid.

## 4. Copy aliases image + local→live breaks (fix both export paths)

**Cause (proven):**
- Copy/paste/Cmd+D copies `data.path` by value (`clipboard.ts:70-78`,
  `demo-view.tsx`); server `addNodeImpl` has no image branch
  (`operations.ts`/`node-files.ts:49-59`), so two nodes alias one file. Deleting
  the original breaks the copy.
- Web "Export to cloud" zips the bytes at `flows/<slug>/files/<assetPath>` but
  never rewrites `data.path` (`build-project-bundle.ts:133-156`) → live viewer
  reads the old `data.path` → 404.
- CLI `seeflow export` reads every file as UTF-8 (`export-bundle.ts:39,54`) →
  binary corruption.

**Fix:**
- Paste: `addNodeImpl` copies the underlying file into the new node's folder
  and rewrites `data.path` when the path belongs to a different node. **Done.**
- Web bundle: rewrite each image node's `data.path` to its in-bundle location
  (`flows/<slug>/files/<assetPath>`); bytes already land there. **Done.**
- CLI (`seeflow export`): carry `BundleFile.content` as binary (base64).
  **DEFERRED** — the receiver is an external cloud service (`/api/export`, not
  in this repo). Base64-encoding the field would break text files too unless
  the cloud `/api/export` handler is updated in lockstep. The user-facing
  "Export to cloud" path is the web ZIP path (fixed above); the CLI path needs
  a coordinated cloud-side change, so it's left for that session.

## 5. Background color tints body + header, not just border

**Cause (proven):** `PAINTED_ENTRIES` maps every hue's body `background` to the
neutral `CARD_SURFACE` (`color-tokens.ts:80-95`); header tint exists but faint
(`HEADER_TINT_ALPHA = 0.14`) and only renders on named nodes. Border is the only
visible change.

**Fix (localized to `color-tokens.ts`):**
- Body: `background = color-mix(in srgb, accent ~6%, CARD_SURFACE)` (subtle,
  dark/light adaptive).
- Header: bump `HEADER_TINT_ALPHA` to ~0.22–0.26.
- Keep border = full accent. Leave `white`/`default`/`none` untinted. Update
  `color-tokens.test.ts` and regenerate visual baselines.

## 6. Connector near-straight snap

**Cause:** `projectCursorToPerimeter`
(`floating-edge-geometry.ts:134-148`) maps cursor to perimeter with no snapping;
perfect H/V requires pixel-perfect placement. (The recent shift-straight work is
freehand-pen only, unrelated.)

**Fix:** add pure `snapPinToStraight(box, pin, fixed, thresholdFlow)` in
`floating-edge-geometry.ts`: if the moving pin's perimeter point is within
threshold of axis-aligning with the fixed endpoint, snap `t` so it's exactly
H/V. Apply at all **three** projection sites in `seeflow-canvas.tsx` (preview
~1729, reconnect commit ~4381, new-connection commit ~4178) using the same fixed
endpoint, so preview == commit. Threshold `STRAIGHT_SNAP_PX (~8px) / zoom`
(zoom-independent, like `RECONNECT_BUFFER_PX`). Always-on (no modifier).

---

## Sequencing (avoid same-file conflicts; one commit per fix)

`seeflow-canvas.tsx` is touched by #1, #2, #6 → those run **sequentially**.
Order: **5** (isolated) → **6** → **1** → **2** → **3** → **4**. Each commit gated
on `bun run typecheck` + `bun test` + relevant integration; e2e baselines
regenerated where visuals change (#2, #5). Then screenshot-verify in browser,
push to main, deploy live.
