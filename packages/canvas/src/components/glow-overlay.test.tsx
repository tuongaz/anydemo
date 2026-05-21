import { describe, expect, it } from 'bun:test';
import { type GlowOverlayTarget, createGlowHandlers } from './glow-overlay.tsx';

// Bun runs the canvas tests without a DOM, so we hand the handler factory a
// plain object satisfying `GlowOverlayTarget` instead of a real HTMLElement.
// The component itself (useStore + useEffect + JSX) is covered by the
// Playwright spec in apps/studio/playwright/canvas.spec.ts — these tests lock
// in the pure DOM-write logic that's hard to assert against from e2e.
function makeTarget(rectLeft = 10, rectTop = 20) {
  const styleWrites: Array<[string, string]> = [];
  const dataset: { active?: string } = {};
  const target: GlowOverlayTarget = {
    getBoundingClientRect: () => ({ left: rectLeft, top: rectTop }),
    style: { setProperty: (name, value) => styleWrites.push([name, value]) },
    dataset,
  };
  return { target, styleWrites, dataset };
}

describe('createGlowHandlers', () => {
  it('onMove writes --mx / --my relative to the element rect and activates the overlay', () => {
    const { target, styleWrites, dataset } = makeTarget(10, 20);
    const { onMove } = createGlowHandlers(target);

    onMove({ clientX: 110, clientY: 220 });

    expect(styleWrites).toEqual([
      ['--mx', '100px'],
      ['--my', '200px'],
    ]);
    expect(dataset.active).toBe('true');
  });

  it('onMove re-activates the overlay on every move (recovers from a prior leave)', () => {
    const { target, dataset } = makeTarget();
    const { onMove, onLeave } = createGlowHandlers(target);

    onMove({ clientX: 0, clientY: 0 });
    onLeave();
    expect(dataset.active).toBe('false');

    onMove({ clientX: 5, clientY: 5 });
    expect(dataset.active).toBe('true');
  });

  it('onLeave sets data-active to "false" so the CSS opacity transition runs', () => {
    const { target, dataset } = makeTarget();
    const { onLeave } = createGlowHandlers(target);

    dataset.active = 'true';
    onLeave();
    expect(dataset.active).toBe('false');
  });

  it('handlers do not retain references to one another (independent closures)', () => {
    // Sanity check — onMove and onLeave only close over `el`, not each other.
    // Prevents a future refactor from accidentally coupling them so that
    // removeEventListener can no longer unbind one without the other.
    const { target } = makeTarget();
    const a = createGlowHandlers(target);
    const b = createGlowHandlers(target);
    expect(a.onMove).not.toBe(b.onMove);
    expect(a.onLeave).not.toBe(b.onLeave);
  });

  it('idle timer flips data-active to "false" when no further move arrives within idleMs', async () => {
    const { target, dataset } = makeTarget();
    const { onMove } = createGlowHandlers(target, { idleMs: 10 });

    onMove({ clientX: 0, clientY: 0 });
    expect(dataset.active).toBe('true');

    await new Promise((r) => setTimeout(r, 25));
    expect(dataset.active).toBe('false');
  });

  it('a fresh move re-arms the idle timer instead of letting the previous one fire', async () => {
    const { target, dataset } = makeTarget();
    const { onMove } = createGlowHandlers(target, { idleMs: 20 });

    onMove({ clientX: 0, clientY: 0 });
    await new Promise((r) => setTimeout(r, 10));
    onMove({ clientX: 1, clientY: 1 }); // resets the timer
    await new Promise((r) => setTimeout(r, 15));
    // 25ms after the first move, but only 15ms after the most recent — still
    // within the 20ms idle window, so the overlay must still be active.
    expect(dataset.active).toBe('true');

    await new Promise((r) => setTimeout(r, 15));
    expect(dataset.active).toBe('false');
  });

  it('dispose() cancels a pending idle timer (no late dataset write after unmount)', async () => {
    const { target, dataset } = makeTarget();
    const { onMove, dispose } = createGlowHandlers(target, { idleMs: 10 });

    onMove({ clientX: 0, clientY: 0 });
    expect(dataset.active).toBe('true');

    dispose();
    await new Promise((r) => setTimeout(r, 25));
    // Without dispose() the timer would have set dataset.active to 'false'.
    // Confirming it stays at 'true' proves the cleanup actually cancelled it,
    // which matters because the real component calls dispose() on unmount —
    // a late write after unmount would touch a detached DOM node.
    expect(dataset.active).toBe('true');
  });

  it('onLeave clears a pending idle timer so it cannot fire after leave', async () => {
    const { target, dataset } = makeTarget();
    const { onMove, onLeave } = createGlowHandlers(target, { idleMs: 10 });

    onMove({ clientX: 0, clientY: 0 });
    onLeave();
    expect(dataset.active).toBe('false');

    // Mark active again so we can detect a stray timer firing.
    dataset.active = 'true';
    await new Promise((r) => setTimeout(r, 25));
    expect(dataset.active).toBe('true');
  });
});
