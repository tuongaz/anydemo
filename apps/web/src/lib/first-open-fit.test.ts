import { describe, expect, it } from 'bun:test';
import { decideFirstOpenFit } from '@/lib/first-open-fit';

const base = {
  alreadyFitted: false,
  loading: false,
  hasDetail: true,
  nodeCount: 3,
  rfReady: true,
};

describe('decideFirstOpenFit', () => {
  it('skips when the flow was already framed', () => {
    expect(decideFirstOpenFit({ ...base, alreadyFitted: true })).toBe('skip');
  });

  it('skips (without marking) while the initial load has not settled', () => {
    expect(decideFirstOpenFit({ ...base, loading: true })).toBe('skip');
    expect(decideFirstOpenFit({ ...base, hasDetail: false })).toBe('skip');
  });

  it('marks-only (no fit) when a flow settles empty so the first create never zooms', () => {
    expect(decideFirstOpenFit({ ...base, nodeCount: 0 })).toBe('mark-only');
  });

  it('fits immediately when a non-empty flow settles and the rf instance is ready', () => {
    expect(decideFirstOpenFit(base)).toBe('fit-now');
  });

  it('defers the fit when the rf instance is not ready yet', () => {
    expect(decideFirstOpenFit({ ...base, rfReady: false })).toBe('defer');
  });

  it('does not re-fit a reload/create once the flow is framed (regression)', () => {
    // A node-create or SSE reload re-runs the effect with alreadyFitted=true —
    // it must skip so the viewport stays where the user left it.
    expect(decideFirstOpenFit({ ...base, alreadyFitted: true, nodeCount: 5 })).toBe('skip');
  });
});
