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

- (Fill from M5 handoff.)
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

## Lessons-learned handoff (FILL THIS IN BEFORE MARKING DONE)
- Did the group-body click-through reliably let you grab children underneath?
- Any Esc ordering conflict with existing handlers (draw/pen/selection-clear)?
- Did the dispatcher-shim tests need slot-index updates (L0.5)? Note new order.
- **➡ Copy into `07-...md`.**
