/**
 * Per-peer token-bucket rate limiter for inbound share frames.
 *
 * Each peer holds a bucket of `burst` tokens, refilling at `ratePerSec`
 * tokens/second. check() deducts a token if available and returns ok; if
 * empty, it returns the milliseconds the caller should wait before retrying.
 * Time is injected via `now()` so tests can drive the bucket synchronously.
 */

export interface RateLimitOk {
  ok: true;
}

export interface RateLimitDenied {
  ok: false;
  retryAfterMs: number;
}

export type RateLimitResult = RateLimitOk | RateLimitDenied;

export interface RateLimiter {
  check(peerId: string): RateLimitResult;
}

export interface RateLimiterOpts {
  ratePerSec: number;
  burst?: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export function createRateLimiter(opts: RateLimiterOpts): RateLimiter {
  const ratePerSec = opts.ratePerSec;
  const capacity = opts.burst ?? opts.ratePerSec;
  const nowFn = opts.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  const refill = (bucket: Bucket, now: number) => {
    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    if (elapsedSec <= 0) return;
    const refilled = bucket.tokens + elapsedSec * ratePerSec;
    bucket.tokens = refilled > capacity ? capacity : refilled;
    bucket.lastRefillMs = now;
  };

  return {
    check(peerId) {
      const now = nowFn();
      let bucket = buckets.get(peerId);
      if (!bucket) {
        bucket = { tokens: capacity, lastRefillMs: now };
        buckets.set(peerId, bucket);
      } else {
        refill(bucket, now);
      }
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { ok: true };
      }
      const deficit = 1 - bucket.tokens;
      const retryAfterMs = Math.ceil((deficit / ratePerSec) * 1000);
      return { ok: false, retryAfterMs };
    },
  };
}
