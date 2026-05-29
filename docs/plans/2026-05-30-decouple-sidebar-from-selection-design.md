# Decouple sidebar (DetailPanel) from node selection

**Status:** Design
**Date:** 2026-05-30
**Owner:** tuong
**Scope:** `@seeflow/canvas` (no host edits required)

## Problem

Today, clicking a node selects it AND opens the right-hand `DetailPanel`
sidebar. Selection is also what reveals resize handles and the multi-select
overlay, so the sidebar is unavoidable collateral whenever you're arranging
the canvas. During an arrange session (move, align, resize) the sidebar
flashes in and out of frame, distracting from the geometry work.

## Goal

When the user is arranging the canvas, the sidebar stays out of the way.
When the user wants to inspect a node, opening the sidebar is a deliberate,
discoverable action.

## Non-goals

- No localStorage / cross-session persistence.
- No keyboard shortcut (e.g. `i`) in v1.
- No open/close animation.
- No controlled `inspectorOpen` / `onInspectorOpenChange` props.
- No double-click-to-open shortcut.
- No memory of "last inspected node" across reopens.
- No drag-to-resize sidebar width.
- No inspector for connectors / edges.
- No portal/overlay sidebar mode — keep the existing flex layout.

## Behavior

| Action | Sidebar effect |
|---|---|
| Click node body | Selects (resize handles appear). Sidebar stays closed. |
| Click another node while sidebar open | Contents swap to that node. |
| Click empty canvas / pane (deselect-all) | Sidebar auto-closes. |
| Click toggle button | Toggles open/closed. If a node is selected, opens to that node; else empty-state placeholder. |
| `disableSidebar` host flag | Toggle hidden too — host opt-out unchanged. |
| Click connector / edge | Selects normally (delete, manipulate). No sidebar effect at all. |

**Default:** closed on every page load. No persistence.

**Empty state:** "Select a node to inspect." rendered in
`text-muted-foreground`.

## UI

A new **inspector toggle** button sits in the canvas's top-right chrome
stack, beside the existing `ShareMenu`. Owned by `@seeflow/canvas`.

- 32×32, ghost variant (matches `design/design.html` header buttons).
- Lucide `PanelRightOpen` when closed, `PanelRightClose` when open.
- Tooltip: "Inspector (selected node)" / "Hide inspector".
- Hidden when `disableSidebar` is true or in mini mode (same gate as the
  panel itself).

No animation. Sidebar appears/disappears instantly; xyflow's
`ResizeObserver` repaints the canvas. The sidebar toggle does NOT trigger
`fitView` — the user's pan/zoom is preserved.

## Implementation seams

**1. `packages/canvas/src/seeflow-canvas.tsx`**

- Append `const [sidebarOpen, setSidebarOpen] = useState(false)` as the
  14th `useState` in the body (after `historyState`). Per
  `packages/canvas/CLAUDE.md`'s append-only rule, this preserves every
  existing hook-shim test's `useStateOverrides[N]` slot index.
- Gate the existing `<DetailPanel>` render on `sidebarOpen` AND the
  existing inspector flag.
- Wrap `onPaneClick`:
  ```ts
  onPaneClick={(e) => { setSidebarOpen(false); userOnPaneClick?.(e); }}
  ```
  xyflow fires this on empty-canvas click and Esc.
- Stop threading `selectedConnectorIds[0]` to `<DetailPanel>` — only
  `selectedNodeIds[0]` feeds it now.
- Mount the new `<InspectorToggle>` next to `<ShareMenu>` in the chrome
  stack, gated on the same `flags.showInspector` (or equivalent) check.

**2. `packages/canvas/src/components/inspector-toggle.tsx` (new)**

- Props: `{ open: boolean; onToggle: () => void }`. No internal state.
- Composes `ui/button.tsx` (ghost) + `ui/tooltip.tsx` + lucide icons.

**3. `DetailPanel`**

- Add an empty-state branch at the top: when `selectedNodeId == null`,
  render the one-line placeholder. Existing edit-callback wiring stays
  inert in that branch.

**4. Public API**

- No breaking changes. `disableSidebar` keeps working.
- No new exports.

## Tests

**Unit (added):**

- `packages/canvas/src/components/inspector-toggle.test.tsx` — icon swap on
  `open`, calls `onToggle`, tooltip copy, hidden when disabled.
- `packages/canvas/src/seeflow-canvas.test.tsx` (extend hook-shim suite):
  - Selecting a node does not mount `DetailPanel`.
  - Toggle opens `DetailPanel` for the currently-selected node.
  - Toggle with nothing selected shows the empty-state placeholder.
  - `onPaneClick` closes the panel.
  - Connector-only selection does not feed `DetailPanel`.
  - `disableSidebar` hides toggle AND panel.

The new 14th `useState` slot needs no changes to existing tests — sparse
`useStateOverrides[]` returns `undefined`, so `useState(false)` keeps
`false`. Only new assertions probe slot 14.

**E2E (`apps/studio/e2e/`):**

- New `inspector-toggle.e2e.ts` — click node leaves sidebar absent; click
  toggle shows it; click empty pane hides it again.
- Existing e2e specs that assumed the sidebar opens on node click need a
  `await page.click('[data-testid="inspector-toggle"]')` step inserted.

**Visual baselines (chromium-linux pinned):**

- "Node selected" baselines WILL change (no sidebar in frame). Regenerate
  via `bun run test:it:update-snapshots` and commit only
  `*-chromium-linux.png`.
- Add new baselines for: toggle closed state, toggle open state, open
  with empty placeholder.

## Verification before done

- `bun run typecheck` clean
- `bun test` green
- `bun run test:it` green (integration + e2e + visual)
- Single commit per project norms

## Risks

- **Existing e2e specs that observe the sidebar implicitly.** Mitigation:
  scan `apps/studio/e2e/` for sidebar selectors before implementation;
  patch each spec with a toggle-click step.
- **Visual-baseline churn.** Expected — regeneration is the right move.
  Restrict the regenerated set to specs whose framing genuinely changed.
- **Discoverability of the new toggle.** Mitigation: tooltip + standard
  lucide panel icons; the button is in the top-right corner where users
  already look for canvas chrome.
