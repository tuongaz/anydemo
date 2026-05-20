import { describe, expect, it } from 'bun:test';
import { shortId } from './short-id.ts';

describe('shortId', () => {
  it('returns 10 chars by default', () => {
    expect(shortId()).toHaveLength(10);
  });

  it('honours the requested length', () => {
    expect(shortId(1)).toHaveLength(1);
    expect(shortId(32)).toHaveLength(32);
  });

  it('only emits base62 characters', () => {
    const id = shortId(1000);
    expect(/^[A-Za-z0-9]+$/.test(id)).toBe(true);
  });

  it('does not collide across a large batch', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) ids.add(shortId());
    expect(ids.size).toBe(10_000);
  });
});
