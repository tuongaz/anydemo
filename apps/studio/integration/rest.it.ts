import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { uniqueFlowId } from './support/ids.ts';
import { type StudioHandle, spawnStudio } from './support/studio-harness.ts';

// One shared studio per file — every test uses uniqueFlowId for its own
// project name, so the file-level harness stays parallel-safe.
let studio: StudioHandle;

beforeAll(async () => {
  studio = await spawnStudio();
});

afterAll(async () => {
  if (studio) await studio.stop();
});

interface CreateProjectResponse {
  id: string;
  slug: string;
  scaffolded: boolean;
}

interface FlowListItem {
  id: string;
  slug: string;
  name: string;
  repoPath: string;
  lastModified: number;
  valid: boolean;
}

interface FlowGetResponse {
  id: string;
  slug: string;
  name: string;
  filePath: string;
  flow: { version: number; name: string } | null;
  valid: boolean;
  error: string | null;
}

interface RegisterResponse {
  id: string;
  slug: string;
  sdk: { outcome: string; filePath: string | null };
}

interface ValidateReport {
  ok: boolean;
  stats: { tier: string; nodeCount: number; connectorCount: number };
  issues: Array<{ kind: string; path?: string; message: string }>;
  warnings: Array<{ kind: string; path?: string; message: string }>;
}

async function createProject(name: string): Promise<CreateProjectResponse> {
  const res = await fetch(`${studio.baseURL}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreateProjectResponse;
}

describe('integration: REST — flow lifecycle', () => {
  describe('GET /healthz', () => {
    it('returns 200 with { status: "ok" }', async () => {
      const res = await fetch(`${studio.baseURL}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    });
  });

  describe('POST /api/projects', () => {
    it('creates a flow dir + flow.json on disk and registers it', async () => {
      const name = uniqueFlowId('create-project');
      const created = await createProject(name);
      expect(created.id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(created.slug).toBeTruthy();
      expect(created.scaffolded).toBe(true);

      const flowPath = join(studio.workspace, created.slug, '.seeflow', 'flow.json');
      expect(existsSync(flowPath)).toBe(true);
      const parsed = JSON.parse(await Bun.file(flowPath).text()) as {
        version: number;
        name: string;
        nodes: unknown[];
        connectors: unknown[];
      };
      expect(parsed.version).toBe(2);
      expect(parsed.name).toBe(name);
      expect(parsed.nodes).toEqual([]);
      expect(parsed.connectors).toEqual([]);
    });
  });

  describe('GET /api/flows', () => {
    it('list includes a newly-created flow', async () => {
      const name = uniqueFlowId('list-flows');
      const created = await createProject(name);

      const res = await fetch(`${studio.baseURL}/api/flows`);
      expect(res.status).toBe(200);
      const list = (await res.json()) as FlowListItem[];
      expect(Array.isArray(list)).toBe(true);
      const entry = list.find((f) => f.id === created.id);
      expect(entry).toBeDefined();
      expect(entry?.slug).toBe(created.slug);
      expect(entry?.name).toBe(name);
      expect(entry?.valid).toBe(true);
    });
  });

  describe('GET /api/flows/:id', () => {
    it('returns the expected shape for a registered flow', async () => {
      const name = uniqueFlowId('get-flow');
      const created = await createProject(name);

      const res = await fetch(`${studio.baseURL}/api/flows/${created.id}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as FlowGetResponse;
      expect(body.id).toBe(created.id);
      expect(body.slug).toBe(created.slug);
      expect(body.name).toBe(name);
      expect(body.valid).toBe(true);
      expect(body.error).toBeNull();
      expect(body.flow).not.toBeNull();
      expect(body.flow?.name).toBe(name);
      expect(body.filePath).toContain(`${created.slug}`);
      expect(body.filePath.endsWith('flow.json')).toBe(true);
    });
  });

  describe('POST /api/flows/register', () => {
    // PRD listed `/api/flows/:id/register`; the real route is `/api/flows/register`
    // and the request body identifies the flow by `{ repoPath, flowPath }` — see
    // RegisterBodySchema in operations.ts. We write a flow.json under a sibling
    // of `studio.workspace` and register it via that path.
    it('registers an existing on-disk flow into the registry', async () => {
      const slug = uniqueFlowId('register-flow');
      const repoPath = join(studio.home, slug);
      const seeflowDir = join(repoPath, '.seeflow');
      mkdirSync(seeflowDir, { recursive: true });
      const flowJson = { version: 2, name: slug, nodes: [], connectors: [] };
      writeFileSync(join(seeflowDir, 'flow.json'), `${JSON.stringify(flowJson, null, 2)}\n`);

      const res = await fetch(`${studio.baseURL}/api/flows/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoPath, flowPath: '.seeflow/flow.json' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as RegisterResponse;
      expect(body.id).toBeTruthy();
      expect(body.slug).toBeTruthy();
      expect(typeof body.sdk.outcome).toBe('string');

      // Side effect: it's now listed by GET /api/flows.
      const list = (await (await fetch(`${studio.baseURL}/api/flows`)).json()) as FlowListItem[];
      expect(list.find((f) => f.id === body.id)).toBeDefined();
    });
  });

  describe('POST /api/flows/validate', () => {
    // PRD listed `/api/flows/:id/validate`; the real route is `/api/flows/validate`
    // and the body is `{ demo, tier? }` per ValidateRequestSchema in diagram.ts.
    it('accepts a valid demo and returns ok: true with no issues', async () => {
      const demo = {
        version: 2,
        name: uniqueFlowId('validate-demo'),
        nodes: [],
        connectors: [],
      };
      const res = await fetch(`${studio.baseURL}/api/flows/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ demo }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ValidateReport;
      expect(body.ok).toBe(true);
      expect(body.issues).toEqual([]);
      expect(body.stats.nodeCount).toBe(0);
      expect(body.stats.connectorCount).toBe(0);
    });
  });

  describe('DELETE /api/flows/:id', () => {
    // deleteFlowImpl only removes the registry entry (and unwatches) — the
    // flow.json on disk is intentionally preserved. The PRD's "removes from
    // disk" wording is loose; this test asserts the actual behavior.
    it('removes the flow from the registry (file on disk is untouched)', async () => {
      const name = uniqueFlowId('delete-flow');
      const created = await createProject(name);
      const flowPath = join(studio.workspace, created.slug, '.seeflow', 'flow.json');
      expect(existsSync(flowPath)).toBe(true);

      // Sanity: registered.
      const before = (await (await fetch(`${studio.baseURL}/api/flows`)).json()) as FlowListItem[];
      expect(before.find((f) => f.id === created.id)).toBeDefined();

      const res = await fetch(`${studio.baseURL}/api/flows/${created.id}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Registry: gone.
      const after = (await (await fetch(`${studio.baseURL}/api/flows`)).json()) as FlowListItem[];
      expect(after.find((f) => f.id === created.id)).toBeUndefined();
      const get = await fetch(`${studio.baseURL}/api/flows/${created.id}`);
      expect(get.status).toBe(404);

      // Disk: flow.json is intentionally preserved.
      expect(existsSync(flowPath)).toBe(true);
    });
  });
});
