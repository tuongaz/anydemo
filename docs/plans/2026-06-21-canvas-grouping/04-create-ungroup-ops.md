# Milestone 4 — Create group / ungroup (ops + icon + context-menu + keyboard)

**Status:** Not started · **Depends on:** M1, M2, M3 · **Risk:** Medium

## Previous milestone — summary

M3 wired the 4 corner handles to proportionally scale the selected nodes against
a **frozen start rect + frozen start node set**, end-only, as one coalesced undo
entry — with a regression test proving no compounding. The overlay chrome (M2)
and group renderer + data model (M1) are in place.

## Lessons carried forward

- **From M3 (resize):** the multi-resize commit reads the **frozen** `startNodes`
  (deep copy at pointer-down), never live `selectedNodes` — search
  `computeFrozenResizeUpdates(startNodes` in `selection-resize-overlay.tsx`. This
  matters to M4 because the overlay's top-right ＋/⊟ icon you add lives in the
  SAME component: do not introduce any read of the live selection into the
  gesture path while wiring the icon.
- **From M3 (host reuse):** the host already exposes the optimistic-override +
  `history.batch(name, fn, { coalesceKey })` pattern (`demo-view.tsx`). `onCreate
  Group` / `onUngroup` follow it exactly — `history.batch('group-create' |
  'ungroup', …)` with optimistic `setNodeOverride` BEFORE the PATCHes, drop
  overrides on rejection. No new history plumbing. End-only / single-batch is the
  norm — one batch ⇒ one undo entry; coalesce is only needed for per-tick bursts.
- **From M3 (xyflow-store test trap, L0.4):** do NOT try to drive the overlay's
  pointer/click handlers through the dispatcher-shim by stubbing `useReactFlow`'s
  store — it re-implements xyflow internals and is brittle. Test the icon's
  decision logic via the pure `group-ops.ts` oracle (`planGroupShortcutAction`)
  and assert the icon's `aria-label`/`onClick` wiring at the render layer; leave
  the live click to the e2e/browser test.
- **L0.3** Membership is `childIds` + absolute positions → create = add a group
  node listing members; ungroup = delete the group node. **No child reparenting,
  no position conversion, no array-ordering invariant** (the v1 simplification).
- **L0.7** New patchable field (`childIds`) was added in M1; verify create/ungroup
  round-trips it.
- v1 lesson: enumerate the ambiguous selection cases up front (`planGroupShortcut
  Action`) — empty / single-loose / mixed group+loose → reasoned no-ops.

## Goal

Turn a selection into a group and back: the top-right overlay icon (req #3),
a right-click context-menu, and ⌘G / ⌘⇧G — all driven by a pure, tested
`group-ops.ts`, each as one atomic undo entry.

**User-testable outcome:** Select 2+ loose nodes → click the ＋ icon (or ⌘G) → a
group appears enclosing them with a default title. Select the group → click the
⊟ icon (or ⌘⇧G, or right-click → Ungroup) → the group dissolves, children stay
exactly put. Undo/redo of either is one step.

## Scope

**In:** `packages/canvas/src/lib/group-ops.ts` (pure) + tests; `onCreateGroup` /
`onUngroup` host callbacks; the overlay top-right icon (＋/⊟); context-menu items;
keyboard chords + command registry; the `history.batch` orchestration in the host.

**Out:** group move (M5), group resize-children (M5), enter/exit (M6), styling UI
(M7), connectors (M8), clipboard/delete-cascade (M9).

## Implementation steps

### A. Pure ops (`packages/canvas/src/lib/group-ops.ts` — NEW)
1. `computeGroupBox(children, padding=12, titleBandPx=28) → {position,width,height}`
   — absolute bbox over members, expanded by padding all sides + extra top band
   for the title. **Resolve member dims via `measured ?? data.width/height ??
   fallback` (design §12.1)** — `data.width/height` alone excludes auto-sized
   nodes and yields a too-small box. The caller (host, has `rfInstance`) supplies
   resolved dims to this pure fn.
2. `selectGroupableSet(nodes, selectedIds) → string[]` — exists, not already a
   member of any group, not itself a group. Require result length ≥ 2.
3. `selectGroupSelection(nodes, selectedIds) → string[]` — selected group ids.
4. `planGroupShortcutAction(nodes, selectedIds) → 'group' | 'ungroup' | {none:reason}`
   — pure ⌘G oracle: 0/1 selected → none; all loose & ≥2 → group; exactly the
   group(s) selected → ungroup; mixed group+loose → none(reason). Exhaustive +
   tested.

### B. Host orchestration (`apps/web/src/pages/demo-view.tsx`)
5. `onCreateGroup(nodeIds)`: filter via `selectGroupableSet`; `computeGroupBox`;
   **pre-generate the group id** (`node-<uuid>`, design §12.7) so the create
   payload carries final `childIds` in ONE call;
   `history.batch('group-create', async () => { await adapter.createNode({id,
   type:'group', position, data:{childIds, name:'Group', width, height,
   ...defaultChrome}}); })`. Set the new group selected after. **No child PATCHes**
   (positions stay absolute). Apply optimistic group insert.
6. `onUngroup(groupId)`: `history.batch('ungroup', async () => { await
   adapter.deleteNode(groupId); })`. Children untouched; reselect them.
7. Ensure z-order: the created group must render behind members (reuse M1's
   mechanism; if zIndex-based, set it in the create payload).

### C. Overlay icon (`selection-resize-overlay.tsx` + `seeflow-canvas.tsx`)
8. Fill the NE-corner icon slot (M2): ＋ "Create group" when the overlay is a
   loose multi-selection; ⊟ "Ungroup" when it's a single group. 32×32 ghost
   button (template `inspector-toggle.tsx` / `play-button.tsx`) + Tooltip showing
   the shortcut. Calls `onCreateGroup`/`onUngroup` host callbacks threaded through
   `seeflow-canvas.tsx` (pattern: `onCopySelection`, `:2059`). **A11y (design
   §12.11):** `aria-label="Create group"`/`"Ungroup"` (toggles with selection),
   decorative icon `aria-hidden`; add a test asserting the label toggles ＋↔⊟.

### D. Context menu (`seeflow-canvas.tsx:5644-5731`)
9. Add "Group" (when ≥2 loose selected) and "Ungroup" (when a group selected)
   `ContextMenuItem`s with `ContextMenuShortcut` hints, following the Copy/Delete
   item pattern.

### E. Keyboard (`packages/canvas/src/lib/keyboard-shortcuts.ts` + `seeflow-canvas.tsx`)
10. Add `'edit.group'` / `'edit.ungroup'` to `CommandId` (`:62-97`) + `COMMANDS`
    (`:125-366`) with `formatShortcut({meta:true,key:'G'})` /
    `{meta:true,shift:true,key:'G'}`, `enabled: ctx.hasSelection`.
11. Add a pure `resolveGroupChord(e, {isEditableActive}) → 'group'|'ungroup'|null`
    beside `resolveClipboardChord` (`:490-518`).
12. Add a keydown shim effect in `seeflow-canvas.tsx` mirroring the clipboard
    effect (`:2736-2753`): read `selectedNodeIds`, run `planGroupShortcutAction`,
    call the right host callback; gated on `flags.enableKeyboard`. **Do not reuse
    ⌘D (Duplicate).**

## Guardrails
- Create/ungroup each = exactly ONE `history.batch` → one undo entry.
- Ungroup does NOT move or mutate children (absolute positions). Verify visually
  children don't shift by even 1px.
- Mixed selections / <2 nodes → reasoned no-op, never a malformed group.

## Tests
- **Unit:** every `group-ops.ts` function incl. `planGroupShortcutAction`'s full
  case matrix (empty, single-loose, all-loose≥2, single-group, multi-group,
  group+loose mixed). `computeGroupBox` padding + title band math.
- **Unit:** `resolveGroupChord` modifier gating; not triggered while editing text.
- **Component:** overlay icon shows ＋ vs ⊟ per selection; context-menu items
  appear per selection; calls the right callback.
- **Host/Integration:** create→one undo entry→Cmd+Z removes group (children
  remain); ungroup→one undo entry→Cmd+Z restores group with same childIds;
  create then reload (persisted childIds correct).

## User Acceptance Test (manual)
1. Marquee 3 nodes → ＋ icon shows top-right → click it → group appears titled
   "Group", enclosing them; the 3 nodes are unchanged in position.
2. Cmd+Z → group gone, nodes remain. Cmd+Shift+Z → group back.
3. Select the group → ⊟ icon shows → click → group gone, children unchanged.
   Cmd+Z → group restored.
4. Marquee 3 nodes → ⌘G → group; select group → ⌘⇧G → ungroup.
5. Right-click a multi-selection → "Group"; right-click a group → "Ungroup".
6. Select 1 node → ⌘G does nothing (reasoned no-op).

## Definition of Done
- Gates green; integration test for persist+undo passes.
- All three entry points (icon, menu, keyboard) work; each op is atomic.
- Children never shift on create/ungroup.
- Lessons handoff filled in.

## Lessons-learned handoff (FILL THIS IN BEFORE MARKING DONE)
- Did `computeGroupBox` use measured dims reliably (vs `data.width/height`)? Note
  the source used (`rfInstance.getInternalNode(id).measured` fallback chain).
- Any optimistic-insert flicker before the SSE reload? How resolved?
- Confirm z-order of a freshly-created group is behind members.
- **➡ Copy into `05-...md`.**
