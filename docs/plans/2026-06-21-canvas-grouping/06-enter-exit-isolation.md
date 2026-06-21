# Milestone 6 — Double-click to enter / exit a group (control children)

**Status:** Not started · **Depends on:** M1, M4, M5 · **Risk:** Medium–High
(v1's "clickable vs pass-through" duality spawned z-index/pointer-events hacks +
6 exit paths — we use ONE explicit model)

## Previous milestone — summary

M5 made the group a real container: dragging it moves members; resizing it scales
members — both atomic, both frozen-baseline. Until now, the group is selected and
manipulated as a unit; there is no way to address an individual child once
grouped.

## Lessons carried forward

- **From M5 handoff (actionable subset):**
  - **Mid-drag/mid-gesture, `setRfNodes(sourceNodes)` is FROZEN** while
    `draggingRef`/`resizingRef` is true (early-return in the sync effect). So a
    host optimistic override does NOT render during a gesture — to move nodes
    live you must write the rendered `rfNodes` directly (the channel xyflow uses).
    M6 implication: when isolation flips `draggable`/`selectable` on members,
    those come from `buildNode`/`sourceNodes`, which only re-render when NOT
    dragging — fine for a click-to-enter, but don't expect a mid-drag prop flip
    to take effect until the gesture ends.
  - **`groupDragRef` is the group-gesture frozen baseline** (`seeflow-canvas.tsx`,
    declared after `lastDragModifierRef`). Refs added AFTER `penModeRef` do NOT
    shift the hook-shim REF index map — append there. The drag-START snapshot is
    read from `rfNodesRef` (live rendered), and the commit reads `rfNodesRef` too
    (never the raw drag event — the ~1px snap-drift memory).
  - **Reuse the shared pure helpers, not new machinery.** Group move =
    `computeGroupMoveUpdates` (additive delta, dedupe via `excludeIds`); group
    resize = `computeFrozenResizeUpdates` + host `onMultiResize` (now group-aware
    via the optional `{ isGroup }` arg → `group-resize` undo label). Both commit
    through ONE batch = one undo.
  - **`selectedGroupId`** (already computed in the canvas) is the single source
    for "is one group selected" — reuse it for M6's double-click enter target
    (design §12.10 already flagged this).
  - **Dispatcher-shim can drive a full drag** (onNodeDragStart → onNodesChange →
    onNodeDrag → onNodeDragStop) and you can read live `rfNodes` via the
    `setterSink` slot-8 (`rfNodes` useState) — but it CANNOT drive a real pointer
    gesture on the overlay (that calls `useReactFlow`). For M6's
    `onNodeDoubleClick`/`onPaneClick` enter/exit, assert WIRING via the shim and
    leave the live pointer flow to the orchestrator browser test.
- **v1 lesson** "elevating the group above its children made children unreachable
  — the group body swallowed clicks at its z-index." → In isolation, the group
  body must be click-through and children must sit above it.
- **v1 lesson** Enter/exit had SIX ad-hoc paths and defensive DOM-walking. → Use
  ONE documented exit set; keep `activeGroupId` as runtime-only state.
- **L0.5** New `useState` (`activeGroupId`) appended at the END of `SeeflowCanvas`.

## Goal

Double-click a group to **enter isolation** and directly select / move / edit its
member nodes; exit cleanly. (Req #4.)

**User-testable outcome:** Double-click a group → its members become individually
selectable & editable; a member can be moved/renamed inside the group. Esc (or
click outside / empty pane) exits back to group-level selection.

## Scope

**In:** `activeGroupId` runtime state; gating that makes members
selectable/draggable/editable only when their group is active; group body
click-through in isolation; one documented exit set; an "entered" visual
affordance.

**Out:** styling UI (M7), connectors to children (M8 — though entering is the
precondition), nesting (non-goal).

## Implementation steps

1. **State:** add `const [activeGroupId, setActiveGroupId] = useState<string|null>
   (null)` at the END of `SeeflowCanvas`'s state block (L0.5) + an
   `activeGroupIdRef` mirror for event handlers.
2. **Enter:** wire a NEW `onNodeDoubleClick` handler on `<ReactFlow>` — **it is
   not wired today** (only `onEdgeDoubleClick` exists, `seeflow-canvas.tsx:5307`).
   If `node.type==='group'`, `setActiveGroupId(node.id)`. **No zoom conflict:**
   `zoomOnDoubleClick={false}` is already set (`seeflow-canvas.tsx:5264`), so a
   double-click won't also zoom the canvas. (Guard: a dblclick that originates on
   a child shouldn't re-enter; but with `childIds` + absolute positions children
   are NOT DOM-nested, so a child dblclick simply targets the child — keep it
   simple, no DOM-walking unless a test shows a need.)
3. **Gating in `buildNode`:** for a node that is a member of some group `g`:
   - if `g === activeGroupId` → normal `selectable`/`draggable` + edit callbacks.
   - else → leave as today (members are normally addressable too, since they're
     just nodes). **Decision:** by default members ARE individually selectable
     even when not entered (they're loose nodes visually). Isolation's real job is
     to (a) let the group body be click-through so you can grab a child *under* the
     group chrome, and (b) scope group-move so dragging a member inside an active
     group moves only that member, not the whole group. Pick and document the
     exact rule; the simplest coherent model:
     - **Not entered:** clicking anywhere on the group's box selects the *group*;
       the group captures the gesture (group move). Members reachable only via
       direct click on the member's own footprint if it pokes outside? → ambiguous.
     - **Entered:** the group box is click-through (`pointer-events:none` on the
       group body, title bar still interactive); members are directly selectable
       and draggable individually; group move is disabled.
   → Implement the **entered = group-body click-through, members individual**
   model. This is the crisp version of v1's intent.
4. **Group body click-through:** when `activeGroupId === group.id`, render the
   group container with `pointer-events:none` on the fill (keep the title bar /
   border interactive for exit affordance). When not active, the group body
   captures clicks → selects the group.
5. **Exit set (ONE place):**
   a. `Esc` — ranked BEFORE selection-clear (first Esc exits isolation, second
      clears selection). Hook into the existing keydown handling.
   b. Click on empty pane (`onPaneClick`) → `setActiveGroupId(null)`.
   c. Click a node that is not a member of the active group → exit then select it.
   d. Effect: if `activeGroupId` no longer exists in `nodes` (ungrouped/deleted/
      flow swap) → `setActiveGroupId(null)`.
6. **Affordance:** when entered, dim the rest of the canvas slightly OR show a
   subtle ring/breadcrumb on the active group so the user knows they're inside.
   Keep it CSS-light (no z-index gymnastics).
7. **Interplay with M5 group-move:** group drag is disabled while that group is
   active (you're manipulating children, not the container).

## Guardrails
- ONE exit set, all in documented locations. No scattering.
- Group-body click-through ONLY when active; otherwise the group is a normal
  selectable node.
- `activeGroupId` never persisted; dropped when the group vanishes.
- Avoid v1's z-index carve-outs — prefer pointer-events + the (M1) stable
  z-order.

## Tests
- **Component:** dblclick group → `activeGroupId` set; member becomes
  selectable/draggable; group body `pointer-events:none` when active; Esc / pane
  click / outside-node click / group-removal all clear `activeGroupId`.
- **Unit:** "is node N a member of active group?" helper.
- **E2E:** dblclick group → drag a child inside → child moves alone (group
  doesn't) → rename a child → Esc → group-level selection restored.

## User Acceptance Test (manual)
1. Double-click a group → it shows an "entered" affordance.
2. Click a member → only that member selects. Drag it → only it moves (group
   stays). Double-click its title → rename it.
3. Press Esc → back to group-level (the group selects, members no longer
   individually active). Press Esc again → selection clears.
4. Enter a group, then click empty pane → exits. Enter, then click a different
   group → exits and selects that one.
5. Enter a group, ungroup it via keyboard → isolation auto-exits cleanly.

## Definition of Done
- Gates green; component + e2e pass.
- One documented exit set; no stray z-index hacks.
- UAT passes.
- Lessons handoff filled in.

## Lessons-learned handoff (FILLED IN — M6 done)

- **The slot rule + an early reader = the one real hazard.** `activeGroupId` is
  the 15th `useState`, appended at the END (→ `useStateOverrides[14]`); **no
  existing slot shifted**, so the dispatcher-shim tests at slots 2/3 (drawStart/
  drawCurrent) and slot 13 (sidebarOpen) were untouched and stayed green with
  zero index edits. BUT `buildNode`/`sourceNodes` (the rebuild-from-props memo)
  lives ~1300 lines ABOVE the state block and reads node render-props — it
  **cannot** reference a state declared at the END (TDZ: "used before
  declaration"). **Resolution that satisfies BOTH constraints:** keep `sourceNodes`
  isolation-agnostic and apply the per-group isolation props in a SEPARATE
  `displayNodes = useMemo(() => overlay(rfNodes, activeGroupId), [rfNodes,
  activeGroupId])` declared AFTER the state, then feed `<ReactFlow nodes={...}>`
  from `displayNodes`. Lag-free (synchronous memo) and no slot churn. **This is
  the pattern for ANY future late-state value that must reach the rendered
  nodes** — do not try to read it inside `buildNode`.
- **ONE isolation flag, ONE overlay.** Isolation render = exactly two prop flips
  on the active group, both in `displayNodes`: `data.active = true` (renderer →
  fill `pointer-events:none` + outline ring + `data-active="true"`) and
  `draggable = false` (step 7: group-move off while entered — no drag ⇒ no M5
  `groupDragRef` ⇒ children never fan out, structurally). No z-index carve-outs,
  no per-story pointer-events hacks — the v1 trap is avoided.
- **Group-body click-through reliably reaches children — by construction, not by
  z-index fighting.** Members are top-level DOM siblings (childIds + absolute
  positions, NOT DOM-nested) sitting ABOVE the group (group z = -1). So
  `pointer-events:none` on the group container only neutralizes the group's own
  box; member hit-testing is unaffected. The title band re-enables
  `pointer-events:auto` on a thin wrapper (`group-node-titlebar`, `display:contents`
  when inactive so it's layout-neutral) to stay the interactive exit affordance.
- **Esc ordering: no conflict.** Inserted ONE step `3b` into the existing US-006
  single-listener ESC chain, BETWEEN the drop-popover close (3a) and the
  selection-clear (4), reading `activeGroupIdRef.current`. First Esc exits
  isolation + `preventDefault`s + early-returns (so it does NOT also clear
  selection); a second Esc falls through to the selection-clear. Draw/pen/connect
  steps are higher-priority and unaffected. The whole exit set is documented in
  that one comment block — no scattering (v1 had six).
- **Exit set wiring detail (host reality):** the live app wires ONLY
  `onSelectionChange` — `onNodeClick`/`onPaneClick` host callbacks are unwired in
  `demo-view.tsx`. So the exit handlers must clear `activeGroupId` THEMSELVES
  (not lean on the host): pane-click handler clears unconditionally; node-click
  handler clears iff the clicked node is NOT a member of the active group AND is
  not the active group itself (`isMemberOfGroup` oracle). xyflow's own
  `onSelectionChange` still selects the clicked node in the same gesture — we
  never drive selection from these handlers.
- **Cleanup effect (exit d):** a `useEffect([activeGroupId, nodes])` drops the id
  the instant it stops being a `type:'group'` node in `nodes` (ungroup / delete /
  flow swap). Guarded so it's a no-op on unrelated `nodes` ticks.
- **Dispatcher-shim slot updates needed? NO.** Append-at-END held the line — the
  count went 14 → 15 (new `activeGroupId` at index 14); every prior index is
  unchanged. The only doc edit was bumping the count + adding the name in
  `packages/canvas/CLAUDE.md`. New M6 shim tests assert via `setterSink` slot 14
  (enter/exit transitions) + `effectSink` (the cleanup effect by its
  `[activeGroupId, nodes]` deps shape) + `<ReactFlow>.props.nodes` (the overlay).
  ESC needed a `globalThis.window`/`document` stub in the shim env (no DOM) to
  fire the real listener body — left the live keydown to the browser test.
- **➡ Copied into `07-...md`.**
