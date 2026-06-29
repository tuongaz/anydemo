import { describe, expect, it } from 'bun:test';
import type { CanvasAdapter } from '@seeflow/canvas';
import {
  COALESCE_WINDOW_MS,
  CONTEXT_DEBOUNCE_MS,
  CONTEXT_THROTTLE_MS,
  createBridge,
} from './bridge.ts';
import { createTelemetry, wrapAdapter } from './canvas-bridge.ts';

/** Same fake-timer harness used in bridge.test.ts. */
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

/**
 * Synchronous resolved-promise factory — keeps the fake-timer harness in step
 * with adapter promises. `await Promise.resolve()` won't actually advance the
 * fake clock; the structural-edit tests use `await` to walk the queued
 * microtasks and then `timers.advance` for the 200ms coalescer.
 */
const makeBaseAdapter = (overrides: Partial<CanvasAdapter> = {}): CanvasAdapter => ({
  createNode: async ({ type, position }) => ({
    id: `node-${Math.random().toString(36).slice(2, 7)}`,
    node: { id: 'x', type, position },
  }),
  updateNode: async () => {},
  updateNodePosition: async (_, position) => ({ ok: true, position }),
  deleteNode: async () => {},
  reorderNode: async () => {},
  createConnector: async () => ({ id: 'conn-1' }),
  updateConnector: async () => {},
  deleteConnector: async () => {},
  uploadImage: async () => ({ path: 'fake' }),
  ...overrides,
});

describe('wrapAdapter — structural edits emit sendMessage', () => {
  it('createNode → node-added with id, type, position', async () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    const base = makeBaseAdapter({
      createNode: async (input) => ({ id: 'server-id-1', node: { id: 'server-id-1', ...input } }),
    });
    const adapter = wrapAdapter(base, bridge, { projectSlug: 'demo-project', flowSlug: 'demo' });

    await adapter.createNode({
      type: 'rectangle',
      position: { x: 10, y: 20 },
      data: { name: 'A' },
    });
    timers.advance(COALESCE_WINDOW_MS);

    expect(recorded.sendMessage).toHaveLength(1);
    expect(recorded.sendMessage[0]).toEqual({
      events: [
        {
          event: 'node-added',
          projectSlug: 'demo-project',
          flowSlug: 'demo',
          payload: { nodeId: 'server-id-1', type: 'rectangle', position: { x: 10, y: 20 } },
        },
      ],
    });
  });

  it('deleteNode → node-deleted with id', async () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    const adapter = wrapAdapter(makeBaseAdapter(), bridge, {
      projectSlug: 'demo-project',
      flowSlug: 'demo',
    });

    await adapter.deleteNode('node-7');
    timers.advance(COALESCE_WINDOW_MS);

    expect(recorded.sendMessage).toHaveLength(1);
    expect(recorded.sendMessage[0]).toEqual({
      events: [
        {
          event: 'node-deleted',
          projectSlug: 'demo-project',
          flowSlug: 'demo',
          payload: { nodeId: 'node-7' },
        },
      ],
    });
  });

  it('createConnector → connector-added with id + endpoints', async () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    const base = makeBaseAdapter({
      createConnector: async () => ({ id: 'conn-42' }),
    });
    const adapter = wrapAdapter(base, bridge, { projectSlug: 'demo-project', flowSlug: 'demo' });

    await adapter.createConnector({ source: 'a', target: 'b' });
    timers.advance(COALESCE_WINDOW_MS);

    expect(recorded.sendMessage).toHaveLength(1);
    expect(recorded.sendMessage[0]).toEqual({
      events: [
        {
          event: 'connector-added',
          projectSlug: 'demo-project',
          flowSlug: 'demo',
          payload: { connectorId: 'conn-42', source: 'a', target: 'b' },
        },
      ],
    });
  });

  it('deleteConnector → connector-deleted with id', async () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    const adapter = wrapAdapter(makeBaseAdapter(), bridge, {
      projectSlug: 'demo-project',
      flowSlug: 'demo',
    });

    await adapter.deleteConnector('conn-9');
    timers.advance(COALESCE_WINDOW_MS);

    expect(recorded.sendMessage).toHaveLength(1);
    expect(recorded.sendMessage[0]).toEqual({
      events: [
        {
          event: 'connector-deleted',
          projectSlug: 'demo-project',
          flowSlug: 'demo',
          payload: { connectorId: 'conn-9' },
        },
      ],
    });
  });

  it('updateNode with name patch → node-renamed', async () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    const adapter = wrapAdapter(makeBaseAdapter(), bridge, {
      projectSlug: 'demo-project',
      flowSlug: 'demo',
    });

    await adapter.updateNode('node-3', { name: 'New label' });
    timers.advance(COALESCE_WINDOW_MS);

    expect(recorded.sendMessage).toHaveLength(1);
    expect(recorded.sendMessage[0]).toEqual({
      events: [
        {
          event: 'node-renamed',
          projectSlug: 'demo-project',
          flowSlug: 'demo',
          payload: { nodeId: 'node-3', name: 'New label' },
        },
      ],
    });
  });

  it('updateNode without name → no sendMessage (visual edits stay silent)', async () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    const adapter = wrapAdapter(makeBaseAdapter(), bridge, {
      projectSlug: 'demo-project',
      flowSlug: 'demo',
    });

    await adapter.updateNode('node-3', { borderColor: 'blue', fontSize: 14 });
    timers.advance(COALESCE_WINDOW_MS);

    expect(recorded.sendMessage).toHaveLength(0);
  });

  it('updateNodePosition stays silent (drag telemetry uses updateModelContext)', async () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    const adapter = wrapAdapter(makeBaseAdapter(), bridge, {
      projectSlug: 'demo-project',
      flowSlug: 'demo',
    });

    await adapter.updateNodePosition('node-3', { x: 100, y: 200 });
    timers.advance(COALESCE_WINDOW_MS);

    expect(recorded.sendMessage).toHaveLength(0);
  });

  it('failed adapter calls do NOT emit (rejection propagates, no event)', async () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    const base = makeBaseAdapter({
      deleteNode: async () => {
        throw new Error('server said no');
      },
    });
    const adapter = wrapAdapter(base, bridge, { projectSlug: 'demo-project', flowSlug: 'demo' });

    await expect(adapter.deleteNode('node-7')).rejects.toThrow('server said no');
    timers.advance(COALESCE_WINDOW_MS);

    expect(recorded.sendMessage).toHaveLength(0);
  });
});

describe('wrapAdapter — burst coalescing through the bridge', () => {
  it('three structural edits inside 200ms collapse into one sendMessage with all events', async () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    let nextNodeId = 1;
    const base = makeBaseAdapter({
      createNode: async (input) => {
        const id = `node-${nextNodeId++}`;
        return { id, node: { id, ...input } };
      },
      createConnector: async () => ({ id: 'conn-1' }),
    });
    const adapter = wrapAdapter(base, bridge, { projectSlug: 'demo-project', flowSlug: 'demo' });

    await adapter.createNode({
      type: 'rectangle',
      position: { x: 0, y: 0 },
      data: { name: 'A' },
    });
    timers.advance(50);
    await adapter.createNode({
      type: 'rectangle',
      position: { x: 100, y: 0 },
      data: { name: 'B' },
    });
    timers.advance(50);
    await adapter.createConnector({ source: 'node-1', target: 'node-2' });

    // Still inside the 200ms window — nothing flushed yet.
    expect(recorded.sendMessage).toHaveLength(0);

    timers.advance(COALESCE_WINDOW_MS);
    expect(recorded.sendMessage).toHaveLength(1);
    const payload = recorded.sendMessage[0] as { events: Array<{ event: string }> };
    expect(payload.events.map((e) => e.event)).toEqual([
      'node-added',
      'node-added',
      'connector-added',
    ]);
  });
});

describe('createTelemetry — selection / drag / viewport route through updateModelContext', () => {
  it('selection change debounces into one updateModelContext fire', () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    const tel = createTelemetry(bridge);

    tel.onSelectionChange(['a'], []);
    timers.advance(CONTEXT_DEBOUNCE_MS);

    expect(recorded.updateModelContext).toHaveLength(1);
    expect(recorded.updateModelContext[0]).toEqual({
      selectedNodeIds: ['a'],
      selectedConnectorIds: [],
    });
  });

  it('drag-in-progress fires at most once per 250ms (bridge debounce absorbs the burst)', () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    const tel = createTelemetry(bridge);

    // Simulate a continuous 1-second drag with viewport updates every 16ms
    // (~60Hz). With pure debounce of 250ms re-arming on every call, no fire
    // happens DURING the drag — the trailing-edge fire lands 250ms after the
    // LAST tick. That satisfies "at most once per 250ms": at most one fire
    // per drag gesture.
    tel.onNodeDragStart();
    for (let t = 0; t < 1000; t += 16) {
      tel.onViewportChange({ x: t, y: 0, zoom: 1 });
      timers.advance(16);
    }
    // Still mid-drag, debounce keeps re-arming → no fires yet.
    expect(recorded.updateModelContext).toHaveLength(0);

    // Release: drag-stop is the LAST call; debounce trailing-edge fires after
    // CONTEXT_DEBOUNCE_MS of silence.
    tel.onNodeDragStop();
    timers.advance(CONTEXT_DEBOUNCE_MS);

    expect(recorded.updateModelContext).toHaveLength(1);
    const fire = recorded.updateModelContext[0] as Record<string, unknown>;
    expect(fire.dragging).toBe(false);
    expect(fire.viewport).toEqual({ x: 992, y: 0, zoom: 1 });
  });

  it('viewport pan/zoom alone emits a debounced patch with the latest viewport', () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    const tel = createTelemetry(bridge);

    tel.onViewportChange({ x: 0, y: 0, zoom: 1 });
    timers.advance(50);
    tel.onViewportChange({ x: 10, y: 20, zoom: 1.5 });
    timers.advance(CONTEXT_DEBOUNCE_MS);

    expect(recorded.updateModelContext).toHaveLength(1);
    expect(recorded.updateModelContext[0]).toEqual({ viewport: { x: 10, y: 20, zoom: 1.5 } });
  });

  it('repeated bursts respect the 1s throttle', () => {
    const timers = createFakeTimers();
    const { host, recorded } = makeHost();
    const bridge = createBridge({
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      now: timers.getNow,
      getHost: () => host,
    });
    const tel = createTelemetry(bridge);

    // Burst 1: selection. Fires at debounce.
    tel.onSelectionChange(['a'], []);
    timers.advance(CONTEXT_DEBOUNCE_MS);
    expect(recorded.updateModelContext).toHaveLength(1);

    // Burst 2: another selection right after — held by 1s throttle.
    tel.onSelectionChange(['b'], []);
    timers.advance(CONTEXT_DEBOUNCE_MS);
    expect(recorded.updateModelContext).toHaveLength(1);
    timers.advance(CONTEXT_THROTTLE_MS - CONTEXT_DEBOUNCE_MS);
    expect(recorded.updateModelContext).toHaveLength(2);
    expect(recorded.updateModelContext[1]).toEqual({
      selectedNodeIds: ['b'],
      selectedConnectorIds: [],
    });
  });
});
