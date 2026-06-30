import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { slugify } from '../src/registry.ts';
import { uniqueFlowId } from './support/ids.ts';
import { type StudioHandle, spawnStudio } from './support/studio-harness.ts';

// One shared studio per file; every test uses uniqueFlowId for its own project
// so the file-level harness stays parallel-safe (mirrors rest.it.ts).
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
}

interface OnDiskFlow {
  version: number;
  name: string;
  nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>;
}

interface OnDiskStyle {
  nodes?: Record<string, Record<string, unknown>>;
}

const flowApi = (slug: string): string => `/api/projects/${slug.replace('/', '/flows/')}`;

function flowDir(slug: string): string {
  const [projectSlug, flowSlug] = slug.split('/');
  return join(studio.workspace, projectSlug as string, 'flows', flowSlug as string);
}

const readFlowJson = async (slug: string): Promise<OnDiskFlow> =>
  JSON.parse(await Bun.file(join(flowDir(slug), 'flow.json')).text()) as OnDiskFlow;

const readStyleJson = async (slug: string): Promise<OnDiskStyle> => {
  const path = join(flowDir(slug), 'style.json');
  return JSON.parse(await Bun.file(path).text()) as OnDiskStyle;
};

async function createProject(name: string): Promise<CreateProjectResponse> {
  const res = await fetch(`${studio.baseURL}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: join(studio.workspace, slugify(name)), name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreateProjectResponse;
}

const postJson = (path: string, body: unknown): Promise<Response> =>
  fetch(`${studio.baseURL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const patchJson = (path: string, body: unknown): Promise<Response> =>
  fetch(`${studio.baseURL}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const tableData = () => ({
  columns: [
    { id: 'c1', width: 140 },
    { id: 'c2', width: 200 },
  ],
  rows: [
    { id: 'r1', height: 40 },
    { id: 'r2', height: 40 },
  ],
  cells: { 'r1:c1': 'Name', 'r2:c2': '42' },
  headerRow: true,
  borderColor: 'blue',
});

describe('integration: table node', () => {
  it('persists table structure to flow.json and styling to style.json', async () => {
    const created = await createProject(uniqueFlowId('table-create'));

    const res = await postJson(`${flowApi(created.slug)}/nodes`, {
      id: 'tbl-1',
      type: 'table',
      position: { x: 0, y: 0 },
      data: tableData(),
    });
    expect(res.status).toBe(200);

    // Structure + sizing are self-contained in flow.json.
    const flow = await readFlowJson(created.slug);
    const node = flow.nodes.find((n) => n.id === 'tbl-1');
    expect(node?.type).toBe('table');
    const data = node?.data as Record<string, unknown>;
    expect(data.columns).toHaveLength(2);
    expect(data.rows).toHaveLength(2);
    expect(data.cells).toEqual({ 'r1:c1': 'Name', 'r2:c2': '42' });
    expect(data.headerRow).toBe(true);
    // Generic styling routes to style.json, NOT flow.json.
    expect('borderColor' in data).toBe(false);
    const style = await readStyleJson(created.slug);
    expect(style.nodes?.['tbl-1']?.borderColor).toBe('blue');

    // The graph endpoint reloads the on-disk (semantic) node with its structure
    // intact. It reads flow.json directly (no style.json merge), so the visual
    // borderColor is intentionally absent here — that routing is checked above.
    const graph = (await (
      await fetch(`${studio.baseURL}${flowApi(created.slug)}/graph`)
    ).json()) as { nodes: Array<{ id: string; type: string; data: Record<string, unknown> }> };
    const reloaded = graph.nodes.find((n) => n.id === 'tbl-1');
    expect(reloaded?.type).toBe('table');
    expect((reloaded?.data.columns as unknown[]).length).toBe(2);
    expect((reloaded?.data.cells as Record<string, string>)['r1:c1']).toBe('Name');
  });

  it('persists a structural edit (add column + set cell) via PATCH', async () => {
    const created = await createProject(uniqueFlowId('table-edit'));
    await postJson(`${flowApi(created.slug)}/nodes`, {
      id: 'tbl-1',
      type: 'table',
      position: { x: 0, y: 0 },
      data: tableData(),
    });

    // Whole-data patch: append a column and write a new cell (what the canvas
    // sends after addColumn + setCell).
    const patched = await patchJson(`${flowApi(created.slug)}/nodes/tbl-1`, {
      columns: [
        { id: 'c1', width: 140 },
        { id: 'c2', width: 200 },
        { id: 'c3', width: 140 },
      ],
      rows: [
        { id: 'r1', height: 40 },
        { id: 'r2', height: 40 },
      ],
      cells: { 'r1:c1': 'Name', 'r2:c2': '42', 'r1:c3': 'new' },
      headerRow: true,
    });
    expect(patched.status).toBe(200);

    const flow = await readFlowJson(created.slug);
    const data = flow.nodes.find((n) => n.id === 'tbl-1')?.data as Record<string, unknown>;
    expect((data.columns as unknown[]).length).toBe(3);
    expect((data.cells as Record<string, string>)['r1:c3']).toBe('new');
  });

  it('rejects a table created with zero columns', async () => {
    const created = await createProject(uniqueFlowId('table-invalid'));
    const res = await postJson(`${flowApi(created.slug)}/nodes`, {
      id: 'tbl-bad',
      type: 'table',
      position: { x: 0, y: 0 },
      data: { ...tableData(), columns: [] },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
