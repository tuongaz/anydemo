import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { slugify } from '../src/registry.ts';
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
}

interface OnDiskFlow {
  version: number;
  name: string;
  nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>;
  connectors: Array<{ id: string }>;
}

interface OnDiskStyle {
  nodes?: Record<
    string,
    {
      position?: { x: number; y: number };
      width?: number;
      height?: number;
      color?: string;
      strokeWidth?: number;
    } & Record<string, unknown>
  >;
}

async function createProject(name: string): Promise<CreateProjectResponse> {
  const res = await fetch(`${studio.baseURL}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: join(studio.workspace, slugify(name)), name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreateProjectResponse;
}

// Per-flow HTTP routes live under /api/projects/:project/flows/:flow/...
// `created.slug` is `${projectSlug}/${flowSlug}`; substituting the inner `/`
// for `/flows/` produces the new path with no parsing.
function flowApi(slug: string): string {
  return `/api/projects/${slug.replace('/', '/flows/')}`;
}

// On-disk flow + style files live under `<projectSlug>/flows/<flowSlug>/`.
function flowDir(slug: string): string {
  const [projectSlug, flowSlug] = slug.split('/');
  return join(studio.workspace, projectSlug as string, 'flows', flowSlug as string);
}

async function readFlowJson(slug: string): Promise<OnDiskFlow> {
  const path = join(flowDir(slug), 'flow.json');
  return JSON.parse(await Bun.file(path).text()) as OnDiskFlow;
}

async function readStyleJson(slug: string): Promise<OnDiskStyle> {
  const path = join(flowDir(slug), 'style.json');
  if (!existsSync(path)) return {};
  return JSON.parse(await Bun.file(path).text()) as OnDiskStyle;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${studio.baseURL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// The pen tool commits a `freehand` node carrying a normalized [x, y, pressure]
// points array. The studio writer (splitFlow) must keep `points` in flow.json
// (it's a semantic data key, unknown to NODE_STYLE_KEYS so it falls through to
// flowData) while routing the box + style fields — position / width / height /
// color / strokeWidth — to style.json, exactly like an icon node.
describe('integration: REST — freehand node round-trip (flow.json points / style.json box)', () => {
  it('splits a pen-tool stroke: points → flow.json, box + style → style.json', async () => {
    const created = await createProject(uniqueFlowId('freehand-rt'));

    // A short, deliberately non-collinear stroke: normalized to the node box
    // so x/y land in 0..1, pressure in 0..1. Mirrors what the pen tool commits.
    const points: Array<[number, number, number]> = [
      [0, 0, 0.5],
      [0.25, 0.5, 0.6],
      [0.5, 0.2, 0.7],
      [0.75, 0.9, 0.55],
      [1, 1, 0.5],
    ];

    const addRes = await postJson(`${flowApi(created.slug)}/nodes`, {
      id: 'ink-1',
      type: 'freehand',
      position: { x: 120, y: 240 },
      data: {
        points,
        width: 80,
        height: 64,
        color: 'red',
        strokeWidth: 2,
      },
    });
    expect(addRes.status).toBe(200);
    const addBody = (await addRes.json()) as { ok: boolean; id: string };
    expect(addBody.ok).toBe(true);
    expect(addBody.id).toBe('ink-1');

    // flow.json: the node is type 'freehand' and carries the points array.
    const onDisk = await readFlowJson(created.slug);
    const node = onDisk.nodes.find((n) => n.id === 'ink-1');
    expect(node).toBeDefined();
    expect(node?.type).toBe('freehand');
    expect(node?.data?.points).toEqual(points);
    // Box + style fields must NOT leak into flow.json — splitFlow routes them
    // to the style side-table.
    expect(node?.data?.width).toBeUndefined();
    expect(node?.data?.height).toBeUndefined();
    expect(node?.data?.position).toBeUndefined();
    expect(node?.data?.color).toBeUndefined();
    expect(node?.data?.strokeWidth).toBeUndefined();

    // style.json: position + width + height + color + strokeWidth all land in
    // the side-table under the node id.
    const style = await readStyleJson(created.slug);
    const entry = style.nodes?.['ink-1'];
    expect(entry).toBeDefined();
    expect(entry?.position).toEqual({ x: 120, y: 240 });
    expect(entry?.width).toBe(80);
    expect(entry?.height).toBe(64);
    expect(entry?.color).toBe('red');
    expect(entry?.strokeWidth).toBe(2);
    // The points array stays out of style.json (it lives in flow.json).
    expect((entry as Record<string, unknown> | undefined)?.points).toBeUndefined();
  });

  it('rejects a freehand node with fewer than 2 points (schema min)', async () => {
    const created = await createProject(uniqueFlowId('freehand-min'));

    const addRes = await postJson(`${flowApi(created.slug)}/nodes`, {
      id: 'ink-bad',
      type: 'freehand',
      data: { points: [[0, 0, 0.5]] },
    });
    expect(addRes.status).toBe(400);

    // The strict failure rolls back the write — no stranded node on disk.
    const onDisk = await readFlowJson(created.slug);
    expect(onDisk.nodes.find((n) => n.id === 'ink-bad')).toBeUndefined();
  });
});
