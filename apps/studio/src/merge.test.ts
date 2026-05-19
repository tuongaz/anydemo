import { describe, expect, it } from 'bun:test';
import { mergeArchitectureAndStyle } from './merge.ts';
import type { Architecture, Style } from './schema.ts';

describe('mergeArchitectureAndStyle', () => {
  it('spreads style.position onto the node root', () => {
    const arch: Architecture = {
      version: 2,
      name: 'T',
      nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }],
      connectors: [],
    };
    const style: Style = { nodes: { n: { position: { x: 10, y: 20 } } } };
    const flow = mergeArchitectureAndStyle(arch, style);
    expect(flow.nodes[0]?.position).toEqual({ x: 10, y: 20 });
  });

  it('defaults position to (0, 0) when missing from style', () => {
    const arch: Architecture = {
      version: 2,
      name: 'T',
      nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }],
      connectors: [],
    };
    const flow = mergeArchitectureAndStyle(arch, {});
    expect(flow.nodes[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('spreads visual fields into node.data', () => {
    const arch: Architecture = {
      version: 2,
      name: 'T',
      nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }],
      connectors: [],
    };
    const style: Style = { nodes: { n: { fontSize: 14, borderColor: 'blue' } } };
    const flow = mergeArchitectureAndStyle(arch, style);
    expect(flow.nodes[0]?.data).toMatchObject({
      shape: 'rectangle',
      fontSize: 14,
      borderColor: 'blue',
    });
  });

  it('spreads connector handles + visual fields onto the connector', () => {
    const arch: Architecture = {
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
    const flow = mergeArchitectureAndStyle(arch, style);
    expect(flow.connectors[0]).toMatchObject({
      sourceHandle: 'r',
      style: 'dashed',
      color: 'blue',
    });
  });

  it('ignores style entries with no matching architecture id', () => {
    const arch: Architecture = {
      version: 2,
      name: 'T',
      nodes: [{ id: 'a', type: 'shapeNode', data: { shape: 'rectangle' } }],
      connectors: [],
    };
    const style: Style = { nodes: { b: { fontSize: 14 } } };
    const flow = mergeArchitectureAndStyle(arch, style);
    expect(flow.nodes).toHaveLength(1);
    expect(flow.nodes[0]?.id).toBe('a');
  });
});
