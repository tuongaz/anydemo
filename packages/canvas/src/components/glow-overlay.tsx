import { useStore } from '@xyflow/react';
import { useEffect, useRef } from 'react';

const BASE_GAP_PX = 12;
const DEFAULT_IDLE_FADE_MS = 1200;

/**
 * Minimal DOM shape the glow handlers need. Widened from `HTMLElement` so
 * `glow-overlay.test.tsx` can hand in a plain object without spinning up a
 * DOM (Bun tests in this package run without jsdom — see
 * `inline-edit.test.tsx`).
 */
export interface GlowOverlayTarget {
  getBoundingClientRect: () => { left: number; top: number };
  style: { setProperty: (name: string, value: string) => void };
  dataset: { active?: string };
}

/** Pure factory for the mousemove / mouseleave handlers. Extracted so the
 * logic is unit-testable without a React render or the React Flow store.
 *
 * Idle behavior: every `onMove` (re)arms a `setTimeout(idleMs)`. When the
 * timer fires (no further moves within the window), `data-active` flips to
 * `'false'` and the CSS opacity transition fades the glow out. The next move
 * cancels any pending timer and re-activates the overlay (CSS smooths the
 * fade-in symmetrically). `dispose()` clears any pending timer — the
 * component effect calls it on cleanup so unmounting never leaks a timer.
 */
export function createGlowHandlers(el: GlowOverlayTarget, opts: { idleMs?: number } = {}) {
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_FADE_MS;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const clearIdle = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };
  const onMove = (e: { clientX: number; clientY: number }) => {
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
    el.dataset.active = 'true';
    clearIdle();
    idleTimer = setTimeout(() => {
      el.dataset.active = 'false';
      idleTimer = undefined;
    }, idleMs);
  };
  const onLeave = () => {
    clearIdle();
    el.dataset.active = 'false';
  };
  return { onMove, onLeave, dispose: clearIdle };
}

/**
 * Cursor-tracking glow overlay. Renders an absolutely-positioned layer of
 * bright dots aligned with the React Flow `<Background gap={12} size={0.6} />`
 * grid, masked by a radial gradient centered on the mouse so only dots near
 * the cursor are revealed. Fades out over 400ms when the cursor leaves the
 * pane (CSS-driven via `[data-active="false"]`).
 *
 * Why no React state for the mouse position: `mousemove` fires up to 120 Hz.
 * `--mx` / `--my` are written directly to the element's `style` via a ref so
 * the React tree never re-renders on move. The only re-render trigger is the
 * `useStore` viewport subscription (pan / zoom), throttled to actual
 * transform changes by the equality function.
 */
export function GlowOverlay() {
  const ref = useRef<HTMLDivElement | null>(null);

  const transform = useStore(
    (s) => s.transform,
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  );
  const [x, y, zoom] = transform;
  const scaledGap = BASE_GAP_PX * zoom;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pane = el.parentElement?.querySelector<HTMLElement>('.react-flow__pane');
    if (!pane) return;

    const { onMove, onLeave, dispose } = createGlowHandlers(el);
    pane.addEventListener('mousemove', onMove);
    pane.addEventListener('mouseleave', onLeave);
    return () => {
      pane.removeEventListener('mousemove', onMove);
      pane.removeEventListener('mouseleave', onLeave);
      dispose();
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
