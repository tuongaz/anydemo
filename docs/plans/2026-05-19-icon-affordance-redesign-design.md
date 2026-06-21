# Icon affordance redesign — @seeflow/canvas

**Date:** 2026-05-19
**Scope:** `packages/canvas/` — icon selection UX for playNode / stateNode and the DetailPanel sidebar.

## Problem

Today's icon picker UX is cumbersome:

- The icon on a node header is purely visual — there is no way to change it from the canvas.
- To change or clear an icon, the user must open the sidebar, scroll past Status/Description, find a separate "Icon" row, click a popover trigger, then optionally hit a second "Clear" button.
- The sidebar's Icon row is visually disconnected from the node title it modifies.
- htmlNode's icon-in-footer mode adds a third presentation pattern with no editing path.

## Goals

- Make icon selection feel direct: clicking the icon where it lives changes it.
- Collapse the sidebar's Icon affordance into the title row.
- Unify removal into the picker itself (no separate Clear button).
- Strip icon support from htmlNode (the only node type whose icon presentation didn't fit either the new pattern or the old one).

## Behavior contract

### On-node icon (playNode, stateNode)

| State | Render |
|---|---|
| `data.icon` set + node selected + `data.onIconChange` wired + not locked | Icon wrapped in `<button>`, hover ring, click opens `IconPickerPopover` anchored to icon |
| `data.icon` set + any other condition | Plain `<Icon>` (identical to today) |
| `data.icon` unset | Nothing rendered (no ghost affordance on the node) |

Adding an icon to a node that has none is **sidebar-only**.

### Sidebar (DetailPanel)

- The standalone `IconRow` component is removed from the content body.
- A new `TitleIconTrigger` sits **left of the title** inside the `SheetTitle` row:
  - `data.icon` set → renders the icon, click opens picker.
  - `data.icon` unset → renders a faint dashed-circle placeholder with an `ImagePlus` glyph, click opens picker.
- Gating: `supportsIconField` matches **only** `playNode` and `stateNode` (htmlNode dropped). Trigger is hidden when `onIconChange` is not provided.

### Picker

- `IconPickerPopover.onPick` signature widens from `(name: string) => void` to `(name: string | null) => void`.
- A synthetic "No icon" tile renders as the **first tile** in the All-icons grid. Click → `onPick(null)`. Always visible when the search query is empty; hidden during search so results stay pure icon matches.
- The tile uses the `Ban` glyph from lucide, `aria-label="No icon"`, `data-testid="icon-picker-tile-none"`.

### htmlNode

- Icon footer branch is stripped from the renderer. Footer label renders `data.name` only.
- `Icon` import removed from `html-node.tsx` if no other references remain.
- `data.icon` field stays on the on-disk schema (no migration); the canvas simply ignores it for htmlNode.

## Data flow

`onIconChange` already enters the canvas via `SeeflowCanvasProps` (no public API change). It reaches the node renderers through the same per-node `data` merge pattern used by `onNameChange` / `onDescriptionChange` in `seeflow-canvas.tsx` (~line 2491):

```ts
onIconChange: (() => {
  if (!isEditMode) return undefined;
  if (merged.type !== 'playNode' && merged.type !== 'stateNode') return undefined;
  return onIconChange;
})(),
```

Node renderers gate the button wrapper on:

```ts
const iconEditable = !!data.onIconChange && selected && !data.locked;
```

When `iconEditable`, the icon renders inside a `<button>` that opens the popover. Otherwise plain `<Icon>` — byte-identical to today's unselected DOM.

The host's `onIconChange` already accepts `string | null`. Passing `null` (from the No-icon tile) flows through unchanged and removes the icon.

## File inventory

**Modified:**

1. `src/components/icon-picker-popover.tsx` — widen `onPick`, render No-icon tile.
2. `src/components/icon-picker-popover.test.tsx` — tests for No-icon tile (first, emits null, hidden on search).
3. `src/components/detail-panel.tsx` — delete `IconRow`, refactor title row to host `TitleIconTrigger`, drop htmlNode from `supportsIconField`.
4. `src/components/detail-panel.test.tsx` — drop `IconRow` tests; add `TitleIconTrigger` tests.
5. `src/components/seeflow-canvas.tsx` — add `onIconChange` to the per-node merged `data` block (~line 2491).
6. `src/nodes/state-node.tsx` — add `onIconChange` to `StateNodeData`, render icon as button + popover when editable.
7. `src/nodes/state-node.test.tsx` — assertions for editable vs static icon and popover trigger.
8. `src/nodes/play-node.tsx` — mirror state-node changes.
9. `src/nodes/play-node.test.tsx` — mirror state-node tests.
10. `src/nodes/html-node.tsx` — strip icon-in-footer branch.
11. `src/nodes/html-node.test.tsx` — drop/update icon-in-label test.

**Untouched:**

- `src/index.ts` — `onIconChange` already exported on `SeeflowCanvasProps` with the right signature.
- `src/types.ts` — `data.icon` stays on the htmlNode schema (no migration).
- CLAUDE.md hook-shim slot order — no new `useState` in `SeeflowCanvas` body. Popover state lives inside per-node renderers and `TitleIconTrigger`.

## Risks & verification

- **Drag interference.** The on-node icon button must `stopPropagation` on `onMouseDown` / `onPointerDown` so the click doesn't start a node drag. Same pattern as the existing play-button on `play-node.tsx`.
- **DetailPanel close-on-outside.** The sidebar's `onInteractOutside` already exempts `[data-radix-popper-content-wrapper]` clicks (line 163), so the new in-sidebar icon popover stays open while the user interacts with the grid.
- **htmlNode disk drift.** Existing flows with `data.icon` on htmlNode will keep the field on disk but no longer render it. This is intentional — no migration risk, and a future flow can re-introduce icon support without schema work.
- **Hook-shim slot order.** Adding `useState(false)` for popover open inside state-node / play-node does NOT affect the SeeflowCanvas 12-slot order — the rule only applies to `SeeflowCanvas`'s own body. Node tests use a stateless shim that returns the initial value, so order doesn't matter there.

## Out of scope

- Migrating any existing `htmlNode.data.icon` values on disk (we just stop rendering them).
- Changing the icon picker's grid layout, virtualization, search behavior, or Recents tracking.
- Adding new icon affordances on shapeNode / imageNode / iconNode (they own different icon semantics and the user's request doesn't cover them).
