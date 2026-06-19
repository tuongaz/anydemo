import type { Context } from 'hono';
import { type EventBus, createEventBus } from './events.ts';
import { type Registry, createRegistry, manifestOnlyEntryFilter } from './registry.ts';
import { join } from 'node:path';
import { seeflowHome } from './paths.ts';

/** The per-request tenant state downstream handlers consume. */
export interface TenantContext {
  registry: Registry;
  events: EventBus;
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
      ? { registry: options.defaultRegistry, events: options.defaultEvents }
      : undefined;

  return {
    resolve(tenantId) {
      if (!tenantId || tenantId.length === 0) {
        if (fallback) return fallback;
        // No injected default and no tenant: build a process-wide singleton
        // lazily so callers without injected state still get one.
        let shared = cache.get('');
        if (!shared) {
          shared = {
            registry: createRegistry({ isLoadableEntry: manifestOnlyEntryFilter }),
            events: createEventBus(),
          };
          cache.set('', shared);
        }
        return shared;
      }
      let tc = cache.get(tenantId);
      if (!tc) {
        tc = {
          registry: createRegistry({
            path: join(seeflowHome(tenantId), 'registry.json'),
            isLoadableEntry: manifestOnlyEntryFilter,
          }),
          events: createEventBus(),
        };
        cache.set(tenantId, tc);
      }
      return tc;
    },
  };
}

/** Default no-op tenant hook: single-tenant local studio. */
export const noTenant = (_ctx: Context): string | undefined => undefined;
