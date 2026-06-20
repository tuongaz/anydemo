import { describe, expect, it } from 'bun:test';
import {
  type PasteableConnector,
  type PasteableNode,
  SEEFLOW_CLIPBOARD_MIME,
  buildPastePayload,
  encodeClipboard,
  parseClipboard,
  reconcilePasteFailure,
} from '@/lib/clipboard';

type TestNode = PasteableNode & { tag?: string };
type TestConn = PasteableConnector & { tag?: string };

const node = (id: string, x: number, y: number): TestNode => ({ id, position: { x, y } });

const conn = (id: string, source: string, target: string): TestConn => ({
  id,
  source,
  target,
});

const seqGen = (prefix: string) => {
  let i = 0;
  return () => `${prefix}-${++i}`;
};

describe('buildPastePayload', () => {
  it('rewrites a single node with +24,+24 offset when flowPos is null', () => {
    const { newNodes, idMap } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('a', 100, 200)],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes).toEqual([{ id: 'n-1', position: { x: 124, y: 224 } }]);
    expect(idMap.get('a')).toBe('n-1');
  });

  it('anchors top-leftmost node at flowPos when supplied', () => {
    const { newNodes } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('a', 50, 50), node('b', 150, 100)],
      connectors: [],
      flowPos: { x: 10, y: 20 },
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes[0]?.position).toEqual({ x: 10, y: 20 });
    expect(newNodes[1]?.position).toEqual({ x: 110, y: 70 });
  });

  it('preserves relative position between multiple nodes', () => {
    const { newNodes } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('a', 0, 0), node('b', 100, 0), node('c', 50, 100)],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes[0]?.position).toEqual({ x: 24, y: 24 });
    expect(newNodes[1]?.position).toEqual({ x: 124, y: 24 });
    expect(newNodes[2]?.position).toEqual({ x: 74, y: 124 });
  });

  it('rewires connector endpoints when both nodes are in the copied set', () => {
    const { newNodes, newConnectors, idMap } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('a', 0, 0), node('b', 100, 0), node('c', 200, 0)],
      connectors: [conn('e1', 'a', 'b'), conn('e2', 'b', 'c')],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes.length).toBe(3);
    expect(newConnectors.length).toBe(2);
    expect(newConnectors[0]?.source).toBe(idMap.get('a'));
    expect(newConnectors[0]?.target).toBe(idMap.get('b'));
    expect(newConnectors[1]?.source).toBe(idMap.get('b'));
    expect(newConnectors[1]?.target).toBe(idMap.get('c'));
    expect(newConnectors[0]?.id).toBe('c-1');
    expect(newConnectors[1]?.id).toBe('c-2');
  });

  it('preserves extra fields on nodes and connectors via generic spread', () => {
    const { newNodes, newConnectors } = buildPastePayload<TestNode, TestConn>({
      nodes: [{ id: 'a', position: { x: 0, y: 0 }, tag: 'preserved' }],
      connectors: [{ id: 'e', source: 'a', target: 'a', tag: 'edge-tag' }],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes[0]?.tag).toBe('preserved');
    expect(newConnectors[0]?.tag).toBe('edge-tag');
  });

  it('returns empty arrays when input is empty', () => {
    const { newNodes, newConnectors, idMap } = buildPastePayload<TestNode, TestConn>({
      nodes: [],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
    });
    expect(newNodes).toEqual([]);
    expect(newConnectors).toEqual([]);
    expect(idMap.size).toBe(0);
  });

  it('uses custom defaultOffset when provided', () => {
    const { newNodes } = buildPastePayload<TestNode, TestConn>({
      nodes: [node('a', 0, 0)],
      connectors: [],
      flowPos: null,
      nodeIdGen: seqGen('n'),
      connectorIdGen: seqGen('c'),
      defaultOffset: { x: 50, y: 75 },
    });
    expect(newNodes[0]?.position).toEqual({ x: 50, y: 75 });
  });
});

describe('reconcilePasteFailure', () => {
  it('keeps every override and shows no error when the server persisted everything', () => {
    // False-negative: the POST rejected on the client but the node + connector
    // are both on disk. The optimistic overrides must survive so the entities
    // stay visible (the prune effect clears them once the refetch lands).
    const result = reconcilePasteFailure({
      newNodeIds: ['n1', 'n2'],
      newConnectorIds: ['c1'],
      serverNodeIds: new Set(['n1', 'n2', 'existing']),
      serverConnectorIds: new Set(['c1']),
    });
    expect(result.dropNodeIds).toEqual([]);
    expect(result.dropConnectorIds).toEqual([]);
    expect(result.showError).toBe(false);
  });

  it('drops only the genuinely-absent entities and shows an error', () => {
    const result = reconcilePasteFailure({
      newNodeIds: ['n1', 'n2'],
      newConnectorIds: ['c1', 'c2'],
      serverNodeIds: new Set(['n1']),
      serverConnectorIds: new Set(['c2']),
    });
    expect(result.dropNodeIds).toEqual(['n2']);
    expect(result.dropConnectorIds).toEqual(['c1']);
    expect(result.showError).toBe(true);
  });

  it('falls back to dropping everything when the reconcile refetch failed', () => {
    const result = reconcilePasteFailure({
      newNodeIds: ['n1', 'n2'],
      newConnectorIds: ['c1'],
      serverNodeIds: null,
      serverConnectorIds: null,
    });
    expect(result.dropNodeIds).toEqual(['n1', 'n2']);
    expect(result.dropConnectorIds).toEqual(['c1']);
    expect(result.showError).toBe(true);
  });

  it('handles a node-only paste with no connectors', () => {
    const result = reconcilePasteFailure({
      newNodeIds: ['n1'],
      newConnectorIds: [],
      serverNodeIds: new Set(['n1']),
      serverConnectorIds: new Set(),
    });
    expect(result.dropNodeIds).toEqual([]);
    expect(result.dropConnectorIds).toEqual([]);
    expect(result.showError).toBe(false);
  });
});

describe('clipboard envelope', () => {
  const nodes = [{ id: 'a', position: { x: 0, y: 0 } }] as const;
  const connectors = [{ id: 'c', source: 'a', target: 'a' }] as const;

  it('exposes a plain-text MIME so the OS clipboard carries it', () => {
    expect(SEEFLOW_CLIPBOARD_MIME).toBe('text/plain');
  });

  it('round-trips nodes + connectors through encode/parse', () => {
    const text = encodeClipboard({ nodes, connectors });
    expect(parseClipboard(text)).toEqual({ nodes, connectors });
  });

  it('returns null for non-seeflow text', () => {
    expect(parseClipboard('hello world')).toBeNull();
    expect(parseClipboard('{"foo":1}')).toBeNull();
    expect(parseClipboard('not json {')).toBeNull();
  });

  it('returns null when the envelope marker/version is wrong', () => {
    expect(parseClipboard(JSON.stringify({ nodes, connectors }))).toBeNull();
  });
});
