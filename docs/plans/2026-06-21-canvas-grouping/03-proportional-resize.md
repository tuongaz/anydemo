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

## Lessons-learned handoff (FILLED IN — M3 done)

**What shipped.** The M2 chrome's pointer handlers were re-wired functional.
Pointer-down already froze `startNodes` (M2 prep); M3 added the end-only commit.
A new pure helper `computeFrozenResizeUpdates(startNodes, startRect, newRect,
opts)` (in `selection-resize-overlay.tsx`) does the scale via the untouched
`scaleNodesWithinRect`. `onHandlePointerUp` recomputes the final rect from the
**frozen** `oldRect` + cursor delta and dispatches ONE `onMultiResize` from the
frozen set. The canvas now passes `onMultiResize` to `<SelectionResizeOverlay>`
(`seeflow-canvas.tsx`). The host handler in `demo-view.tsx` **already existed**
(US-007) and needed no change — see "Surprises" below.

- **Exact line where `startNodes` is read at commit.**
  `packages/canvas/src/components/selection-resize-overlay.tsx`:
  - `const startNodes = dragState.startNodes;` — the read (≈ line 499).
  - `const updates = computeFrozenResizeUpdates(startNodes, startRect, newRect,
    { lockAspectRatio: event.shiftKey });` — the use (≈ line 523).
  `selectedNodes` is **not referenced anywhere in `onHandlePointerUp`**. A guard
  comment directly above the call names the regression. Line numbers drift —
  search for `computeFrozenResizeUpdates(startNodes`.

- **Flicker from optimistic overrides + SSE echo on commit?** None observed in
  the design model, and structurally avoided. End-only commit means there is
  exactly ONE optimistic write per gesture (no per-tick overrides), so there is
  no echo to fight mid-drag. On commit the host sets the override to the final
  dims **before** firing the PATCHes (`demo-view.tsx` `onMultiResize`), so the
  canvas stays pinned at the committed footprint through the PATCH round-trip;
  `usePendingOverrides.pruneAgainst` drops each override only once the SSE reload
  reports matching server state. **Coalesce mechanism:** the host wraps the
  fan-out in `history.batch('multi-resize', …, { coalesceKey:
  \`multi:resize:${sortedIds}\` })`. With end-only commit there is ONE batch per
  gesture, so coalesce is effectively a no-op now (nothing to merge within a
  gesture) — it's harmless and left in place because M5's group-resize reuses the
  same handler, and a future live-preview enhancement (§6.3) would re-introduce
  per-tick dispatch that the key would then coalesce into one undo entry.

- **End-only UX acceptable, or is live preview needed?** **End-only is shipped
  and is the recorded decision for M3** (design §6.3). During the drag the user
  sees the dashed bounding rect + corner handles track the cursor 1:1 (local
  `previewRect`); the member nodes snap to the new sizes on release. This is
  acceptable for the first cut and is the safe choice (no per-tick real-node
  mutation ⇒ compounding is structurally impossible). Live per-tick visual
  scaling of the real nodes is the explicit §6.3 enhancement — defer it; if
  added, do it via a frozen-baseline preview transform layer (NOT per-tick
  optimistic overrides) and keep the tripwire green.

- **Surprises / deviations (see also the report).**
  1. The host `onMultiResize` in `demo-view.tsx` was **already fully implemented**
     (US-007: optimistic overrides + batched PATCH fan-out + coalesceKey + wired
     to `<DemoCanvas>`). Step 4 ("implement the host handler") was already
     satisfied; M3 changed nothing there. The only missing link was the canvas
     not forwarding `onMultiResize` to the overlay.
  2. `DragState.oldRect` was **not renamed** to `startRect` (the doc suggested
     it). It is already documented as "Frozen union rect at pointer-down" and the
     rename is cosmetic; renaming risked churn across the M2 code with no
     behavioral gain. Both members of the frozen pair (`oldRect` + `startNodes`)
     are frozen — the contract holds regardless of the field name.
  3. A full down→move→up **component gesture test is not feasible** through the
     dispatcher-shim: the overlay's pointer handlers call
     `useReactFlow().screenToFlowPosition`, and `useReactFlow` (xyflow 12.10.2)
     pulls `useStoreApi` + `useViewportHelper` + `useStore` + zustand's
     `useSyncExternalStore`. Stubbing all of that re-implements xyflow's store
     contract — exactly the "fight xyflow internals" trap (L0.4). The
     no-compounding contract is fully covered by the **pure** tripwire
     (`computeFrozenResizeUpdates`, the exact function the handler calls); the
     live gesture is verified by the orchestrator's browser test. A render-level
     test asserts the handles carry the four pointer callbacks (gesture wired).

- **➡ Propagated:** copied the actionable subset into `04-create-ungroup-ops.md`
  "Lessons carried forward"; reinforced L0.1 in `00-design.md` §11.
