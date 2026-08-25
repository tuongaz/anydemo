import { describe, expect, it } from 'bun:test';
import { type StudioEvent, createEventBus } from './events.ts';

describe('createEventBus', () => {
  it('delivers events to subscribers of the same flowId only', () => {
    const bus = createEventBus();
    const aEvents: StudioEvent[] = [];
    const bEvents: StudioEvent[] = [];

    const offA = bus.subscribe('flow-a', (e) => aEvents.push(e));
    const offB = bus.subscribe('flow-b', (e) => bEvents.push(e));

    bus.broadcast({ type: 'flow:reload', flowId: 'flow-a', payload: { valid: true } });
    bus.broadcast({ type: 'flow:reload', flowId: 'flow-b', payload: { valid: false } });

    expect(aEvents).toHaveLength(1);
    expect(bEvents).toHaveLength(1);
    expect(aEvents[0]?.flowId).toBe('flow-a');
    expect(bEvents[0]?.flowId).toBe('flow-b');

    offA();
    offB();
  });

  it('stamps a server-side ts on broadcast', () => {
    const bus = createEventBus();
    let received: StudioEvent | undefined;
    bus.subscribe('x', (e) => {
      received = e;
    });
    const before = Date.now();
    bus.broadcast({ type: 'flow:reload', flowId: 'x', payload: null });
    const after = Date.now();
    expect(received).toBeDefined();
    expect(received?.ts).toBeGreaterThanOrEqual(before);
    expect(received?.ts).toBeLessThanOrEqual(after);
  });

  it('unsubscribe stops further deliveries and tracks subscriberCount', () => {
    const bus = createEventBus();
    let count = 0;
    const off = bus.subscribe('x', () => {
      count++;
    });
    expect(bus.subscriberCount('x')).toBe(1);

    bus.broadcast({ type: 'flow:reload', flowId: 'x', payload: null });
    expect(count).toBe(1);

    off();
    expect(bus.subscriberCount('x')).toBe(0);

    bus.broadcast({ type: 'flow:reload', flowId: 'x', payload: null });
    expect(count).toBe(1);
  });

  it('a throwing subscriber does not block others', () => {
    const bus = createEventBus();
    let bSawIt = false;
    bus.subscribe('x', () => {
      throw new Error('boom');
    });
    bus.subscribe('x', () => {
      bSawIt = true;
    });
    bus.broadcast({ type: 'flow:reload', flowId: 'x', payload: null });
    expect(bSawIt).toBe(true);
  });
});
