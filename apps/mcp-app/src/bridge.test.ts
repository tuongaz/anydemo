import { describe, expect, it } from 'bun:test';
import {
  COALESCE_WINDOW_MS,
  CONTEXT_DEBOUNCE_MS,
  CONTEXT_THROTTLE_MS,
  createBridge,
} from './bridge.ts';

/** Deterministic timer + clock harness (mirrors packages/canvas/src/lib/debounce.test.ts). */
const createFakeTimers = () => {
  let now = 0;
  let nextId = 1;
  type Pending = { id: number; runAt: number; fn: () => void };
  const pending = new Map<number, Pending>();
  const setTimer = (fn: () => void, ms: number) => {
    const id = nextId++;
    pending.set(id, { id, runAt: now + ms, fn });
    return id;
  };
  const clearTimer = (handle: unknown) => {
    pending.delete(handle as number);
  };
  const advance = (ms: number) => {
    const target = now + ms;
    while (true) {
      const due = Array.from(pending.values())
        .filter((p) => p.runAt <= target)
        .sort((a, b) => a.runAt - b.runAt);
      if (due.length === 0) break;
      const next = due[0];
      if (!next) break;
      now = next.runAt;
      pending.delete(next.id);
      next.fn();
    }
    now = target;
  };
  return { setTimer, clearTimer, advance, getNow: () => now };
};

type Recorded = {
  sendMessage: unknown[];
  updateModelContext: unknown[];
};

const makeHost = () => {
  const recorded: Recorded = { sendMessage: [], updateModelContext: [] };
  const host = {
    sendMessage: (payload: unknown) => {
      recorded.sendMessage.push(payload);
    },
    updateModelContext: (patch: unknown) => {
      recorded.updateModelContext.push(patch);
    },
  };
  return { host, recorded };
};

describe('createBridge — sendMessage coalescing', () => {
  it('collapses bursts within the 200ms window into one sendMessage with all events', () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });

    bridge.sendMessage({
      event: 'node-added',
      projectSlug: 'demo-project',
      flowSlug: 'demo',
      payload: { id: 'a' },
    });
    timers.advance(50);
    bridge.sendMessage({
      event: 'node-added',
      projectSlug: 'demo-project',
      flowSlug: 'demo',
      payload: { id: 'b' },
    });
    timers.advance(50);
    bridge.sendMessage({
      event: 'connector-added',
      projectSlug: 'demo-project',
      flowSlug: 'demo',
      payload: { id: 'c' },
    });

    // Still inside the 200ms window — nothing flushed yet.
    expect(recorded.sendMessage).toHaveLength(0);

    timers.advance(COALESCE_WINDOW_MS);
    expect(recorded.sendMessage).toHaveLength(1);
    expect(recorded.sendMessage[0]).toEqual({
      events: [
        {
          event: 'node-added',
          projectSlug: 'demo-project',
          flowSlug: 'demo',
          payload: { id: 'a' },
        },
        {
          event: 'node-added',
          projectSlug: 'demo-project',
          flowSlug: 'demo',
          payload: { id: 'b' },
        },
        {
          event: 'connector-added',
          projectSlug: 'demo-project',
          flowSlug: 'demo',
          payload: { id: 'c' },
        },
      ],
    });
  });

  it('starts a fresh coalesce window after the previous flush', () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });

    bridge.sendMessage({ event: 'one' });
    timers.advance(COALESCE_WINDOW_MS);
    expect(recorded.sendMessage).toHaveLength(1);

    bridge.sendMessage({ event: 'two' });
    bridge.sendMessage({ event: 'three' });
    timers.advance(COALESCE_WINDOW_MS);

    expect(recorded.sendMessage).toHaveLength(2);
    expect(recorded.sendMessage[1]).toEqual({ events: [{ event: 'two' }, { event: 'three' }] });
  });
});

describe('createBridge — updateModelContext debounce', () => {
  it('fires once 250ms after the last call (trailing edge)', () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });

    // 5 calls at t=0,50,100,150,200; last call → debounce fires at t=450.
    for (let i = 0; i < 5; i++) {
      bridge.updateModelContext({ tick: i });
      timers.advance(50);
    }
    // After loop, t=250 — 200ms still left in the debounce window since last call.
    expect(recorded.updateModelContext).toHaveLength(0);

    timers.advance(199); // t=449
    expect(recorded.updateModelContext).toHaveLength(0);

    timers.advance(1); // t=450
    expect(recorded.updateModelContext).toHaveLength(1);
    // Latest patch wins via shallow merge — all keys present, last value kept.
    expect(recorded.updateModelContext[0]).toEqual({ tick: 4 });
  });

  it('merges accumulated patches across the debounce window', () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });

    bridge.updateModelContext({ selectedNodeId: 'a' });
    timers.advance(50);
    bridge.updateModelContext({ hoveredNodeId: 'b' });
    timers.advance(50);
    bridge.updateModelContext({ viewport: { x: 1, y: 2, zoom: 1 } });
    timers.advance(CONTEXT_DEBOUNCE_MS);

    expect(recorded.updateModelContext).toHaveLength(1);
    expect(recorded.updateModelContext[0]).toEqual({
      selectedNodeId: 'a',
      hoveredNodeId: 'b',
      viewport: { x: 1, y: 2, zoom: 1 },
    });
  });
});

describe('createBridge — updateModelContext throttle', () => {
  it('caps fires at one per 1000ms even when debounce would fire sooner', () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });

    // First fire at t=250.
    bridge.updateModelContext({ v: 1 });
    timers.advance(CONTEXT_DEBOUNCE_MS);
    expect(recorded.updateModelContext).toHaveLength(1);
    expect(recorded.updateModelContext[0]).toEqual({ v: 1 });

    // Second call at t=300 — debounce alone would fire at t=550, but throttle
    // must hold until t=1250 (1000ms after first fire).
    bridge.updateModelContext({ v: 2 });
    timers.advance(CONTEXT_DEBOUNCE_MS);
    expect(recorded.updateModelContext).toHaveLength(1); // still throttled

    // Advance to just before the throttle releases.
    timers.advance(CONTEXT_THROTTLE_MS - CONTEXT_DEBOUNCE_MS - 1);
    expect(recorded.updateModelContext).toHaveLength(1);

    timers.advance(1);
    expect(recorded.updateModelContext).toHaveLength(2);
    expect(recorded.updateModelContext[1]).toEqual({ v: 2 });
  });

  it('caps fires across multiple debounce-fire-burst cycles', () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });

    // Three short bursts, each separated by a full debounce window. Without
    // throttling we'd see 3 fires close together; with the 1s throttle the 2nd
    // and 3rd are held until the 1s window has elapsed since the previous fire.
    const fireCountAfter = (ms: number) => {
      timers.advance(ms);
      return recorded.updateModelContext.length;
    };

    bridge.updateModelContext({ burst: 1 });
    expect(fireCountAfter(CONTEXT_DEBOUNCE_MS)).toBe(1);

    bridge.updateModelContext({ burst: 2 });
    // 250ms into the debounce window of burst 2 — throttle still holding.
    expect(fireCountAfter(CONTEXT_DEBOUNCE_MS)).toBe(1);
    // Advance to just past 1s since burst 1's fire — throttle releases.
    expect(fireCountAfter(CONTEXT_THROTTLE_MS - CONTEXT_DEBOUNCE_MS)).toBe(2);

    bridge.updateModelContext({ burst: 3 });
    expect(fireCountAfter(CONTEXT_DEBOUNCE_MS)).toBe(2); // throttle holding
    expect(fireCountAfter(CONTEXT_THROTTLE_MS - CONTEXT_DEBOUNCE_MS)).toBe(3);
  });
});

describe('createBridge — no host', () => {
  it('returns silently from sendMessage when window.openai is undefined', () => {
    const timers = createFakeTimers();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => undefined,
    });

    expect(() => bridge.sendMessage({ event: 'node-added' })).not.toThrow();
    timers.advance(COALESCE_WINDOW_MS);
    // Nothing scheduled, nothing fired — no observable side effects.
  });

  it('returns silently from updateModelContext when window.openai is undefined', () => {
    const timers = createFakeTimers();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => undefined,
    });

    expect(() => bridge.updateModelContext({ selectedNodeId: 'a' })).not.toThrow();
    timers.advance(CONTEXT_DEBOUNCE_MS + CONTEXT_THROTTLE_MS);
  });

  it('returns silently when host exists but lacks the relevant method', () => {
    const timers = createFakeTimers();
    const partial = {} as Record<string, never>;
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => partial,
    });

    expect(() => bridge.sendMessage({ event: 'node-added' })).not.toThrow();
    expect(() => bridge.updateModelContext({ selectedNodeId: 'a' })).not.toThrow();
    timers.advance(COALESCE_WINDOW_MS + CONTEXT_DEBOUNCE_MS);
  });
});
