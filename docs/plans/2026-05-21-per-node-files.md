# Per-node files Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Externalize node text content (`detail`, `html`) to per-node files under `<project>/.seeflow/nodes/<id>/`, move imageNode uploads into the same folder, and replace bespoke htmlNode/imageNode lifecycle code with a single generic mechanism.

**Architecture:** A new spec list (`EXTERNALIZED_NODE_FIELDS`) in `apps/studio/src/node-files.ts` drives `addNodeImpl` and `patchNodeImpl` to write text fields to `<repoPath>/.seeflow/nodes/<id>/<fileName>` and store `"file://nodes/<id>/<fileName>"` in `flow.json`. The existing `resolveFileRefs` watcher (`apps/studio/src/file-ref.ts`) inlines content on read, so consumers see resolved strings transparently. `deleteNodeImpl` cascades by removing the whole `nodes/<id>/` folder. ImageNode uploads land in the same folder via a new `POST /api/projects/:id/nodes/:nodeId/files/upload` endpoint; the renderer still fetches lazily via the existing file-serving endpoint.

**Tech Stack:** Bun, Hono, Zod, TypeScript, Vite + React (web), `bun:test`.

**Reference design:** `docs/plans/2026-05-21-per-node-files-design.md`

**Prerequisites:**
- Read the design doc end-to-end before starting.
- Run from a worktree (`git worktree add ../seeflow-node-files -b per-node-files`) so the long-running refactor doesn't block other work on `main`.
- Verify baseline: `bun run typecheck && bun test` — all green before Task 1.

---

## Phase A — Foundation + `detail` externalization

Delivers the original requested feature: every new node created via API/MCP gets a `.seeflow/nodes/<id>/detail.md` file, and patch/delete handle the lifecycle. htmlNode and imageNode remain on their current path-based shape until Phase B/C.

---

### Task 1: Create `node-files.ts` with helpers and spec

**Files:**
- Create: `apps/studio/src/node-files.ts`
- Create: `apps/studio/src/node-files.test.ts`

**Step 1: Write the failing tests**

```ts
// apps/studio/src/node-files.test.ts
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  EXTERNALIZED_NODE_FIELDS,
  nodeFileAbsPath,
  nodeFileRef,
  nodeFileRelPath,
  removeNodeDir,
  writeNodeFile,
} from './node-files.ts';

describe('node-files path helpers', () => {
  it('builds rel path under nodes/<id>/<fileName>', () => {
    expect(nodeFileRelPath('node-abc', 'detail.md')).toBe('nodes/node-abc/detail.md');
  });
  it('builds file:// ref', () => {
    expect(nodeFileRef('node-abc', 'view.html')).toBe('file://nodes/node-abc/view.html');
  });
  it('builds absolute path under .seeflow/', () => {
    expect(nodeFileAbsPath('/repo', 'node-abc', 'detail.md')).toBe(
      '/repo/.seeflow/nodes/node-abc/detail.md',
    );
  });
  it('exposes a spec with at least detail.md', () => {
    expect(EXTERNALIZED_NODE_FIELDS.some((e) => e.field === 'detail' && e.fileName === 'detail.md'))
      .toBe(true);
  });
});

describe('writeNodeFile / removeNodeDir', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'node-files-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('writes content atomically, creating parent dirs', () => {
    const abs = nodeFileAbsPath(root, 'node-x', 'detail.md');
    writeNodeFile(abs, 'hello');
    expect(readFileSync(abs, 'utf8')).toBe('hello');
  });

  it('writes empty string when content is empty', () => {
    const abs = nodeFileAbsPath(root, 'node-x', 'detail.md');
    writeNodeFile(abs, '');
    expect(readFileSync(abs, 'utf8')).toBe('');
  });

  it('removeNodeDir deletes the node folder and contents', () => {
    const abs = nodeFileAbsPath(root, 'node-x', 'detail.md');
    writeNodeFile(abs, 'x');
    removeNodeDir(root, 'node-x');
    expect(existsSync(abs)).toBe(false);
    expect(existsSync(join(root, '.seeflow', 'nodes', 'node-x'))).toBe(false);
  });

  it('removeNodeDir is idempotent on missing folder', () => {
    expect(() => removeNodeDir(root, 'node-missing')).not.toThrow();
  });

  it('removeNodeDir leaves sibling node folders intact', () => {
    writeNodeFile(nodeFileAbsPath(root, 'node-a', 'detail.md'), 'a');
    writeNodeFile(nodeFileAbsPath(root, 'node-b', 'detail.md'), 'b');
    removeNodeDir(root, 'node-a');
    expect(existsSync(nodeFileAbsPath(root, 'node-a', 'detail.md'))).toBe(false);
    expect(readFileSync(nodeFileAbsPath(root, 'node-b', 'detail.md'), 'utf8')).toBe('b');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test apps/studio/src/node-files.test.ts`
Expected: FAIL — `Cannot find module './node-files.ts'`.

**Step 3: Implement `node-files.ts`**

```ts
// apps/studio/src/node-files.ts
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './operations.ts';

export const EXTERNALIZED_NODE_FIELDS = [
  { field: 'detail', fileName: 'detail.md' },
] as const;

export type ExternalizedFieldName = (typeof EXTERNALIZED_NODE_FIELDS)[number]['field'];

export const nodeFileRelPath = (nodeId: string, fileName: string): string =>
  `nodes/${nodeId}/${fileName}`;

export const nodeFileRef = (nodeId: string, fileName: string): string =>
  `file://${nodeFileRelPath(nodeId, fileName)}`;

export const nodeFileAbsPath = (repoPath: string, nodeId: string, fileName: string): string =>
  join(repoPath, '.seeflow', nodeFileRelPath(nodeId, fileName));

// Ensures the parent dir exists, then writes atomically — callers will be
// hitting nodes/<id>/ folders that don't exist yet on the first add_node.
export function writeNodeFile(absPath: string, content: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileAtomic(absPath, content);
}

// Cascade-delete the node's whole folder. Best-effort: missing folder is
// not an error (delete_node may run for a node that never had a spec file
// written, e.g. an old flow imported from before this change).
export function removeNodeDir(repoPath: string, nodeId: string): void {
  rmSync(join(repoPath, '.seeflow', 'nodes', nodeId), { recursive: true, force: true });
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test apps/studio/src/node-files.test.ts`
Expected: PASS (9 tests).

Also: `bun run typecheck` — green.

**Step 5: Commit**

```bash
git add apps/studio/src/node-files.ts apps/studio/src/node-files.test.ts
git commit -m "feat(node-files): add per-node externalization helpers and spec"
```

---

### Task 2: Wire `addNodeImpl` to externalize `detail`

**Files:**
- Modify: `apps/studio/src/operations.ts:884-954` (`addNodeImpl`)
- Modify: `apps/studio/src/operations.test.ts` (extend `addNodeImpl` cases)

**Step 1: Write the failing tests**

Append to `apps/studio/src/operations.test.ts` (inside the existing `describe('addNodeImpl', ...)` block, or add a new block):

```ts
import { existsSync, readFileSync } from 'node:fs';
import { nodeFileAbsPath, nodeFileRef } from './node-files.ts';

describe('addNodeImpl + detail externalization', () => {
  // Reuse the existing test fixture pattern in operations.test.ts — every
  // other addNodeImpl test sets up a tmp project, registers a flow, and
  // calls addNodeImpl. Copy that scaffold.

  it('writes detail.md and stores file:// ref when detail is provided', async () => {
    const { deps, flowId, repoPath, flowAbs } = setupProjectWithFlow();
    const res = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', kind: 'tally', stateSource: { kind: 'request' }, shape: 'square', detail: 'hello world' },
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const nodeId = res.data.id;

    const detailAbs = nodeFileAbsPath(repoPath, nodeId, 'detail.md');
    expect(existsSync(detailAbs)).toBe(true);
    expect(readFileSync(detailAbs, 'utf8')).toBe('hello world');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
  });

  it('writes empty detail.md and stores file:// ref when detail is omitted', async () => {
    const { deps, flowId, repoPath, flowAbs } = setupProjectWithFlow();
    const res = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', kind: 'tally', stateSource: { kind: 'request' }, shape: 'square' },
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const nodeId = res.data.id;

    const detailAbs = nodeFileAbsPath(repoPath, nodeId, 'detail.md');
    expect(existsSync(detailAbs)).toBe(true);
    expect(readFileSync(detailAbs, 'utf8')).toBe('');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
  });

  it('get_flow returns resolved detail content, not the file:// ref', async () => {
    const { deps, flowId } = setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', kind: 'tally', stateSource: { kind: 'request' }, shape: 'square', detail: 'inlined-on-read' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const get = await getFlowImpl(deps, flowId);
    if (get.kind !== 'ok' || !get.data.flow) throw new Error('get failed');
    const node = get.data.flow.nodes.find((n) => n.id === add.data.id);
    expect((node?.data as { detail?: string }).detail).toBe('inlined-on-read');
  });
});
```

If `setupProjectWithFlow()` doesn't exist as a helper in `operations.test.ts`, lift the same scaffold the existing addNodeImpl tests use into a small helper at the top of the file. Don't invent a new pattern — copy what's there.

**Step 2: Run tests to verify they fail**

Run: `bun test apps/studio/src/operations.test.ts -t 'addNodeImpl + detail externalization'`
Expected: FAIL — `node.data.detail` is the raw string `'hello world'`, not the file:// ref; no detail.md on disk.

**Step 3: Implement `addNodeImpl` change**

In `apps/studio/src/operations.ts`, modify `addNodeImpl` (around line 884–954). After the `newId` is assigned and the htmlNode starter-file block (lines 907-928), add a generic externalization pass:

```ts
import { EXTERNALIZED_NODE_FIELDS, nodeFileAbsPath, nodeFileRef, writeNodeFile } from './node-files.ts';

// Inside addNodeImpl, after newId is set and before the resolveFilePath line:

const externalized: Array<{ absPath: string; content: string }> = [];
const dataIsRecord =
  newNode.data !== null && typeof newNode.data === 'object' && !Array.isArray(newNode.data);
const externalizedData: Record<string, unknown> = dataIsRecord
  ? { ...(newNode.data as Record<string, unknown>) }
  : {};

for (const { field, fileName } of EXTERNALIZED_NODE_FIELDS) {
  const incoming = externalizedData[field];
  const content = typeof incoming === 'string' ? incoming : '';
  externalizedData[field] = nodeFileRef(newId, fileName);
  externalized.push({ absPath: nodeFileAbsPath(entry.repoPath, newId, fileName), content });
}

if (externalized.length > 0) {
  newNode.data = externalizedData;
}
```

Then inside the existing `mutator` callback, AFTER `flow.nodes.push(newNode)` and the existing `starterFile` block, flush all externalized writes:

```ts
for (const ext of externalized) {
  try {
    writeNodeFile(ext.absPath, ext.content);
  } catch (err) {
    return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
  }
}
```

Leave the existing htmlNode `starterFile` block alone for now — Phase B will fold it into the spec.

**Step 4: Run tests to verify they pass**

```
bun test apps/studio/src/operations.test.ts -t 'addNodeImpl'
bun test apps/studio/src/operations.test.ts
bun run typecheck
```
Expected: all green.

**Step 5: Commit**

```bash
git add apps/studio/src/operations.ts apps/studio/src/operations.test.ts
git commit -m "feat(operations): externalize detail to nodes/<id>/detail.md on add_node"
```

---

### Task 3: Wire `patchNodeImpl` to externalize spec fields

**Files:**
- Modify: `apps/studio/src/operations.ts` (`patchNodeImpl`, around line 1050; `mergeNodeUpdates`, line 145)
- Modify: `apps/studio/src/operations.test.ts`

**Step 1: Write the failing tests**

```ts
describe('patchNodeImpl + detail externalization', () => {
  it('writes detail content to detail.md and keeps file:// ref in flow.json', async () => {
    const { deps, flowId, repoPath, flowAbs } = setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', kind: 'tally', stateSource: { kind: 'request' }, shape: 'square' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    const patch = await patchNodeImpl(deps, flowId, nodeId, { detail: 'new content' });
    expect(patch.kind).toBe('ok');

    const detailAbs = nodeFileAbsPath(repoPath, nodeId, 'detail.md');
    expect(readFileSync(detailAbs, 'utf8')).toBe('new content');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
  });

  it('empty-string detail empties the file but keeps the file:// ref (NEW behavior)', async () => {
    const { deps, flowId, repoPath, flowAbs } = setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', kind: 'tally', stateSource: { kind: 'request' }, shape: 'square', detail: 'starts non-empty' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    const patch = await patchNodeImpl(deps, flowId, nodeId, { detail: '' });
    expect(patch.kind).toBe('ok');

    const detailAbs = nodeFileAbsPath(repoPath, nodeId, 'detail.md');
    expect(readFileSync(detailAbs, 'utf8')).toBe('');

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
  });

  it('empty-string description still clears the inline field (unchanged behavior)', async () => {
    const { deps, flowId, flowAbs } = setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', kind: 'tally', stateSource: { kind: 'request' }, shape: 'square', description: 'starts' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    await patchNodeImpl(deps, flowId, nodeId, { description: '' });
    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect('description' in node.data).toBe(false);
  });

  it('patching an unrelated field preserves the detail file:// ref round-trip', async () => {
    const { deps, flowId, flowAbs } = setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', kind: 'tally', stateSource: { kind: 'request' }, shape: 'square', detail: 'survive' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;

    await patchNodeImpl(deps, flowId, nodeId, { name: 'A renamed' });

    const flow = JSON.parse(readFileSync(flowAbs, 'utf8'));
    const node = flow.nodes.find((n: { id: string }) => n.id === nodeId);
    expect(node.data.detail).toBe(nodeFileRef(nodeId, 'detail.md'));
    expect(node.data.name).toBe('A renamed');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test apps/studio/src/operations.test.ts -t 'patchNodeImpl + detail externalization'`
Expected: FAIL — `mergeNodeUpdates` writes the raw string to `data.detail`, no file on disk.

**Step 3: Implement the change**

Two pieces.

**(a)** Modify `mergeNodeUpdates` (`operations.ts:145-213`) so externalized spec fields are NOT handled by the merge. Add an early skip at the top of the loop:

```ts
import { EXTERNALIZED_NODE_FIELDS } from './node-files.ts';
const EXTERNALIZED_FIELD_NAMES = new Set<string>(EXTERNALIZED_NODE_FIELDS.map((e) => e.field));

// inside the for-loop in mergeNodeUpdates, before the "empty string clear" check:
if (EXTERNALIZED_FIELD_NAMES.has(key)) continue;
```

This keeps `description` on its existing empty-string-clears semantics but takes `detail` out of the merge entirely.

**(b)** In `patchNodeImpl`, before calling the mutator, collect spec writes from the patch body. After `entry` is resolved and before the `mutateMergedFlowAndBroadcast` call:

```ts
const externalizedWrites: Array<{ absPath: string; ref: string; field: string; content: string }> = [];
for (const { field, fileName } of EXTERNALIZED_NODE_FIELDS) {
  const incoming = (updates as Record<string, unknown>)[field];
  if (incoming === undefined) continue;
  externalizedWrites.push({
    absPath: nodeFileAbsPath(entry.repoPath, nodeId, fileName),
    ref: nodeFileRef(nodeId, fileName),
    field,
    content: typeof incoming === 'string' ? incoming : '',
  });
}
```

Inside the mutator, after `mergeNodeUpdates(node, updates)` succeeds (and after the existing schema reparse if any), apply the spec writes and patch the raw node's data:

```ts
const data = (node.data ??= {}) as Record<string, unknown>;
for (const w of externalizedWrites) {
  try {
    writeNodeFile(w.absPath, w.content);
  } catch (err) {
    return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
  }
  data[w.field] = w.ref;
}
```

Note: `writeFailed` may need to be added to `PatchNodeOutcome` if it isn't already there — check `operations.ts:283-310` for the outcome union and add it. The MCP/API translation in `mcp.ts` and `api.ts` will need a parallel branch — search for the existing `case 'writeFailed':` in those files to mirror.

**Step 4: Run tests to verify they pass**

```
bun test apps/studio/src/operations.test.ts -t 'patchNodeImpl'
bun test apps/studio/src/operations.test.ts
bun run typecheck
```
Expected: all green.

**Step 5: Commit**

```bash
git add apps/studio/src/operations.ts apps/studio/src/operations.test.ts
git commit -m "feat(operations): externalize detail on patch_node, keep file:// ref"
```

---

### Task 4: Wire `deleteNodeImpl` to cascade `removeNodeDir`

**Files:**
- Modify: `apps/studio/src/operations.ts` (`deleteNodeImpl`, around line 976)
- Modify: `apps/studio/src/operations.test.ts`

**Step 1: Write the failing test**

```ts
describe('deleteNodeImpl + per-node folder cascade', () => {
  it('removes nodes/<id>/ folder after flow.json write', async () => {
    const { deps, flowId, repoPath } = setupProjectWithFlow();
    const add = await addNodeImpl(deps, flowId, {
      type: 'shapeNode',
      data: { name: 'A', kind: 'tally', stateSource: { kind: 'request' }, shape: 'square', detail: 'bye' },
    });
    if (add.kind !== 'ok') throw new Error('add failed');
    const nodeId = add.data.id;
    const detailAbs = nodeFileAbsPath(repoPath, nodeId, 'detail.md');
    expect(existsSync(detailAbs)).toBe(true);

    const del = await deleteNodeImpl(deps, flowId, nodeId);
    expect(del.kind).toBe('ok');
    expect(existsSync(detailAbs)).toBe(false);
    expect(existsSync(join(repoPath, '.seeflow', 'nodes', nodeId))).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test apps/studio/src/operations.test.ts -t 'per-node folder cascade'`
Expected: FAIL — the detail.md and folder still exist after delete.

**Step 3: Implement the change**

In `deleteNodeImpl` (`operations.ts:976`), after the existing flow.json write succeeds (parallel to the htmlNode `blocks/<id>.html` cleanup), add:

```ts
import { removeNodeDir } from './node-files.ts';

// After the flow.json mutation completes successfully and after any
// htmlNode-specific cleanup, cascade-delete the node's folder.
try {
  removeNodeDir(entry.repoPath, nodeId);
} catch (err) {
  // Log and swallow — folder cleanup is best-effort. flow.json is already
  // written; an orphan folder is acceptable and recoverable manually.
  console.error(`[seeflow] failed to remove nodes/${nodeId}/`, err);
}
```

Leave the existing htmlNode `blocks/<id>.html` cleanup in place for now (Phase B deletes it).

**Step 4: Run tests to verify they pass**

```
bun test apps/studio/src/operations.test.ts
bun run typecheck
```
Expected: all green.

**Step 5: Commit**

```bash
git add apps/studio/src/operations.ts apps/studio/src/operations.test.ts
git commit -m "feat(operations): cascade-delete nodes/<id>/ folder on delete_node"
```

---

### Task 5: MCP / API parity for `detail` externalization

**Files:**
- Modify: `apps/studio/src/mcp.test.ts` (extend `seeflow_add_node`, `seeflow_patch_node`, `seeflow_delete_node` blocks)
- Modify: `apps/studio/src/mcp-parity.test.ts` (`seeflow_add_node` scenario expected payload)
- Modify: `apps/studio/src/api.test.ts` (POST `/nodes`, PATCH, DELETE)

**Step 1: Write the failing tests**

For each surface (MCP envelope, REST), add scenarios mirroring the operations tests:
- add_node with detail → flow.json has file:// ref; detail.md exists with content.
- add_node without detail → file exists, empty.
- patch_node setting detail → detail.md updated.
- patch_node with empty detail → file emptied, ref preserved.
- delete_node → folder removed.

Existing tests in those files set up the same fixtures via `callTool` / fetch. Mirror the shape.

For `mcp-parity.test.ts:228-260` — the existing `seeflow_add_node` scenario's expected node payload needs the `data.detail` field updated to the file:// ref. The id is generated, so use `expect.stringMatching(/^file:\/\/nodes\/node-[A-Za-z0-9]{10}\/detail\.md$/)`.

**Step 2: Run tests to verify they fail**

```
bun test apps/studio/src/mcp.test.ts -t 'seeflow_add_node'
bun test apps/studio/src/mcp-parity.test.ts
bun test apps/studio/src/api.test.ts
```
Expected: FAIL on the new assertions.

**Step 3: Implement**

No new production code — operations.ts already does the work. The failing tests will pass once the assertions reflect the new behavior. If any existing test fails because it asserted the old inline-string shape, update those assertions.

**Step 4: Run tests to verify they pass**

```
bun test
bun run typecheck
bun run lint
```
Expected: all green.

**Step 5: Commit**

```bash
git add apps/studio/src/mcp.test.ts apps/studio/src/mcp-parity.test.ts apps/studio/src/api.test.ts
git commit -m "test(mcp,api): cover detail externalization across surfaces"
```

---

## Phase B — htmlNode migration

Migrates `htmlNode` from path-based (`data.htmlPath`) to content-externalized (`data.html`) using the same generic mechanism. Deletes the bespoke starter-file and cleanup branches.

This phase touches the schema (breaking change) and frontend simultaneously. Land in one or two commits so the tree never type-checks broken.

---

### Task 6: Schema + merge routing — `htmlPath` → `html`

**Files:**
- Modify: `apps/studio/src/schema.ts:226-243` (`HtmlNodeDataSchema`) and `:507-510` (patch schema)
- Modify: `apps/studio/src/merge.ts:42` (`NODE_DATA_FLOW_KEYS`)
- Modify: `apps/studio/src/schema.test.ts` (htmlNode cases — search for `htmlPath`)
- Modify: `apps/studio/src/merge.test.ts` if it references `htmlPath`

**Step 1: Update the schema tests first**

In `schema.test.ts`, find every `htmlPath` reference and change it to `html`. The shape becomes `z.string().optional()` with no path-safety refine, so adjust assertions that expected refinement errors. Add a test that confirms `html` accepts a free-form string and a `file://` ref:

```ts
it('accepts html as free-form content', () => {
  const result = HtmlNodeDataSchema.safeParse({ html: '<div>hi</div>' });
  expect(result.success).toBe(true);
});
it('accepts html as a file:// ref (round-trip from disk)', () => {
  const result = HtmlNodeDataSchema.safeParse({ html: 'file://nodes/node-abc/view.html' });
  expect(result.success).toBe(true);
});
```

**Step 2: Run tests to verify the rename surfaces failures**

Run: `bun test apps/studio/src/schema.test.ts apps/studio/src/merge.test.ts`
Expected: FAIL — schema still has `htmlPath`.

**Step 3: Implement the schema rename**

In `apps/studio/src/schema.ts:226-243`:

```ts
export const HtmlNodeDataSchema = z.object({
  html: z.string().optional(),
  name: z.string().optional(),
  icon: z.string().optional(),
  autoSize: z.boolean().optional(),
  ...NodeVisualBaseShape,
  ...NodeDescriptionBaseShape,
});
```

Remove the `isCleanRelativePath` refine — `html` carries content (or a file:// ref handled at the resolver layer). Update the comment block above to reflect the new model.

In `schema.ts:507-510` (the patch schema), do the same rename.

In `merge.ts:42` (`NODE_DATA_FLOW_KEYS`):

```ts
const NODE_DATA_FLOW_KEYS = new Set([
  'name', 'kind', 'stateSource', 'handlerModule', 'icon',
  'description', 'detail',
  'playAction', 'statusAction', 'shape', 'path', 'alt',
  'html', // was 'htmlPath'
]);
```

**Step 4: Run tests to verify they pass**

```
bun test apps/studio/src/schema.test.ts apps/studio/src/merge.test.ts
bun run typecheck
```
Expected: schema/merge tests green. typecheck WILL fail in `operations.ts`, `api.ts`, `web/`, `use-export-to-cloud.ts`, `demo-view.tsx` — those consumers still reference `htmlPath`. That's expected and the next tasks fix it.

Do NOT commit yet — the tree doesn't typecheck. Tasks 7–8 land alongside this.

---

### Task 7: Add `html` to spec, delete bespoke htmlNode add/delete logic

**Files:**
- Modify: `apps/studio/src/node-files.ts` (add `html` to spec)
- Modify: `apps/studio/src/node-files.test.ts` (assert spec has both entries)
- Modify: `apps/studio/src/operations.ts:907-928` (delete htmlNode starter-file block)
- Modify: `apps/studio/src/operations.ts` (delete htmlNode block-cleanup in `deleteNodeImpl`)

**Step 1: Update spec test**

```ts
it('exposes detail and html entries', () => {
  const fields = EXTERNALIZED_NODE_FIELDS.map((e) => e.field);
  expect(fields).toContain('detail');
  expect(fields).toContain('html');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test apps/studio/src/node-files.test.ts`
Expected: FAIL — `html` not in spec.

**Step 3: Implement**

Append to `EXTERNALIZED_NODE_FIELDS`:

```ts
{ field: 'html', fileName: 'view.html' },
```

In `operations.ts:907-928`: DELETE the entire `if (newNode.type === 'htmlNode') { ... }` block. The generic spec loop now handles starter writes for every spec entry, including `html`.

In `operations.ts:deleteNodeImpl`: DELETE the htmlNode-specific `blocks/<id>.html` cleanup branch (search for `blocks/` or `htmlPath`). `removeNodeDir` already cascades.

In `operations.test.ts`: any test that asserted the old `blocks/<id>.html` shape needs to be updated to assert `view.html` under `nodes/<id>/` instead.

**Step 4: Run tests to verify they pass**

```
bun test apps/studio/src/node-files.test.ts apps/studio/src/operations.test.ts
bun run typecheck
```
Expected: studio tests green; web typecheck still fails.

---

### Task 8: Update web app for `data.html`

**Files:**
- Modify: `apps/web/src/lib/api.ts` (the `HtmlNodeData` type definition)
- Modify: `apps/web/src/hooks/use-export-to-cloud.ts:29-31`
- Modify: `apps/web/src/hooks/use-export-to-cloud.test.ts:165` (fixture data)
- Modify: `apps/web/src/pages/demo-view.tsx:1522-1574` (drop out-of-band `htmlPath` from htmlNode create)
- Modify: the htmlNode renderer (loaded dynamically — grep `data.htmlPath` in `apps/web` and in `packages/canvas/` to find it)

**Step 1: Update the failing tests**

`use-export-to-cloud.test.ts:165` — change fixture from `data: { htmlPath: 'blocks/widget.html', name: 'Widget' }` to `data: { html: 'file://nodes/node-w/view.html', name: 'Widget' }` and adjust the expected bundled-paths assertion to walk file:// refs.

Add (or update) a test that asserts the htmlNode renderer receives resolved HTML content directly — if a renderer test exists.

**Step 2: Run tests to verify they fail**

```
cd apps/web && bun test
```
Expected: type or assertion failures.

**Step 3: Implement web changes**

- `lib/api.ts`: rename `htmlPath` → `html` in `HtmlNodeData`.
- `use-export-to-cloud.ts:29-31`: replace the `data.htmlPath`-driven bundling with walking file:// refs across all nodes. The watcher snapshot already exposes resolved refs; for the export path, walk `data.html` and `data.detail` looking for the `file://` prefix and strip it for the bundle path. Image `data.path` bundling stays as-is.
- `demo-view.tsx:1522-1574`: simplify `onCreateHtmlNode`. POST `{ id, type: 'htmlNode', position, data: {} }` (no `htmlPath`). Drop the out-of-band optimistic data.
- htmlNode renderer: change from fetching `/api/projects/:id/files/<htmlPath>` to consuming `data.html` directly as resolved HTML content. Keep sanitization. The renderer file is dynamically loaded — grep `data.htmlPath` and the HTML-inject API under `apps/web/` and `packages/canvas/` to find it.

**Step 4: Run tests to verify they pass**

```
bun run typecheck
bun test
bun run lint
```
Expected: all green.

Manually verify: start `bun run dev`, drag an htmlNode onto a flow, edit `view.html`, confirm the canvas re-renders.

**Step 5: Commit (everything in Phase B as one commit)**

```bash
git add apps/studio/src/schema.ts apps/studio/src/schema.test.ts apps/studio/src/merge.ts \
        apps/studio/src/node-files.ts apps/studio/src/node-files.test.ts \
        apps/studio/src/operations.ts apps/studio/src/operations.test.ts \
        apps/web/src/lib/api.ts apps/web/src/hooks/use-export-to-cloud.ts \
        apps/web/src/hooks/use-export-to-cloud.test.ts apps/web/src/pages/demo-view.tsx \
        packages/canvas/  # whichever renderer files you touched
git commit -m "refactor(htmlNode): externalize html content to nodes/<id>/view.html"
```

---

### Task 9: MCP/API parity for `html` externalization

**Files:**
- Modify: `apps/studio/src/mcp.test.ts` (htmlNode add/patch scenarios)
- Modify: `apps/studio/src/api.test.ts` (htmlNode add/patch scenarios)
- Modify: `apps/studio/src/mcp.ts:384` (update `seeflow_patch_node` tool description to mention `html`)

**Step 1: Add tests**

Mirror Task 5: assert that `seeflow_add_node` with `type: 'htmlNode'` and inline `data.html` content writes `nodes/<id>/view.html` and stores the file:// ref. Same for patch.

**Step 2: Run, implement (mostly description tweaks), commit**

```bash
git add apps/studio/src/mcp.test.ts apps/studio/src/api.test.ts apps/studio/src/mcp.ts
git commit -m "test(mcp,api): cover html externalization for htmlNode"
```

---

## Phase C — imageNode migration

Per-node folder for image uploads. Renderer keeps fetching via the file-serving endpoint.

---

### Task 10: imageNode path invariant — `superRefine` on `ResolvedFlowSchema`

**Files:**
- Modify: `apps/studio/src/schema.ts` (find `ResolvedFlowSchema`; add a `.superRefine` after the existing definition)
- Modify: `apps/studio/src/schema.test.ts`

**Step 1: Write the failing tests**

```ts
it('rejects an imageNode whose path is outside its nodes/<id>/ folder', () => {
  const result = ResolvedFlowSchema.safeParse({
    version: 1, name: 'x', nodes: [{
      id: 'node-abc', type: 'imageNode',
      position: { x: 0, y: 0 },
      data: { path: 'assets/foo.png' }, // wrong: not under nodes/node-abc/
    }], connectors: [],
  });
  expect(result.success).toBe(false);
});

it('accepts an imageNode whose path is under its own nodes/<id>/ folder', () => {
  const result = ResolvedFlowSchema.safeParse({
    version: 1, name: 'x', nodes: [{
      id: 'node-abc', type: 'imageNode',
      position: { x: 0, y: 0 },
      data: { path: 'nodes/node-abc/foo.png' },
    }], connectors: [],
  });
  expect(result.success).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test apps/studio/src/schema.test.ts -t 'imageNode'`
Expected: FAIL on the rejection case (currently `assets/foo.png` is accepted).

**Step 3: Implement**

Add a `.superRefine` to `ResolvedFlowSchema`:

```ts
export const ResolvedFlowSchema = z.object({
  // ... existing shape ...
}).superRefine((flow, ctx) => {
  flow.nodes.forEach((node, idx) => {
    if (node.type === 'imageNode') {
      const path = (node.data as { path?: string }).path;
      const expected = `nodes/${node.id}/`;
      if (path && !path.startsWith(expected)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes', idx, 'data', 'path'],
          message: `imageNode path must start with "${expected}"`,
        });
      }
    }
  });
});
```

Update any existing imageNode test fixtures that used `assets/foo.png` to use `nodes/<id>/foo.png`.

**Step 4: Run tests to verify they pass**

```
bun test apps/studio/src/schema.test.ts
bun run typecheck
```
Expected: all green.

**Step 5: Commit**

```bash
git add apps/studio/src/schema.ts apps/studio/src/schema.test.ts
git commit -m "feat(schema): require imageNode path to live under nodes/<id>/"
```

---

### Task 11: New per-node upload endpoint

**Files:**
- Modify: `apps/studio/src/api.ts` (add new route around line 670 after the existing upload)
- Modify: `apps/studio/src/api.test.ts`

**Step 1: Write the failing tests**

```ts
describe('POST /api/projects/:id/nodes/:nodeId/files/upload', () => {
  it('writes the file to nodes/<nodeId>/ and returns the path', async () => {
    const { app, projectId, repoPath } = setupProject();
    const form = new FormData();
    form.set('file', new File([Buffer.from('binary')], 'logo.png', { type: 'image/png' }));
    const res = await app.request(`/api/projects/${projectId}/nodes/node-abc/files/upload`, {
      method: 'POST', body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe('nodes/node-abc/logo.png');
    expect(existsSync(join(repoPath, '.seeflow', 'nodes', 'node-abc', 'logo.png'))).toBe(true);
  });

  it('rejects disallowed extensions', async () => {
    const { app, projectId } = setupProject();
    const form = new FormData();
    form.set('file', new File([Buffer.from('x')], 'evil.sh', { type: 'text/x-shellscript' }));
    const res = await app.request(`/api/projects/${projectId}/nodes/node-abc/files/upload`, {
      method: 'POST', body: form,
    });
    expect(res.status).toBe(400);
  });

  it('dedupes within the node folder with -2/-3 suffix', async () => {
    const { app, projectId } = setupProject();
    for (const _ of [0, 1, 2]) {
      const form = new FormData();
      form.set('file', new File([Buffer.from('x')], 'a.png', { type: 'image/png' }));
      await app.request(`/api/projects/${projectId}/nodes/node-x/files/upload`, {
        method: 'POST', body: form,
      });
    }
    // expect a.png, a-2.png, a-3.png to all exist
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test apps/studio/src/api.test.ts -t 'nodes/:nodeId/files/upload'`
Expected: FAIL — route doesn't exist (404).

**Step 3: Implement**

In `api.ts`, copy the existing `/projects/:id/files/upload` handler (line 618-670). Adapt:
- Path: `/projects/:id/nodes/:nodeId/files/upload`.
- `nodeId = c.req.param('nodeId')`. Validate: must match `^node-[A-Za-z0-9]{10}$` (mirrors the auto-generated shape).
- Target dir: `join(entry.repoPath, '.seeflow', 'nodes', nodeId)` instead of `assets/`.
- Returned path: `nodes/${nodeId}/${finalName}` instead of `assets/${finalName}`.
- Reuse `sanitizeUploadFilename`, `pickUploadFilename`, the size cap, the allowlist.

**Step 4: Run tests to verify they pass**

```
bun test apps/studio/src/api.test.ts
bun run typecheck
```
Expected: all green.

**Step 5: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/api.test.ts
git commit -m "feat(api): add per-node files/upload endpoint under nodes/<id>/"
```

---

### Task 12: Update web imageNode upload flow + delete old endpoint

**Files:**
- Modify: `apps/web/src/` — wherever imageNode upload is wired (grep `files/upload`)
- Modify: `apps/web/src/hooks/use-export-to-cloud.ts` (imageNode path walking — verify)
- Modify: `apps/studio/src/api.ts` — remove old `/projects/:id/files/upload` route
- Modify: `apps/studio/src/api.test.ts` — remove tests for the old route

**Step 1: Update web tests for the new upload path**

Find the existing imageNode-drop test (or upload-related test in `apps/web/src/`) and update its expected endpoint and returned path shape.

**Step 2: Run, observe failures, implement**

- Web: change the upload call site from `/api/projects/:id/files/upload` to `/api/projects/:id/nodes/:nodeId/files/upload`. The flow needs the imageNode's id before uploading — likely means: create the imageNode first (with no `data.path`), then upload, then patch `data.path` with the returned path. This may already be the order; verify.
- Studio: delete the old endpoint and its tests.

**Step 3: Manually verify in browser**

`bun run dev` → drag a PNG onto the canvas → confirm it lands at `<project>/.seeflow/nodes/<imageNodeId>/<filename>` and renders.

**Step 4: Run full suite**

```
bun test
bun run typecheck
bun run lint
```

**Step 5: Commit**

```bash
git add apps/web/ apps/studio/src/api.ts apps/studio/src/api.test.ts
git commit -m "refactor(image): move imageNode uploads to per-node folder; drop assets/ endpoint"
```

---

## Phase D — Cleanup and polish

---

### Task 13: Update MCP tool descriptions and docs

**Files:**
- Modify: `apps/studio/src/mcp.ts:298` (`seeflow_add_node` description)
- Modify: `apps/studio/src/mcp.ts:384` (`seeflow_patch_node` description)
- Modify: any plugin skill (e.g., `skills/*.md`) that references `htmlPath` or the old upload endpoint

**Step 1: Grep for stale references**

```bash
grep -rn 'htmlPath\|assets/\|files/upload' \
  apps/studio/src skills/ docs/ \
  --exclude='*.test.ts' --exclude-dir=node_modules
```

For each hit not already updated by previous tasks: update the text to reflect the new convention.

**Step 2: Update**

Tool descriptions:
- `seeflow_add_node`: mention that `detail` (and `html` for htmlNode) are auto-externalized to `nodes/<id>/`.
- `seeflow_patch_node`: same.

**Step 3: Commit**

```bash
git add apps/studio/src/mcp.ts skills/ docs/
git commit -m "docs(mcp): document per-node file externalization in tool descriptions"
```

---

### Task 14: Final pass

**Step 1: Full check**

```bash
bun run format
bun run lint
bun run typecheck
bun test
```

All green.

**Step 2: Manual smoke**

- `bun run dev`
- Create a fresh project via MCP (`seeflow_create_project`).
- Add a shapeNode with detail — verify `.seeflow/nodes/<id>/detail.md` exists with the content.
- Edit detail.md in your editor — verify the canvas reloads.
- Drag an htmlNode onto the canvas — verify `.seeflow/nodes/<id>/view.html` exists.
- Drop a PNG — verify it lands at `.seeflow/nodes/<id>/<filename>` and renders.
- Delete the nodes — verify the `nodes/<id>/` folders are gone.

**Step 3: PR**

```bash
git push -u origin per-node-files
gh pr create --title "Per-node files: externalize detail, html, and image uploads to nodes/<id>/" \
  --body "$(cat <<'EOF'
## Summary

- New per-node folder convention: `<project>/.seeflow/nodes/<id>/`
- Generic spec mechanism (`EXTERNALIZED_NODE_FIELDS`) externalizes text content fields (`detail`, `html`) automatically; stored as `file://` refs in `flow.json` and inlined by the existing resolver on read.
- imageNode uploads land in the same per-node folder via a new endpoint; renderer unchanged.
- `delete_node` cascades by removing the whole `nodes/<id>/` folder — one rule, no per-field special-casing.
- Deletes the bespoke htmlNode starter-file / cleanup logic and the flat `assets/` upload endpoint.

Design doc: `docs/plans/2026-05-21-per-node-files-design.md`

## Test plan

- [ ] All existing tests green: `bun test`
- [ ] Typecheck: `bun run typecheck`
- [ ] Lint: `bun run lint`
- [ ] Manual: create project, add nodes with detail, edit detail.md externally, drop image, delete node — all behave per spec.
EOF
)"
```

---

## Risk + rollback notes

- Every commit through Phase A leaves the tree green (typecheck + tests + lint). If something breaks in Phase B/C, the worktree can be reset to the last green Phase A commit.
- The schema rename in Task 6 is atomic with its consumers — if it lands separately, the tree won't typecheck. Tasks 6, 7, 8 must be a single commit, OR Tasks 7 and 8 must land in the same git push as Task 6.
- imageNode path invariant (Task 10) is a strict refine — any existing flow with `data.path: assets/...` will fail to parse. Since old flows are being removed per the design, this is intentional. If a stray imageNode hits this in dev, the validation failure surfaces in the canvas as a parse error (the existing `valid: false` path).
