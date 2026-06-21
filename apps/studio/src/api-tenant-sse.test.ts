import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createApi } from './api.ts';
import { createEventBus } from './events.ts';
import { createRegistry } from './registry.ts';
import { createWatcher } from './watcher.ts';

// RC1 regression: a tenant's flow:reload echo must be broadcast on the SAME
// event bus the SSE `/api/events` route subscribes on (the per-tenant bus).
// Before the fix, the per-tenant ops facade was built with the shared DEFAULT
// watcher, so every tenant mutation broadcast on the default bus — where no
// tenant client is subscribed — and the optimistic edit never got its live
// confirmation echo. The studio's own integration tests miss this because they
// run with `disableWatcher: true`, which triggers a route-level tenant-bus
// fallback that production (watcher present) skips.

const VALID_DEMO = {
  version: 2,
  name: 'Checkout Flow',
  nodes: [{ id: 'api-checkout', type: 'rectangle', data: { name: 'POST /checkout' } }],
  connectors: [],
};

const tmpRegistryPath = () =>
  join(mkdtempSync(join(tmpdir(), 'seeflow-tenant-sse-reg-')), 'registry.json');

const tmpRepoWithDemo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-tenant-sse-repo-'));
  writeFileSync(join(dir, 'flow.json'), JSON.stringify(VALID_DEMO));
  return dir;
};

describe('tenant SSE bus wiring (RC1 regression)', () => {
  it('broadcasts a tenant mutation flow:reload on the TENANT bus, not the default bus', async () => {
    // Default (no-tenant) singletons handed to createApi — the local studio.
    const defaultRegistry = createRegistry({ path: tmpRegistryPath() });
    const defaultBus = createEventBus();
    const defaultWatcher = createWatcher({ registry: defaultRegistry, events: defaultBus });

    // Per-tenant singletons — exactly what createTenantResolver builds in cloud:
    // a fresh registry + event bus + a watcher bound to that bus.
    const tenantRegistry = createRegistry({ path: tmpRegistryPath() });
    const tenantBus = createEventBus();
    const tenantWatcher = createWatcher({ registry: tenantRegistry, events: tenantBus });

    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-x');
      c.set('tenant', { registry: tenantRegistry, events: tenantBus, watcher: tenantWatcher });
      return next();
    });
    app.route(
      '/api',
      createApi({ registry: defaultRegistry, events: defaultBus, watcher: defaultWatcher }),
    );

    try {
      // Register the flow under the TENANT registry (the middleware routes it).
      const repoPath = tmpRepoWithDemo();
      const regRes = await app.request('/api/flows/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoPath, flowPath: 'flow.json' }),
      });
      expect(regRes.status).toBe(200);
      const reg = (await regRes.json()) as { id: string; slug: string };
      const [project, flow] = reg.slug.split('/');

      // Subscribe to BOTH buses on the flow channel and prove the echo lands on
      // the tenant bus only.
      const tenantCaptured: string[] = [];
      const defaultCaptured: string[] = [];
      tenantBus.subscribe(reg.id, (e) => tenantCaptured.push(e.type));
      defaultBus.subscribe(reg.id, (e) => defaultCaptured.push(e.type));

      // Edit a node — the exact "edit a node" path from the bug report.
      const patchRes = await app.request(
        `/api/projects/${project}/flows/${flow}/nodes/api-checkout`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed checkout' }),
        },
      );
      expect(patchRes.status).toBe(200);

      expect(tenantCaptured).toContain('flow:reload');
      expect(defaultCaptured).not.toContain('flow:reload');
    } finally {
      defaultWatcher.closeAll();
      tenantWatcher.closeAll();
    }
  });
});
