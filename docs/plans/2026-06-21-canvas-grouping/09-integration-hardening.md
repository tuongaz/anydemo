# Milestone 9 — Cross-cutting integration & hardening

**Status:** Not started · **Depends on:** M1–M8 · **Risk:** Medium (this is where
v1's hidden coupling bit — clipboard, delete, ordering, export)

## Previous milestone — summary

M8 made groups (and their children, in isolation) connector endpoints with
floating-edge geometry hugging the group box and previews mirroring commits.

## Lessons carried forward

- **From M8 handoff (actionable subset):**
  - **The connector stack is fully TYPE-AGNOSTIC.** Connect/preview/commit/
    floating-geometry/head-glyph all treat a group like any node (it's a
    `.react-flow__node` with `data-id`, measured box, `positionAbsolute`). The
    ONLY node-type gate in the whole connector path is the `text`-shape rejection
    in `isValidConnection`. **Do NOT add group branches to connector code in M9** —
    if a clipboard/delete/export path needs connector-vs-group logic, that's the
    L0.3 leak signal, stop. Connectors to/from a group persist + round-trip as
    ordinary connectors (endpoint = the group's id; no schema change).
  - **Edges re-anchor on group move/resize for FREE** via `useInternalNode`
    (the edge subscribes to the group node's live position/dims). M9's
    persistence round-trip + SSE-reload tests should assert a group-endpoint
    connector renders anchored to the group border after reload AND after an
    external move — but the mechanism is already there; M9 only needs coverage.
  - **`pickNearestSnapTarget` (exported, pure) is the snap-target oracle** with a
    smaller-bbox-area tie-break so a member wins over its enclosing group in the
    connection PREVIEW (matching the commit's `elementsFromPoint` z-order). The
    same area tie-break is mirrored in the commit-side `nodeElNearPoint` fallback.
    If M9 touches the connect hit-test or reorder/z-order, keep these two in
    lockstep (preview must mirror commit — `project_connection_preview_mirrors_commit`).
  - **Group hit-testing depends on the z model:** members (z=0) above group
    (z=-1). A drop on the group's padding band targets the group; on a member
    targets the member; entered-group fill is `pointer-events:none` so a drop
    inside lands on the member underneath. M9's bring-to-front/back clamp (step 8)
    MUST preserve `group z < member z` or this hit-testing (and the preview
    tie-break) silently inverts — a member could fall behind its group and become
    un-targetable.
  - **Custom head glyphs draw in the edge `<g>`, never as SVG `<marker>`s**
    (`project_xyflow_custom_edge_markers`). A group-endpoint edge renders its head
    via `ConnectorHeadGlyph` at the resolved floating endpoint; unaffected by M9
    but don't regress to markers when touching export (PNG/PDF) rendering.
- **L0.3** v1 was removed mainly because group-awareness leaked into clipboard,
  delete-cascade, edge gating, and node ordering. With `childIds` + absolute
  positions, those touch-points are minimal — but this milestone proves it by
  exercising each one. If any subsystem needs deep group logic, reconsider.
- Remember the e2e bundle-build gotcha (`project_e2e_bundle_build_gotcha`): build
  web+mcp bundles before e2e, or use full `test:it`.
- Visual baselines pinned to chromium-linux; regenerate via
  `test:it:update-snapshots`, commit `*-chromium-linux.png` only.

## Goal

Make grouping robust across every cross-cutting path and lock it with
integration + e2e + visual tests. (Req #6 "anything else".)

**User-testable outcome:** Copy/paste a group with members; delete a group
(children released) and a member (pruned from `childIds`); export PNG/PDF with the
group; reload after each op — all correct and undoable.

## Scope

**In:** clipboard (copy/paste/duplicate) with id-remap of `childIds`; delete
policies (§9.3); export; persistence round-trip; SSE/live reload; z-order &
bring-to-front/back interplay; modes/flags; empty/locked/mixed selections; full
test sweep + baselines + docs.

**Out:** nested groups (explicit non-goal); live per-tick child scaling (§6.3
optional enhancement, separate future work).

## Implementation steps

### A. Clipboard (`packages/canvas/src/lib/` clipboard path + host)
1. Copying a selection that includes a group copies the group + all its members.
   On paste/duplicate, remap ids: new member ids AND rewrite the pasted group's
   `childIds` to the new member ids (single id-remap pass — no parent rewrites).
2. Copying members WITHOUT their group → paste as loose nodes (no dangling
   `childIds`). Copying a group WITHOUT some members → prune missing ids.
3. Offset paste position applies to group + members uniformly (absolute coords).

### B. Delete policy (§9.3)
4. Delete a **group** → delete container only; children released (survive loose).
   Implement as: `deleteNode(groupId)` (children untouched). One undo entry.
5. Delete a **member** → in one batch, **ORDER MATTERS (design §12.9):**
   `updateNode(groupId,{childIds minus memberId})` **FIRST**, THEN
   `deleteNode(memberId)`. Each server write re-validates the whole flow
   (`operations.ts:680`) and the strict `childIds`-existence `superRefine` rejects
   any state where the group still references a deleted node. The reverse-order
   undo (recreate member → restore childIds) is also valid at each step.
6. Marquee delete spanning a group + members → dedupe; if the group is deleted,
   its `childIds` pruning is moot; if only members, prune.

### C. Export
7. Verify `use-canvas-export.ts` PNG/PDF includes the group box + title behind
   members with correct z-order. Add an export test/baseline.

### D. Z-order & reorder
8. Bring-to-front/forward/backward/to-back (context menu, `onReorderNode`) must
   not let a member fall behind its group or a group rise above its members
   confusingly. Clamp: group zIndex stays below member zIndex (M1 mechanism).
   Test the interplay.

### E. Persistence / SSE
9. Round-trip: create/move/resize/style/connect a group → reload → identical.
10. In-flight `activeGroupId` (M6) dropped if the group vanishes via an external
    SSE reload (multi-client / live).

### F. Modes / flags / edge cases
11. Group renders read-only in view/mini; create/ungroup/enter are edit-only.
12. Optional `flags.enableGrouping` master switch (default ON for edit).
13. Empty/single/mixed selections → reasoned no-ops (covered M4, re-verify).

### G. Tests + docs
14. Full sweep: `bun test`, `bun run test:it` (integration + e2e). Add e2e for the
    end-to-end journey (marquee → resize → group → enter → edit child → exit →
    connect → ungroup). Add/refresh visual baselines (chromium-linux).
15. Update `packages/canvas/CLAUDE.md` with the group rules (childIds model,
    frozen-baseline resize contract, z-order, isolation model). Update
    `packages/canvas/README.md` public API if anything is exported.
16. Update the seeflow skill's vendored schema/docs if group is exposed to the
    LLM authoring path.

## Guardrails
- If any subsystem (clipboard/delete/export/reorder) needs MORE than id-remap or a
  childIds prune, that's a signal the `childIds` decoupling is being violated —
  stop and reconsider rather than spreading group logic.
- Never write a `childIds` referencing a deleted node (schema rejects it).
- Build bundles before e2e (gotcha above).

## Tests
- **Integration:** clipboard round-trip (group+members id-remap); delete-group
  releases children; delete-member prunes childIds; persistence round-trip for
  every op; export contains the group.
- **Integration (§12.9 ordering):** delete-member issues prune BEFORE delete (no
  intermediate dangling-childIds server rejection); assert the server accepts both
  writes and the reverse-order undo restores cleanly. A test that swaps the order
  must fail (tripwire).
- **E2E:** the full journey + visual baselines for overlay chrome, a rendered
  group, and a group-with-connector.
- **Unit:** clipboard id-remap; delete-dedupe; reorder zIndex clamp.

## User Acceptance Test (manual)
1. Copy a group (with members) → paste → a full duplicate group with its own
   members appears offset; its members are independent of the originals.
2. Delete a group → the container vanishes, children remain as loose nodes.
   Cmd+Z restores the group. Delete a single member → it's gone and the group no
   longer references it; Cmd+Z restores both.
3. Export PNG and PDF → the group box + title appear behind members.
4. Bring a member to front / send group to back → ordering stays sane (members
   never hidden behind their group).
5. Reload after each → state persists. Open in a second client (live) → group
   appears; ungroup in one client → the other updates and any open isolation
   exits.

## Definition of Done
- All gates green: `bun run format && bun run lint && bun run typecheck && bun test
  && bun run test:it`.
- `make verify-seeflow-schema-sync` passes.
- Visual baselines committed (chromium-linux only).
- All UAT steps across M1–M9 pass; the original 6 requirements demonstrably met.
- `packages/canvas/CLAUDE.md` + README updated.
- Final lessons handoff written into `00-design.md` §11.

## Lessons-learned handoff (DONE)
- **Which cross-cutting paths needed the most group logic? Did `childIds` stay
  decoupled?** It stayed fully decoupled — the architecture held. Ranked by group
  logic needed: **Delete** (most, but still minimal — pure `planGroupAwareDeletion`
  + threading `childIdsPrunes` first into the existing batch + a groups-first
  delete order) > **Clipboard** (one id-remap pass `remapGroupChildIds` + one
  copy-set expander `expandSelectionWithGroupMembers`) > **Export** and
  **Z-order/reorder** (ZERO production code each — export's whole-viewport
  snapshot + class-based filter captures groups for free; the static
  `GROUP_NODE_Z_INDEX` re-pin in `buildNode` makes reorder z-invariant). No
  subsystem needed more than an id-remap or a `childIds` prune — the guardrail was
  never tripped. With `parentId`, all four would have needed bespoke logic (the v1
  failure). Full write-up in `00-design.md` §11 L9.1.
- **The one real gap found:** double-click ENTER isolation was not mode-gated
  (would fire in `view` mode). Fixed by gating on `flags.showResizeHandles`
  (§11 L9.3). The dead `onDeleteSelectionRef` bridge + no-op
  `childFirstNodeSnapshots` alias the host carried as scaffolding were finally
  wired (§11 L9.5).
- **Decision:** NO `flags.enableGrouping` master switch — not cheap, and redundant
  with `showResizeHandles`/`enableKeyboard`/`enableContextMenu` + prop-presence.
  Documented as a non-goal (§11 L9.4).
- **Any flaky e2e / baseline issues?** The e2e spec (`apps/studio/e2e/grouping.e2e.ts`)
  was ADDED but NOT run (Docker e2e is the orchestrator's call). Its visual
  baseline (`group-rendered.png`) needs a first chromium-linux generation via
  `bun run test:it:update-snapshots`; remember the bundle-build gotcha (build
  web+mcp bundles first or use full `test:it`). No baselines committed by M9.
- **Final retrospective:** see §11 L9.5 — write the delete-ordering tripwire first
  next time; mark host TODO-scaffolding with a skipped test so it can't be mistaken
  for done. The `childIds` model would not change.
- **➡ Consolidated lessons written into `00-design.md` §11 (L9.1–L9.5).** ✓
