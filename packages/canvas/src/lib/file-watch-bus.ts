/**
 * US-014: tiny pub/sub on top of the studio SSE stream.
 *
 * One `EventSource` per `projectId` is opened lazily on the first subscriber
 * and closed when the last subscriber unsubscribes. Every `file:changed` event
 * emitted by the watcher (US-002) is fanned out to all current listeners for
 * that project — listeners filter on `path` themselves.
 *
 * Shared across all `useHtmlContent` instances on the page so 10 htmlNodes
 * pointing at 10 different files cost ONE SSE connection per project, not 10.
 */
type Listener = (path: string) => void;

interface BusEntry {
  source: { close: () => void };
  listeners: Set<Listener>;
  refCount: number;
}

type EventSourceLike = {
  close: () => void;
  addEventListener: (type: string, handler: (e: MessageEvent) => void) => void;
};

/** Test seam: caller can substitute a fake EventSource constructor. The
 *  production default points at the global `EventSource`. SSR / non-browser
 *  runtimes (Bun's test runtime) return `null` so the bus stays inert. */
export type EventSourceFactory = (url: string) => EventSourceLike | null;

const defaultFactory: EventSourceFactory = (url) => {
  if (typeof EventSource === 'undefined') return null;
  return new EventSource(url) as unknown as EventSourceLike;
};

const buses = new Map<string, BusEntry>();

let factoryOverride: EventSourceFactory | null = null;

/** Test seam: install a fake EventSource factory for the next subscriber that
 *  opens a fresh bus. Call again with `null` to restore the default. Existing
 *  open buses are NOT replaced — they keep their original source. */
export function _setEventSourceFactoryForTest(factory: EventSourceFactory | null): void {
  factoryOverride = factory;
}

/** Test seam: tear down every open bus. Cheap to call in test teardown. */
export function _resetFileWatchBusForTest(): void {
  for (const entry of buses.values()) entry.source.close();
  buses.clear();
}

/**
 * Subscribe to `file:changed` events for `projectId`. Returns an unsubscribe
 * function that decrements the refcount and closes the underlying SSE
 * connection when no listeners remain.
 */
export function subscribeFileChanged(projectId: string, listener: Listener): () => void {
  let entry = buses.get(projectId);
  if (!entry) {
    const factory = factoryOverride ?? defaultFactory;
    const source = factory(`/api/events?demoId=${encodeURIComponent(projectId)}`);
    if (!source) {
      // SSR / non-browser runtime — the listener will never be called but the
      // unsubscribe callback still needs to be safe to invoke.
      return () => {};
    }
    const newEntry: BusEntry = { source, listeners: new Set(), refCount: 0 };
    source.addEventListener('file:changed', (e: MessageEvent) => {
      let path: unknown = undefined;
      try {
        const parsed = JSON.parse(e.data) as { path?: unknown };
        path = parsed.path;
      } catch {
        return;
      }
      if (typeof path !== 'string') return;
      for (const l of newEntry.listeners) l(path);
    });
    buses.set(projectId, newEntry);
    entry = newEntry;
  }
  entry.listeners.add(listener);
  entry.refCount += 1;
  return () => {
    const current = buses.get(projectId);
    if (!current) return;
    current.listeners.delete(listener);
    current.refCount -= 1;
    if (current.refCount === 0) {
      current.source.close();
      buses.delete(projectId);
    }
  };
}
