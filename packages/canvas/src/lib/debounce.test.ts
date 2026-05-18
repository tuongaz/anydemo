import { describe, expect, it } from 'bun:test';
import { createDebouncer } from './debounce';

/** A simple deterministic timer harness mirroring jest fake timers. */
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
    now += ms;
    const due = Array.from(pending.values()).filter((p) => p.runAt <= now);
    due.sort((a, b) => a.runAt - b.runAt);
    for (const p of due) {
      pending.delete(p.id);
      p.fn();
    }
  };
  return { setTimer, clearTimer, advance, hasPending: () => pending.size > 0 };
};

describe('createDebouncer', () => {
  it('runs the latest callback once after the delay window elapses', () => {
    const timers = createFakeTimers();
    const debouncer = createDebouncer(400, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const calls: string[] = [];
    debouncer.schedule(() => calls.push('a'));
    timers.advance(100);
    debouncer.schedule(() => calls.push('b'));
    timers.advance(100);
    debouncer.schedule(() => calls.push('c'));
    timers.advance(399);
    expect(calls).toEqual([]);
    timers.advance(1);
    expect(calls).toEqual(['c']);
  });

  it('is idle once the callback runs (no pending timer)', () => {
    const timers = createFakeTimers();
    const debouncer = createDebouncer(50, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    debouncer.schedule(() => {});
    expect(debouncer.pending).toBe(true);
    timers.advance(50);
    expect(debouncer.pending).toBe(false);
  });

  it('flush() runs the pending callback synchronously and clears the timer', () => {
    const timers = createFakeTimers();
    const debouncer = createDebouncer(400, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    let calls = 0;
    debouncer.schedule(() => {
      calls++;
    });
    debouncer.flush();
    expect(calls).toBe(1);
    expect(debouncer.pending).toBe(false);
    timers.advance(1000);
    expect(calls).toBe(1);
  });

  it('cancel() drops the pending callback without running it', () => {
    const timers = createFakeTimers();
    const debouncer = createDebouncer(400, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    let calls = 0;
    debouncer.schedule(() => {
      calls++;
    });
    debouncer.cancel();
    timers.advance(1000);
    expect(calls).toBe(0);
    expect(debouncer.pending).toBe(false);
  });

  it('rapid scheduling produces a single callback per pause window', () => {
    const timers = createFakeTimers();
    const debouncer = createDebouncer(300, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    let calls = 0;
    // Burst 1: 5 scheduled within 200ms — only the last runs once at t=350.
    for (let i = 0; i < 5; i++) {
      debouncer.schedule(() => {
        calls++;
      });
      timers.advance(50);
    }
    expect(calls).toBe(0);
    timers.advance(300);
    expect(calls).toBe(1);
    // Burst 2: another batch — should fire once more after its own pause.
    for (let i = 0; i < 3; i++) {
      debouncer.schedule(() => {
        calls++;
      });
      timers.advance(50);
    }
    timers.advance(300);
    expect(calls).toBe(2);
  });
});
