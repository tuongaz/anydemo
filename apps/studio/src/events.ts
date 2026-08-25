/**
 * In-memory pub/sub keyed by flowId. Subscribers receive every event published
 * for that demo until they unsubscribe; other demos are not notified.
 */

export type StudioEventType = 'flow:reload' | 'file:changed' | 'registry:reload';

export interface StudioEvent {
  type: StudioEventType;
  flowId: string;
  /** Arbitrary JSON-serializable payload. Shape depends on event type. */
  payload: unknown;
  /** Server-side timestamp (ms since epoch). */
  ts: number;
}

export type Subscriber = (event: StudioEvent) => void;

export interface EventBus {
  /** Subscribe to events for a demo. Returns an unsubscribe fn. */
  subscribe(flowId: string, fn: Subscriber): () => void;
  /** Broadcast an event to all subscribers of flowId. */
  broadcast(event: Omit<StudioEvent, 'ts'> & { ts?: number }): void;
  /** Number of active subscribers for a demo (used in tests). */
  subscriberCount(flowId: string): number;
}

export function createEventBus(): EventBus {
  const subs = new Map<string, Set<Subscriber>>();

  return {
    subscribe(flowId, fn) {
      let set = subs.get(flowId);
      if (!set) {
        set = new Set();
        subs.set(flowId, set);
      }
      set.add(fn);
      return () => {
        const current = subs.get(flowId);
        if (!current) return;
        current.delete(fn);
        if (current.size === 0) subs.delete(flowId);
      };
    },
    broadcast(event) {
      const set = subs.get(event.flowId);
      if (!set) return;
      const full: StudioEvent = { ...event, ts: event.ts ?? Date.now() };
      for (const fn of set) {
        try {
          fn(full);
        } catch (err) {
          console.error('[events] subscriber threw, dropping:', err);
        }
      }
    },
    subscriberCount(flowId) {
      return subs.get(flowId)?.size ?? 0;
    },
  };
}
