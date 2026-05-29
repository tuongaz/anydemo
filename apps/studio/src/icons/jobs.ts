import { randomUUID } from 'node:crypto';
import type { InstallEvent } from './installer-types.ts';
import type { IconVendor } from './paths.ts';

interface Job {
  id: string;
  vendor: IconVendor;
  events: InstallEvent[];
  complete: boolean;
  subscribers: Set<(ev: InstallEvent) => void>;
  endSubscribers: Set<() => void>;
}

export interface JobRegistry {
  create(vendor: IconVendor): string;
  append(id: string, ev: InstallEvent): void;
  markComplete(id: string): void;
  get(id: string): Job | undefined;
  subscribe(id: string, onEvent: (ev: InstallEvent) => void, onEnd: () => void): () => void;
  inFlightFor(vendor: IconVendor): string | undefined;
}

export function createJobRegistry(): JobRegistry {
  const jobs = new Map<string, Job>();
  return {
    create(vendor) {
      for (const j of jobs.values()) {
        if (j.vendor === vendor && !j.complete) {
          throw new Error(`Install for vendor ${vendor} already in flight (job ${j.id})`);
        }
      }
      const id = randomUUID();
      jobs.set(id, {
        id,
        vendor,
        events: [],
        complete: false,
        subscribers: new Set(),
        endSubscribers: new Set(),
      });
      return id;
    },
    append(id, ev) {
      const j = jobs.get(id);
      if (!j) return;
      j.events.push(ev);
      for (const sub of j.subscribers) sub(ev);
    },
    markComplete(id) {
      const j = jobs.get(id);
      if (!j) return;
      j.complete = true;
      for (const onEnd of j.endSubscribers) onEnd();
    },
    get: (id) => jobs.get(id),
    subscribe(id, onEvent, onEnd) {
      const j = jobs.get(id);
      if (!j) return () => undefined;
      for (const ev of j.events) onEvent(ev);
      if (j.complete) {
        onEnd();
        return () => undefined;
      }
      j.subscribers.add(onEvent);
      j.endSubscribers.add(onEnd);
      return () => {
        j.subscribers.delete(onEvent);
        j.endSubscribers.delete(onEnd);
      };
    },
    inFlightFor(vendor) {
      for (const j of jobs.values()) {
        if (j.vendor === vendor && !j.complete) return j.id;
      }
      return undefined;
    },
  };
}
