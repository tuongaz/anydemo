# Canvas line / fonts / snapping — Implementation Plan

> Worktree: `.claude/worktrees/canvas-line-fonts-snapping`, branch `feat/canvas-line-fonts-snapping` (off `c8d18c6a`). TDD; one commit per milestone; gate on `bun test` + `bun run typecheck`.

**Goal:** Decorative line shape + curated per-node font picker + line straight-snap + connection snap-to-node highlight in `@seeflow/canvas`.

**Architecture:** `line` mirrors the `freehand` node (non-geometric `NodeType`, points-based `data`, own schema variant, dedicated renderer in `nodeTypes`). Fonts add an optional `fontFamily` token resolved via a `FONT_STACKS` map. Snapping reuses connector geometry helpers.

Design doc: `docs/plans/2026-06-27-canvas-line-fonts-snapping-design.md`.

## Reference anchors (verified)
- Freehand renderer: `packages/canvas/src/nodes/freehand-node.tsx`.
- `nodeTypes`: `seeflow-canvas.tsx:1507`. `onCreateFreehandNode` prop `:632`, call `:3082`. `onCreateShapeNode` prop `:605`, call `:3193`.
- Toolbar shapes: `canvas-toolbar.tsx:121-184`; tile onClick `:284`; pen button `:248-270`.
- Schema: `NodeVisualBaseShape` `apps/studio/src/schema.ts:43`; `ResolvedFreehandNodeData` `:415`; `FlowFreehandNodeData` `:746`; `FlowFreehandNodeSchema` `:846`; union `:862`. Parity test `apps/studio/src/schema.test.ts:3091`.
- `snapPinToStraight` `floating-edge-geometry.ts:244`; `projectCursorToPerimeter` `:134`; `STRAIGHT_SNAP_PX=8` `seeflow-canvas.tsx:1220`.
- `RECONNECT_BUFFER_PX=15` `seeflow-canvas.tsx:1211`; `nodeElNearPoint` `:1241`; `connecting` state `:2523`.
- StyleStrip `NodeStylePatch` `style-strip.tsx:45`; font-size slider `:999`; align toggle `:1018`; apply helpers `:344-378`.

## M1 — Schema + types
- `types.ts`: `FontFamilyToken` union; `fontFamily?` on `NodeVisual`; `fontFamily:true` in `CANVAS_NODE_DATA_FIELDS`. Add `'line'` to `NodeType` + `DrawableNodeType`; `LineNodeData { points: [[number,number],[number,number]] }`; `FlowNode` variant.
- `schema.ts`: `fontFamily` enum on `NodeVisualBaseShape`; mirror freehand → `ResolvedLineNodeData`/`FlowLineNodeData` (points `z.array(z.tuple([z.number(),z.number()])).length(2)`)/`FlowLineNodeSchema`; add to union.
- Parity test green; `make sync-seeflow-schema`; typecheck.
- Commit: `feat(canvas): add line node type + fontFamily token to schema/types`

## M2 — Fonts (#2)
- `font-stacks.ts` (TDD): `FONT_STACKS`, `resolveFontStack(token?)`→stack|undefined, `FONT_FAMILY_OPTIONS`.
- StyleStrip: `fontFamily` on `NodeStylePatch`; picker next to font-size; `applyFontFamily`/`previewFontFamily`; hide for `line`.
- Render: apply `resolveFontStack(data.fontFamily)` in `geometric-node.tsx` + `editable-edge.tsx`.
- Commit: `feat(canvas): per-node font-family picker`

## M3 — Line node (#1)
- `line-geometry.ts` (TDD): `boxFromEndpoints`, `normalizePointsToBox`, `denormalizePoints`.
- `line-node.tsx` (TDD): mirror freehand; svg `preserveAspectRatio="none"`; thin `<line>` + fat hit line; no fill/text/handles.
- Register `line: LineNode`; toolbar `／ Line` entry.
- `onCreateLineNode?(a,b)`; pointer-up commit; `buildNewLineData`. `apps/web` adapter accepts `type:'line'`.
- Commit: `feat(canvas): decorative line shape in the toolbar`

## M4 — Endpoint editing + straight-snap (#3)
- `snap-segment.ts` (TDD): `snapSegmentToStraight(a,b,thresholdPx,zoom)`.
- Endpoint dots (ViewportPortal) on sole-selected line; drag → snap → recompute box; commit on pointer-up.
- Draw-time snap reuse.
- Commit: `feat(canvas): line endpoint editing with straight-snap`

## M5 — Connection highlight + widen (#4)
- `connectBufferPx(nodeRect, basePx)` node-size-aware (TDD); used in `nodeElNearPoint`.
- `data-connect-candidate` toggled imperatively on pointer-move during drag (no new useState slot); CSS ring in `index.css`.
- Rebuild canvas CSS.
- Commit: `feat(canvas): highlight + widen connection snap-to-node`

## Final gate
`bun run format` → `lint` → `typecheck` → `bun test` → canvas build → `make verify-seeflow-schema-sync` → `bun run test:it` → reconcile uncommitted main WIP → push.

## Non-goals (v1)
No polyline/curves/arrowheads/labels. No local-font enumeration. No 45° auto-snap. Connectors unchanged.
