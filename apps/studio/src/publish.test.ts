import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishProject } from './publish.ts';

function root(): string {
  const r = join(tmpdir(), `sf-pub-${crypto.randomUUID()}`);
  mkdirSync(r, { recursive: true });
  writeFileSync(
    join(r, 'flow.json'),
    JSON.stringify({ version: 1, name: 'N', nodes: [], connectors: [] }),
  );
  return r;
}

test('first publish posts without a project id and stores the returned id', async () => {
  const r = root();
  let seenBody: any;
  const fakeFetch = async (_url: string, init: any) => {
    seenBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ projectId: 'proj_new' }), { status: 200 });
  };
  const res = await publishProject({
    root: r,
    baseUrl: 'https://cloud.seeflow.dev',
    token: 'tok',
    fetchImpl: fakeFetch as unknown as typeof fetch,
  });
  expect(seenBody.projectId).toBeUndefined();
  expect(seenBody.bundle.files.some((f: any) => f.path === 'flow.json')).toBe(true);
  expect(res.projectId).toBe('proj_new');
  expect(
    JSON.parse(readFileSync(join(r, '.seeflow', 'cloud.json'), 'utf8'))['https://cloud.seeflow.dev']
      .projectId,
  ).toBe('proj_new');
});

test('re-publish sends the stored project id (update in place)', async () => {
  const r = root();
  let seenId: unknown;
  const f1 = async () => new Response(JSON.stringify({ projectId: 'proj_x' }), { status: 200 });
  await publishProject({ root: r, baseUrl: 'https://c.dev', token: 't', fetchImpl: f1 as unknown as typeof fetch });
  const f2 = async (_u: string, init: any) => {
    seenId = JSON.parse(init.body).projectId;
    return new Response(JSON.stringify({ projectId: 'proj_x' }), { status: 200 });
  };
  await publishProject({ root: r, baseUrl: 'https://c.dev', token: 't', fetchImpl: f2 as unknown as typeof fetch });
  expect(seenId).toBe('proj_x');
});

test('throws a clear error when not logged in (no token)', async () => {
  await expect(
    publishProject({
      root: root(),
      baseUrl: 'https://c.dev',
      token: null,
      fetchImpl: (async () => new Response('', { status: 200 })) as unknown as typeof fetch,
    }),
  ).rejects.toThrow(/login/i);
});

test('surfaces a non-2xx response as an error', async () => {
  const failing = async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  await expect(
    publishProject({
      root: root(),
      baseUrl: 'https://c.dev',
      token: 't',
      fetchImpl: failing as unknown as typeof fetch,
    }),
  ).rejects.toThrow();
});
