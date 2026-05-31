import { describe, expect, it } from 'bun:test';
import { formatAttribution } from './format-attribution.ts';

describe('formatAttribution', () => {
  it('maps each known op to its verb', () => {
    expect(formatAttribution('moveNode', {}).verb).toBe('moved');
    expect(formatAttribution('patchNode', {}).verb).toBe('updated');
    expect(formatAttribution('addNode', {}).verb).toBe('added');
    expect(formatAttribution('deleteNode', {}).verb).toBe('deleted');
    expect(formatAttribution('addConnector', {}).verb).toBe('connected');
    expect(formatAttribution('patchConnector', {}).verb).toBe('updated');
    expect(formatAttribution('deleteConnector', {}).verb).toBe('disconnected');
    expect(formatAttribution('addBulk', {}).verb).toBe('created');
    expect(formatAttribution('reorderNode', {}).verb).toBe('reordered');
  });

  it('falls back to the op name for unknown ops', () => {
    expect(formatAttribution('frobnicate', {}).verb).toBe('frobnicate');
  });

  it('uses the supplied nodeLabel when provided', () => {
    const result = formatAttribution('moveNode', { name: 'ignored' }, 'Login API');
    expect(result.nodeLabel).toBe('Login API');
  });

  it('reads the diff name/label/text/title fields when no nodeLabel is supplied', () => {
    expect(formatAttribution('patchNode', { name: 'Worker' }).nodeLabel).toBe('Worker');
    expect(formatAttribution('patchNode', { label: 'L' }).nodeLabel).toBe('L');
    expect(formatAttribution('patchNode', { text: 'T' }).nodeLabel).toBe('T');
    expect(formatAttribution('patchNode', { title: 'Ti' }).nodeLabel).toBe('Ti');
  });

  it('peeks into diff.patch and diff.node for nested labels', () => {
    expect(formatAttribution('patchNode', { patch: { name: 'X' } }).nodeLabel).toBe('X');
    expect(formatAttribution('addNode', { node: { name: 'Y' } }).nodeLabel).toBe('Y');
  });

  it('falls back to nodeId / connectorId / id when no name is present', () => {
    expect(formatAttribution('moveNode', { nodeId: 'n-1' }).nodeLabel).toBe('n-1');
    expect(formatAttribution('addConnector', { connectorId: 'c-1' }).nodeLabel).toBe('c-1');
    expect(formatAttribution('addNode', { id: 'something' }).nodeLabel).toBe('something');
  });

  it('returns "Node" as the final fallback', () => {
    expect(formatAttribution('moveNode', null).nodeLabel).toBe('Node');
    expect(formatAttribution('moveNode', {}).nodeLabel).toBe('Node');
    expect(formatAttribution('moveNode', 'malformed').nodeLabel).toBe('Node');
  });

  it('ignores empty / whitespace-only strings in the diff', () => {
    expect(formatAttribution('patchNode', { name: '   ', label: 'L' }).nodeLabel).toBe('L');
    expect(formatAttribution('patchNode', { name: '', nodeId: 'x' }).nodeLabel).toBe('x');
  });
});
