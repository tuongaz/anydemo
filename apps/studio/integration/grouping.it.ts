import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { slugify } from '../src/registry.ts';
import { uniqueFlowId } from './support/ids.ts';
import { type StudioHandle, spawnStudio } from './support/studio-harness.ts';

// Canvas grouping M9 — server-contract integration tests (design §9.3, §9.8,
// §12.9). The clipboard id-remap + delete-prune LOGIC lives in the web host
// (apps/web/src/pages/demo-view.tsx) and is unit-tested as pure functions in
// packages/canvas/src/lib/group-ops.test.ts. What integration MUST prove is the
// SERVER side those host ops depend on:
//   1. a group node + childIds round-trips through flow.json / style.json,
//   2. deleting the group container releases its children (they survive loose),
//   3. the §12.9 ORDERING is load-bearing: a member delete that prunes the
//      owning group's childIds FIRST is accepted, but the swapped order (delete
//      the member while the group still references it) is REJECTED by the
//      childIds-existence superRefine — the tripwire,
//   4. the reverse-order undo (recreate member → restore childIds) is valid at
//      each step.
// These are the exact server behaviours the host's prune-before-delete batch
// and clipboard remap rely on; if the server contract regresses, grouping
// breaks even though the client unit tests stay green.

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
  connectors: Array<{ id: string; source: string; target: string; kind: string }>;
}

interface OnDiskStyle {
  nodes?: Record<string, { position?: { x: number; y: number } } & Record<string, unknown>>;
}

function flowApi(slug: string): string {
  return `/api/projects/${slug.replace('/', '/flows/')}`;
}

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

async function createProject(name: string): Promise<CreateProjectResponse> {
  const res = await fetch(`${studio.baseURL}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: join(studio.workspace, slugify(name)), name }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as CreateProjectResponse;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${studio.baseURL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${studio.baseURL}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function deleteNode(slug: string, nodeId: string): Promise<Response> {
  return fetch(`${studio.baseURL}${flowApi(slug)}/nodes/${nodeId}`, { method: 'DELETE' });
}

/**
 * Seed a flow with a group `grp` containing two rectangle members `a`,`b` —
 * mirrors the `grouping-demo` fixture (a group + members). Uses ONE transactional
 * bulk write carrying the group with its final childIds (the §12.7 atomic-create
 * shape the host's `onCreateGroup` uses).
 */
async function seedGroupWithMembers(slug: string): Promise<void> {
  const res = await postJson(`${flowApi(slug)}/bulk`, {
    nodes: [
      { id: 'a', type: 'rectangle', data: { name: 'A', width: 160, height: 80 } },
      { id: 'b', type: 'rectangle', data: { name: 'B', width: 160, height: 80 } },
      {
        id: 'grp',
        type: 'group',
        position: { x: 80, y: 60 },
        data: { name: 'Group', width: 400, height: 220, childIds: ['a', 'b'] },
      },
    ],
  });
  expect(res.status).toBe(200);
}

describe('integration: canvas grouping (M9 server contract)', () => {
  describe('persistence round-trip (§9.8)', () => {
    it('a group + childIds round-trips through flow.json (semantic) and style.json (visual)', async () => {
      const created = await createProject(uniqueFlowId('group-persist'));
      await seedGroupWithMembers(created.slug);

      const onDisk = await readFlowJson(created.slug);
      const group = onDisk.nodes.find((n) => n.id === 'grp');
      expect(group?.type).toBe('group');
      // childIds is SEMANTIC → flow.json (NODE_DATA_FLOW_KEYS).
      expect(group?.data?.childIds).toEqual(['a', 'b']);
      expect(group?.data?.name).toBe('Group');
      // Members persist as ordinary nodes (absolute positions, no parentId).
      expect(onDisk.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'grp']);
      expect(onDisk.nodes.some((n) => 'parentId' in (n.data ?? {}))).toBe(false);

      // Group position lives in style.json like every node's position.
      const style = await readStyleJson(created.slug);
      expect(style.nodes?.grp?.position).toEqual({ x: 80, y: 60 });
    });

    it('move + resize + style edits on a group survive a reload (identical state)', async () => {
      const created = await createProject(uniqueFlowId('group-edit-persist'));
      await seedGroupWithMembers(created.slug);

      // Move the group (style.json), resize it (width/height → style.json), and
      // restyle it (backgroundColor → style.json). Each is a separate write that
      // re-parses the whole flow — all must stay valid with the group present.
      expect(
        (await patchJson(`${flowApi(created.slug)}/nodes/grp/position`, { x: 300, y: 200 })).status,
      ).toBe(200);
      expect(
        (await patchJson(`${flowApi(created.slug)}/nodes/grp`, { width: 500, height: 280 })).status,
      ).toBe(200);
      expect(
        (await patchJson(`${flowApi(created.slug)}/nodes/grp`, { backgroundColor: 'blue' })).status,
      ).toBe(200);

      const onDisk = await readFlowJson(created.slug);
      const group = onDisk.nodes.find((n) => n.id === 'grp');
      // childIds untouched by move/resize/style (no group-awareness leak).
      expect(group?.data?.childIds).toEqual(['a', 'b']);

      const style = await readStyleJson(created.slug);
      expect(style.nodes?.grp?.position).toEqual({ x: 300, y: 200 });
      expect(style.nodes?.grp?.width).toBe(500);
      expect(style.nodes?.grp?.height).toBe(280);
      expect(style.nodes?.grp?.backgroundColor).toBe('blue');
    });

    it('a connector to the GROUP as an endpoint round-trips (§9 connectors)', async () => {
      const created = await createProject(uniqueFlowId('group-connector'));
      await seedGroupWithMembers(created.slug);
      // Add a loose node + a connector targeting the group as a whole.
      expect(
        (
          await postJson(`${flowApi(created.slug)}/nodes`, {
            id: 'ext',
            type: 'rectangle',
            data: {},
          })
        ).status,
      ).toBe(200);
      const connRes = await postJson(`${flowApi(created.slug)}/bulk`, {
        connectors: [{ id: 'ext-to-grp', source: 'ext', target: 'grp' }],
      });
      expect(connRes.status).toBe(200);
      const onDisk = await readFlowJson(created.slug);
      const conn = onDisk.connectors.find((c) => c.id === 'ext-to-grp');
      expect(conn?.source).toBe('ext');
      expect(conn?.target).toBe('grp');
    });
  });

  describe('delete policy (§9.3)', () => {
    it('deleting the GROUP container releases its children (members survive loose)', async () => {
      const created = await createProject(uniqueFlowId('group-delete-releases'));
      await seedGroupWithMembers(created.slug);

      const res = await deleteNode(created.slug, 'grp');
      expect(res.status).toBe(200);

      const onDisk = await readFlowJson(created.slug);
      // Group gone; members survive as loose nodes (no cascade to children).
      expect(onDisk.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
      expect(onDisk.nodes.some((n) => n.type === 'group')).toBe(false);
    });

    it('deleting an EMPTY group (childIds: []) is fine — labeled-zone removal', async () => {
      const created = await createProject(uniqueFlowId('empty-group-delete'));
      // An empty group is allowed and persists (design §9.11).
      const seed = await postJson(`${flowApi(created.slug)}/bulk`, {
        nodes: [
          {
            id: 'zone',
            type: 'group',
            position: { x: 0, y: 0 },
            data: { name: 'Zone', width: 300, height: 200, childIds: [] },
          },
        ],
      });
      expect(seed.status).toBe(200);
      expect(
        (await readFlowJson(created.slug)).nodes.find((n) => n.id === 'zone')?.data?.childIds,
      ).toEqual([]);
      expect((await deleteNode(created.slug, 'zone')).status).toBe(200);
      expect((await readFlowJson(created.slug)).nodes).toHaveLength(0);
    });
  });

  describe('delete-member childIds prune ORDERING — the §12.9 tripwire', () => {
    it('prune FIRST then delete the member: BOTH writes accepted', async () => {
      const created = await createProject(uniqueFlowId('member-delete-ordered'));
      await seedGroupWithMembers(created.slug);

      // §12.9 ORDER: updateNode(group, {childIds: minus member}) FIRST …
      const prune = await patchJson(`${flowApi(created.slug)}/nodes/grp`, { childIds: ['a'] });
      expect(prune.status).toBe(200);
      // … THEN deleteNode(member). The group no longer references 'b', so this
      // intermediate state is valid and the delete is accepted.
      const del = await deleteNode(created.slug, 'b');
      expect(del.status).toBe(200);

      const onDisk = await readFlowJson(created.slug);
      const group = onDisk.nodes.find((n) => n.id === 'grp');
      expect(group?.data?.childIds).toEqual(['a']); // pruned membership persisted
      expect(onDisk.nodes.map((n) => n.id).sort()).toEqual(['a', 'grp']); // 'b' gone
    });

    it('TRIPWIRE: deleting the member WITHOUT pruning first is REJECTED (dangling childIds)', async () => {
      const created = await createProject(uniqueFlowId('member-delete-swapped'));
      await seedGroupWithMembers(created.slug);

      // The SWAPPED order: delete the member while the group STILL lists it.
      // Every server write re-parses the whole flow; the childIds-existence
      // superRefine rejects the resulting dangling reference. This is the exact
      // failure the host's prune-FIRST ordering avoids — if this ever starts
      // returning 200, the server invariant (and the reason for the ordering)
      // has regressed.
      const del = await deleteNode(created.slug, 'b');
      expect(del.status).not.toBe(200);
      expect(del.status).toBeGreaterThanOrEqual(400);
      const body = (await del.json().catch(() => ({}))) as {
        error?: string;
        issues?: Array<{ message?: string }>;
      };
      // It's a schema-validation rejection, and the per-issue detail cites the
      // group's dangling child reference (the childIds-existence superRefine).
      expect(body.error).toBe('Flow failed schema validation');
      const messages = (body.issues ?? []).map((i) => i.message ?? '').join(' ');
      expect(messages.toLowerCase()).toContain('child');

      // And the flow is unchanged on disk — the rejected delete left 'b' + the
      // group's childIds intact (no partial write).
      const onDisk = await readFlowJson(created.slug);
      expect(onDisk.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'grp']);
      expect(onDisk.nodes.find((n) => n.id === 'grp')?.data?.childIds).toEqual(['a', 'b']);
    });

    it('reverse-order UNDO is valid at each step: recreate member → restore childIds', async () => {
      const created = await createProject(uniqueFlowId('member-delete-undo'));
      await seedGroupWithMembers(created.slug);

      // Forward: prune then delete (as above).
      expect(
        (await patchJson(`${flowApi(created.slug)}/nodes/grp`, { childIds: ['a'] })).status,
      ).toBe(200);
      expect((await deleteNode(created.slug, 'b')).status).toBe(200);

      // UNDO runs the batch inverses in REVERSE order:
      //   (1) recreate the member 'b' — valid: at this point the group's childIds
      //       is still ['a'], so 'b' existing-but-unreferenced is fine, …
      const recreate = await postJson(`${flowApi(created.slug)}/nodes`, {
        id: 'b',
        type: 'rectangle',
        data: { name: 'B', width: 160, height: 80 },
      });
      expect(recreate.status).toBe(200);
      //   (2) restore the group's childIds to ['a','b'] — valid: 'b' exists again.
      const restore = await patchJson(`${flowApi(created.slug)}/nodes/grp`, {
        childIds: ['a', 'b'],
      });
      expect(restore.status).toBe(200);

      const onDisk = await readFlowJson(created.slug);
      expect(onDisk.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'grp']);
      expect(onDisk.nodes.find((n) => n.id === 'grp')?.data?.childIds).toEqual(['a', 'b']);
    });
  });

  describe('membership integrity (§4.1 / §9.7) — the invariants the host relies on', () => {
    it('rejects a group referencing an unknown child (dangling childIds)', async () => {
      const created = await createProject(uniqueFlowId('group-dangling'));
      const res = await postJson(`${flowApi(created.slug)}/bulk`, {
        nodes: [
          {
            id: 'grp',
            type: 'group',
            position: { x: 0, y: 0 },
            data: { name: 'G', width: 200, height: 200, childIds: ['ghost'] },
          },
        ],
      });
      expect(res.status).not.toBe(200);
    });

    it('rejects a nested group (a group id inside another group’s childIds)', async () => {
      const created = await createProject(uniqueFlowId('group-nested'));
      const res = await postJson(`${flowApi(created.slug)}/bulk`, {
        nodes: [
          { id: 'inner', type: 'group', position: { x: 0, y: 0 }, data: { childIds: [] } },
          { id: 'outer', type: 'group', position: { x: 0, y: 0 }, data: { childIds: ['inner'] } },
        ],
      });
      expect(res.status).not.toBe(200);
    });

    it('rejects double-membership (one node in two groups’ childIds)', async () => {
      const created = await createProject(uniqueFlowId('group-double'));
      const res = await postJson(`${flowApi(created.slug)}/bulk`, {
        nodes: [
          { id: 'm', type: 'rectangle', data: {} },
          { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { childIds: ['m'] } },
          { id: 'g2', type: 'group', position: { x: 0, y: 0 }, data: { childIds: ['m'] } },
        ],
      });
      expect(res.status).not.toBe(200);
    });
  });
});
