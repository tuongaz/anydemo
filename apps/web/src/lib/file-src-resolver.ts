import { apiFetch } from './api-client.ts';

/**
 * Cloud/authed-mode resolver for file-backed nodes (type:'image').
 *
 * A native `<img src="/api/projects/:id/files/:path">` GET cannot carry an
 * `Authorization` header, so in the cloud the token-gated file route 401s and
 * the image renders broken. This resolver fetches the asset through `apiFetch`
 * (which attaches a fresh bearer token and re-auths on 401) and hands back a
 * `blob:` URL the `<img>` can display.
 *
 * Resolved blob URLs are cached briefly and revoked after a short TTL — long
 * enough to dedupe re-renders / re-mounts, short enough that the object URLs
 * don't accumulate. Each (re)fetch after expiry gets a fresh token, so this is
 * robust against short-lived (~60s) session tokens.
 */

const TTL_MS = 60_000;

interface CacheEntry {
  blobUrl: string;
  /** Timestamp (ms) the entry was created. */
  ts: number;
  /** Pending fetch so concurrent renders of the same URL share one request. */
  inflight?: Promise<string>;
}

const cache = new Map<string, CacheEntry>();

function revoke(blobUrl: string): void {
  const u = (globalThis as { URL?: { revokeObjectURL?: (s: string) => void } }).URL;
  u?.revokeObjectURL?.(blobUrl);
}

function scheduleRevoke(url: string, blobUrl: string): void {
  setTimeout(() => {
    const cur = cache.get(url);
    if (cur && cur.blobUrl === blobUrl) {
      cache.delete(url);
      revoke(blobUrl);
    }
  }, TTL_MS);
}

export async function resolveFileSrc(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit) {
    if (hit.inflight) return hit.inflight;
    if (Date.now() - hit.ts < TTL_MS) return hit.blobUrl;
    // Expired but not yet revoked — drop it and refetch with a fresh token.
    cache.delete(url);
    revoke(hit.blobUrl);
  }

  const inflight = (async () => {
    const res = await apiFetch(url);
    if (!res.ok) throw new Error(`file fetch failed: ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    cache.set(url, { blobUrl, ts: Date.now() });
    scheduleRevoke(url, blobUrl);
    return blobUrl;
  })();

  // Hold the in-flight promise so concurrent callers dedupe onto one request.
  cache.set(url, { blobUrl: '', ts: Date.now(), inflight });
  try {
    return await inflight;
  } catch (err) {
    // Clear the failed placeholder so a later render can retry.
    const cur = cache.get(url);
    if (cur?.inflight === inflight) cache.delete(url);
    throw err;
  }
}

/** Test-only: drop all cached entries and revoke their blob URLs. */
export function __clearFileSrcCache(): void {
  for (const entry of cache.values()) {
    if (entry.blobUrl) revoke(entry.blobUrl);
  }
  cache.clear();
}
