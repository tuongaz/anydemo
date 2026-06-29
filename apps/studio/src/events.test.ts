import { describe, expect, it } from 'bun:test';
import { type StudioEvent, createEventBus } from './events.ts';

describe('createEventBus', () => {
  it('delivers events to subscribers of the same flowId only', () => {
    const bus = createEventBus();
    const aEvents: StudioEvent[] = [];
    const bEvents: StudioEvent[] = [];

    const offA = bus.subscribe('demo-a', (e) => aEvents.push(e));
    const offB = bus.subscribe('demo-b', (e) => bEvents.push(e));

    bus.broadcast({ type: 'flow:reload', flowId: 'demo-a', payload: { valid: true } });
    bus.broadcast({ type: 'flow:reload', flowId: 'demo-b', payload: { valid: false } });

    expect(aEvents).toHaveLength(1);
    expect(bEvents).toHaveLength(1);
    expect(aEvents[0]?.flowId).toBe('demo-a');
    expect(bEvents[0]?.flowId).toBe('demo-b');

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

describe('event bus tenancy', () => {
  it('keeps subscribers without a tenant id working (back-compat)', () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe('flow-1', (e) => seen.push(e.type));
    bus.broadcast({ type: 'flow:reload', flowId: 'flow-1', payload: {} });
    expect(seen).toEqual(['flow:reload']);
  });

  it('does not deliver across tenants for the same flowId', () => {
    const bus = createEventBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe('flow-1', (e) => a.push(e.type), 'tenant-a');
    bus.subscribe('flow-1', (e) => b.push(e.type), 'tenant-b');
    bus.broadcast({ type: 'flow:reload', flowId: 'flow-1', payload: {}, tenantId: 'tenant-a' });
    expect(a).toEqual(['flow:reload']);
    expect(b).toEqual([]);
  });

  it('counts subscribers per (tenantId, flowId)', () => {
    const bus = createEventBus();
    bus.subscribe('flow-1', () => {}, 'tenant-a');
    expect(bus.subscriberCount('flow-1', 'tenant-a')).toBe(1);
    expect(bus.subscriberCount('flow-1', 'tenant-b')).toBe(0);
    expect(bus.subscriberCount('flow-1')).toBe(0);
  });
});
