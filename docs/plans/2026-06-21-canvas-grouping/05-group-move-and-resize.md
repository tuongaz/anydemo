# Milestone 5 — Group move + group resize (children fan-out)

**Status:** Not started · **Depends on:** M3, M4 · **Risk:** Medium–High
(reuses M3's frozen-baseline contract — same runaway risk if violated)

## Previous milestone — summary

M4 made create/ungroup work via a pure `group-ops.ts`, the overlay ＋/⊟ icon,
the context menu, and ⌘G/⌘⇧G — each atomic. A group is a node listing `childIds`
with absolute child positions; ungroup leaves children put.

## Lessons carried forward

- (Fill from M4 handoff.)
- **L0.1 (CRITICAL, again)** Resize children using a FROZEN baseline (group box
  + child geometry at pointer-down) and END-ONLY commit. Same trap as M3 — do
  NOT read live child sizes per tick.
- **L0.3** Children have absolute positions; xyflow will NOT auto-move them when
  the group moves. The canvas must explicitly fan out child moves.
- Group move delta must come from the group's drag, not per-child echoes.

## Goal

Make the group behave like a container: **dragging the group moves its members**;
**resizing the group (via the overlay corners) scales its members** (reusing M3
math). Both as single atomic undo entries.

**User-testable outcome:** Drag a group → all members move with it, keeping
relative layout. Resize the group via its corner handles → members scale
proportionally (size + spacing) with no runaway. Each gesture is one Cmd+Z.

## Scope

**In:** group drag → fan-out child position updates; group resize → reuse
`scaleNodesWithinRect` on members from a frozen baseline; group box recompute;
single coalesced undo per gesture.

**Out:** enter/exit isolation (M6) — until then, dragging a *child* directly is
still possible only when not gated; styling (M7); connectors (M8). Nested groups
(non-goal).

## Implementation steps

### A. Group move (`apps/web/src/pages/demo-view.tsx` + `seeflow-canvas.tsx`)
0. **Live child movement during the drag (design §12.2 — REAL WORK, not just
   drag-stop).** `onNodeDrag` (per-frame) is NOT wired today — only
   `onNodeDragStart/Stop` (`seeflow-canvas.tsx:2182`,`:4849`). With `childIds` +
   absolute positions xyflow will NOT auto-move children, so without this they
   stay frozen and snap only on release (visible lag). Either add an `onNodeDrag`
   prop on `<ReactFlow>` or detect the group's per-frame delta inside
   `onNodesChange` (`:3551`, where `draggingRef` is already true), and apply the
   delta to members as **optimistic position overrides** live. This is additive
   (delta), so it cannot compound like resize — but compute the delta against the
   **drag-START snapshot**, not the previous frame. (Time-boxed fallback: snap on
   drag-stop only and note the lag as a known limitation.)
1. On group drag-stop (`onNodeDragStop` / `commitDraggedNodes`), if the dragged
   node is a group, compute `delta = newGroupPos − startGroupPos` and fan out
   `updateNode(childId,{position: childStart + delta})` for each member, plus the
   group's own position, in ONE `history.batch('group-move', …)`.
   - **Read the start positions from a snapshot captured at drag START**, not
     from live overrides (same frozen-baseline discipline).
   - Per the `project_xyflow_dragstop_reports_raw_position` memory: persist from
     `rfNodesRef`, not the raw drag event position, to avoid the ~1px snap drift.
2. Group selection while a member is also individually selected: dedupe so a
   child isn't moved twice (once as selection member, once as group child).

### B. Group resize (reuse M3 — via the OVERLAY, not per-node controls)
3. **Group resize is served by the overlay only (design §12.3).** The group node
   renderer mounts NO `<ResizeControls>` (M1 step 17), so there is exactly one
   resize path. The overlay's `selectionOverlayNodes` for a group already resolves
   to the members + group box (M2 step 4 / design §12.5). When the overlay is a
   **single group**, dragging a corner scales the group's **members** (and the
   group box). Capture at pointer-down:
   `startGroupBox` + `startNodes` = deep copy of each member's geometry. On
   pointer-up, `scaleNodesWithinRect(startMembers, startGroupBox, newBox)` → fan
   out member PATCHes + the group's own `{position,width,height}` in ONE
   `history.batch('group-resize', …)`.
4. The group's `width/height` and `childIds` are unchanged in count; only
   geometry scales. Recompute is unnecessary if math is correct.

### C. Shared
5. Factor the "scale a frozen member set within a frozen box, commit once" path so
   M3 (loose selection) and M5 (group members) share it — they already share
   `scaleNodesWithinRect`; share the host commit helper too.

## Guardrails (restate)
- Frozen baseline for BOTH move (start positions) and resize (start box + start
  member geometry). No live reads mid-gesture.
- End-only commit; one coalesced undo per gesture.
- Group move delta from the group, not summed child echoes.
- Dedupe selection vs membership so nothing moves/scales twice.

## Tests
- **Unit:** group-move fan-out (delta applied to each member + group); no double-
  apply when a child is also selected. Group-resize reuses the M3 no-compounding
  invariant (extend the tripwire test to the group path).
- **Live drag (§12.2):** per-frame delta computed against the drag-START snapshot
  (not the previous frame) so repeated frames don't drift; members track the
  group during the drag, not only on release.
- **Resize path:** group renderer mounts no `<ResizeControls>` (one resize path).
- **Component/Host:** group drag-stop → one undo entry reverts group + all members
  together; group corner-resize → one undo entry; members scale, no runaway.
- **Integration:** move+resize a group, reload → geometry persisted correctly.

## User Acceptance Test (manual)
1. Drag a group across the canvas → all members follow **live during the drag**
   (no snap-lag on release), relative layout intact. Cmd+Z → everything returns
   in one step.
2. Resize the group via a corner outward (slow then fast) → members scale
   proportionally, NO order-of-magnitude blowup. Cmd+Z reverts all.
3. Shift-resize the group → aspect locked.
4. Select group + one extra loose node, drag → no member moved twice (no drift).

## Definition of Done
- Gates green; no-compounding tripwire extended to the group resize path and
  passing.
- UAT passes incl. the fast-drag no-runaway check.
- Move + resize each one atomic undo entry; reload-persistence correct.
- Lessons handoff filled in.

## Lessons-learned handoff (FILL THIS IN BEFORE MARKING DONE)
- How did you capture the move start-snapshot (where + when)? Note the exact ref.
- Any interaction between group move and the alignment-guide system?
- Confirm the dedupe (selection ∩ membership) path; note any edge case.
- **➡ Copy into `06-...md`.**
