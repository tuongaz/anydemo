# Canvas Grouping — Master Design

**Date:** 2026-06-21 · **Status:** Approved direction (4 product decisions locked, see §3).

This document is the single source of truth for the grouping feature. The
numbered milestone files implement it incrementally. Read this fully first.

---

## 1. Goal & requirements

Add **grouping** to the `@seeflow/canvas` React Flow canvas. From the request:

1. Marquee-selecting nodes shows a **temporary rectangle** around them, with a
   bit of **extra padding**.
2. That rectangle shows **4 corner boxes** to **resize the selected nodes**.
   *(History: a prior attempt resized "too fast", boxes grew by an order of
   magnitude — a feedback-loop bug. See §6.)*
3. A **small icon on the top-right** to **create a group** (or **ungroup** if
   already grouped).
4. When grouped, **double-click to control the elements inside** the group.
5. A group also: can be a **connector endpoint**, can **change background /
   border**, has a **title**, and supports **sidebar content**.
6. *"Anything else I missed"* — covered in §9 (clipboard, delete-cascade,
   export, persistence, live reload, z-order, nesting policy, empty/locked
   selections).

### Two distinct surfaces (important framing)

The request conflates two things that we keep separate in the build:

- **A. Transient multi-select overlay** (reqs #1, #2, and the *create* half of
  #3). This works on *any* 2+ node selection, **before any group exists**. It is
  the padded rect + 4 corner resize handles + a ＋ "create group" icon.
- **B. The persistent group container** (reqs #3 *ungroup*, #4, #5). Once
  created, a group is a first-class node with a title, styling, sidebar,
  connectors, and an enter/exit interaction. A selected group shows the *same*
  overlay chrome but with a ⊟ "ungroup" icon.

Milestones 2–3 build surface A. Milestones 1, 4–8 build surface B. Milestone 9
hardens the cross-cutting integration.

---

## 2. Why v1 failed (read before coding)

A complete group feature existed (`cac9608e` US-011 … `9087ff17`) and was removed
in **`8673a650`**. There was **no design doc and no stated removal rationale** —
only commit messages and code comments. Reconstructed causes:

1. **`parentId` leaked into every subsystem.** v1 used xyflow's native
   parent-child model (`child.parentId = groupId`, relative positions). Removing
   it had to touch clipboard, delete-cascade, selection overlay, edge gating,
   node array ordering (`insertGroupBeforeChildren`), schema `superRefine`
   integrity, and even the example fixtures. Group-awareness was *everywhere*.
2. **The exponential resize bug.** Live per-tick child scaling fed the
   *just-written optimistic override* back in as the next tick's baseline →
   `w·sx·sx·sx…` compounding. `cd489599` reverted live child scaling to
   end-only. (The current dead overlay still contains this trap, §6.)
3. **The "fight xyflow's selection internals" marquee bug.** Marquee
   group-select required patching xyflow's `getSelectionChanges` (which mutates
   `internalNode.selected` directly) and stamping fresh node references to beat
   `adoptUserNodes`. It produced flicker (ResizeControls unmount/remount thrash)
   and was abandoned in `02996405` ("revisit later").
4. **The container "clickable vs pass-through" duality** was solved
   story-by-story with hand-tuned z-index carve-outs, `pointer-events:none`
   gating, and ~6 separate enter/exit paths.

**Design responses** (each maps to a v1 failure):

| v1 failure | This design's response |
|---|---|
| `parentId` leaks | First-class container with **`childIds[]`**; child positions stay **absolute**; rest of canvas stays group-agnostic (§4). |
| Exponential resize | **Frozen baseline + end-only commit** (§6). The single most important rule. |
| Marquee internals fight | We **do not** patch xyflow's selection stream. Marquee selection already works today (`SelectionMode.Partial`). The overlay reads the *resulting* selection; it never intercepts selection changes (§5, §7). |
| Click/pass-through duality | An explicit **isolation model**: a group is selectable as a unit; double-click enters isolation where children are directly addressable; one documented exit set (§8). |
| No design doc | This document + the lessons log (§11). |

---

## 3. Locked product decisions

Confirmed with the requester on 2026-06-21:

1. **Group model:** *First-class container + `childIds`.* The group node owns
   `data.childIds: string[]`. Child node positions remain **absolute**. Group
   move/resize **explicitly fans out** child updates via a pure ops layer. The
   rest of the canvas does not become group-aware.
2. **Resize behavior:** *Scale size + position proportionally* against a
   **frozen start rect** (Figma-style). Member nodes' width/height AND positions
   scale. Must use the frozen-baseline + end-only commit pattern (§6).
3. **Overlay scope:** *Both* a transient marquee selection (2+ loose nodes) AND
   a selected group show the padded rect + 4 corner handles + the top-right icon
   (＋ create vs ⊟ ungroup).
4. **Connectors:** *Group and children both connectable.* A connector can
   target the group as a whole; children are connectable when the group is
   entered (isolation mode). Schema already permits any node id as an endpoint.

---

## 4. Data model

### 4.1 The group node

A group is a **node** of a new `type: 'group'`. It reuses the existing
visual/semantic field groups so styling, title, and sidebar come (almost) for
free.

```ts
// resolved (in-memory / wire) shape — apps/studio/src/schema.ts
{
  id: string,
  position: { x, y },          // absolute top-left of the group container
  type: 'group',
  data: {
    // membership — THE new structural field:
    childIds: string[],        // ids of member nodes (absolute positions)

    // reused from NodeVisualBaseShape (schema.ts:43-60):
    width?, height?,           // container size (drives the rendered box)
    backgroundColor?, borderColor?, borderSize?, borderStyle?,
    cornerRadius?, shadow?, fontSize?, textAlign?,

    // reused from NodeSemanticBaseShape (schema.ts:65-90):
    name?,                     // the group TITLE
    description?, detail?,     // sidebar content (markdown)
    icon?,                     // optional title glyph
  }
}
```

**Why `childIds` on the group, not `parentId` on children?**
- Single source of truth for membership lives in one node, not scattered.
- Child positions stay absolute → no absolute↔relative conversion, no
  parent-before-child array-ordering invariant, no `superRefine` cycle checks.
- The rest of the canvas treats children as ordinary nodes. Clipboard, delete,
  edges, export all keep working without group-awareness, except the few
  deliberate touch-points in §9.

**Membership invariants** (enforced in the ops layer + a schema `superRefine`):
- Every id in `childIds` must reference an existing node.
- A node id appears in **at most one** group's `childIds` (no double-membership).
- A group id never appears in its own or another group's `childIds` in v1
  (**no nested groups in v1** — see §9.7).

### 4.2 Persistence (flow.json / style.json split)

`apps/studio/src/merge.ts` routes each `data` key to flow.json (semantic) or
style.json (visual) via `NODE_DATA_FLOW_KEYS` / `NODE_STYLE_KEYS`.
- `childIds` is **semantic** → add to `NODE_DATA_FLOW_KEYS` (flow.json).
- The reused visual fields already route correctly.
- `position` already lives in style.json for all nodes.

### 4.3 Schema parity gates (must all stay green)

- `apps/studio/src/schema.ts` — add `'group'` to `NodeTypeSchema` (`:215`) and a
  `group` variant to BOTH the resolved union (`:381`-ish) and on-disk union
  (`:758`-ish). Decide: a group is **not** a geometric node (don't add to
  `GEOMETRIC_NODE_TYPES`); it's its own variant with `GroupNodeDataSchema`.
- Run `make sync-seeflow-schema` (mirrors to `skills/seeflow/vendored/schema.ts`;
  CI gates `make verify-seeflow-schema-sync`).
- `packages/canvas/src/types.ts` — add `'group'` to `NodeType` (`:118`), a
  `FlowNode` union member (`:292`), `GroupNodeData`, and `childIds` etc. to
  `CANVAS_NODE_DATA_FIELDS` (`:143`, a `satisfies` const — compile fails if a
  field is missing).
- `packages/canvas/src/types.test.ts` — exhaustive `switch` over `NodeType`
  (`:73-120`) must handle `'group'`.
- `apps/studio/src/schema.test.ts` — the `canvas ↔ disk schema parity` test
  (`:3088`) and `STRIPPED_VISUAL_FIELDS` (`:2950`) must account for the new
  fields.

### 4.4 Adapter / mutation surface

No new adapter *method* is needed. Create/ungroup/move/resize compose existing
methods inside a single `history.batch(...)`:
- `createNode({ type:'group', position, data:{ childIds, ... } })`
- `updateNode(childId, { position, width, height })` (already patchable)
- `updateNode(groupId, { /* childIds */, position, width, height, ... })`
- `deleteNode(groupId)`

**`childIds` must be added to `NodePatch`** (`adapter/types.ts:40-97`) and the
studio `NodePatchBodySchema` (`operations.ts:100-187`) + `mergeNodeUpdates`
(`operations.ts:347`) so it round-trips. Per the canvas CLAUDE.md passthrough
rule, since we reuse `updateNode` (not a new optional method), no
`wrap-adapter.ts` spread change is needed — but verify the `updateNode`
interceptor (`wrap-adapter.ts:168-221`) snapshots `childIds` in its `before` and
add `'childIds'` to `NULL_CLEARS_NODE_KEY` (`wrap-adapter.ts:33-49`) so an undo
that clears membership sends an explicit empty value rather than a dropped
`undefined`.

---

## 5. Interaction model

### 5.1 Selection & the overlay

- Marquee already works (`seeflow-canvas.tsx:5246` `SelectionMode.Partial`,
  `selectionOnDrag`). We **do not touch** the selection event stream.
- The overlay renders when:
  - **2+ loose nodes** are selected (transient surface A), OR
  - **exactly one group** is selected (surface B).
- The overlay reads `selectedNodes` (already controlled, threaded as
  `selectionOverlayNodes`, `seeflow-canvas.tsx:3227`) — it is a pure consumer of
  selection, never a mutator of it.

### 5.2 The top-right icon (req #3)

A single 32×32 ghost icon button anchored to the **top-right of the padded
overlay rect** (rendered inside the same `ViewportPortal` as the handles so it
tracks zoom/pan):
- Loose multi-selection → ＋ "Create group" (tooltip, ⌘G). Calls
  `onCreateGroup(selectedNodeIds)`.
- Selected group → ⊟ "Ungroup" (tooltip, ⌘⇧G). Calls `onUngroup(groupId)`.

Modeled on `inspector-toggle.tsx` / `play-button.tsx` (NodeToolbar is *not* used
in this codebase — match the in-house absolute-positioned affordance pattern).
Also exposed via the right-click context menu (`seeflow-canvas.tsx:5644-5731`)
and keyboard (§5.4).

### 5.3 Double-click enter / exit (req #4)

- Double-click a group → enter **isolation**: `activeGroupId = group.id`.
  In isolation, member nodes become individually `selectable`/`draggable`/
  editable; the group body becomes click-through so children underneath are
  reachable; the group shows a subtle "entered" affordance (e.g. dimmed
  backdrop or a breadcrumb).
- Exit paths (one documented set — avoid v1's six ad-hoc paths):
  1. `Esc` (ranked before selection-clear: first Esc exits, second clears).
  2. Click on empty pane.
  3. Click a node that is not a member of the active group.
  4. The active group disappears from `nodes` (ungrouped/deleted/flow swap) →
     effect drops `activeGroupId`.
- Isolation is **runtime-only UI state** (a new `useState` slot appended at the
  END of `SeeflowCanvas` per the hook-shim rule). It is never persisted.

### 5.4 Keyboard (req #3 parity)

- `Cmd/Ctrl+G` → create group from selection (≥2 loose) — or no-op with reason.
- `Cmd/Ctrl+Shift+G` → ungroup the selected group(s).
- `Cmd+D` is already Duplicate (`keyboard-shortcuts.ts:277`) — do not reuse.
- Add `'edit.group'` / `'edit.ungroup'` to `CommandId` + `COMMANDS`, a pure
  `resolveGroupChord(e, ctx)` resolver beside `resolveClipboardChord`
  (`:490-518`), and a keydown shim effect in `seeflow-canvas.tsx` mirroring the
  clipboard effect (`:2736-2753`), gated on `flags.enableKeyboard`.

---

## 6. The resize contract (the make-or-break section)

This is where v1 died twice. The rules here are **non-negotiable** and are
re-stated in milestones 3 and 5.

### 6.1 Root cause of the "order of magnitude" bug

In the current dead overlay, the live per-tick path does:

```ts
// selection-resize-overlay.tsx:327-333  — THE BUG
const oldRectAtStart = dragState.oldRect;     // ✅ frozen
const nodesAtTick = selectedNodes;            // ❌ LIVE, optimistically-overridden
scheduleRaf(liveDispatchRafRef, () => {
  const updates = computeSelectionResizeUpdates(nodesAtTick, oldRectAtStart, newRect, …);
  if (updates.length > 0) onMultiResize(updates);
});
```

Sequence: tick 1 scales originals by 1.1 → parent applies optimistic override →
`selectedNodes` now reports 1.1× sizes. Tick 2 computes `newRect` = 1.2× of the
*frozen* old rect, but multiplies the **already-1.1× `nodesAtTick`** → result
1.1 × 1.2 = 1.32×. Each tick compounds. A few fast ticks → ×10. Freezing only
`oldRect` is **not enough**; the *node set* must be frozen too.

### 6.2 The contract

1. **Freeze both at pointer-down:** capture `startRect` (the union rect) AND
   `startNodes` = a deep copy of each selected node's `{id, position, width,
   height}`. Store both in `DragState`.
2. **Every computation uses the frozen pair:**
   `scaleNodesWithinRect(startNodes, startRect, newRect, opts)`. Never read the
   live `selectedNodes` again until the gesture ends and `DragState` is cleared.
3. **End-only commit (default).** Dispatch the single batched
   `onMultiResize(updates)` once, on pointer-up, from the frozen pair. One
   `coalesceKey` → one undo entry.
4. **During the drag, show a LOCAL preview only** — the padded rect + handles
   move to `newRect` (already implemented via `previewRect`). Optionally render
   ghost outlines of where each node will land, computed from the frozen pair.
   Do **not** mutate the real nodes per tick in the first cut.
5. **Stable callbacks** if any xyflow `NodeResizeControl` is involved
   (group-as-node resize path): mirror callbacks into refs, return
   `useCallback([])` handles (`use-resize-gesture.ts:181-211`). A fresh
   reference mid-drag zeros xyflow's d3 `startValues` → the other exponential
   bug.
6. **`scaleNodesWithinRect` is correct and stays untouched** (`scale-nodes.ts`)
   — it is pure and takes explicit `oldRect`/`newRect`. The danger is never in
   the helper; it is always in what the *caller* feeds it.

### 6.3 Optional later enhancement (NOT first cut)

Live per-tick visual scaling of the real nodes can be added later by applying a
CSS transform to a frozen-baseline preview layer, or by per-tick optimistic
overrides keyed so the SSE echo can't double-apply — but only after the
end-only path is proven and regression-tested. Milestone 3 ships end-only.

### 6.4 Regression test that must exist

A unit test that simulates N ticks where the "live" node set is replaced by the
*previous tick's output* (simulating the optimistic-override echo) and asserts
the committed result equals a single `start → final` scale — i.e. **no
compounding**. This test is the tripwire for the order-of-magnitude bug and
lives in milestone 3.

---

## 7. Rendering

### 7.1 GroupNode renderer (milestone 1)

A new `packages/canvas/src/nodes/group-node.tsx`:
- Draws a rounded rectangle sized to `data.width/height`, painted from
  `backgroundColor`/`borderColor`/`borderSize`/`borderStyle`/`cornerRadius`/
  `shadow` (reuse the same inline-style derivation rectangle/geometric nodes
  use; tokens via `color-tokens.ts`).
- A title row (top, inside the padding) reusing `NodeHeader` (`node-header.tsx`)
  → inline title edit + optional icon for free.
- **z-order: behind its children.** A group must paint under member nodes. Use a
  low `zIndex` on the group node and/or rely on array ordering — see §9.6.
- The padded gap between the container edge and the children is the group's
  "chrome" (the title sits in the top padding band, like v1's 28px label slot).
- Registered in the node-type registry consumed by `buildNode` /
  `nodeTypes` in `seeflow-canvas.tsx`.

### 7.2 Overlay chrome (milestone 2)

Revive the deleted JSX in `SelectionResizeOverlay` (`return null` at `:407`):
- A dashed bounding rect at `paddedRect`, `zIndex` ~1500, inside `ViewportPortal`.
- 4 **corner** handles only (v1 had 8; the request asks for 4 corners). Keep the
  `ANCHOR_OFFSET`/`ANCHOR_CURSOR` maps but render only `nw/ne/se/sw`.
- Zoom-compensated handle size (`--rf-zoom`) so boxes stay constant screen size.
- The top-right icon button (§5.2) anchored to the rect's NE corner.
- `pointer-events` only on the handles + icon; the rect itself is non-interactive
  so it never steals clicks from nodes underneath
  (mirror `nodesselection-rect` neutralization, `index.css:491`).

### 7.3 Selection padding (req #1)

`SELECTION_OVERLAY_PADDING` already exists (`= 8`,
`selection-resize-overlay.tsx:40`). The request says "a bit extra padding" —
bump to **12** (or expose as a constant; pick one value and pin it in a test).
For a *selected group*, the rect pads outside the group's own chrome so the
selection ring sits clearly outside any selected child (v1 lesson `166bd0bf`).

---

## 8. Group lifecycle ops (pure module: `group-ops.ts`)

Re-introduce a **pure, unit-tested** `packages/canvas/src/lib/group-ops.ts`
(v1 had one in `apps/web`; keep it pure so geometry is testable without React
Flow). Functions:

- `computeGroupBox(children, padding, titleBandPx) → { position, width, height }`
  — absolute bbox over members, expanded by padding all sides + extra top band
  for the title.
- `selectGroupableSet(nodes, selectedIds) → string[]` — eligible members:
  exist, not already in a group, not themselves a group (no nesting in v1).
- `selectGroupSelection(nodes, selectedIds) → groupIds[]` — selected groups.
- `planGroupShortcutAction(nodes, selectedIds) → 'group' | 'ungroup' | { none: reason }`
  — pure decision oracle for ⌘G (empty / single-loose / mixed → reasoned no-op).
- `expandGroupDeletion(nodes, toDeleteIds) → string[]` — policy for delete: in v1
  deleting a group cascaded to children; **decide the v1-of-this policy in §9.3.**

**Create group** (one `history.batch('group-create', …)`):
1. Filter selection via `selectGroupableSet` (require ≥2).
2. `computeGroupBox` from live displayed positions + measured/`data` dims.
3. `createNode({ type:'group', position, data:{ childIds, name:'Group', …default
   chrome } })` → get the new group id.
4. `updateNode(groupId, { childIds })` is folded into the create payload (no
   second call needed).
5. **No child mutation required** (positions stay absolute) — children simply
   become members. This is the big simplification over v1.
6. Z-order: ensure the group renders behind children (§9.6) — may require one
   `reorderNode` or a `zIndex` write.

**Ungroup** (one `history.batch('ungroup', …)`):
1. `deleteNode(groupId)`. Children are untouched (absolute positions, no
   reparent). They remain selected as the new multi-selection.

> Contrast with v1's fragile ordering (unparent-before-delete, recreate-before-
> reparent, parent-before-child array order). With `childIds` + absolute
> positions, **none of that ordering complexity exists**. This is the core payoff
> of decision #1.

---

## 9. Cross-cutting concerns ("anything else", req #6)

### 9.1 Group move
Dragging the group must move its members. Since positions are absolute and
xyflow won't auto-move them, the canvas computes the group's drag delta and fans
out `position` updates to each member in the same drag-stop commit (one undo
entry). Detail in milestone 5. Guard: read the delta from the group's drag, not
from per-child echoes.

### 9.2 Group resize
Reuse the §6 contract: frozen baseline (group box + member geometry at
pointer-down), end-only commit, members scaled via `scaleNodesWithinRect`.
Milestone 5.

### 9.3 Delete policy
**Decision:** Deleting a **group** deletes the container only and **releases**
its children (they survive as loose nodes). Rationale: least-surprise + matches
"ungroup then the box is gone". Deleting a **member** removes it and prunes its
id from the group's `childIds` (a `updateNode(groupId,{childIds})` in the same
batch). Deleting via marquee that includes both group and members: dedupe so the
group delete + member deletes compose without referencing a stale `childIds`.

### 9.4 Clipboard (copy/paste)
Copying a selection that includes a group copies the group + all its members and
remaps ids so the pasted group's `childIds` point at the pasted members. Because
membership is `childIds` (not `parentId`), this is a single id-remap pass — no
per-node parent rewrite. Milestone 9.

### 9.5 Export (PNG/PDF)
Group renders as a normal node, so `use-canvas-export.ts` includes it
automatically. Verify the group box and title appear and z-order is correct in
the export. Milestone 9.

### 9.6 Z-order
The group must paint **behind** its members. Options: (a) a dedicated low
`zIndex` for `type:'group'` nodes in `buildNode`; (b) keep groups ordered before
members in `nodes[]`. Prefer (a) — an explicit `zIndex` is robust against array
reordering by bring-to-front/back. The bring-to-front/back context-menu actions
must not let a member fall behind its group or a group rise above its members in
a confusing way — clamp group zIndex below member zIndex. Decide & test in
milestone 1 (render) + revisit in milestone 9 (reorder interplay).

### 9.7 Nesting policy
**No nested groups in v1.** `selectGroupableSet` excludes existing members and
groups. A `superRefine` rejects a group id inside another group's `childIds`.
Document as an explicit non-goal; revisit later.

### 9.8 Live reload / SSE
Server broadcasts `flow:reload` after each mutation. The group node + `childIds`
round-trip through the resolved schema; `autoFitViewSignal` handling is unchanged.
Verify a group survives a reload and that an in-flight isolation (`activeGroupId`)
is dropped if the group vanishes. Milestone 9.

### 9.9 Modes & flags
- The overlay/handles are gated on `flags.showResizeHandles`
  (`seeflow-canvas.tsx:160`, ON for edit, OFF for view/mini).
- Group create/ungroup/enter are edit-only (require adapter).
- A group still **renders** in view/mini (read-only) — title, chrome, members.
- Consider a `flags.enableGrouping` master switch (default ON for edit) so the
  whole feature can be disabled by a host.

### 9.10 Empty / locked / single selections
- 0–1 selected → no overlay, ⌘G is a reasoned no-op.
- Selection mixing a group + loose nodes → ⌘G no-op (don't nest); document.

### 9.11 Empty groups (decision)
**An empty group (`childIds` = `[]`) is ALLOWED and persists.** A titled/styled
group with no members is a useful **labeled zone** (req #5 gives it title +
background + border + sidebar). So: deleting the last member leaves an empty
group box, NOT an auto-delete. The user removes it explicitly via ungroup/delete.
`computeGroupBox` for an empty group keeps the group's last explicit
`width/height` (don't collapse to 0). Pin a test for an empty group round-trip +
render. (If a future product call wants auto-cleanup, it's a separate opt-in.)

---

## 10. Testing strategy (per-milestone detail in each file)

- **Unit** (`*.test.ts(x)` beside sources, `bun test`): pure geometry
  (`group-ops.ts`, `scale-nodes.ts` already covered, overlay rect math), the
  **no-compounding regression test** (§6.4), schema round-trip, history-batch
  atomicity, keyboard chord resolvers.
- **Component** (dispatcher-shim tests): GroupNode render, overlay chrome
  presence/gating, DetailPanel/StyleStrip group branches. Respect the
  append-at-END `useState` slot rule.
- **Integration** (`apps/studio/integration/*.it.ts`): create→persist→reload a
  group; ungroup; delete policies; clipboard round-trip.
- **E2E** (`apps/studio/e2e/*.e2e.ts`, Playwright, chromium-linux baselines):
  marquee → overlay → resize → group → enter → edit child → exit → ungroup;
  visual baselines for the overlay chrome and a rendered group. Remember the
  bundle-build gotcha (build web+mcp bundles before e2e, or use full
  `test:it`).
- **Gates per milestone:** `bun run format` → `bun run lint` →
  `bun run typecheck` → `bun test` → (where relevant) `bun run test:it`. Schema
  edits → `make sync-seeflow-schema` + `make verify-seeflow-schema-sync`.

---

## 11. Lessons log (append-only, shared across milestones)

> Each milestone appends its discovered lessons here AND into the next
> milestone's "Lessons carried forward". Seeded from v1 archaeology:

- **L0.1** Freezing only `oldRect` is insufficient for multi-node scale — freeze
  the *node set* too, or the optimistic-override echo compounds the scale
  (order-of-magnitude bug). (`selection-resize-overlay.tsx:328`)
- **L0.2** Non-stable xyflow resize callbacks zero the d3 `startValues` mid-drag
  → the *other* exponential bug. Keep callbacks `useCallback([])`-stable.
  (`use-resize-gesture.ts:115-129`)
- **L0.3** `parentId`-based membership leaks group-awareness into every
  subsystem. Use `childIds` + absolute positions so the canvas stays
  group-agnostic. (v1 removal `8673a650`)
- **L0.4** Do not patch xyflow's selection event stream for marquee — it mutates
  internal node state directly and fights you. Consume the resulting selection
  only. (`02996405`)
- **L0.5** Append new `useState` slots at the END of `SeeflowCanvas` or every
  hook-shim test's `useStateOverrides[N]` index shifts. (canvas CLAUDE.md)
- **L0.6** Any `schema.ts` edit needs `make sync-seeflow-schema` in the same
  change or CI's `verify-seeflow-schema-sync` fails.
- **L0.7** A new patchable field needs: `NodePatch` (canvas) + `NodePatchBody`
  (studio) + `mergeNodeUpdates` + (if nullable-clearing) `NULL_CLEARS_NODE_KEY`.
  Miss one and it silently fails to persist or to undo.
- **L1.1 (M1) Group z-order mechanism is a NEGATIVE per-node `zIndex`.**
  `GROUP_NODE_Z_INDEX = -1`, exported from `packages/canvas/src/nodes/group-node.tsx`,
  applied in `seeflow-canvas.tsx` `buildNode` (`if (merged.type === 'group')
  node.zIndex = GROUP_NODE_Z_INDEX`). It MUST be negative because edges are
  pinned at `zIndex 0` (`DEFAULT_EDGE_OPTIONS`) and all other nodes leave
  `zIndex` undefined (xyflow → 0); an equal 0 lets DOM order win and a
  late-authored group paints over its members. Stable on selection thanks to
  `elevateNodesOnSelect={false}` + the
  `.react-flow__node.selected:not(.react-flow__node-group)` carve-out in
  `index.css`. **M5/M9 contract:** do not add a selection-time z bump for
  groups; clamp bring-to-front/back so a group never rises to ≥ a member's z.
- **L1.2 (M1) `childIds` is NOT in `CANVAS_NODE_DATA_FIELDS`.** That
  satisfies-const is bound to `GeometricNodeData`; `childIds` lives on the
  separate `GroupNodeData` variant and persists via its own `FlowGroupNodeData`
  on-disk schema. The studio↔disk parity test only checks the geometric set.
  Group-only fields added by later milestones must NOT touch that const.
- **L1.3 (M1) The group membership `superRefine` is duplicated in BOTH the
  resolved and on-disk unions** via a shared `addGroupMembershipIssues(nodes,
  ctx)` helper in `schema.ts` (mirrors the connector-existence check). Its
  `nodes` param types `data` as `unknown` (the variants are structurally
  exclusive, so a narrow `{childIds?}` type is rejected). **§12.9 ordering rules
  apply** because the on-disk read paths enforce it too.
- **L1.4 (M1) Adding a `NodeType` ripples into exhaustive maps the milestones
  don't always list:** `operations.ts SEMANTIC_KEYS_BY_TYPE` and `layout.ts
  DEFAULT_DIMENSIONS` (both `Record<NodeType,…>`) failed typecheck until a
  `group` entry was added. Grep `Record<...NodeType...>` when adding a type.
- **L1.5 (M1) v1's group CSS was left behind in `index.css`** (dead
  `.react-flow__node-group` border/bg + `data-active`/`data-gated-child`/label
  rules) after the `8673a650` removal. xyflow auto-tags `type:'group'` nodes
  with `.react-flow__node-group`, so the dead base rule fought the renderer's
  inline box. Removed in M1. Before adding group CSS in M6/M7, `rg
  "react-flow__node-group"` first.

---

## 12. Technical challenges & techniques (verified against the codebase)

These are the specific implementation hazards confirmed by reading the live code,
each mapped to the milestone that must handle it. They are the difference between
"a plan that reads well" and "a plan that survives contact with the code".

### 12.1 Dimension resolution — `measured ?? data ?? fallback` (M2, M3, M4, M5)
**Challenge:** the overlay's `computeUnionRect` (`selection-resize-overlay.tsx:54`)
reads **only `data.width/height`** and `continue`s past any node lacking it — so
**auto-sized nodes** (`html`/`component` with `autoSize`, and freshly-created
nodes that haven't persisted a size) are **silently excluded** from the union
rect. The rest of the canvas resolves dims via the fallback chain
`node.measured.width ?? node.width ?? 0` (e.g. `seeflow-canvas.tsx:1286-1289`,
`:1605`, `:1730`, `:1748`).
**Technique:** for the group bbox (`computeGroupBox`), the multi-select union
rect, and the resize baseline, resolve each member's size via
`rfInstance.getInternalNode(id)?.measured ?? data.width/height ?? sensible
fallback`. Either (a) extend `OverlayInputNode` to carry a resolved
`width/height` computed by the caller in `seeflow-canvas.tsx` (which has
`rfInstance`), or (b) pass measured dims in. **Do NOT rely on `data.width/height`
alone** or groups containing auto-sized nodes will mis-fit and mis-scale. Pin a
test with an auto-sized member.

### 12.2 Live child movement during a group drag (M5)
**Challenge:** `onNodeDrag` (per-frame) is **not wired** today — only
`onNodeDragStart`/`onNodeDragStop` (`seeflow-canvas.tsx:2182-2183`,
`:4849-4866`). Per-frame position changes flow through `onNodesChange`
(`:3551`). With xyflow-native `parentId`, children moved automatically during a
drag; with **`childIds` + absolute positions they do NOT** — naively, children
would stay frozen and snap to the group only on drag-stop (a visible UX lag).
**Technique:** move children live by applying the group's per-frame delta as
**optimistic position overrides** during the drag. Hook the per-frame signal —
either add an `onNodeDrag` prop on `<ReactFlow>` or detect the group's position
delta inside `onNodesChange` (where `draggingRef` is already true) — and fan the
delta to members via the existing optimistic-override mechanism, then commit the
real PATCHes on `onNodeDragStop`. **This is additive (delta), not multiplicative,
so it cannot compound** like the resize bug — but still read the per-frame delta
against the drag-start snapshot, not against the previous frame's override.
Acceptable v1-of-this fallback if time-boxed: snap children on drag-stop only,
and explicitly note the lag as known.

### 12.3 The group node must not mount the standard per-node ResizeControls (M1, M5)
**Challenge:** every resizable renderer mounts `<ResizeControls>`
(`rectangle-node.tsx:138`, `geometric-node.tsx:558`) which drives xyflow's
`NodeResizeControl` to resize **only that node**. If the group renderer does the
same, the user gets TWO resize mechanisms (the node's own handles that resize
just the box + the overlay's handles that scale children) — confusing and
conflicting.
**Technique:** `group-node.tsx` **omits** `<ResizeControls>`. Group resize is
served exclusively by the overlay (decision #3: the overlay shows for a single
selected group). This keeps one resize path and dodges the L0.2 stable-callback
trap entirely for groups (no `NodeResizeControl` on the group).

### 12.4 z-order is already de-risked — `elevateNodesOnSelect={false}` (M1, M6)
**Finding (good news):** `<ReactFlow elevateNodesOnSelect={false}>` is already set
(`seeflow-canvas.tsx:5205`). v1's worst enter/exit bug was the group's z-index
jumping to 1000 on selection and swallowing child clicks. Because selection no
longer elevates z-index, a **stable low `zIndex` for `type:'group'` nodes holds
even when the group is selected.** Set the group's `zIndex` explicitly in
`buildNode` below members' and it stays put. Still verify with a test, but the
single biggest v1 z-index landmine is structurally absent here.

### 12.5 Overlay must know type, and operate on members for a group (M2, M5)
**Challenge:** `OverlayInputNode` (`selection-resize-overlay.tsx:26-30`) carries
only `{id, position, data:{width,height}}` — **no `type`**. Two consequences:
(a) the "show overlay for a single group" gating needs the type, and (b) when a
**group** is the selection, the overlay must scale the group's **members** (and
the group box), not the single group node.
**Technique:** in `seeflow-canvas.tsx`, build `selectionOverlayNodes` (`:3227`)
so that: for a loose multi-selection it is the selected nodes (with resolved dims
per §12.1); for a single selected group it is the group's **members** resolved
from `childIds` (plus the group itself so its box scales too). Thread an
`isGroupSelection`/`groupId` flag for gating + for the icon's ＋ vs ⊟ state.

### 12.6 Freehand & non-box geometry under scale (M3, M9)
**Challenge:** `scaleNodesWithinRect` scales `position` + `width/height`. A
`freehand` node's geometry lives in `data.points` (`freehand-node.tsx` /
`freehand-geometry.ts`), not width/height — so scaling a group/selection
containing a freehand stroke would reposition it but **not** scale the stroke.
**Technique:** v1-of-this scope decision — freehand nodes **reposition but do not
internally scale** under group/selection resize (document as a known limitation).
If full scaling is wanted later, extend the scale to transform `data.points`. Pin
a test asserting freehand position scales and points are left intact (so the
behavior is intentional, not accidental).

### 12.7 `createNode` id + childIds atomicity (M4)
**Technique:** `NodeCreateInput.id?` is optional — pre-generate the group id
(`node-<uuid>`) so the create payload can carry final `childIds` (member ids,
which already exist) in one call. No second `updateNode` and no parent-before-
child ordering needed (the v1 invariant is gone with `childIds`).

### 12.8 Marquee selection-rect coexistence (M2)
**Technique:** xyflow renders its own `.react-flow__nodesselection` for a
multi-selection (neutralized transparent at `index.css:491`). The overlay draws
its padded rect + handles ON TOP via `ViewportPortal`. Keep the overlay rect
`pointer-events:none` and only the handles/icon interactive so xyflow's
selection-drag (move-all) still works underneath and the overlay never steals a
node click. Already the existing neutralization pattern — just don't regress it.

### 12.9 `childIds` referential integrity → mutation ORDERING (M1, M4, M9)
**Challenge:** every server write re-parses the WHOLE flow against
`ResolvedFlowSchema` and "rejects dangling references" (`operations.ts:680`,
modeled on the connector-existence `superRefine` at `schema.ts:489`/`:807`). If we
add a strict `childIds`-existence `superRefine` (recommended, M1 step 4), then a
two-write operation that transiently leaves a group pointing at a deleted node is
**rejected by the server** mid-batch. `history.batch` makes ONE *undo* entry but
issues N *separate* server writes — so intra-batch ordering is load-bearing,
exactly like v1's "unparent-before-delete".
**Technique / ordering rules:**
- **Delete a member:** `updateNode(groupId, {childIds: minus memberId})` **FIRST**,
  then `deleteNode(memberId)`. Each intermediate flow is valid. The batch inverse
  (reverse order) recreates the member, then restores `childIds` — also valid.
- **Create group:** single `createNode` with `childIds` of *existing* members →
  one valid write (§12.7). No ordering issue.
- **Ungroup:** `deleteNode(groupId)` only; its `childIds` die with it → no dangling
  ref.
- **Member also in a marquee-delete with its group:** if the group is deleted too,
  pruning is moot (dedupe); if only members, prune-first each.
- **Note:** multi-write batches are NOT server-transactional — a mid-batch server
  rejection leaves earlier writes applied; client rollback issues compensating
  writes (same property the existing multi-PATCH resize already has). Keep
  per-write states individually valid so a rejection can't happen in normal flow.

### 12.10 Confirmed host-side wiring (use the real APIs)
Verified so the milestones name the correct primitives instead of inventing them:
- **Atomic undo:** `history.batch(name, fn)` is reachable in the host and already
  used for `'move-nodes'`, `'style-nodes'`, `'delete-selection'`, `'paste'`,
  `'tidy'`, `'create-and-connect'` (`demo-view.tsx:563,708,796,976,1655,1777,
  2073`). Group ops (`'group-create'`, `'ungroup'`, `'group-move'`,
  `'group-resize'`) follow this exact pattern — no new history plumbing.
- **Optimistic overrides:** the host uses the **`usePendingOverrides`** hook
  (`demo-view.tsx:15,246` → `nodePending`) with `pruneAgainst` reconciliation
  against SSE reloads — NOT a bespoke `setNodeOverride`. All milestones that
  "apply optimistic overrides" mean this API.
- **Double-click:** `onNodeDoubleClick` is **NOT wired** today (only
  `onEdgeDoubleClick`, `seeflow-canvas.tsx:5307`) — M6 adds it.
  `zoomOnDoubleClick={false}` (`:5264`) is already set → no zoom conflict.
- **History exposure:** `history` is produced by `wrapAdapterWithHistory`
  (`demo-view.tsx:448`) and its `undo/redo/subscribe/markExternalChange` are
  already consumed — group ops need nothing new here.

### 12.11 Accessibility (carry the existing convention to group affordances)
**Challenge:** this codebase has a consistent a11y convention that new UI is
expected to follow — `aria-label` + `aria-pressed` on icon buttons
(`inspector-toggle.tsx:32-33`, `node-header.tsx:116-117`), `aria-hidden="true"` on
decorative glyphs, `sr-only` titles for screen readers, and `role`/`aria-label`
on regions (`detail-panel.tsx:198`, `:209`, `:217`, `:270`). The group affordances
must match it or they regress accessibility.
**Technique (per milestone):**
- **Overlay create/ungroup icon (M4):** `aria-label="Create group"` /
  `"Ungroup"`, decorative icon `aria-hidden`, Tooltip for the shortcut — mirror
  `inspector-toggle.tsx`.
- **Overlay corner handles (M2):** give each handle an `aria-label`
  (e.g. `"Resize selection"`) and a `cursor`; they're pointer-driven (keyboard
  resize is out of scope, note it explicitly so it's a decision not an omission).
- **Group node (M1/M7):** the group container should expose an accessible name
  from its title — `aria-label={name || 'Group'}` (or an `sr-only` heading like
  DetailPanel's `:270`). The title `InlineEdit` already inherits the
  editable-field a11y.
- **Test:** assert the icon button's `aria-label` toggles ＋↔⊟ with selection and
  that the group exposes an accessible name. Keeps parity with the existing
  a11y-attribute tests.

> **Verification status:** §12.1–12.5, 12.8–12.11 are confirmed against the
> current code (file:line cited). §12.6–12.7 are scoped decisions. Each is now
> referenced from its milestone(s) so no challenge is left implicit.
