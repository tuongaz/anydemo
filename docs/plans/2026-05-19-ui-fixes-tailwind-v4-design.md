# UI Fixes — Tailwind v4 Conflict + Visual Polish — Design

**Status:** ready for implementation
**Date:** 2026-05-19
**Scope:** `packages/canvas` + `apps/web`. Single PR.

## Why

Six visible regressions accumulated after the v3 → v4 Tailwind migration:

1. CreateProjectDialog renders un-centered with unstyled buttons.
2. Connector labels disappear into the canvas (background matches canvas).
3. Node body text is too bright (`text-foreground` ≈ 98% white).
4. SidePanel reads as a flat slab — no hierarchy between header, description, detail.
5. App header has a harsh light separator the user finds ugly.
6. Toolbar shape buttons appear unresponsive when clicked.

(1) and (6) need runtime confirmation. (2)–(5) are deterministic visual polish.

## Diagnosis path for (1) — Dialog bug

The studio header sits outside any `.seeflow-canvas-root`. The Radix Portal
inside `<Dialog>` uses `useCanvasPortalContainer()`, which returns `undefined`
when no provider is mounted → dialog lands on `document.body`.

Symptoms in the screenshot suggest classes resolve as-if `--tw-translate-x`
and `--tw-translate-y` are never set, and `<Button variant="default">` never
applies `background-color`. Both rules exist in `dist/style.css`:

```css
.sf\:translate-x-\[-50\%\]{--tw-translate-x:-50%;translate:var(--tw-translate-x) var(--tw-translate-y)}
.sf\:bg-primary{background-color:hsl(var(--primary))}
.sf\:h-9{height:calc(var(--sf-spacing) * 9)}
.sf\:px-4{padding-inline:calc(var(--sf-spacing) * 4)}
```

`--sf-spacing: .25rem` is registered on `:root,:host` by the canvas CSS, so
those references work globally.

`--primary: 160 84% 39.4%` is in BOTH:
- `apps/web/src/index.css :root { --primary: ... }`
- `packages/canvas/src/styles/index.css .seeflow-canvas-root { --primary: ... }`

So `hsl(var(--primary))` resolves on `document.body`. The bug is therefore
NOT token-scoping. Most likely candidate: a `@layer properties` collision
between the two Tailwind v4 instances, or a residual `@property` registration
that locks `--tw-translate-x` to its initial value.

Concrete step: open dev server, inspect `[data-testid="create-project-dialog"]`
in DevTools, read computed values for `translate`, `--tw-translate-x`,
`background-color`, `height`, `padding-inline` on the dialog and submit
button. The data narrows it to one of three fixes:

- **A — wrap `.seeflow-canvas-root`:** Put the studio inside the canvas
  scope. Tokens, class semantics, and event behavior all align. One-line
  change in `App.tsx`. Risk: studio chrome currently uses unprefixed
  Tailwind referencing `:root` tokens; tokens are mirrored, so visual delta
  should be zero.
- **B — re-render dialog without canvas wrappers:** Inline a small
  unprefixed-Tailwind dialog in `apps/web`. Sidesteps the bug but doesn't
  cure the class.
- **C — fix the upstream Tailwind v4 conflict:** If diagnosis points to a
  `@property` registration issue, the fix may be to load one Tailwind via
  `@reference` or to declare canvas's CSS first in import order.

Default recommendation: **A**, unless diagnosis surfaces a deeper conflict
that needs C.

## File-by-file changes (post-diagnosis)

### `apps/web`

```
src/App.tsx
  Wrap the layout div with `seeflow-canvas-root` class + data-mode attr
  so canvas's prefixed utilities + Radix portals get the right scope.

src/components/header.tsx
  Remove `border-b border-border`. Replace with subtle elevation:
  `bg-card/60 backdrop-blur shadow-[0_1px_0_0_hsl(var(--border)/0.4)]`.
```

### `packages/canvas`

```
src/edges/editable-edge.tsx
  Connector label: bg-background → bg-card, shadow-sm → shadow-md.
  Same change for the "+ Add label" placeholder pill.

src/components/detail-panel.tsx
  - Title row: text-base font-semibold tracking-tight.
  - EditableField body text (detail field): text-foreground → text-foreground/85.
  - Add a small section label row above Description and Detail
    (uppercase tracking-widest text-[10px] muted) for hierarchy.
  - StatusSection date stamp: keep muted.

src/components/canvas-toolbar.tsx
  Active state: sf:bg-primary/10 → sf:bg-primary/20 sf:ring-1 sf:ring-primary/50.
  If clicks genuinely don't reach the button (e.g. pointer-events from
  parent overlay), diagnose during dev-server pass; out-of-scope for this
  design until confirmed.

src/nodes/play-node.tsx
src/nodes/state-node.tsx
src/nodes/html-node.tsx
  Body text wrappers: text-foreground → text-foreground/85.
  Titles stay full-white for hierarchy.
```

### `packages/canvas/src/styles/index.css`

Optional: introduce `--foreground-soft: 0 0% 88%` on `.seeflow-canvas-root`
for future "less-white-than-foreground" use cases. Mirror into
`apps/web/src/index.css :root` for consistency. Skip if `/85` opacity
suffices.

## Verification

1. `bun run --filter @seeflow/canvas build` after canvas edits.
2. `bun run dev`, open <http://localhost:5173/>:
   - Click "Create new project" → dialog centered + emerald submit button.
   - Open any flow → click a shape in left toolbar → active state visible.
   - Click a connector label → bg + shadow visible.
   - Select a node → soft body text, hierarchical sidebar.
   - Check header: no harsh white line.
3. `bun test` from repo root.
4. `bun run typecheck`.

## Risks

- Wrapping App in `.seeflow-canvas-root` may shift styling for studio chrome
  (header, project switcher). Tokens mirror, so should be cosmetically
  identical. Visually verify after the wrap.
- If (6) is a real event-blocking bug rather than weak visual feedback,
  scope expands — handle in a follow-up if it's non-trivial.

## Out of scope

- Token consolidation between canvas and web app (separate decision).
- Deeper accessibility audit on the new color contrasts.
