# Milestone 3 — Proportional resize via the 4 corner handles ⚠ THE RISKY ONE

**Status:** Not started · **Depends on:** M2 · **Risk:** HIGH (this is the bug
that killed v1 twice — read `00-design.md` §6 in full before coding)

## Previous milestone — summary

M2 restored the overlay's visual chrome: a padded (12px) dashed rect with 4
corner boxes that appears for 2+ loose nodes or a selected group, is
zoom/pan-correct, and is **inert** (no resize wired). The `DragState` frozen-
baseline structure was prepared.

## Lessons carried forward

**From M2's handoff (the chrome M3 makes functional):**
- **`DragState.startNodes` is ALREADY populated** at pointer-down (a
  `FrozenNode[]` of `{id,position,width,height}` resolved via the overlay's
  private `resolveNodeSize`, sitting beside the frozen `oldRect`). M3's job: in
  `onHandlePointerUp`, compute `scaleNodesWithinRect(dragState.startNodes,
  dragState.oldRect, newRect, {lockAspectRatio})` and dispatch ONE
  `onMultiResize(updates)`. **Read `startNodes`, NEVER the live `selectedNodes`**
  (that's the L0.1 compounding trap — the live set carries optimistic overrides).
- **The handlers are wired but inert today.** `onHandlePointerMove` only
  `setPreviewRect(newRect)` (visual feedback); `onHandlePointerUp` only clears
  the gesture. M2 removed the old per-tick `scheduleRaf`→`onMultiResize` loop and
  the `liveDispatchRafRef`. M3 ADDS the end-only dispatch back; if you reintroduce
  a live per-tick path (§6.3 enhancement, NOT first cut), it MUST scale from
  `startNodes`, not the previous tick's output.
- **`onMultiResize` is currently NOT passed to the overlay** from
  `seeflow-canvas.tsx` (M2 made it inert). M3 re-wires it: thread the host's
  `onMultiResize` prop back into `<SelectionResizeOverlay onMultiResize=…>` and
  flip the seeflow-canvas test back to asserting it's forwarded (M2 changed that
  test to assert `undefined`).
- **Dims are resolved `measured ?? data ?? fallback` (§12.1)** in the overlay
  payload now — so `startNodes` already includes auto-sized html/component
  members with correct sizes. The scale will move + size them; remember the
  freehand caveat (§12.6 — `data.points` not scaled in v1).
- **DX:** the M3 gate is `bun run --filter @seeflow/canvas build:js` (NOT the
  full `build`, which `rm -rf dist` and clobbers the dev server's
  `dist/style.dev.css`). See M2 L2.4.

- **L0.1 (CRITICAL)** The "order-of-magnitude" bug: the live tick path scaled the
  *live, optimistically-overridden* node set (`nodesAtTick = selectedNodes`,
  `selection-resize-overlay.tsx:328`) against a frozen rect → each tick multiplies
  already-scaled sizes → compounding (1.1×1.2×… → ×10). **Freeze the node set,
  not just the rect.**
- **L0.2** Non-stable xyflow resize callbacks zero d3 `startValues` → the other
  exponential bug. (Relevant only where a `NodeResizeControl` is used; the overlay
  uses its own pointer handlers, so L0.1 is the live risk here.)
- **L0.3** Membership is `childIds` — but this milestone scales whatever is
  selected (loose or group's members handled in M5); here, the *selected nodes*.

## Goal

Make the 4 corner handles **proportionally scale** the selected nodes — both
**position and size** — against a **frozen start rect AND frozen start node set**,
committing once on pointer-up as a single coalesced undo entry. **No runaway.**

**User-testable outcome:** Select 2+ nodes, drag a corner → all nodes scale
smoothly and proportionally (sizes + spacing), tracking the cursor 1:1, with
**zero acceleration/compounding**. Release → committed. One Cmd+Z reverts all.
Shift-drag locks aspect ratio.

## Scope

**In:** wire `onMultiResize` end-only from the frozen pair; add `startNodes` to
`DragState`; the no-compounding regression test; the host handler in
`apps/web/src/pages/demo-view.tsx` (fan-out optimistic overrides + batched
PATCHes + single undo via `coalesceKey`); Shift aspect-lock.

**Out:** live per-tick visual scaling of real nodes (explicit later enhancement,
§6.3); group move (M5); group-specific resize-children (M5 reuses this math).

## Implementation steps

1. **Freeze the node set at pointer-down.** In `onHandlePointerDown`
   (`selection-resize-overlay.tsx:284`), capture
   `startNodes = selectedNodes.map(n => ({ id:n.id, position:{...n.position},
   width:n.data.width, height:n.data.height }))` into `DragState` alongside the
   existing `oldRect` (rename to `startRect`). **This deep copy is the fix for
   L0.1.**
2. **Remove the live per-tick dispatch** (`:320-335`). In the first cut there is
   NO `onMultiResize` call during move — only `setPreviewRect(newRect)` for the
   visual rect. (Optionally render ghost outlines of each node's target rect,
   computed from `startNodes` + `startRect` → `newRect`.)
3. **End-only commit.** In `onHandlePointerUp` (`:338`), compute
   `updates = computeSelectionResizeUpdates(dragState.startNodes,
   dragState.startRect, newRect, { lockAspectRatio: event.shiftKey })` — **note
   `startNodes`, NOT `selectedNodes`** (`:380` currently uses `selectedNodes` —
   change it). Keep the zero-movement no-op guard (`:371-379`).
4. **Host handler** (`apps/web/src/pages/demo-view.tsx`): implement
   `onMultiResize(updates)` to (a) set optimistic overrides for each node via the
   existing `usePendingOverrides` API (`demo-view.tsx:246`, `nodePending`) — NOT a
   bespoke setter; (b) fan out `updateNode(id,{position,width,height})` PATCHes;
   (c) wrap in `history.batch('multi-resize', …)` — the host already uses
   `.batch('move-nodes' | 'style-nodes' | 'tidy' | …)` so this matches the
   established pattern. Locked/absent sizes pass through unchanged.
5. **Wire** `onMultiResize` from `seeflow-canvas.tsx` (prop already declared
   `:555`, threaded `:2125`).
6. **Aspect lock:** Shift held → `lockAspectRatio` (already plumbed through
   `computeNewRectFromAnchorDrag` `:115` and `scaleNodesWithinRect`).

7. **Dimension resolution (design §12.1):** `startNodes` must capture each node's
   size via `measured ?? data.width/height ?? fallback`, not `data.width/height`
   alone — otherwise auto-sized members scale wrong / are skipped.
8. **Freehand (design §12.6):** `freehand` nodes reposition but do NOT internally
   scale (geometry is `data.points`, not width/height). Document as intentional;
   add a test asserting freehand position scales while `points` are untouched.

## Guardrails (restate of §6.2)
1. Freeze BOTH `startRect` and `startNodes` at pointer-down.
2. Every computation uses the frozen pair — never read live `selectedNodes`
   during the gesture.
3. End-only commit; one coalesced undo entry.
4. Preview is local-visual only during drag.
5. `scaleNodesWithinRect` stays untouched (it is correct).

## Tests
- **Unit (THE TRIPWIRE, §6.4):** simulate N ticks where the "live" set is
  replaced by the *previous tick's scaled output* (mimicking the optimistic-
  override echo). Assert the committed result equals a single `startNodes →
  final` scale — proving **no compounding**. This test must fail if anyone
  reintroduces `nodesAtTick = selectedNodes`.
- **Unit:** end-to-end corner drag math (nw/ne/se/sw) produces correct
  positions+sizes from frozen pair; Shift aspect-lock uses `min(sx,sy)`;
  zero-movement → no update.
- **Component:** pointer-down captures `startNodes`; pointer-up dispatches once;
  no dispatch during move.
- **Host:** `onMultiResize` fans out N PATCHes + exactly one undo entry; Cmd+Z
  reverts all; locked nodes skipped.

## User Acceptance Test (manual)
1. Select 3 nodes of different sizes. Drag the SE corner outward slowly, then
   **fast**. **Expect:** nodes scale proportionally, tracking the cursor; NO
   acceleration, NO order-of-magnitude blowup (the v1 bug).
2. Drag a corner inward → nodes shrink proportionally; spacing shrinks too.
3. Shift-drag a corner → aspect ratio locked.
4. Release, then Cmd+Z → all nodes snap back in ONE undo. Cmd+Shift+Z redoes.
5. Repeat the drag 5× rapidly → sizes stay stable & reversible (no drift).

## Definition of Done
- Gates green.
- The no-compounding regression test exists and passes.
- UAT passes — explicitly verify NO runaway on a fast drag.
- Lessons handoff filled in.

## Lessons-learned handoff (FILL THIS IN BEFORE MARKING DONE)
- Confirm the exact line where `startNodes` is read at commit (guard against a
  future refactor reintroducing the live set).
- Did optimistic overrides + SSE echo cause any flicker on commit? Note the
  coalesce mechanism used.
- Is end-only UX acceptable, or is live preview needed? Record the decision for
  the §6.3 enhancement.
- **➡ Copy into `04-...md` and reinforce L0.1 in `00-design.md` §11.**
