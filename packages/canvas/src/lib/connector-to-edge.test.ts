import { describe, expect, it } from 'bun:test';
import { type EdgeMarker, MarkerType } from '@xyflow/react';
import type { Connector } from '../types.ts';
import { connectorToEdge } from './connector-to-edge';

// The native arrow head is an EdgeMarker object; custom heads are url() strings.
// These helpers narrow to the object form for the arrow-marker assertions.
const asMarker = (m: EdgeMarker | string | undefined): EdgeMarker | undefined =>
  typeof m === 'object' ? m : undefined;

describe('connectorToEdge', () => {
  it('preserves id/source/target and uses the editableEdge custom type', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
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
      eventName: 'todo.completed',
      label: 'publishes todo.completed',
    };
    expect(connectorToEdge(c, false).label).toBe('publishes todo.completed');
  });

  it('flips animated:true when adjacent to a running node', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', eventName: 'x.y' };
    expect(connectorToEdge(c, true).animated).toBe(true);
    expect(connectorToEdge(c, false).animated).toBe(false);
  });

  it('renders a closed arrowhead at the target so direction reads at a glance', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      method: 'GET',
      url: 'http://b/',
    };
    const edge = connectorToEdge(c, false);
    expect(asMarker(edge.markerEnd)?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.markerStart).toBeUndefined();
  });

  it('renders a connector as solid (no dasharray) by default', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    const edge = connectorToEdge(c, false);
    expect(edge.style.strokeDasharray).toBeUndefined();
    expect(edge.style.strokeWidth).toBe(2);
  });

  it('lets per-connector style set the dash pattern', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
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
      borderSize: 5,
    };
    expect(connectorToEdge(c, false).style.strokeWidth).toBe(5);
  });

  it('places markerStart only when direction is backward', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      direction: 'backward',
    };
    const edge = connectorToEdge(c, false);
    expect(asMarker(edge.markerStart)?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.markerEnd).toBeUndefined();
  });

  it('places markerStart and markerEnd when direction is both', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      direction: 'both',
    };
    const edge = connectorToEdge(c, false);
    expect(asMarker(edge.markerStart)?.type).toBe(MarkerType.ArrowClosed);
    expect(asMarker(edge.markerEnd)?.type).toBe(MarkerType.ArrowClosed);
  });

  it('treats absent direction as forward (markerEnd only)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    const edge = connectorToEdge(c, false);
    expect(asMarker(edge.markerEnd)?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.markerStart).toBeUndefined();
  });

  it('sets a 24px interactionWidth so the edge has a wider hit area for hover/click/reconnect', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    expect(connectorToEdge(c, false).interactionWidth).toBe(24);
  });

  it('passes sourceHandle/targetHandle through to the React Flow edge (US-013)', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      sourceHandle: 'b',
      targetHandle: 't',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.sourceHandle).toBe('b');
    expect(edge.targetHandle).toBe('t');
  });

  it('leaves sourceHandle/targetHandle undefined for connectors authored without handle ids', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    const edge = connectorToEdge(c, false);
    expect(edge.sourceHandle).toBeUndefined();
    expect(edge.targetHandle).toBeUndefined();
  });

  it('bumps strokeWidth to 3 and pins opacity to 1 when selected (US-004)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    const edge = connectorToEdge(c, false, true);
    expect(edge.style.strokeWidth).toBe(3);
    expect(edge.style.opacity).toBe(1);
  });

  it('preserves user-provided borderSize >= 3 when selected', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b', borderSize: 5 };
    const edge = connectorToEdge(c, false, true);
    expect(edge.style.strokeWidth).toBe(5);
  });

  it('does not bump strokeWidth or opacity when not selected', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    const edge = connectorToEdge(c, false, false);
    expect(edge.style.strokeWidth).toBe(2);
    expect(edge.style.opacity).toBeUndefined();
  });

  it('forwards connector.path through edge.data so EditableEdge can branch geometry (US-017)', () => {
    const curveC: Connector = { id: 'c1', source: 'a', target: 'b' };
    const stepC: Connector = {
      id: 'c2',
      source: 'a',
      target: 'b',
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
      sourceHandleAutoPicked: true,
      targetHandleAutoPicked: true,
    };
    const pinned: Connector = {
      id: 'c2',
      source: 'a',
      target: 'b',
      sourceHandleAutoPicked: false,
      targetHandleAutoPicked: false,
      sourceHandle: 'r',
      targetHandle: 'l',
    };
    const legacy: Connector = { id: 'c3', source: 'a', target: 'b' };
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
      color: 'blue',
      direction: 'both',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.style.stroke).toBeTruthy();
    expect(asMarker(edge.markerStart)?.color).toBe(edge.style.stroke);
    expect(asMarker(edge.markerEnd)?.color).toBe(edge.style.stroke);
  });

  it('renders the default token with an explicit stroke + matching marker (no fall-through to React Flow defaults)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    const edge = connectorToEdge(c, false);
    expect(edge.style.stroke).toBeTruthy();
    expect(asMarker(edge.markerEnd)?.color).toBe(edge.style.stroke);
  });

  it('does not set a per-edge zIndex so connectors paint behind nodes (US-014)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
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
  // seeflow-canvas drag-direction normalization — together they guarantee the
  // arrow lands on the drop-end node, not the drag-start node.
  it('defaults a no-direction connector to markerEnd-only (US-023)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    const edge = connectorToEdge(c, false);
    expect(edge.markerEnd).toBeDefined();
    expect(asMarker(edge.markerEnd)?.type).toBe(MarkerType.ArrowClosed);
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
      sourcePin: { side: 'right', t: 0.25 },
      targetPin: { side: 'left', t: 0.75 },
    };
    const e = connectorToEdge(pinned, false);
    expect(e.data.sourcePin).toEqual({ side: 'right', t: 0.25 });
    expect(e.data.targetPin).toEqual({ side: 'left', t: 0.75 });
  });

  it('leaves sourcePin / targetPin undefined when the connector has no pins', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    const e = connectorToEdge(c, false);
    expect(e.data.sourcePin).toBeUndefined();
    expect(e.data.targetPin).toBeUndefined();
  });

  // US-010: identical inputs (same connector ref + same isAdjacentToRunning +
  // same selected) return the SAME edge reference, so React Flow's marquee
  // gesture (which re-derives edges per frame) doesn't churn edge identities
  // and trigger needless edge re-renders.
  it('returns the same DerivedEdge reference for identical inputs (memoized)', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    const first = connectorToEdge(c, false, false);
    const second = connectorToEdge(c, false, false);
    expect(second).toBe(first);
  });

  it('returns a fresh edge when isAdjacentToRunning changes for the same connector', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    const idle = connectorToEdge(c, false, false);
    const running = connectorToEdge(c, true, false);
    expect(running).not.toBe(idle);
    expect(running.animated).toBe(true);
  });

  it('returns a fresh edge when selected flips for the same connector', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    const unselected = connectorToEdge(c, false, false);
    const selected = connectorToEdge(c, false, true);
    expect(selected).not.toBe(unselected);
    expect(selected.style.strokeWidth).toBe(3);
  });

  it('keys the cache on the connector ref so a mutated copy yields a fresh edge', () => {
    const c1: Connector = { id: 'c1', source: 'a', target: 'b' };
    const c2: Connector = { ...c1, label: 'updated' };
    const e1 = connectorToEdge(c1, false, false);
    const e2 = connectorToEdge(c2, false, false);
    expect(e2).not.toBe(e1);
    expect(e2.label).toBe('updated');
  });

  it('keeps the native ArrowClosed marker when headShape is absent or "arrow"', () => {
    const absent: Connector = { id: 'c1', source: 'a', target: 'b' };
    const explicit: Connector = { id: 'c2', source: 'a', target: 'b', headShape: 'arrow' };
    expect((connectorToEdge(absent, false).markerEnd as { type?: string })?.type).toBe(
      MarkerType.ArrowClosed,
    );
    expect((connectorToEdge(explicit, false).markerEnd as { type?: string })?.type).toBe(
      MarkerType.ArrowClosed,
    );
  });

  // Custom shapes are drawn by EditableEdge (no native marker) — they surface
  // via edge.data.headShape + headStart/headEnd, and the native marker slots
  // stay empty so a connector never shows an arrow AND a custom glyph.
  it('routes custom head shapes through edge.data with no native marker', () => {
    for (const shape of ['one', 'many', 'optional-many', 'diamond', 'circle'] as const) {
      const c: Connector = { id: 'c1', source: 'a', target: 'b', headShape: shape };
      const edge = connectorToEdge(c, false);
      expect(edge.data.headShape).toBe(shape);
      expect(edge.markerEnd).toBeUndefined();
      expect(edge.markerStart).toBeUndefined();
      // direction defaults to forward → head at the target end only.
      expect(edge.data.headEnd).toBe(true);
      expect(edge.data.headStart).toBe(false);
    }
  });

  it('flags both head ends when direction is both', () => {
    const both: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      headShape: 'diamond',
      direction: 'both',
    };
    const edge = connectorToEdge(both, false);
    expect(edge.data.headShape).toBe('diamond');
    expect(edge.data.headStart).toBe(true);
    expect(edge.data.headEnd).toBe(true);
  });

  it('flags no head ends when direction is none regardless of headShape', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      headShape: 'many',
      direction: 'none',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.markerStart).toBeUndefined();
    expect(edge.markerEnd).toBeUndefined();
    expect(edge.data.headStart).toBe(false);
    expect(edge.data.headEnd).toBe(false);
  });

  it('leaves data.headShape undefined for the default arrow head', () => {
    const c: Connector = { id: 'c1', source: 'a', target: 'b' };
    expect(connectorToEdge(c, false).data.headShape).toBeUndefined();
  });

  // tailShape styles the SOURCE end independently of headShape.
  it('routes an arrow head + custom tail to a native markerEnd and a glyph tail', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      headShape: 'arrow',
      tailShape: 'many',
      direction: 'both',
    };
    const edge = connectorToEdge(c, false);
    // Target end: native arrow marker, no custom head glyph.
    expect(asMarker(edge.markerEnd)?.type).toBe(MarkerType.ArrowClosed);
    expect(edge.data.headShape).toBeUndefined();
    // Source end: custom crow's-foot glyph, no native marker.
    expect(edge.markerStart).toBeUndefined();
    expect(edge.data.tailShape).toBe('many');
    expect(edge.data.headStart).toBe(true);
    expect(edge.data.headEnd).toBe(true);
  });

  it('mixes distinct head and tail glyphs (ER one-to-many)', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      headShape: 'many',
      tailShape: 'one',
      direction: 'both',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.data.headShape).toBe('many');
    expect(edge.data.tailShape).toBe('one');
    expect(edge.markerStart).toBeUndefined();
    expect(edge.markerEnd).toBeUndefined();
  });

  it('falls back to headShape for the tail when tailShape is unset', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      headShape: 'diamond',
      direction: 'both',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.data.tailShape).toBe('diamond');
  });

  it('leaves data.tailShape undefined when the tail end is a plain arrow', () => {
    const c: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      tailShape: 'arrow',
      direction: 'both',
    };
    const edge = connectorToEdge(c, false);
    expect(edge.data.tailShape).toBeUndefined();
    expect(asMarker(edge.markerStart)?.type).toBe(MarkerType.ArrowClosed);
  });

  it('forwards optional connector fontSize to edge data (US-018)', () => {
    const sized: Connector = {
      id: 'c1',
      source: 'a',
      target: 'b',
      label: 'wide',
      fontSize: 18,
    };
    const unsized: Connector = { id: 'c2', source: 'a', target: 'b' };
    expect(connectorToEdge(sized, false).data.fontSize).toBe(18);
    expect(connectorToEdge(unsized, false).data.fontSize).toBeUndefined();
  });
});
