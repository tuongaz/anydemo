import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ProjectSummary } from '@/lib/api';

// Same fetch-mock shape used across apps/web hook tests
// (use-project-flows.test.ts pattern). Tracks every request so we can assert
// the URL/method shape `unregisterProject` produces.
const realFetch = globalThis.fetch;

type MockHandler = (url: string, init?: RequestInit) => { status: number; body: unknown };

function installMock(handler: MockHandler): { calls: Array<{ url: string; method?: string }> } {
  const calls: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = (async (
    input: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, method: init?.method });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls };
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const SAMPLE_PROJECTS: ProjectSummary[] = [
  {
    projectSlug: 'order-pipeline',
    name: 'Order Pipeline',
    defaultFlow: 'main',
    flowCount: 2,
    repoPath: '/tmp/order-pipeline',
  },
];

describe('fetchProjects', () => {
  it('GETs /api/projects and unwraps { projects }', async () => {
    const { fetchProjects } = await import('@/lib/api');
    const { calls } = installMock(() => ({ status: 200, body: { projects: SAMPLE_PROJECTS } }));
    const result = await fetchProjects();
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe('/api/projects');
    expect(result).toEqual(SAMPLE_PROJECTS);
  });

  it('throws with a status-bearing fallback when the request fails', async () => {
    const { fetchProjects } = await import('@/lib/api');
    installMock(() => ({ status: 500, body: { error: 'boom' } }));
    await expect(fetchProjects()).rejects.toThrow('GET /api/projects failed: 500');
  });
});

describe('useProjects hook contract', () => {
  it('exports a useProjects factory', async () => {
    const mod = await import('@/hooks/use-projects');
    expect(typeof mod.useProjects).toBe('function');
  });
});

describe('deleteProject', () => {
  // The unregister flow now calls the project-level DELETE endpoint in one
  // shot. The previous per-flow cascade tripped the studio's last-flow guard
  // on the final entry, leaving the project half-removed; this single-call
  // design bypasses that guard entirely.
  it('issues DELETE /api/projects/:project without deleteSource by default', async () => {
    const { deleteProject } = await import('@/lib/api');
    const { calls } = installMock(() => ({ status: 200, body: { ok: true } }));
    await deleteProject('order-pipeline');
    expect(calls).toEqual([{ url: '/api/projects/order-pipeline', method: 'DELETE' }]);
  });

  it('appends ?deleteSource=true when the caller opts in', async () => {
    const { deleteProject } = await import('@/lib/api');
    const { calls } = installMock(() => ({ status: 200, body: { ok: true } }));
    await deleteProject('order-pipeline', { deleteSource: true });
    expect(calls).toEqual([
      { url: '/api/projects/order-pipeline?deleteSource=true', method: 'DELETE' },
    ]);
  });

  it('omits the query string when deleteSource is explicitly false', async () => {
    const { deleteProject } = await import('@/lib/api');
    const { calls } = installMock(() => ({ status: 200, body: { ok: true } }));
    await deleteProject('order-pipeline', { deleteSource: false });
    expect(calls).toEqual([{ url: '/api/projects/order-pipeline', method: 'DELETE' }]);
  });

  it('surfaces the studio error code in the thrown message', async () => {
    const { deleteProject } = await import('@/lib/api');
    installMock(() => ({ status: 404, body: { error: 'project-not-found' } }));
    await expect(deleteProject('ghost')).rejects.toThrow('project-not-found');
  });

  it('includes the detail when the studio returns one (e.g. source-delete-failed)', async () => {
    const { deleteProject } = await import('@/lib/api');
    installMock(() => ({
      status: 500,
      body: { error: 'source-delete-failed', detail: 'EACCES: permission denied' },
    }));
    await expect(deleteProject('order-pipeline', { deleteSource: true })).rejects.toThrow(
      'source-delete-failed: EACCES: permission denied',
    );
  });

  it('falls back to a status-bearing message when the body has no error field', async () => {
    const { deleteProject } = await import('@/lib/api');
    installMock(() => ({ status: 500, body: {} }));
    await expect(deleteProject('order-pipeline')).rejects.toThrow(
      'DELETE /api/projects/order-pipeline → 500',
    );
  });
});
