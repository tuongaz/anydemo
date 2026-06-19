import { describe, expect, it } from 'bun:test';
import type { FlowDetail } from '@/lib/api';
import { type PasteFailureDeps, handlePasteFailure } from '@/lib/paste-failure';

const detailWith = (nodeIds: string[], connIds: string[] = []): FlowDetail =>
  ({
    id: 'f',
    slug: 'p/f',
    name: 'F',
    filePath: '/f',
    valid: true,
    error: null,
    flow: {
      nodes: nodeIds.map((id) => ({ id })),
      connectors: connIds.map((id) => ({ id })),
    },
  }) as unknown as FlowDetail;

interface Spy {
  deps: PasteFailureDeps;
  dropped: { nodes: string[]; connectors: string[] };
  applied: FlowDetail[];
  errors: string[];
}

const makeDeps = (fetchDetail: PasteFailureDeps['fetchDetail']): Spy => {
  const dropped = { nodes: [] as string[], connectors: [] as string[] };
  const applied: FlowDetail[] = [];
  const errors: string[] = [];
  return {
    dropped,
    applied,
    errors,
    deps: {
      fetchDetail,
      applyDetail: (d) => applied.push(d),
      dropNode: (id) => dropped.nodes.push(id),
      dropConnector: (id) => dropped.connectors.push(id),
      setError: (m) => errors.push(m),
      logError: () => {},
    },
  };
};

describe('handlePasteFailure', () => {
  it('keeps persisted entities and shows no error (false-negative recovery)', async () => {
    // Server actually persisted both the node and the connector; the client just
    // saw a spurious error. Nothing should be dropped, no banner, and the fresh
    // detail must be pushed so the persisted entities render without a refresh.
    const spy = makeDeps(async () => detailWith(['n1'], ['c1']));
    await handlePasteFailure(new Error('boom'), ['n1'], ['c1'], spy.deps);
    expect(spy.dropped).toEqual({ nodes: [], connectors: [] });
    expect(spy.errors).toEqual([]);
    expect(spy.applied).toHaveLength(1);
  });

  it('keeps the persisted node but rolls back the failed connector + errors', async () => {
    // The classic partial paste: node POST succeeded, connector POST 400'd.
    // The node must survive; only the connector is rolled back, with an error.
    const spy = makeDeps(async () => detailWith(['n1'], []));
    await handlePasteFailure(new Error('schema rejected connector'), ['n1'], ['c1'], spy.deps);
    expect(spy.dropped.nodes).toEqual([]);
    expect(spy.dropped.connectors).toEqual(['c1']);
    expect(spy.errors).toEqual(['schema rejected connector']);
    expect(spy.applied).toHaveLength(1);
  });

  it('rolls back everything + errors on a genuine total failure', async () => {
    const spy = makeDeps(async () => detailWith([], []));
    await handlePasteFailure(new Error('write failed'), ['n1', 'n2'], ['c1'], spy.deps);
    expect(spy.dropped.nodes).toEqual(['n1', 'n2']);
    expect(spy.dropped.connectors).toEqual(['c1']);
    expect(spy.errors).toEqual(['write failed']);
  });

  it('falls back to dropping everything when the reconcile refetch also fails', async () => {
    const spy = makeDeps(async () => {
      throw new Error('network down');
    });
    await handlePasteFailure(new Error('original'), ['n1'], ['c1'], spy.deps);
    expect(spy.dropped.nodes).toEqual(['n1']);
    expect(spy.dropped.connectors).toEqual(['c1']);
    expect(spy.errors).toEqual(['original']);
    expect(spy.applied).toHaveLength(0); // never applied — refetch threw
  });
});
