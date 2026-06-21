import { join } from 'node:path';
import type { Context } from 'hono';
import { type EventBus, createEventBus } from './events.ts';
import { seeflowHome } from './paths.ts';
import { type Registry, createRegistry, manifestOnlyEntryFilter } from './registry.ts';
import type { FlowWatcher } from './watcher.ts';

/** The per-request tenant state downstream handlers consume. */
export interface TenantContext {
  registry: Registry;
  events: EventBus;
  /**
   * Flow watcher BOUND TO THIS TENANT'S `events` bus. Mutations route their
   * `flow:reload` broadcast through this watcher (`notifyWritten`), and the
   * SSE `/events` route subscribes on the same `events` bus — so a tenant
   * client actually receives the live echo. A shared default watcher (wired to
   * the process-wide bus) would broadcast where no tenant subscriber is
   * listening. Undefined only when no watcher factory is injected (tests that
   * pass `disableWatcher`, or a host that never enables watching).
   */
  watcher?: FlowWatcher;
}

declare module 'hono' {
  interface ContextVariableMap {
    tenantId?: string;
    tenant: TenantContext;
  }
}

export interface TenantResolverOptions {
  /** Used when a request resolves no tenant id (single-tenant local studio). */
  defaultRegistry?: Registry;
  defaultEvents?: EventBus;
  /** Watcher for the default (no-tenant) context. The local studio's boot
   *  watcher; reused so single-tenant behaviour is unchanged. */
  defaultWatcher?: FlowWatcher;
  /**
   * Factory that builds a fresh watcher for a newly-created tenant context,
   * bound to that tenant's own registry + event bus. Injected by the host
   * (server.ts) so tenancy.ts stays decoupled from watcher.ts at runtime.
   * When omitted, per-tenant contexts carry no watcher (tests / local studio
   * with watching disabled). The watcher is `watchAll()`-seeded on creation so
   * the tenant's already-registered flows surface snapshots + fs-watch on the
   * tenant bus.
   */
  createWatcher?: (registry: Registry, events: EventBus) => FlowWatcher;
}

export interface TenantResolver {
  /** Build-or-fetch the cached registry/events for a tenant id. */
  resolve(tenantId: string | undefined): TenantContext;
}

/**
 * Factory keyed by tenant id. Each tenant gets its own registry (persisted
 * under seeflowHome(tenantId)/registry.json) and its own event bus, built
 * lazily and cached for the process lifetime. When tenantId is undefined the
 * injected default singletons are used — the local studio's behavior.
 *
 * Provider-agnostic: knows nothing about how a tenant id is produced (auth,
 * Clerk, etc.). The host supplies getTenantId(ctx); see createApp.
 */
export function createTenantResolver(options: TenantResolverOptions = {}): TenantResolver {
  const cache = new Map<string, TenantContext>();
  const fallback: TenantContext | undefined =
    options.defaultRegistry && options.defaultEvents
      ? {
          registry: options.defaultRegistry,
          events: options.defaultEvents,
          watcher: options.defaultWatcher,
        }
      : undefined;

  // Build a watcher bound to the tenant's own bus and seed it against the
  // tenant's already-registered flows. Mirrors the default watcher's
  // boot-time watchAll() so a tenant's flow:reload echo, snapshots, and
  // external-edit fs-watch all ride the tenant bus the SSE route subscribes on.
  const buildWatcher = (registry: Registry, events: EventBus): FlowWatcher | undefined => {
    if (!options.createWatcher) return undefined;
    const w = options.createWatcher(registry, events);
    w.watchAll();
    return w;
  };

  return {
    resolve(tenantId) {
      if (!tenantId || tenantId.length === 0) {
        if (fallback) return fallback;
        // No injected default and no tenant: build a process-wide singleton
        // lazily so callers without injected state still get one.
        let shared = cache.get('');
        if (!shared) {
          const registry = createRegistry({ isLoadableEntry: manifestOnlyEntryFilter });
          const events = createEventBus();
          shared = { registry, events, watcher: buildWatcher(registry, events) };
          cache.set('', shared);
        }
        return shared;
      }
      let tc = cache.get(tenantId);
      if (!tc) {
        const registry = createRegistry({
          path: join(seeflowHome(tenantId), 'registry.json'),
          isLoadableEntry: manifestOnlyEntryFilter,
        });
        const events = createEventBus();
        tc = { registry, events, watcher: buildWatcher(registry, events) };
        cache.set(tenantId, tc);
      }
      return tc;
    },
  };
}

/** Default no-op tenant hook: single-tenant local studio. */
export const noTenant = (_ctx: Context): string | undefined => undefined;
