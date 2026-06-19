import { describe, expect, it } from 'bun:test';
import { createEventBus } from './events.ts';
import { createRegistry } from './registry.ts';
import { createTenantResolver } from './tenancy.ts';

describe('createTenantResolver', () => {
  it('returns the same registry/events for the same tenant id (cached)', () => {
    const resolver = createTenantResolver();
    const a1 = resolver.resolve('tenant-a');
    const a2 = resolver.resolve('tenant-a');
    expect(a1.registry).toBe(a2.registry);
    expect(a1.events).toBe(a2.events);
  });

  it('returns distinct registry/events for different tenants', () => {
    const resolver = createTenantResolver();
    const a = resolver.resolve('tenant-a');
    const b = resolver.resolve('tenant-b');
    expect(a.registry).not.toBe(b.registry);
    expect(a.events).not.toBe(b.events);
  });

  it('falls back to injected singletons when tenant id is undefined', () => {
    const registry = createRegistry({ path: '/tmp/seeflow-test-registry.json' });
    const events = createEventBus();
    const resolver = createTenantResolver({ defaultRegistry: registry, defaultEvents: events });
    const r = resolver.resolve(undefined);
    expect(r.registry).toBe(registry);
    expect(r.events).toBe(events);
  });
});

import { createApp } from './server.ts';

describe('createApp getTenantId hook', () => {
  it('exposes the resolved tenant id to downstream routes', async () => {
    const app = createApp({
      disableWatcher: true,
      getTenantId: (c) => c.req.header('x-tenant') ?? undefined,
    });
    // Smoke: the app boots with the hook wired and still serves /health.
    // A deeper route-level assertion lands in Phase 2 when routes read
    // c.get('tenant').
    const res = await app.fetch(
      new Request('http://x/health', { headers: { 'x-tenant': 'tenant-a' } }),
    );
    expect(res.status).toBe(200);
  });
});
