/**
 * In-memory pub/sub keyed by (tenantId, flowId). Subscribers receive every
 * event published for that (tenant, demo) until they unsubscribe; other
 * tenants and other demos are not notified. `tenantId` is optional — omitting
 * it uses a single shared partition (the single-tenant local studio).
 */

export type StudioEventType =
  | 'flow:reload'
  | 'node:running'
  | 'node:done'
  | 'node:error'
  | 'node:status'
  | 'file:changed'
  | 'registry:reload';

export interface StudioEvent {
  type: StudioEventType;
  flowId: string;
  /** Optional tenant partition. Undefined = the single shared partition. */
  tenantId?: string;
  /** Arbitrary JSON-serializable payload. Shape depends on event type. */
  payload: unknown;
  /** Server-side timestamp (ms since epoch). */
  ts: number;
}

export type Subscriber = (event: StudioEvent) => void;

export interface EventBus {
  /** Subscribe to events for a (tenant, demo). Returns an unsubscribe fn. */
  subscribe(flowId: string, fn: Subscriber, tenantId?: string): () => void;
  /** Broadcast an event to all subscribers of (tenantId, flowId). */
  broadcast(event: Omit<StudioEvent, 'ts'> & { ts?: number }): void;
  /** Number of active subscribers for a (tenant, demo) (used in tests). */
  subscriberCount(flowId: string, tenantId?: string): number;
}

/** Partition key: tenant-scoped when a tenant id is present, else shared. */
const partitionKey = (flowId: string, tenantId?: string): string =>
  tenantId && tenantId.length > 0 ? `${tenantId} ${flowId}` : flowId;

export function createEventBus(): EventBus {
  const subs = new Map<string, Set<Subscriber>>();

  return {
    subscribe(flowId, fn, tenantId) {
      const key = partitionKey(flowId, tenantId);
      let set = subs.get(key);
      if (!set) {
        set = new Set();
        subs.set(key, set);
      }
      set.add(fn);
      return () => {
        const current = subs.get(key);
        if (!current) return;
        current.delete(fn);
        if (current.size === 0) subs.delete(key);
      };
    },
    broadcast(event) {
      const key = partitionKey(event.flowId, event.tenantId);
      const set = subs.get(key);
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
    subscriberCount(flowId, tenantId) {
      return subs.get(partitionKey(flowId, tenantId))?.size ?? 0;
    },
  };
}
