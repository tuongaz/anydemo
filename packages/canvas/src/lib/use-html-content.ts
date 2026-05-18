import { useEffect, useState } from 'react';
import { fileUrl } from './file-url.ts';
import { subscribeFileChanged } from './file-watch-bus.ts';

/**
 * US-014: discriminated state of an htmlNode's content fetch. The renderer
 * dispatches on `kind`:
 *   • loading — initial / in-flight fetch
 *   • loaded  — sanitization-ready HTML string
 *   • missing — 404 from the file-serving endpoint (renders PlaceholderCard)
 *   • error   — network / other non-404 failure (renders PlaceholderCard)
 */
export type HtmlContentState =
  | { kind: 'loading' }
  | { kind: 'loaded'; html: string }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

const cache = new Map<string, HtmlContentState>();

/** Internal cache key. `projectId` and `htmlPath` are joined with `::` because
 *  neither legally contains that pair (htmlPath rejects absolute / traversal /
 *  empty per US-011; projectId is a generated registry id). */
const cacheKey = (projectId: string, htmlPath: string): string => `${projectId}::${htmlPath}`;

/** Test seam: prime the cache so a hook-shim render observes a specific state
 *  on first call. Production code never calls this. */
export function _setHtmlContentForTest(
  projectId: string,
  htmlPath: string,
  state: HtmlContentState,
): void {
  cache.set(cacheKey(projectId, htmlPath), state);
}

/** Test seam: drop all cached content. Useful in test teardown. */
export function _clearHtmlContentCacheForTest(): void {
  cache.clear();
}

/**
 * Fetch the htmlNode's file via the project file-serving endpoint, cache by
 * `(projectId, htmlPath)`, and refetch whenever:
 *   • the `htmlPath` prop changes, OR
 *   • the watcher (US-002) broadcasts `file:changed` with a matching path.
 *
 * Returns the discriminated state. `projectId` or `htmlPath` being undefined
 * keeps the hook in `loading` — the renderer treats that as "waiting on the
 * runtime data injection from demo-canvas".
 */
export function useHtmlContent(
  projectId: string | undefined,
  htmlPath: string | undefined,
): HtmlContentState {
  const [state, setState] = useState<HtmlContentState>(() => {
    if (!projectId || !htmlPath) return { kind: 'loading' };
    return cache.get(cacheKey(projectId, htmlPath)) ?? { kind: 'loading' };
  });

  useEffect(() => {
    if (!projectId || !htmlPath) {
      setState({ kind: 'loading' });
      return;
    }

    const key = cacheKey(projectId, htmlPath);
    let cancelled = false;
    const cached = cache.get(key);
    if (cached) {
      setState(cached);
    } else {
      setState({ kind: 'loading' });
    }

    const run = async (): Promise<void> => {
      try {
        const res = await fetch(fileUrl(projectId, htmlPath));
        if (cancelled) return;
        if (res.status === 404) {
          const missing: HtmlContentState = { kind: 'missing' };
          cache.set(key, missing);
          setState(missing);
          return;
        }
        if (!res.ok) {
          const err: HtmlContentState = {
            kind: 'error',
            message: `GET ${htmlPath} → ${res.status}`,
          };
          cache.set(key, err);
          setState(err);
          return;
        }
        const html = await res.text();
        if (cancelled) return;
        const loaded: HtmlContentState = { kind: 'loaded', html };
        cache.set(key, loaded);
        setState(loaded);
      } catch (e) {
        if (cancelled) return;
        const err: HtmlContentState = {
          kind: 'error',
          message: e instanceof Error ? e.message : String(e),
        };
        cache.set(key, err);
        setState(err);
      }
    };

    run();

    const unsubscribe = subscribeFileChanged(projectId, (changedPath) => {
      if (changedPath === htmlPath) run();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [projectId, htmlPath]);

  return state;
}
