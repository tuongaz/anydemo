# Canvas Mouse Glow — Spotlight Over Background Dots

**Date:** 2026-05-21
**Scope:** `packages/canvas/` (every consumer of `<SeeflowCanvas>` inherits the effect).

## Goal

When the mouse moves over the canvas, the background grid dots inside a soft
radial spotlight around the cursor brighten to near-white, falling off to the
existing dim baseline at the spotlight's edge. The spotlight tracks the mouse
1:1 (no easing, no lag, no trail). When the cursor either leaves the canvas
or stops moving for ~1.2s, the spotlight fades to nothing over 800ms. A fresh
mousemove re-arms the idle timer and re-activates the glow (snappy 120ms
fade-in so it lights up immediately under the cursor).

The effect is purely cosmetic — `pointer-events: none`, no React Flow state
change, no interaction with nodes, edges, selection, or pan/zoom. It is on by
default for every consumer; no opt-out flag in v1 (YAGNI — add one only if a
host complains).

## Approach

Two-layer dots with a radial mask:

1. The existing `<Background gap={12} size={0.6} />` continues to render the
   dim baseline dots, panned and zoomed by React Flow.
2. A new sibling component `GlowOverlay` renders an absolutely-positioned
   `<div>` filling the React Flow viewport. Its `background-image` is a brighter
   copy of the same dot pattern (`rgba(255,255,255,0.55)` dots, `12 * zoom` px
   gap). The whole layer is masked by a `radial-gradient(circle 240px at
   var(--mx) var(--my), ...)`, so only the dots inside the spotlight are
   visible. The overlay's `background-position` and `background-size` are
   synced to the React Flow viewport transform so the bright dots stay aligned
   with the dim baseline during pan and zoom.

Rejected alternatives:

- **Single radial overlay with `mix-blend-mode: screen`** — simplest (~15 LOC),
  but `screen` brightens the dark space between dots too, producing a soft
  white fog rather than visibly brighter dots. Doesn't match the reference.
- **HTML Canvas per-dot renderer** — would support per-dot trails and decay,
  but the chosen design is a 1:1-tracking spotlight with no trail, so the
  added complexity buys nothing.

## File map

| Path | Change |
| --- | --- |
| `packages/canvas/src/components/glow-overlay.tsx` | **new**, ~60 LOC |
| `packages/canvas/src/components/glow-overlay.test.tsx` | **new** |
| `packages/canvas/src/components/seeflow-canvas.tsx` | render `<GlowOverlay />` next to `<Background gap={12} size={0.6} />` at line 4218 |
| `packages/canvas/src/styles/index.css` | append `.glow-overlay` CSS scoped under `.seeflow-canvas-root` |
| `apps/studio/playwright/canvas.spec.ts` | extend with two glow assertions |

No new dependencies. No public API changes (no entry in `src/index.ts`,
`GlowOverlay` is internal). No state added to `SeeflowCanvas`, so the
hook-shim `useStateOverrides[N]` ordering constraint from the canvas CLAUDE.md
is not in play.

## Component design

`GlowOverlay` is a small functional component rendered as a sibling of
`<Background>` inside `<ReactFlow>`, following the same embed pattern as
`StoreApiBridge` and `ZoomBridge` (lines 4216-4217 of `seeflow-canvas.tsx`).

```tsx
// packages/canvas/src/components/glow-overlay.tsx
import { useEffect, useRef } from 'react';
import { useStore } from '@xyflow/react';

const SPOTLIGHT_RADIUS_PX = 240;
const BASE_GAP_PX = 12; // must match <Background gap={12}>

export function GlowOverlay() {
  const ref = useRef<HTMLDivElement | null>(null);

  // Viewport-sync subscription. Re-renders ONLY this overlay component when
  // the React Flow transform changes — does not touch the rest of the canvas.
  const transform = useStore(
    (s) => s.transform,
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  );
  const [x, y, zoom] = transform;
  const scaledGap = BASE_GAP_PX * zoom;

  // Mouse listener — bound to .react-flow__pane (the interaction surface,
  // which sits beneath the overlay). The overlay itself is pointer-events:
  // none so it can't receive events directly.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pane = el.parentElement?.querySelector<HTMLElement>(
      '.react-flow__pane',
    );
    if (!pane) return;

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      el.style.setProperty('--my', `${e.clientY - rect.top}px`);
      el.dataset.active = 'true';
    };
    const onLeave = () => {
      el.dataset.active = 'false';
    };

    pane.addEventListener('mousemove', onMove);
    pane.addEventListener('mouseleave', onLeave);
    return () => {
      pane.removeEventListener('mousemove', onMove);
      pane.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="glow-overlay"
      data-active="false"
      data-testid="canvas-glow-overlay"
      style={{
        backgroundPosition: `${x}px ${y}px`,
        backgroundSize: `${scaledGap}px ${scaledGap}px`,
      }}
    />
  );
}
```

### Why no React state for the mouse position

`mousemove` fires up to 120Hz on modern displays. Writing `--mx` / `--my`
directly to the element's `style` via a ref keeps the React tree untouched on
move. The only re-render trigger is the `useStore` viewport subscription, and
its equality function (`(a, b) => a[0] === b[0] && ...`) prevents re-renders
when an unrelated store slice changes.

### Why `data-active` instead of a state flag

Same reason — toggling a data attribute on a ref'd element does not re-render.
The fade-out is driven entirely by the CSS `transition: opacity 400ms`
attached to the `[data-active="false"]` selector.

## CSS

Appended to `packages/canvas/src/styles/index.css`, scoped under
`.seeflow-canvas-root` per the package convention (non-utility globals only
live there, never at `:root`):

```css
.seeflow-canvas-root .glow-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1; /* above <Background>, below nodes (which sit on .react-flow__nodes) */

  background-image: radial-gradient(
    rgba(255, 255, 255, 0.55) 0.6px,
    transparent 1px
  );
  /* background-size + background-position written inline from the viewport
     transform — see GlowOverlay component. */

  --mx: 50%;
  --my: 50%;
  -webkit-mask-image: radial-gradient(
    circle 240px at var(--mx) var(--my),
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.6) 35%,
    rgba(0, 0, 0, 0) 100%
  );
  mask-image: radial-gradient(
    circle 240px at var(--mx) var(--my),
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.6) 35%,
    rgba(0, 0, 0, 0) 100%
  );

  opacity: 0;
  transition: opacity 400ms ease-out;
}
.seeflow-canvas-root .glow-overlay[data-active='true'] {
  opacity: 1;
}
```

Dot size `0.6px` and gap `12px` mirror `<Background gap={12} size={0.6} />`
exactly so the bright dots overlay the dim ones precisely. The bright dot
alpha `0.55` (vs. the dim baseline's much lower alpha) gives the contrast
visible in the reference image.

Tailwind v4 note: this file already has the `sf:` prefix configured for
utility classes; `.glow-overlay` is a global class selector, not a utility, so
no prefix applies (consistent with the existing `.seeflow-canvas-root`
scoping in this file).

## Integration

`seeflow-canvas.tsx` line 4218 changes from:

```tsx
<Background gap={12} size={0.6} />
```

to:

```tsx
<Background gap={12} size={0.6} />
<GlowOverlay />
```

That is the only change to `seeflow-canvas.tsx`. No imports re-arranged
beyond adding `GlowOverlay`. No state. No props.

## Testing

**Unit (`packages/canvas/src/components/glow-overlay.test.tsx`)**

Wrap `<GlowOverlay />` in a minimal `<ReactFlowProvider>` + a host `<div>`
carrying a stub `.react-flow__pane`. Assertions:

1. Renders a `[data-testid="canvas-glow-overlay"]` element with
   `data-active="false"`.
2. Dispatching a `mousemove` on the pane sets `data-active="true"` and writes
   `--mx` / `--my` CSS variables matching the event's `clientX/Y` minus the
   element's bounding rect.
3. Dispatching a `mouseleave` on the pane sets `data-active="false"`.
4. Unmount removes the listeners (assert by spying on `removeEventListener`).

**Playwright (`apps/studio/playwright/canvas.spec.ts` — extends US-013)**

Two new assertions appended to the existing kitchen-sink fixture spec:

1. Move mouse to canvas center → wait for `[data-testid="canvas-glow-overlay"]`
   to have `data-active="true"` and computed `opacity` > 0.9.
2. Move mouse off canvas → after 500ms, computed `opacity` < 0.05.

No new visual baseline PNG — the existing canvas baselines snapshot at a
fixed cursor-out state, so they continue to pass (the overlay's `opacity: 0`
makes it invisible to the snapshot).

**Manual smoke**

```
bun run dev
```

Open the studio, move the mouse around the canvas. Pan with space + drag and
zoom with the scroll wheel; verify the bright dots stay aligned with the dim
dots (the viewport-sync subscription is correct).

## Performance

- `mousemove`: writes two CSS variables via ref. No React reconciliation, no
  layout thrash. Browser-internal cost for mask re-rasterization at 60-120Hz
  with a 240px spotlight is negligible on the GPU.
- `useStore(transform)`: re-renders the overlay component only, and only when
  the transform actually changes. The equality function prevents spurious
  re-renders from unrelated store slice updates.
- Mask rasterization is the dominant per-frame cost. Profiled equivalents
  (radial-gradient masks at this scale) hold 120fps on M-series Macs and
  60fps comfortably on integrated GPUs.

## Out of scope

- Per-dot decay / trailing-glow effect. Decided against in brainstorming —
  the chosen behavior is a 1:1-tracking spotlight.
- Emerald or other brand tinting. The glow is pure white to match the
  reference image; revisit if it ever feels off-brand.
- Touch-device support. Touch events don't generate `mousemove`, so the
  effect is naturally inert on touch — no fallback needed (and a touch
  spotlight chasing the finger would be a different design conversation).
- Opt-out prop. Add a `disableMouseGlow` flag only if a real consumer asks;
  YAGNI in v1.
