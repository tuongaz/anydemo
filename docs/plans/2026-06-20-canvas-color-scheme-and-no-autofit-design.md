# Canvas: theme-adaptive color scheme + no auto-fit on create

Date: 2026-06-20
Scope: `packages/canvas/` (color tokens, node rendering) and `apps/web/` (auto-fit ownership)

## Problem

Three independent improvements to the React Flow canvas:

1. **Auto-fit on node create.** Creating the first node in a flow auto-rearranges
   and hard-zooms onto the node. The view should stay put on create and on
   reload; a flow should only be framed once, on first open.
2. **Color scheme.** Colored nodes currently paint an always-light pastel body
   regardless of canvas dark/light mode. We want a theme-adaptive style: the
   body follows the theme surface (dark card in dark mode, white card in light
   mode), the accent color lives on the border plus a faint header tint. This
   becomes the default look. Reference: the two screenshots (same green-accented
   node in dark and light mode).
3. **No-color border.** Clearing a node's color makes it vanish (transparent
   border). It should keep a neutral gray border instead.

## Decisions (from brainstorming)

- Item 1: **fit once on first open only.** Never fit on node-create; never
  re-fit on reload — the viewport stays where the user left it. Session-only;
  no persistence to storage.
- Item 2: **replace the pastel rendering entirely** with the theme-adaptive
  accent scheme. Accent extent = **border + subtle header tint**; body and text
  follow the theme surface/foreground.
- Item 3: `'none'` keeps a **default gray border**; `'default'` aligns to the
  same neutral.

---

## Item 1 — Stop auto-fit on node create

### Root cause

The canvas "first-open fit" is a one-shot guarded by `didMountFitRef`, but the
late-nodes mount-fit effect (`packages/canvas/src/components/seeflow-canvas.tsx:2217`)
returns early **without consuming the one-shot** while `nodes.length === 0`:

```ts
useEffect(() => {
  if (didMountFitRef.current) return;
  if (!resolvedAutoFitView.onMount) return;
  if (nodes.length === 0) return;          // <-- bails, leaves fit "armed"
  rfInstanceRef.current?.fitView(FIT_VIEW_OPTIONS);
  didMountFitRef.current = true;
}, [nodes, resolvedAutoFitView.onMount]);
```

So opening an **empty** flow leaves the fit armed; it fires the moment the first
node appears → the hard zoom. Non-empty flows fire correctly once on open.

The canvas cannot tell "empty because loading" from "empty because genuinely
empty" from "user just created a node." The host (`demo-view.tsx`) can — it owns
the node state and the `loading`/`detail` load signals.

### Approach — move fit ownership to the host

1. Pass `autoFitView={false}` to `<SeeflowCanvas>` from `demo-view.tsx`. The
   canvas keeps the `autoFitView` feature for embed/mini consumers; the studio
   opts out of canvas-internal auto-fit.
2. Add a `demo-view.tsx` effect keyed on `[flowKey, loading, detail]`:
   - If `flowKey ∈ fittedFlowsRef` → return (never re-fit).
   - If `loading || !detail` → return (wait for initial load to settle).
   - Load settled → add `flowKey` to `fittedFlowsRef` **now**. If
     `demoNodes.length > 0` and the rf instance is ready →
     `rfInstanceRef.current.fitView(FIT_VIEW_OPTIONS)`. If empty → mark only,
     no fit.
3. Race guard: if the rf instance isn't ready when load settles, stash a
   `pendingFitFlowKey` and flush it inside the existing `onRfInit` callback.

`fittedFlowsRef` already exists (`demo-view.tsx:280`); the existing
`isFirstLoad`/`autoFitView={isFirstLoad}` wiring is replaced by this
host-owned effect.

### Result

- Empty flow open → marked framed at open → first create does **not** zoom.
- Existing diagram open → fit once.
- Reload / SSE echo / create → already framed → viewport untouched.

---

## Item 2 — Theme-adaptive accent color scheme

Single source of truth: `packages/canvas/src/lib/color-tokens.ts`
(`colorTokenStyle`). Every renderer and the picker swatches route through it, so
this is almost entirely one file. No renderer changes required.

### Token model change

Collapse each theme from the `(body, header, border)` pastel tuple to a single
saturated **accent** HSL per hue. Target L ≈ 45–50 so the border reads on both
dark and light cards (the current `border` L≈30 is too muddy for dark mode).
Tune exact values against `design/design.html`.

`colorTokenStyle` returns, per kind, for themed tokens:

| kind               | before (pastel)            | after (adaptive)                          |
| ------------------ | -------------------------- | ----------------------------------------- |
| `node`             | border darker, bg pastel   | `borderColor: accent`, `backgroundColor: hsl(var(--card))` |
| `node-header`      | saturated mid bar          | `backgroundColor: hsla(accent, ~0.12)` (translucent over card) |
| `node-header-text` | fixed dark/light per theme | `{}` (inherit theme foreground)           |
| `node-body-text`   | fixed dark                 | `{}` (inherit `--muted-foreground`)       |
| `edge` / `text` / swatch | accent               | accent (unchanged — picker + connectors stay vivid) |

The translucent header tint over the `--card` body adapts to dark/light for
free from one definition (light tint in light mode, dark tint in dark mode).

### Special cases

- **`white`** stays special: forced white body in both modes → keeps explicit
  dark header text and dark body text.
- This deletes the `TEXT_ON_LIGHT/DARK` + `BODY_TEXT_ON_LIGHT` machinery for
  themed tokens; only `white` still needs fixed dark text. The per-theme
  `text: 'light' | 'dark'` flag becomes unused for themed tokens (optional
  cleanup).
- Existing on-disk demos with color tokens re-render in the new style
  automatically — no migration.

### API stability

`colorTokenStyle` is exported from `index.ts` and consumed by `apps/web`.
Signature and overloads stay identical; only return values change. Non-breaking.

---

## Item 3 — No-color keeps a gray border

In `colorTokenStyle`, the `'none'` → `'node'` branch:

- `borderColor: 'hsl(var(--border))'` (neutral gray, mode-adaptive)
- `backgroundColor: 'transparent'` (unchanged — "no fill" still means no fill)

Header/edge stay transparent.

Align `'default'`: point its border at the same `hsl(var(--border))` (today
`hsl(var(--primary))`, which can be a loud brand color). Body `hsl(var(--card))`,
header `hsl(var(--muted))`. Default and none then read as the same neutral card,
none being fill-less.

---

## Testing

- **Unit (`color-tokens.test.ts`):** `'none'`/`'default'` node border =
  `hsl(var(--border))`; themed `node` bg = `hsl(var(--card))`; `node-header` =
  translucent accent; header/body text inherit (`{}`); `white` keeps dark text.
- **Unit (demo-view fit logic):** empty flow open → no fit on first create;
  non-empty open → one fit; reload → no re-fit.
- **Visual baselines:** regenerate chromium-linux snapshots for node renderers
  in **both** light and dark (`bun run test:it:update-snapshots`); commit only
  `*-chromium-linux.png`.
- **Gates:** `bun run typecheck`; `bun run format` then `bun run lint`;
  `bun test`.

## Out of scope (YAGNI)

- No per-node "filled vs outlined" toggle.
- No new schema fields.
- No viewport persistence to storage (session-only first-open fit is enough).
