import { describe, expect, it } from 'bun:test';
import { mergeFlowAndStyle } from './merge.ts';
import type { Flow, Style } from './schema.ts';

describe('mergeFlowAndStyle', () => {
  it('spreads style.position onto the node root', () => {
    const flow: Flow = {
      version: 2,
      name: 'T',
      nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }],
      connectors: [],
    };
    const style: Style = { nodes: { n: { position: { x: 10, y: 20 } } } };
    const resolved = mergeFlowAndStyle(flow, style);
    expect(resolved.nodes[0]?.position).toEqual({ x: 10, y: 20 });
  });

  it('defaults position to (0, 0) when missing from style', () => {
    const flow: Flow = {
      version: 2,
      name: 'T',
      nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }],
      connectors: [],
    };
    const resolved = mergeFlowAndStyle(flow, {});
    expect(resolved.nodes[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('spreads visual fields into node.data', () => {
    const flow: Flow = {
      version: 2,
      name: 'T',
      nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }],
      connectors: [],
    };
    const style: Style = { nodes: { n: { fontSize: 14, borderColor: 'blue' } } };
    const resolved = mergeFlowAndStyle(flow, style);
    expect(resolved.nodes[0]?.data).toMatchObject({
      shape: 'rectangle',
      fontSize: 14,
      borderColor: 'blue',
    });
  });

  it('spreads connector handles + visual fields onto the connector', () => {
    const flow: Flow = {
      version: 2,
      name: 'T',
      nodes: [
        { id: 'a', type: 'shapeNode', data: { shape: 'rectangle' } },
        { id: 'b', type: 'shapeNode', data: { shape: 'rectangle' } },
      ],
      connectors: [{ id: 'c', source: 'a', target: 'b', kind: 'default' }],
    };
    const style: Style = {
      connectors: { c: { sourceHandle: 'r', style: 'dashed', color: 'blue' } },
    };
    const resolved = mergeFlowAndStyle(flow, style);
    expect(resolved.connectors[0]).toMatchObject({
      sourceHandle: 'r',
      style: 'dashed',
      color: 'blue',
    });
  });

  it('ignores style entries with no matching flow id', () => {
    const flow: Flow = {
      version: 2,
      name: 'T',
      nodes: [{ id: 'a', type: 'shapeNode', data: { shape: 'rectangle' } }],
      connectors: [],
    };
    const style: Style = { nodes: { b: { fontSize: 14 } } };
    const resolved = mergeFlowAndStyle(flow, style);
    expect(resolved.nodes).toHaveLength(1);
    expect(resolved.nodes[0]?.id).toBe('a');
  });
});
