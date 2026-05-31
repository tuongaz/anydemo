import { describe, expect, it } from 'bun:test';
import { createRateLimiter } from './share-ratelimit.ts';

describe('createRateLimiter', () => {
  it('allows up to burst consecutive calls within the same instant', () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ ratePerSec: 30, burst: 30, now: () => now });
    for (let i = 0; i < 30; i += 1) {
      expect(limiter.check('peer-1')).toEqual({ ok: true });
    }
  });

  it('denies burst+1 with a positive retryAfterMs', () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ ratePerSec: 30, burst: 30, now: () => now });
    for (let i = 0; i < 30; i += 1) {
      limiter.check('peer-1');
    }
    const res = limiter.check('peer-1');
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected denied');
    expect(res.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills the bucket after sufficient simulated time', () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ ratePerSec: 30, burst: 30, now: () => now });
    for (let i = 0; i < 30; i += 1) {
      limiter.check('peer-1');
    }
    expect(limiter.check('peer-1').ok).toBe(false);
    // Advance one full second — bucket fully refills to capacity.
    now += 1000;
    expect(limiter.check('peer-1')).toEqual({ ok: true });
  });

  it('tracks separate buckets per peerId', () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ ratePerSec: 2, burst: 2, now: () => now });
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(false);
    // 'b' has its own bucket and is untouched.
    expect(limiter.check('b').ok).toBe(true);
    expect(limiter.check('b').ok).toBe(true);
    expect(limiter.check('b').ok).toBe(false);
  });

  it('defaults burst to ratePerSec when unspecified', () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ ratePerSec: 5, now: () => now });
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.check('p').ok).toBe(true);
    }
    expect(limiter.check('p').ok).toBe(false);
  });
});
