import { describe, expect, it } from 'bun:test';
import type { FlowSummary } from '@/lib/api';
import { pickInitialDemo } from '@/lib/last-project';

const summary = (id: string, slug: string): FlowSummary => ({
  id,
  slug,
  name: slug,
  repoPath: `/tmp/${slug}`,
  lastModified: 0,
  valid: true,
});

describe('pickInitialDemo', () => {
  it('returns null when there are no demos', () => {
    expect(pickInitialDemo([], null)).toBeNull();
    expect(pickInitialDemo([], 'anything')).toBeNull();
  });

  it('returns the only demo when exactly one is registered (ignoring stored id)', () => {
    const a = summary('a', 'alpha');
    expect(pickInitialDemo([a], null)).toBe(a);
    expect(pickInitialDemo([a], 'stale')).toBe(a);
  });

  it('returns the demo matching the stored id when 2+ are registered', () => {
    const a = summary('a', 'alpha');
    const b = summary('b', 'beta');
    expect(pickInitialDemo([a, b], 'b')).toBe(b);
  });

  it('returns null with 2+ demos and no stored id so the picker shows', () => {
    const a = summary('a', 'alpha');
    const b = summary('b', 'beta');
    expect(pickInitialDemo([a, b], null)).toBeNull();
  });

  it('returns null with 2+ demos when stored id is no longer in the registry', () => {
    const a = summary('a', 'alpha');
    const b = summary('b', 'beta');
    expect(pickInitialDemo([a, b], 'gone')).toBeNull();
  });
});
