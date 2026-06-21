# Milestone 7 — Group styling, title, and sidebar content

**Status:** Not started · **Depends on:** M1, M4 · **Risk:** Low (mostly reuse)

## Previous milestone — summary

M6 added double-click enter/exit isolation so individual members can be selected,
moved, and renamed inside a group, with one documented exit set.

## Lessons carried forward

- **From M6 handoff (actionable subset):**
  - **Title-edit vs group-enter dblclick — the M7 disambiguation is REAL and is
    yours to wire.** M6 enters isolation on `onNodeDoubleClick` when
    `node.type==='group'` (wired on `<ReactFlow>`). M7 step 1 wires the group
    title's inline edit via `onNameChange` on `NodeHeader`. A double-click on the
    title bubbles up to `<ReactFlow>`'s `onNodeDoubleClick` and would ALSO enter
    isolation. **Fix:** the title's dblclick-to-edit path must `stopPropagation()`
    on the dblclick so it never reaches the node-level enter handler (the design
    §7 guardrail "dblclick on title = edit; dblclick on body = enter"). Verify the
    M6 regression test ("dblclick body still enters") stays green after wiring it.
  - **`GroupNodeRuntimeData.active` already exists** (M6) — true only for the
    entered group; when active the renderer makes the fill `pointer-events:none`,
    paints an outline ring, and re-enables pointer-events on the
    `group-node-titlebar` wrapper. **M7 styling must not clobber this:** the M7
    title-band / background work composes ON TOP of the active-state styles. The
    title band already has a dedicated wrapper (`data-testid="group-node-titlebar"`,
    `display:contents` when inactive) — reuse it; don't add a competing one.
  - **Isolation render-props are applied in `displayNodes`, NOT `buildNode`.**
    `buildNode`/`sourceNodes` sits high in `seeflow-canvas.tsx` and can't read
    state declared at the END of the block (the slot rule pins `activeGroupId`
    there → TDZ). M6 added a `displayNodes = useMemo(overlay(rfNodes,
    activeGroupId))` AFTER the state and feeds `<ReactFlow nodes={displayNodes}>`.
    If M7 needs any late-state value on the rendered group, follow that pattern.
  - **`isMemberOfGroup(nodes, activeGroupId, nodeId)`** is a new pure export in
    `group-ops.ts` (null-safe; a group is not its own member). Reuse it if M7
    needs member/non-member logic; don't re-derive from `childIds` inline.
- The group reuses `NodeVisualBaseShape` + `NodeSemanticBaseShape`, so StyleStrip
  and DetailPanel can drive it with minimal changes (research confirmed).
- StyleStrip excludes `icon`/`freehand` from shared controls; a group is a
  "visual" node → it hits the default branch (`style-strip.tsx:739`) for free.

## Goal

Let users change a group's **title**, **background/border** (and corner/shadow/
font), and **sidebar content** (description + detail markdown) — req #5.

**User-testable outcome:** Select a group → the StyleStrip changes its
background/border/corners/shadow; the DetailPanel sidebar edits its title,
description, and detail markdown; the title is also inline-editable on the group
itself.

## Scope

**In:** wire group `type` into DetailPanel field-gating + StyleStrip default
branch; inline title edit on the group header (M1 rendered it read-only); ensure
the style/name/detail callbacks reach a group selection.

**Out:** connectors (M8); export/persistence verification (M9, though styling
persists via the normal patch path).

## Implementation steps

1. **Inline title (on-canvas):** in `group-node.tsx`, pass `onNameChange` into the
   `NodeHeader` so double-click on the title inline-edits it (M1 left it
   read-only). Use `commitMode="blur-only"` like other headers
   (`node-header.tsx:156`). Wire `onNameChange` through `buildNode` data (it's
   already threaded for other nodes).
2. **StyleStrip:** confirm a selected group flows into `visualNodes`
   (`style-strip.tsx:238`) and the default branch (`:739`). Since the group
   carries the standard visual fields, `onStyleNode`/`onStyleNodes` (and the
   `*Preview` variants for live slider drag) apply with **zero StyleStrip
   changes** — but verify the type isn't excluded like `icon`/`freehand`
   (`:246-260`). Add `'group'` to the allowed set if needed.
3. **DetailPanel (sidebar):** make a selected group fall into the populated-node
   branch (`detail-panel.tsx:224`). Add `'group'` to `showNameField`
   (`detail-panel.tsx:131`) and decide on `supportsIconField` (`:137-140`) — a
   group title icon is nice-to-have; include it. Name/description/detail edit via
   `EditableField` reuse the existing `onNameChange`/`onDescriptionChange`/
   `onDetailChange` callbacks (already threaded `seeflow-canvas.tsx:5826-5829`).
4. **Detail markdown** renders via the existing react-markdown + mermaid path
   (`detail-panel.tsx:300-310`) — no new code.
5. **Title band layout:** ensure the title bar sits in the group's top padding
   band and doesn't overlap members (the `titleBandPx` from `computeGroupBox`,
   M4). Adjust `group-node.tsx` layout so chrome (title + border) stays clear of
   member footprints.
6. **A11y (design §12.11):** the group container exposes an accessible name from
   its title — `aria-label={name || 'Group'}` or an `sr-only` heading (mirror
   `detail-panel.tsx:270`). Add a test asserting the group has an accessible name.

## Guardrails
- Reuse, don't fork: no new style/sidebar components. Just type-gating + wiring.
- Title edit must NOT trigger group enter (dblclick on title = edit; dblclick on
  body = enter, M6). Disambiguate by target.
- Styling changes persist via the standard `updateNode` patch (already covered).

## Tests
- **Component:** DetailPanel renders Name/Description/Detail for a selected group
  and calls the right callbacks; StyleStrip default branch applies bg/border/
  corner/shadow/font to a group; group not in the icon/freehand exclusion.
- **Component:** `group-node` inline title edit commits via `onNameChange`;
  dblclick on title edits (does not enter), dblclick on body enters (M6 regress).
- **Integration:** style + rename + detail a group, reload → all persisted.

## User Acceptance Test (manual)
1. Select a group → StyleStrip: set background slate, border red dashed, corners
   16, shadow 3 → group updates live.
2. Open the sidebar → edit Title to "Payments", add a Description and a Detail
   markdown block (incl. a list and a `mermaid` diagram) → renders in sidebar.
3. Double-click the group's title on canvas → inline-edit it → blur commits.
   Double-click the group body (not title) → enters isolation (M6 still works).
4. Reload → all styling, title, and detail persist.

## Definition of Done
- Gates green; component + integration pass.
- Title (inline + sidebar), bg/border/corner/shadow/font, and detail markdown all
  work and persist; title-edit vs enter disambiguated.
- Lessons handoff filled in.

## Lessons-learned handoff (FILL THIS IN BEFORE MARKING DONE)
- Did StyleStrip need a type allow-list edit, or did the group flow through
  untouched? Note the exact change.
- Any title-edit vs group-enter dblclick conflict? How disambiguated?
- **➡ Copy into `08-...md`.**
