import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './server.ts';

// Phase-2 tenancy: studio routes must read/write the per-request tenant
// registry (c.get('tenant')), not the shared singleton. Without it, every
// authenticated cloud user sees every other user's projects (the reported
// "I can see everyone's project in the list" bug) and a `/p/` editor resolves
// the wrong registry → 404.

describe('GET/POST /api/projects tenant isolation', () => {
  let workspace: string;
  let prevWorkspace: string | undefined;

  beforeEach(() => {
    prevWorkspace = process.env.SEEFLOW_WORKSPACE;
    workspace = mkdtempSync(join(tmpdir(), 'seeflow-tenancy-'));
    process.env.SEEFLOW_WORKSPACE = workspace;
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: assigning undefined would store the string "undefined"; we need the var truly unset.
    if (prevWorkspace === undefined) delete process.env.SEEFLOW_WORKSPACE;
    else process.env.SEEFLOW_WORKSPACE = prevWorkspace;
    rmSync(workspace, { recursive: true, force: true });
  });

  const app = () =>
    createApp({
      mode: 'prod',
      staticRoot: join(workspace, '__nosuch_static__'),
      disableWatcher: true,
      getTenantId: (c) => c.req.header('x-tenant') ?? undefined,
    });

  const listProjects = async (a: ReturnType<typeof app>, tenant: string): Promise<string[]> => {
    const res = await a.fetch(
      new Request('http://x/api/projects', { headers: { 'x-tenant': tenant } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: Array<{ projectSlug: string }> };
    return body.projects.map((p) => p.projectSlug);
  };

  it("does not leak one tenant's project into another tenant's listing", async () => {
    const a = app();

    const created = await a.fetch(
      new Request('http://x/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant': 'tenant-a' },
        body: JSON.stringify({ name: 'Alpha Project' }),
      }),
    );
    expect(created.status).toBe(200);

    // The owner sees it; a different tenant must NOT.
    expect(await listProjects(a, 'tenant-a')).toContain('alpha-project');
    expect(await listProjects(a, 'tenant-b')).not.toContain('alpha-project');
    expect(await listProjects(a, 'tenant-b')).toEqual([]);
  });

  it("does not let another tenant resolve the owner's flow (the /p 404 path)", async () => {
    const a = app();

    const created = await a.fetch(
      new Request('http://x/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant': 'owner' },
        body: JSON.stringify({ name: 'Secret' }),
      }),
    );
    expect(created.status).toBe(200);

    const flowUrl = 'http://x/api/projects/secret/flows/main';
    const owned = await a.fetch(new Request(flowUrl, { headers: { 'x-tenant': 'owner' } }));
    expect(owned.status).toBe(200);

    const stranger = await a.fetch(new Request(flowUrl, { headers: { 'x-tenant': 'stranger' } }));
    expect(stranger.status).toBe(404);
  });
});
