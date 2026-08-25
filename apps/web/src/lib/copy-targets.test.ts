import { describe, expect, it } from 'bun:test';
import type { Connector, FlowNode } from '@/lib/api';
import { collectCopyTargets } from '@/lib/copy-targets';

const node = (id: string, x = 0, y = 0, extra: Record<string, unknown> = {}): FlowNode =>
  ({
    id,
    type: 'rectangle',
    position: { x, y },
    data: { name: id, ...extra },
  }) as unknown as FlowNode;

const conn = (id: string, source: string, target: string): Connector =>
  ({ id, source, target }) as unknown as Connector;

describe('collectCopyTargets', () => {
  it('copies a node that exists only as an optimistic override (un-echoed create)', () => {
    // The reported bug: a just-created node lives only in the override map; the
    // raw server snapshot has nothing, so the old flowNodes-only filter copied
    // an empty set and the paste silently no-opped.
    const fresh = node('new-1', 10, 20);
    const { nodes } = collectCopyTargets({
      selectedIds: ['new-1'],
      serverNodes: [],
      nodeOverrides: { 'new-1': fresh },
      serverConnectors: [],
      connectorOverrides: {},
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe('new-1');
    expect(nodes[0]?.position).toEqual({ x: 10, y: 20 });
  });

  it('merges pending optimistic edits over the server snapshot', () => {
    const server = node('a', 0, 0, { color: 'old' });
    const { nodes } = collectCopyTargets({
      selectedIds: ['a'],
      serverNodes: [server],
      nodeOverrides: {
        a: { position: { x: 99, y: 99 }, data: { color: 'new' } } as Partial<FlowNode>,
      },
      serverConnectors: [],
      connectorOverrides: {},
    });
    expect(nodes[0]?.position).toEqual({ x: 99, y: 99 });
    // data merges (server `name` preserved, override `color` wins).
    expect((nodes[0]?.data as Record<string, unknown>).color).toBe('new');
    expect((nodes[0]?.data as Record<string, unknown>).name).toBe('a');
  });

  it('falls back to the server node when no override is present', () => {
    const server = node('a');
    const { nodes } = collectCopyTargets({
      selectedIds: ['a'],
      serverNodes: [server],
      nodeOverrides: {},
      serverConnectors: [],
      connectorOverrides: {},
    });
    expect(nodes).toEqual([server]);
  });

  it('copies a connector only when both endpoints are in the copied set', () => {
    const { connectors } = collectCopyTargets({
      selectedIds: ['a', 'b'],
      serverNodes: [node('a'), node('b'), node('c')],
      nodeOverrides: {},
      serverConnectors: [conn('e1', 'a', 'b'), conn('e2', 'a', 'c')],
      connectorOverrides: {},
    });
    expect(connectors.map((c) => c.id)).toEqual(['e1']);
  });

  it('includes an override-only connector between two copied nodes', () => {
    const { connectors } = collectCopyTargets({
      selectedIds: ['a', 'b'],
      serverNodes: [node('a'), node('b')],
      nodeOverrides: {},
      serverConnectors: [],
      connectorOverrides: { 'edge-new': { source: 'a', target: 'b' } as Partial<Connector> },
    });
    expect(connectors).toHaveLength(1);
    expect(connectors[0]?.id).toBe('edge-new');
  });

  it('returns nothing when the selection resolves to no nodes', () => {
    const { nodes, connectors } = collectCopyTargets({
      selectedIds: ['missing'],
      serverNodes: [node('a')],
      nodeOverrides: {},
      serverConnectors: [conn('e1', 'a', 'a')],
      connectorOverrides: {},
    });
    expect(nodes).toEqual([]);
    expect(connectors).toEqual([]);
  });
});
