import { describe, expect, it } from 'bun:test';
import type { FlowSummary } from '@/lib/api';
import { pickLandingFlow } from '@/lib/last-project';

const summary = (id: string, slug: string): FlowSummary => ({
  id,
  slug,
  name: slug,
  repoPath: `/tmp/${slug}`,
  lastModified: 0,
  valid: true,
});

describe('pickLandingFlow', () => {
  it('returns null when there are no flows', () => {
    expect(pickLandingFlow([], null)).toBeNull();
    expect(pickLandingFlow([], 'anything')).toBeNull();
  });

  it('returns the only flow when exactly one is registered (ignoring stored id)', () => {
    const a = summary('a', 'alpha');
    expect(pickLandingFlow([a], null)).toBe(a);
    expect(pickLandingFlow([a], 'stale')).toBe(a);
  });

  it('returns the flow matching the stored id when 2+ are registered', () => {
    const a = summary('a', 'alpha');
    const b = summary('b', 'beta');
    expect(pickLandingFlow([a, b], 'b')).toBe(b);
  });

  it('returns null with 2+ flows and no stored id so the picker shows', () => {
    const a = summary('a', 'alpha');
    const b = summary('b', 'beta');
    expect(pickLandingFlow([a, b], null)).toBeNull();
  });

  it('returns null with 2+ flows when stored id is no longer in the registry', () => {
    const a = summary('a', 'alpha');
    const b = summary('b', 'beta');
    expect(pickLandingFlow([a, b], 'gone')).toBeNull();
  });
});
