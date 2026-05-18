import { describe, expect, it } from 'bun:test';
import { MarkerType } from '@xyflow/react';
import type { Connector } from '../types.ts';
import { connectorToEdge, styleForKind } from './connector-to-edge';

describe('connectorToEdge', () => {
  it('preserves id/source/target and uses the editableEdge custom type', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'http',
      method: 'POST',
      url: 'http://b/',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.id).toBe('c1');
    expect(edge.source).toBe('a');
    expect(edge.target).toBe('b');
    expect(edge.type).toBe('editableEdge');
  });

  it('passes the connector label through to the React Flow edge label', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'event',
      eventName: 'todo.completed',
      label: 'publishes todo.completed',
    };
    expect(connectorToEdge(c, false).label).toBe('publishes todo.completed');
  });

  it('flips animated:true when adjacent to a running node', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'event', eventName: 'x.y' };
    expect(connectorToEdge(c, true).animated).toBe(true);
    expect(connectorToEdge(c, false).animated).toBe(false);
  });

  it('styles edges by kind: solid http, dashed event, dotted queue', () => {
    expect(styleForKind('http')).toEqual({});
    expect(styleForKind('event')).toEqual({ strokeDasharray: '6 4' });
    expect(styleForKind('queue')).toEqual({ strokeDasharray: '2 4' });
  });

  it('renders a closed arrowhead at the target so direction reads at a glance', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'http',
      method: 'GET',
      url: 'http://b/',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.markerEnd?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.markerStart).toBeUndefined();
  });

  it('preserves the connector kind in edge data for downstream filtering', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'queue',
      queueName: 'work-queue',
    };
    expect(connectorToEdge(c, false).data.kind).toBe('queue');
  });

  it('renders a default connector as solid (no dasharray)', () => {
    expect(styleForKind('default')).toEqual({});
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const edge = connectorToEdge(c, false);
    expect(edge.style.strokeDasharray).toBeUndefined();
    expect(edge.style.strokeWidth).toBe(2);
  });

  it('lets per-connector style override the kind-derived style', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'http',
      style: 'dashed',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.style.strokeDasharray).toBe('6 4');
    expect(edge.style.strokeWidth).toBe(2);
  });

  it('uses connector.borderSize as strokeWidth when set', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      borderSize: 5,
    };
    expect(connectorToEdge(c, false).style.strokeWidth).toBe(5);
  });

  it('places markerStart only when direction is backward', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      direction: 'backward',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.markerStart?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.markerEnd).toBeUndefined();
  });

  it('places markerStart and markerEnd when direction is both', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      direction: 'both',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.markerStart?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.markerEnd?.type).toBe(MarkerType.ArrowClosed);
  });

  it('treats absent direction as forward (markerEnd only)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const edge = connectorToEdge(c, false);
    expect(edge.markerEnd?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.markerStart).toBeUndefined();
  });

  it('sets a 24px interactionWidth so the edge has a wider hit area for hover/click/reconnect', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    expect(connectorToEdge(c, false).interactionWidth).toBe(24);
  });

  it('passes sourceHandle/targetHandle through to the React Flow edge (US-013)', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      sourceHandle: 'b',
      targetHandle: 't',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.sourceHandle).toBe('b');
    expect(edge.targetHandle).toBe('t');
  });

  it('leaves sourceHandle/targetHandle undefined for connectors authored without handle ids', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const edge = connectorToEdge(c, false);
    expect(edge.sourceHandle).toBeUndefined();
    expect(edge.targetHandle).toBeUndefined();
  });

  it('bumps strokeWidth to 3 and pins opacity to 1 when selected (US-004)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'http' };
    const edge = connectorToEdge(c, false, true);
    expect(edge.style.strokeWidth).toBe(3);
    expect(edge.style.opacity).toBe(1);
  });

  it('preserves user-provided borderSize >= 3 when selected', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default', borderSize: 5 };
    const edge = connectorToEdge(c, false, true);
    expect(edge.style.strokeWidth).toBe(5);
  });

  it('keeps the connector kind dasharray when selected (event=dashed, queue=dotted)', () => {
    const eventC: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'event',
      eventName: 'x.y',
    };
    const queueC: Connector = {
      id: 'c2',
      source: 'a',
      target: 'b',
      kind: 'queue',
      queueName: 'q',
    };
    expect(connectorToEdge(eventC, false, true).style.strokeDasharray).toBe('6 4');
    expect(connectorToEdge(queueC, false, true).style.strokeDasharray).toBe('2 4');
  });

  it('does not bump strokeWidth or opacity when not selected', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'http' };
    const edge = connectorToEdge(c, false, false);
    expect(edge.style.strokeWidth).toBe(2);
    expect(edge.style.opacity).toBeUndefined();
  });

  it('forwards connector.path through edge.data so EditableEdge can branch geometry (US-017)', () => {
    const curveC: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const stepC: Connector = {
      id: 'c2',
      source: 'a',
      target: 'b',
      kind: 'default',
      path: 'step',
    };
    expect(connectorToEdge(curveC, false).data.path).toBeUndefined();
    expect(connectorToEdge(stepC, false).data.path).toBe('step');
  });

  // US-025: edge.data must carry the autoPicked flags so EditableEdge can
  // pick floating vs pinned at render time. `undefined` (the migration
  // default for pre-US-021 connectors) means floating — the absence of an
  // explicit pin.
  it('forwards source/target HandleAutoPicked through edge.data (US-025)', () => {
    const floating: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      sourceHandleAutoPicked: true,
      targetHandleAutoPicked: true,
    };
    const pinned: Connector = {
      id: 'c2',
      source: 'a',
      target: 'b',
      kind: 'default',
      sourceHandleAutoPicked: false,
      targetHandleAutoPicked: false,
      sourceHandle: 'r',
      targetHandle: 'l',
    };
    const legacy: Connector = { id: 'c3', source: 'a', target: 'b', kind: 'default' };
    expect(connectorToEdge(floating, false).data.sourceHandleAutoPicked).toBe(true);
    expect(connectorToEdge(floating, false).data.targetHandleAutoPicked).toBe(true);
    expect(connectorToEdge(pinned, false).data.sourceHandleAutoPicked).toBe(false);
    expect(connectorToEdge(pinned, false).data.targetHandleAutoPicked).toBe(false);
    // Pre-US-021 connector — no autoPicked field at all → undefined → renders
    // as floating per the migration default.
    expect(connectorToEdge(legacy, false).data.sourceHandleAutoPicked).toBeUndefined();
    expect(connectorToEdge(legacy, false).data.targetHandleAutoPicked).toBeUndefined();
  });

  it('paints the arrow marker in the same color as the connector stroke', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      color: 'blue',
      direction: 'both',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.style.stroke).toBeTruthy();
    expect(edge.markerStart?.color).toBe(edge.style.stroke);
    expect(edge.markerEnd?.color).toBe(edge.style.stroke);
  });

  it('renders the default token with an explicit stroke + matching marker (no fall-through to React Flow defaults)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const edge = connectorToEdge(c, false);
    expect(edge.style.stroke).toBeTruthy();
    expect(edge.markerEnd?.color).toBe(edge.style.stroke);
  });

  it('does not set a per-edge zIndex so connectors paint behind nodes (US-014)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const idle = connectorToEdge(c, false, false);
    const running = connectorToEdge(c, true, false);
    const selected = connectorToEdge(c, false, true);
    // Per AC: rely on React Flow's default DOM order (.react-flow__edges
    // renders before .react-flow__nodes) instead of per-edge zIndex hacks.
    // A `zIndex` field on the derived edge would set inline style on each
    // edge's <svg>, lifting it above the nodes layer.
    expect((idle as unknown as Record<string, unknown>).zIndex).toBeUndefined();
    expect((running as unknown as Record<string, unknown>).zIndex).toBeUndefined();
    expect((selected as unknown as Record<string, unknown>).zIndex).toBeUndefined();
  });

  // US-023 regression guard: drag-direction is the canonical mapping for new
  // connectors, so a freshly-drawn connector (no explicit direction set)
  // MUST render its arrowhead on the target end. Pair this with the
  // demo-canvas drag-direction normalization — together they guarantee the
  // arrow lands on the drop-end node, not the drag-start node.
  it('defaults a no-direction connector to markerEnd-only (US-023)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const edge = connectorToEdge(c, false);
    expect(edge.markerEnd).toBeDefined();
    expect(edge.markerEnd?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.markerStart).toBeUndefined();
  });

  // US-007: sourcePin / targetPin must be carried into edge.data so the
  // EditableEdge consumer can pass them through to resolveEdgeEndpoints
  // (per-frame geometry computation).
  it('forwards sourcePin / targetPin through edge.data (US-007)', () => {
    const pinned: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      sourcePin: { side: 'right', t: 0.25 },
      targetPin: { side: 'left', t: 0.75 },
    };
    const e = connectorToEdge(pinned, false);
    expect(e.data.sourcePin).toEqual({ side: 'right', t: 0.25 });
    expect(e.data.targetPin).toEqual({ side: 'left', t: 0.75 });
  });

  it('leaves sourcePin / targetPin undefined when the connector has no pins', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const e = connectorToEdge(c, false);
    expect(e.data.sourcePin).toBeUndefined();
    expect(e.data.targetPin).toBeUndefined();
  });

  // US-010: identical inputs (same connector ref + same isAdjacentToRunning +
  // same selected) return the SAME edge reference, so React Flow's marquee
  // gesture (which re-derives edges per frame) doesn't churn edge identities
  // and trigger needless edge re-renders.
  it('returns the same DerivedEdge reference for identical inputs (memoized)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const first = connectorToEdge(c, false, false);
    const second = connectorToEdge(c, false, false);
    expect(second).toBe(first);
  });

  it('returns a fresh edge when isAdjacentToRunning changes for the same connector', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const idle = connectorToEdge(c, false, false);
    const running = connectorToEdge(c, true, false);
    expect(running).not.toBe(idle);
    expect(running.animated).toBe(true);
  });

  it('returns a fresh edge when selected flips for the same connector', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const unselected = connectorToEdge(c, false, false);
    const selected = connectorToEdge(c, false, true);
    expect(selected).not.toBe(unselected);
    expect(selected.style.strokeWidth).toBe(3);
  });

  it('keys the cache on the connector ref so a mutated copy yields a fresh edge', () => {
    const c1: Connector = { id: 'c1', source: 'a', target: 'b', kind: 'default' };
    const c2: Connector = { ...c1, kind: 'event', eventName: 'x.y' };
    const e1 = connectorToEdge(c1, false, false);
    const e2 = connectorToEdge(c2, false, false);
    expect(e2).not.toBe(e1);
    expect(e2.data.kind).toBe('event');
  });

  it('forwards optional connector fontSize to edge data (US-018)', () => {
    const sized: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      kind: 'default',
      label: 'wide',
      fontSize: 18,
    };
    const unsized: Connector = { id: 'c2', source: 'a', target: 'b', kind: 'default' };
    expect(connectorToEdge(sized, false).data.fontSize).toBe(18);
    expect(connectorToEdge(unsized, false).data.fontSize).toBeUndefined();
  });
});
