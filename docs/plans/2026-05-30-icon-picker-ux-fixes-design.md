# Icon Picker UX fixes (post-merge cleanup)

Three small fixes to the cloud-icon-packs feature merged in `24e7446`. All
changes are in `@seeflow/canvas`.

## Issue 1 — Vendor tabs always visible

**Today:** `TAB_DEFS` in `packages/canvas/src/components/icon-picker-popover.tsx`
is a fixed array `['lucide', 'aws', 'gcp', 'azure', 'iconify']`. AWS / GCP /
Azure tabs render in every picker, faded with a sibling Download button when
not yet installed.

**Fix:** filter pack vendors out of the rendered tabs when
`ICON_NAMES_BY_VENDOR[vendor].length === 0`. `lucide` and `iconify` always
show. AWS / GCP / Azure appear only after install — `applyPackSummaries` already
mutates `ICON_NAMES_BY_VENDOR` after a successful install, so the tab appears
the same render cycle.

**Collapse:**
- `renderTabButton` always takes the installed branch — drop the install
  branch and the `installed` arg.
- Drop the `installed` flag passed in from the call site.
- Drop the `data-installed` attribute on tabs.
- `renderInstallPrompt` (the empty-state inside a vendor tab grid) becomes
  unreachable — drop it and its call site.

## Issue 2 — `+` button at end of tab bar

**Today:** users reach Browse Packs either (a) by clicking the per-tab Download
icon next to an uninstalled vendor tab — going away in Issue 1 — or (b) via a
`Browse packs` footer button below the icon grid (`showBrowseFooter` prop).

**Fix:** append a `Plus` icon-only button after the last tab in the bar:

- `<button aria-label="Browse packs" data-testid="icon-picker-tab-browse">`
- visual: `sf:h-7 sf:px-2`, `<Plus className="sf:h-3 sf:w-3" />`, same hover
  treatment as inactive tabs
- click handler: existing `setView('browse')` path
- visibility: rendered only when `iconsAdapter !== undefined`
- layout: plain flex child appended at the end (no `sf:ml-auto` push-right)

**Collapse:**
- Drop the `showBrowseFooter` footer block and the `showBrowseFooter` prop on
  `IconPickerBody`.
- Keep the `onBrowsePacks` fallback prop on `IconPickerPopover` so hosts that
  pass it without an adapter still work — the `+` just won't render in that
  case.

## Issue 3 — Install progress toast clipped to a sliver

**Symptom:** click Install in the modal, the install kicks off, but the
progress toast doesn't appear bottom-right of the viewport. Instead a stray
cut-off X icon appears somewhere mid-canvas.

**Root cause:** `<InstallProgressToast>` is wrapped in
`<div className="sf:fixed sf:bottom-4 sf:right-4 …">` rendered as a sibling
of `<Popover>` in the Fragment returned by `IconPickerPopover`. That Fragment
mounts inline at the picker trigger — a node's inline edit-icon button —
which lives inside React Flow's per-node container. xyflow applies a
`transform` to those containers. CSS spec: any ancestor with `transform`
turns `position: fixed` into `position: absolute` relative to that ancestor.
So `bottom-4 right-4` lands at the node's bottom-right corner in canvas
coordinates, gets clipped by the node's overflow, and the user sees only the
close-X sliver.

**Fix:** portal the toast wrapper to `document.body` via `createPortal`. The
toast itself doesn't change — only the host `<div>` moves out of the
transform stack.

```tsx
{jobState && typeof document !== 'undefined'
  ? createPortal(
      <div
        data-testid="icon-picker-install-toast-host"
        className="sf:fixed sf:bottom-4 sf:right-4 sf:z-50 sf:w-[320px]"
      >
        <InstallProgressToast … />
      </div>,
      document.body,
    )
  : null}
```

**Why body, not `useCanvasPortalContainer()`:** the canvas portal container
lives inside `.seeflow-canvas-root`, which is itself often a transformed
ancestor in host layouts. Body is the only guaranteed-untransformed anchor.

**Modal is fine.** `<InstallPackModal>` uses Radix `<Dialog>`, whose
`<DialogContent>` portals via Radix's portal slot already threaded to the
canvas portal container. The modal opens at the right place — only the toast
is broken.

## Test impact

- Existing tab-rendering tests in `icon-picker-popover.test.tsx` lose their
  `installed=false` branches.
- New test: `+` button renders when `iconsAdapter` is provided, doesn't when
  it isn't. Click on `+` switches view to browse.
- New test: install-toast host renders into `document.body` (assert via
  `document.body.querySelector('[data-testid="icon-picker-install-toast-host"]')`).
- Hook-shim slot order is unchanged — no `useState` added or removed.

## Commit plan

Per the user's "one commit per fix" memory, three commits to `main`:

1. `fix(canvas): hide AWS/GCP/Azure picker tabs until installed`
2. `fix(canvas): add + button to icon picker tab bar for Browse Packs`
3. `fix(canvas): portal install-progress toast to body to escape RF transform`

Gate on `bun test` + `bun run test:it` green before push.
