import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { debouncedResizeObserver } from './debounced-resize-observer.ts';

// Test-controlled ResizeObserver: stores fired callbacks so tests can trigger
// them on demand. Each instance keeps its callback for `fire()` invocation.
class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(public cb: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  fire() {
    this.cb([], this as unknown as ResizeObserver);
  }
}

beforeEach(() => {
  TestResizeObserver.instances = [];
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    TestResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  TestResizeObserver.instances = [];
});

describe('debouncedResizeObserver', () => {
  it('calls onSettle once after debounce window expires on a single fire', async () => {
    const el = {} as unknown as Element;
    const onSettle = mock(() => {});
    const cleanup = debouncedResizeObserver(el, 50, onSettle);
    const obs = TestResizeObserver.instances[0];
    if (!obs) throw new Error('expected observer instance');
    expect(obs.observed).toContain(el);

    obs.fire();
    expect(onSettle).toHaveBeenCalledTimes(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(onSettle).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('coalesces multiple fires within the debounce window into one onSettle', async () => {
    const el = {} as unknown as Element;
    const onSettle = mock(() => {});
    const cleanup = debouncedResizeObserver(el, 50, onSettle);
    const obs = TestResizeObserver.instances[0];
    if (!obs) throw new Error('expected observer instance');

    obs.fire();
    await new Promise((r) => setTimeout(r, 10));
    obs.fire();
    await new Promise((r) => setTimeout(r, 10));
    obs.fire();
    expect(onSettle).toHaveBeenCalledTimes(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(onSettle).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('fires onSettle again for a late observer fire after the first settle', async () => {
    const el = {} as unknown as Element;
    const onSettle = mock(() => {});
    const cleanup = debouncedResizeObserver(el, 30, onSettle);
    const obs = TestResizeObserver.instances[0];
    if (!obs) throw new Error('expected observer instance');

    obs.fire();
    await new Promise((r) => setTimeout(r, 50));
    expect(onSettle).toHaveBeenCalledTimes(1);

    // Simulates a late reflow (Tailwind hydration / image load) — second
    // settle expected.
    obs.fire();
    await new Promise((r) => setTimeout(r, 50));
    expect(onSettle).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('cleanup disconnects the observer and prevents pending settle from firing', async () => {
    const el = {} as unknown as Element;
    const onSettle = mock(() => {});
    const cleanup = debouncedResizeObserver(el, 50, onSettle);
    const obs = TestResizeObserver.instances[0];
    if (!obs) throw new Error('expected observer instance');
    obs.fire();
    cleanup();
    expect(obs.disconnected).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(onSettle).toHaveBeenCalledTimes(0);
  });
});
