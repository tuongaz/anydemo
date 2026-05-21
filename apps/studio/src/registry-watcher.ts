import { type FSWatcher, existsSync, readFileSync, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { EventBus } from './events.ts';
import type { Registry } from './registry.ts';

const DEFAULT_DEBOUNCE_MS = 100;

/**
 * Internal sentinel flowId used to broadcast registry-scoped events on the
 * (flowId-keyed) EventBus. SSE consumers subscribe to this exact channel.
 */
export const REGISTRY_CHANNEL = '__registry__';

export interface RegistryWatcherDeps {
  registry: Registry;
  events: EventBus;
  /** Override for tests. */
  debounceMs?: number;
}

export interface RegistryWatcher {
  start(): void;
  close(): void;
}

export function createRegistryWatcher(deps: RegistryWatcherDeps): RegistryWatcher {
  const { registry, events } = deps;
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const filePath = registry.path;
  const dir = dirname(filePath);
  const base = basename(filePath);

  let fsWatcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let started = false;

  const onChange = () => {
    if (!existsSync(filePath)) return;
    let contents: string;
    try {
      contents = readFileSync(filePath, 'utf8');
    } catch {
      return;
    }
    if (registry.isOwnWrite(contents)) return;
    registry.reload();
    events.broadcast({
      type: 'registry:reload',
      flowId: REGISTRY_CHANNEL,
      payload: {},
    });
  };

  return {
    start() {
      if (started) return;
      started = true;
      if (!existsSync(dir)) {
        // Parent directory may not exist yet on a clean machine. The studio
        // creates it on first persist, but we'd miss that event. Bail without
        // throwing — callers can choose to start() again later.
        return;
      }
      try {
        fsWatcher = watch(dir, { persistent: true }, (_event, changed) => {
          if (changed && changed !== base) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            onChange();
          }, debounceMs);
        });
      } catch (err) {
        console.error(`[registry-watcher] failed to watch ${dir}:`, err);
      }
    },
    close() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      if (fsWatcher) fsWatcher.close();
      fsWatcher = null;
      started = false;
    },
  };
}
