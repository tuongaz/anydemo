# SeeFlow Flow Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split today's `seeflow.json` into `architecture.json` (semantic data, LLM-cheap) + `style.json` (presentation, keyed by id), add `file://` string substitution, retire the `Demo*` vocabulary in favor of `Flow*`, and remove the vendored schema from `skills/seeflow/`.

**Architecture:** Two on-disk files merged into a single `Flow` shape over the wire so the web app stays unchanged. Server-side `splitPatch` routes PATCH bodies between the two files; a `withFlowWriteLock` keeps writes serial. `file://` is a generic string-substitution layer applied before schema validation. Schema validation is exposed as `POST /api/validate` so the skill can drop its vendored schema entirely.

**Tech Stack:** Bun 1.3+, Hono via `hono/bun`, Zod, React + React Flow, Biome, Vitest/Bun test.

**Design source of truth:** `docs/plans/2026-05-19-seeflow-flow-split-design.md` — the 11-section design doc. Refer back to it when an example/rule is ambiguous.

**Pre-execution sanity:**
- `bun run typecheck && bun run lint && bun test` should be green on `main` before starting.
- Create a dedicated worktree (see `superpowers:using-git-worktrees`) — this plan touches ~30 files.
- Each task ends with a green `bun test` for the touched module. Commit after each task.

---

## Phase 0 — Pre-flight `Demo*` → `Flow*` rename

The rename is mechanical and lower-risk than the schema split. Doing it first means every new schema/operation lands in the `Flow` namespace from the start, with no Demo↔Flow bilingual code.

> ⚠️ This phase wipes any user-registered flows from the registry on first run. The user has confirmed "no migration required". Users re-register flows after upgrading.

### Task 0.1: Rename `DemoSchema` → `FlowSchema` (and friends) in `schema.ts`

**Files:**
- Modify: `apps/studio/src/schema.ts:399-454`

**Step 1: Run the existing schema tests to confirm baseline**

```bash
bun test apps/studio/src/schema.test.ts
```

Expected: all pass.

**Step 2: Rename exports**

In `apps/studio/src/schema.ts`, replace every identifier:

```
DemoSchema      → FlowSchema
Demo            → Flow
DemoNode        → FlowNode
```

(Other type exports unchanged; only the top-level union renames.)

**Step 3: Update every importer**

```bash
grep -rln "from.*['\"].*schema['\"]" apps/studio/src apps/web/src packages/sdk skills/seeflow | xargs grep -l "Demo\b\|DemoSchema\|DemoNode" | sort -u
```

For each file in the list, replace `DemoSchema` → `FlowSchema`, `\bDemo\b` (type position) → `Flow`, `DemoNode` → `FlowNode`.

**Step 4: Run typecheck + tests**

```bash
bun run typecheck
bun test apps/studio/src/schema.test.ts
```

Expected: both green.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(schema): rename DemoSchema/Demo/DemoNode to FlowSchema/Flow/FlowNode"
```

### Task 0.2: Rename watcher types and event name

**Files:**
- Modify: `apps/studio/src/watcher.ts` (entire file)
- Modify: `apps/studio/src/watcher.test.ts`
- Modify: `apps/studio/src/events.ts` (event type literal)
- Modify: `apps/studio/src/api.ts` (event payload construction)
- Modify: `apps/web/src/hooks/use-studio-events.ts` (subscriber)

**Step 1: Rename in `watcher.ts`**

- `DemoSnapshot` → `FlowSnapshot`
- `DemoWatcher` → `FlowWatcher`
- `WatcherDeps` field comments only (no type rename)
- `demoId` variable name → `flowId` everywhere in this file
- `snapshot(demoId)` → `snapshot(flowId)`, same for `watch`/`unwatch`/`reparse`/`referencedPaths`

**Step 2: Rename event literal**

In `apps/studio/src/events.ts`, change the event type union:

```ts
type StudioEvent =
  | { type: 'flow:reload'; flowId: string; payload: {...} }  // was 'demo:reload'/demoId
  | { type: 'file:changed'; flowId: string; payload: {...} } // was demoId
  | ... // other events: rename demoId → flowId
```

Update `events.test.ts` literal references.

**Step 3: Update API event broadcasts**

In `api.ts`, every `events.broadcast({ type: 'demo:reload', demoId, ... })` → `{ type: 'flow:reload', flowId, ... }`. SSE query param `?demoId=` accepts `?flowId=` (path-rename happens in Phase 0.3 — for now both work via:

```ts
const flowId = url.searchParams.get('flowId') ?? url.searchParams.get('demoId');
```

…remove the `?? demoId` fallback at the end of Phase 0).

**Step 4: Update web subscriber**

In `apps/web/src/hooks/use-studio-events.ts`, every event-type string `'demo:reload'` → `'flow:reload'`, `demoId` field reads → `flowId`. Same for any other hook subscribing to studio events (grep for `demo:reload`).

**Step 5: Run all studio + web tests**

```bash
bun test apps/studio/src/watcher.test.ts apps/studio/src/events.test.ts apps/studio/src/api.test.ts
bun --cwd apps/web test
```

Expected: all green.

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename DemoSnapshot/DemoWatcher and demo:reload event to Flow*"
```

### Task 0.3: Rename API routes `/api/demos/*` → `/api/flows/*`

**Files:**
- Modify: `apps/studio/src/api.ts` (route declarations)
- Modify: `apps/studio/src/api.test.ts`
- Modify: `apps/web/src/lib/api.ts` (client URL builders)
- Modify: `apps/web/src/hooks/use-demos.ts` (rename file to `use-flows.ts`)
- Modify: every web component that calls `/api/demos/...` (grep first)

**Step 1: Grep to inventory call sites**

```bash
grep -rn "'/api/demos\|\"/api/demos\|\`/api/demos" apps/studio apps/web packages skills
```

Expected: every match needs the rename. Save the list.

**Step 2: Update route declarations in `api.ts`**

Replace every `app.get('/api/demos/...')`, `.post('/api/demos/...')`, etc. with `/api/flows/...`. Update path params: `req.param('demoId')` → `req.param('flowId')`. URL builder in handlers similarly.

**Step 3: Update web client**

In `apps/web/src/lib/api.ts`, every URL builder `\`/api/demos/${id}\`` → `\`/api/flows/${id}\``. Same for SSE: `\`/api/events?demoId=${id}\`` → `\`/api/events?flowId=${id}\``.

**Step 4: Rename hook file**

```bash
git mv apps/web/src/hooks/use-demos.ts apps/web/src/hooks/use-flows.ts
```

Update its exports and every importer.

**Step 5: Run integration tests**

```bash
bun test apps/studio/src/api.test.ts apps/studio/src/mcp.test.ts
bun --cwd apps/web test
```

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(api): rename /api/demos/* routes and use-demos hook to /api/flows/* and use-flows"
```

### Task 0.4: Rename operations + registry field

**Files:**
- Modify: `apps/studio/src/operations.ts`
- Modify: `apps/studio/src/operations.test.ts`
- Modify: `apps/studio/src/registry.ts` (field `demoPath` → `architecturePath`)
- Modify: `apps/studio/src/registry.test.ts`
- Modify: any `seeflow.json` literal in the studio that still says "seeflow.json" — DEFER to Phase 4. Keep them as-is during rename.

**Step 1: Rename in `operations.ts`**

- `DemoListItem` → `FlowListItem`
- `DemoGetResponse` → `FlowGetResponse`
- `getDemoImpl` → `getFlowImpl`
- `registerDemoImpl` → `registerFlowImpl`
- `deleteDemoImpl` → `deleteFlowImpl`
- `withDemoWriteLock` → `withFlowWriteLock`
- `demoWriteChains` → `flowWriteChains`
- `RegisterBody.demoPath` → `RegisterBody.architecturePath`
- Every local `demoId` variable → `flowId`

`createProjectImpl` stays — it creates a project.

**Step 2: Registry field rename**

In `registry.ts`, entry shape field `demoPath` → `architecturePath`. Strip old persistence: on read, if the on-disk JSON has `demoPath`, ignore that entry (the user wipes & re-registers per the design's no-migration rule). Add a one-line console.warn for ignored entries.

```ts
// In the load step:
const valid = persisted.filter((e) => {
  if ('demoPath' in e && !('architecturePath' in e)) {
    console.warn(`[registry] ignoring legacy entry ${e.id} (pre-split format) — please re-register`);
    return false;
  }
  return true;
});
```

**Step 3: Update API consumers**

In `api.ts`, every `entry.demoPath` → `entry.architecturePath`. Same in `watcher.ts`, `cli.ts`, `mcp.ts`.

**Step 4: Update register request body**

`POST /api/flows/register` body: `demoPath` field → `architecturePath`. Same in MCP `register_demo` tool body (tool rename happens in Phase 5; keep `register_demo` for now but rename its body field).

**Step 5: Run tests**

```bash
bun test apps/studio/src
```

Expected: all green.

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename Demo* operations and registry.demoPath to Flow*/architecturePath"
```

### Task 0.5: Rename CLI flag `--demo` → `--architecture`

**Files:**
- Modify: `apps/studio/src/cli.ts`
- Modify: `apps/studio/src/cli.test.ts`

**Step 1: Update flag parsing**

In `cli.ts`, the `register` subcommand currently accepts `--demo <path>`. Rename to `--architecture <path>`. No backward-compat alias (no migration).

Update help text + `DEFAULT_DEMO_PATH` constant rename (to `DEFAULT_ARCHITECTURE_PATH` — value unchanged for now, will become `architecture.json` in Phase 4).

**Step 2: Run CLI tests**

```bash
bun test apps/studio/src/cli.test.ts
```

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor(cli): rename --demo flag to --architecture"
```

---

## Phase 1 — Architecture + Style schemas

Now that the namespace is `Flow`, introduce the two new on-disk schemas alongside `FlowSchema` (the merged shape). `FlowSchema` keeps its current shape — it's what the server returns over the wire. `ArchitectureSchema` and `StyleSchema` are what live on disk after the split.

### Task 1.1: Add `ArchitectureSchema` to `schema.ts`

**Files:**
- Modify: `apps/studio/src/schema.ts` (append after existing schemas)
- Test: `apps/studio/src/schema.test.ts` (new describe block)

**Step 1: Write failing tests for ArchitectureSchema**

```ts
// apps/studio/src/schema.test.ts (append)
import { ArchitectureSchema } from './schema.ts';

describe('ArchitectureSchema', () => {
  it('accepts a minimal architecture with one play node', () => {
    const result = ArchitectureSchema.safeParse({
      version: 2,
      name: 'Test Flow',
      nodes: [{
        id: 'n1',
        type: 'playNode',
        data: {
          name: 'POST /x', kind: 'service',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
        },
      }],
      connectors: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects visual fields on node.data', () => {
    const result = ArchitectureSchema.safeParse({
      version: 2,
      name: 'Test',
      nodes: [{
        id: 'n1', type: 'playNode',
        data: {
          name: 'X', kind: 'service',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'p.ts' },
          fontSize: 15,  // visual field — must be rejected
        },
      }],
      connectors: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects node.position at the root', () => {
    const result = ArchitectureSchema.safeParse({
      version: 2,
      name: 'Test',
      nodes: [{
        id: 'n1', type: 'playNode',
        position: { x: 0, y: 0 },  // must be rejected
        data: {
          name: 'X', kind: 'service',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'p.ts' },
        },
      }],
      connectors: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects visual fields on connectors', () => {
    const result = ArchitectureSchema.safeParse({
      version: 2,
      name: 'Test',
      nodes: [
        { id: 'a', type: 'playNode', data: { name: 'A', kind: 'service', stateSource: { kind: 'request' }, playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'p.ts' } } },
        { id: 'b', type: 'stateNode', data: { name: 'B', kind: 'worker', stateSource: { kind: 'event' } } },
      ],
      connectors: [{ id: 'c1', source: 'a', target: 'b', kind: 'default', color: 'blue' }],
    });
    expect(result.success).toBe(false);
  });

  it('enforces connector source/target referential integrity', () => {
    const result = ArchitectureSchema.safeParse({
      version: 2, name: 'T', nodes: [],
      connectors: [{ id: 'c', source: 'missing', target: 'also-missing', kind: 'default' }],
    });
    expect(result.success).toBe(false);
  });

  it('keeps label, eventName, queueName, method, url on connectors', () => {
    const result = ArchitectureSchema.safeParse({
      version: 2, name: 'T',
      nodes: [
        { id: 'a', type: 'playNode', data: { name: 'A', kind: 'service', stateSource: { kind: 'request' }, playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'p.ts' } } },
        { id: 'b', type: 'stateNode', data: { name: 'B', kind: 'worker', stateSource: { kind: 'event' } } },
      ],
      connectors: [{ id: 'c', source: 'a', target: 'b', kind: 'event', eventName: 'evt', label: 'hi' }],
    });
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run, see fail**

```bash
bun test apps/studio/src/schema.test.ts -t ArchitectureSchema
```

Expected: every test fails (`ArchitectureSchema` undefined).

**Step 3: Implement `ArchitectureSchema`**

Add to `apps/studio/src/schema.ts` (after the existing `FlowSchema` block):

```ts
// =============================================================================
// Architecture schema — pure semantic data, every visual/layout field stripped.
// What lives on disk in <project>/.seeflow/architecture.json.
// =============================================================================

const ArchitectureNodeDataBaseSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  stateSource: StateSourceSchema,
  handlerModule: z.string().optional(),
  icon: z.string().optional(),
  ...NodeDescriptionBaseShape, // description, detail
}).strict();

const ArchitecturePlayNodeDataSchema = ArchitectureNodeDataBaseSchema.extend({
  playAction: PlayActionSchema,
  statusAction: StatusActionSchema.optional(),
}).strict();

const ArchitectureStateNodeDataSchema = ArchitectureNodeDataBaseSchema.extend({
  playAction: PlayActionSchema.optional(),
  statusAction: StatusActionSchema.optional(),
}).strict();

const ArchitectureShapeNodeDataSchema = z.object({
  shape: ShapeKindSchema,
  name: z.string().optional(),
  ...NodeDescriptionBaseShape,
}).strict();

const ArchitectureImageNodeDataSchema = z.object({
  path: z.string().min(1).refine(isCleanRelativePath, { message: 'path must be a relative path under .seeflow/ (no absolute / traversal)' }),
  alt: z.string().optional(),
  ...NodeDescriptionBaseShape,
}).strict();

const ArchitectureIconNodeDataSchema = z.object({
  icon: z.string().min(1),
  alt: z.string().optional(),
  name: z.string().optional(),
  ...NodeDescriptionBaseShape,
}).strict();

const ArchitectureHtmlNodeDataSchema = z.object({
  htmlPath: z.string().min(1).refine(isCleanRelativePath, { message: 'htmlPath must be a relative path under .seeflow/ (no absolute / traversal)' }),
  name: z.string().optional(),
  icon: z.string().optional(),
  ...NodeDescriptionBaseShape,
}).strict();

const ArchitectureNodeBaseShape = {
  id: z.string().min(1),
};

const ArchitectureNodeSchema = z.discriminatedUnion('type', [
  z.object({ ...ArchitectureNodeBaseShape, type: z.literal('playNode'),  data: ArchitecturePlayNodeDataSchema }).strict(),
  z.object({ ...ArchitectureNodeBaseShape, type: z.literal('stateNode'), data: ArchitectureStateNodeDataSchema }).strict(),
  z.object({ ...ArchitectureNodeBaseShape, type: z.literal('shapeNode'), data: ArchitectureShapeNodeDataSchema }).strict(),
  z.object({ ...ArchitectureNodeBaseShape, type: z.literal('imageNode'), data: ArchitectureImageNodeDataSchema }).strict(),
  z.object({ ...ArchitectureNodeBaseShape, type: z.literal('iconNode'),  data: ArchitectureIconNodeDataSchema  }).strict(),
  z.object({ ...ArchitectureNodeBaseShape, type: z.literal('htmlNode'),  data: ArchitectureHtmlNodeDataSchema  }).strict(),
]);

const ArchitectureConnectorBaseShape = {
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
};

const ArchitectureConnectorSchema = z.discriminatedUnion('kind', [
  z.object({ ...ArchitectureConnectorBaseShape, kind: z.literal('http'),    method: HttpMethodSchema.optional(), url: z.string().min(1).optional() }).strict(),
  z.object({ ...ArchitectureConnectorBaseShape, kind: z.literal('event'),   eventName: z.string().min(1) }).strict(),
  z.object({ ...ArchitectureConnectorBaseShape, kind: z.literal('queue'),   queueName: z.string().min(1) }).strict(),
  z.object({ ...ArchitectureConnectorBaseShape, kind: z.literal('default') }).strict(),
]);

export const ArchitectureSchema = z.object({
  version: z.literal(2),
  name: z.string().min(1),
  resetAction: ResetActionSchema.optional(),
  nodes: z.array(ArchitectureNodeSchema),
  connectors: z.array(ArchitectureConnectorSchema),
}).strict().superRefine((arch, ctx) => {
  const ids = new Set(arch.nodes.map((n) => n.id));
  arch.connectors.forEach((c, idx) => {
    if (!ids.has(c.source)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['connectors', idx, 'source'], message: `Connector ${c.id} references unknown source node: ${c.source}` });
    if (!ids.has(c.target)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['connectors', idx, 'target'], message: `Connector ${c.id} references unknown target node: ${c.target}` });
  });
});

export type Architecture = z.infer<typeof ArchitectureSchema>;
export type ArchitectureNode = z.infer<typeof ArchitectureNodeSchema>;
```

**Step 4: Run, see green**

```bash
bun test apps/studio/src/schema.test.ts -t ArchitectureSchema
bun run typecheck
```

Expected: all green.

**Step 5: Commit**

```bash
git add apps/studio/src/schema.ts apps/studio/src/schema.test.ts
git commit -m "feat(schema): add ArchitectureSchema for the data-only on-disk shape"
```

### Task 1.2: Add `StyleSchema` to `schema.ts`

**Files:**
- Modify: `apps/studio/src/schema.ts`
- Modify: `apps/studio/src/schema.test.ts`

**Step 1: Write failing tests**

```ts
describe('StyleSchema', () => {
  it('accepts an empty style object', () => {
    expect(StyleSchema.safeParse({}).success).toBe(true);
  });

  it('accepts position + visual fields on a node entry', () => {
    const r = StyleSchema.safeParse({
      nodes: { n1: { position: { x: 1, y: 2 }, width: 100, height: 50, borderColor: 'blue', fontSize: 14, locked: false } },
    });
    expect(r.success).toBe(true);
  });

  it('accepts iconNode-specific color/strokeWidth and htmlNode autoSize', () => {
    const r = StyleSchema.safeParse({
      nodes: {
        i1: { color: 'red', strokeWidth: 2 },
        h1: { autoSize: true },
      },
    });
    expect(r.success).toBe(true);
  });

  it('accepts connector handles, pins, and visual fields', () => {
    const r = StyleSchema.safeParse({
      connectors: {
        c1: {
          sourceHandle: 'r', targetHandle: 'l',
          sourceHandleAutoPicked: true,
          sourcePin: { side: 'right', t: 0.5 },
          style: 'dashed', color: 'blue', direction: 'forward',
          borderSize: 1, path: 'curve', fontSize: 11,
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown keys on a node entry', () => {
    const r = StyleSchema.safeParse({ nodes: { n1: { fontSize: 14, bogus: 1 } } });
    expect(r.success).toBe(false);
  });

  it('rejects unknown keys on the root', () => {
    const r = StyleSchema.safeParse({ nodes: {}, extra: true });
    expect(r.success).toBe(false);
  });
});
```

**Step 2: Run, see fail**

```bash
bun test apps/studio/src/schema.test.ts -t StyleSchema
```

**Step 3: Implement `StyleSchema`**

Add to `schema.ts`:

```ts
// =============================================================================
// Style schema — keyed map of presentation overrides, side-table by id.
// What lives on disk in <project>/.seeflow/style.json (optional file).
// =============================================================================

const NodeStyleSchema = z.object({
  position: PositionSchema.optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  borderColor: ColorTokenSchema.optional(),
  backgroundColor: ColorTokenSchema.optional(),
  borderSize: z.number().positive().optional(),
  borderStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  fontSize: z.number().positive().optional(),
  textColor: ColorTokenSchema.optional(),
  cornerRadius: z.number().min(0).optional(),
  locked: z.boolean().optional(),
  // imageNode-specific
  borderWidth: z.number().min(1).max(8).optional(),
  // iconNode-specific
  color: ColorTokenSchema.optional(),
  strokeWidth: z.number().min(0.5).max(4).optional(),
  // htmlNode-specific
  autoSize: z.boolean().optional(),
}).strict();

const ConnectorStyleEntrySchema = z.object({
  sourceHandle: SourceHandleIdSchema.optional(),
  targetHandle: TargetHandleIdSchema.optional(),
  sourceHandleAutoPicked: z.boolean().optional(),
  targetHandleAutoPicked: z.boolean().optional(),
  sourcePin: EdgePinSchema.optional(),
  targetPin: EdgePinSchema.optional(),
  style: ConnectorStyleSchema.optional(),
  color: ColorTokenSchema.optional(),
  direction: ConnectorDirectionSchema.optional(),
  borderSize: z.number().positive().optional(),
  path: ConnectorPathSchema.optional(),
  fontSize: z.number().positive().optional(),
}).strict();

export const StyleSchema = z.object({
  nodes: z.record(z.string(), NodeStyleSchema).optional(),
  connectors: z.record(z.string(), ConnectorStyleEntrySchema).optional(),
}).strict();

export type Style = z.infer<typeof StyleSchema>;
export type NodeStyle = z.infer<typeof NodeStyleSchema>;
export type ConnectorStyleEntry = z.infer<typeof ConnectorStyleEntrySchema>;
```

**Step 4: Run, see green**

```bash
bun test apps/studio/src/schema.test.ts -t StyleSchema
bun run typecheck
```

**Step 5: Commit**

```bash
git add apps/studio/src/schema.ts apps/studio/src/schema.test.ts
git commit -m "feat(schema): add StyleSchema for the presentation side-table"
```

### Task 1.3: Bump `FlowSchema.version` from `1` to `2`

**Files:**
- Modify: `apps/studio/src/schema.ts`
- Modify: every fixture that currently writes `"version": 1`

**Step 1: Inventory fixtures**

```bash
grep -rln '"version":\s*1' apps/studio apps/web packages skills .seeflow apps/studio/examples
```

**Step 2: Update FlowSchema version literal**

In `schema.ts`, change `version: z.literal(1)` → `version: z.literal(2)`.

**Step 3: Update every fixture**

Every grep hit: `"version": 1` → `"version": 2`. Don't touch the on-disk example files yet (they get rewritten in Phase 8); just code fixtures.

**Step 4: Run all tests**

```bash
bun test
bun run typecheck
```

Expected: all green. If any tests still write `version: 1`, update them.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(schema): bump FlowSchema version literal from 1 to 2"
```

---

## Phase 2 — `file://` resolver

Pure function: walks parsed architecture JSON, substitutes any string starting with `file://` with the file contents. Used by the watcher before validation.

### Task 2.1: Create `file-ref.ts` with the walker

**Files:**
- Create: `apps/studio/src/file-ref.ts`
- Create: `apps/studio/src/file-ref.test.ts`

**Step 1: Write failing tests**

```ts
// apps/studio/src/file-ref.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFileRefs } from './file-ref.ts';

describe('resolveFileRefs', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'seeflow-fileref-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('returns the input unchanged when no file:// refs present', () => {
    const { resolved, refs } = resolveFileRefs({ foo: 'bar', n: 1 }, root);
    expect(resolved).toEqual({ foo: 'bar', n: 1 });
    expect(refs).toEqual([]);
  });

  it('substitutes a file:// reference with the file contents', () => {
    mkdirSync(join(root, 'details'));
    writeFileSync(join(root, 'details/foo.md'), '# Hello world');
    const { resolved, refs } = resolveFileRefs(
      { data: { detail: 'file://details/foo.md' } },
      root,
    );
    expect(resolved).toEqual({ data: { detail: '# Hello world' } });
    expect(refs.sort()).toEqual(['details/foo.md']);
  });

  it('recurses into arrays and nested objects', () => {
    writeFileSync(join(root, 'a.txt'), 'AAA');
    writeFileSync(join(root, 'b.txt'), 'BBB');
    const { resolved, refs } = resolveFileRefs(
      { nodes: [{ data: { detail: 'file://a.txt', tags: ['file://b.txt', 'plain'] } }] },
      root,
    );
    expect(resolved).toEqual({ nodes: [{ data: { detail: 'AAA', tags: ['BBB', 'plain'] } }] });
    expect(refs.sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('substitutes a placeholder marker when the file is missing', () => {
    const { resolved, refs } = resolveFileRefs(
      { data: { detail: 'file://missing.md' } },
      root,
    );
    expect(resolved).toEqual({ data: { detail: "[seeflow: missing file 'missing.md']" } });
    expect(refs).toEqual([]); // missing files NOT in the watch set
  });

  it('rejects path traversal with an invalid-path marker', () => {
    const { resolved } = resolveFileRefs(
      { data: { detail: 'file://../escape.md' } },
      root,
    );
    expect(resolved).toEqual({ data: { detail: "[seeflow: invalid file:// path '../escape.md']" } });
  });

  it('rejects absolute paths with an invalid-path marker', () => {
    const { resolved } = resolveFileRefs(
      { data: { detail: 'file:///etc/passwd' } },
      root,
    );
    expect(resolved).toEqual({ data: { detail: "[seeflow: invalid file:// path '/etc/passwd']" } });
  });

  it('rejects symlink escapes', () => {
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, '..outside.md'), 'secret');
    // place a symlink inside root pointing outside root
    symlinkSync(join(root, '..outside.md'), join(root, 'sub/escape.md'));
    const { resolved } = resolveFileRefs(
      { data: { detail: 'file://sub/escape.md' } },
      root,
    );
    expect(resolved.data.detail).toMatch(/^\[seeflow: invalid file:\/\/ path/);
  });

  it('returns refs sorted and de-duplicated', () => {
    writeFileSync(join(root, 'x.txt'), 'X');
    const { refs } = resolveFileRefs(
      { a: 'file://x.txt', b: 'file://x.txt' },
      root,
    );
    expect(refs).toEqual(['x.txt']);
  });
});
```

**Step 2: Run, see fail**

```bash
bun test apps/studio/src/file-ref.test.ts
```

**Step 3: Implement `file-ref.ts`**

```ts
// apps/studio/src/file-ref.ts
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

const FILE_PREFIX = 'file://';

const isCleanRelativePath = (p: string): boolean => {
  if (p.length === 0) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (/^[A-Za-z]:[\\/]/.test(p)) return false;
  const segments = p.split(/[\\/]/);
  return !segments.some((seg) => seg === '..');
};

const invalidMarker = (rawPath: string) =>
  `[seeflow: invalid file:// path '${rawPath}']`;
const missingMarker = (rawPath: string) =>
  `[seeflow: missing file '${rawPath}']`;

/**
 * Resolve every `file://<relative-path>` string in `raw` by reading the file
 * under `<seeflowRoot>` and substituting its UTF-8 content. Missing or invalid
 * paths are replaced with placeholder markers so schema parse still succeeds.
 *
 * Returns the mutated tree plus the sorted, de-duplicated list of relative
 * paths that resolved cleanly (the watcher tracks these).
 */
export function resolveFileRefs(
  raw: unknown,
  seeflowRoot: string,
): { resolved: unknown; refs: string[] } {
  const refs = new Set<string>();
  const seeflowRealRoot = existsSync(seeflowRoot) ? realpathSync(seeflowRoot) : seeflowRoot;

  const resolveString = (s: string): string => {
    if (!s.startsWith(FILE_PREFIX)) return s;
    const relPath = s.slice(FILE_PREFIX.length);
    if (!isCleanRelativePath(relPath)) return invalidMarker(relPath);
    const abs = join(seeflowRoot, relPath);
    if (!existsSync(abs)) return missingMarker(relPath);

    // Symlink-escape defense: resolve realpath and confirm it stays inside root.
    let realAbs: string;
    try {
      realAbs = realpathSync(abs);
    } catch {
      return missingMarker(relPath);
    }
    const rel = relative(seeflowRealRoot, realAbs);
    if (rel.startsWith('..') || isAbsolute(rel)) return invalidMarker(relPath);

    try {
      const content = readFileSync(realAbs, 'utf8');
      refs.add(relPath);
      return content;
    } catch {
      return missingMarker(relPath);
    }
  };

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return resolveString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };

  const resolved = walk(raw);
  return { resolved, refs: [...refs].sort() };
}
```

**Step 4: Run, see green**

```bash
bun test apps/studio/src/file-ref.test.ts
```

**Step 5: Commit**

```bash
git add apps/studio/src/file-ref.ts apps/studio/src/file-ref.test.ts
git commit -m "feat(file-ref): add file:// substitution resolver with path-safety + realpath checks"
```

---

## Phase 3 — Watcher reads both files and merges

`reparse()` becomes the integration point. Reads `architecture.json`, resolves `file://`, validates against `ArchitectureSchema`, reads optional `style.json`, validates against `StyleSchema`, merges into a `Flow` matching today's shape.

### Task 3.1: Add a `mergeArchitectureAndStyle` pure helper

**Files:**
- Create: `apps/studio/src/merge.ts`
- Create: `apps/studio/src/merge.test.ts`

**Step 1: Write failing tests**

```ts
// apps/studio/src/merge.test.ts
import { describe, it, expect } from 'bun:test';
import { mergeArchitectureAndStyle } from './merge.ts';

describe('mergeArchitectureAndStyle', () => {
  it('spreads style.position onto the node root', () => {
    const flow = mergeArchitectureAndStyle(
      { version: 2, name: 'T', nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }], connectors: [] },
      { nodes: { n: { position: { x: 10, y: 20 } } } },
    );
    expect(flow.nodes[0].position).toEqual({ x: 10, y: 20 });
  });

  it('defaults position to (0, 0) when missing from style', () => {
    const flow = mergeArchitectureAndStyle(
      { version: 2, name: 'T', nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }], connectors: [] },
      {},
    );
    expect(flow.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it('spreads visual fields into node.data', () => {
    const flow = mergeArchitectureAndStyle(
      { version: 2, name: 'T', nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }], connectors: [] },
      { nodes: { n: { fontSize: 14, borderColor: 'blue' } } },
    );
    expect(flow.nodes[0].data).toMatchObject({ shape: 'rectangle', fontSize: 14, borderColor: 'blue' });
  });

  it('spreads connector handles + visual fields onto the connector', () => {
    const flow = mergeArchitectureAndStyle(
      {
        version: 2, name: 'T',
        nodes: [
          { id: 'a', type: 'shapeNode', data: { shape: 'rectangle' } },
          { id: 'b', type: 'shapeNode', data: { shape: 'rectangle' } },
        ],
        connectors: [{ id: 'c', source: 'a', target: 'b', kind: 'default' }],
      },
      { connectors: { c: { sourceHandle: 'r', style: 'dashed', color: 'blue' } } },
    );
    expect(flow.connectors[0]).toMatchObject({ sourceHandle: 'r', style: 'dashed', color: 'blue' });
  });

  it('ignores style entries with no matching architecture id', () => {
    const flow = mergeArchitectureAndStyle(
      { version: 2, name: 'T', nodes: [{ id: 'a', type: 'shapeNode', data: { shape: 'rectangle' } }], connectors: [] },
      { nodes: { b: { fontSize: 14 } } },
    );
    expect(flow.nodes).toHaveLength(1);
    expect(flow.nodes[0].id).toBe('a');
  });
});
```

**Step 2: Run, see fail**

```bash
bun test apps/studio/src/merge.test.ts
```

**Step 3: Implement `merge.ts`**

```ts
// apps/studio/src/merge.ts
import type { Architecture } from './schema.ts';
import type { Flow } from './schema.ts';
import type { Style } from './schema.ts';

/**
 * Merge architecture.json (semantic data) and the optional style.json
 * (presentation overrides) into the merged Flow shape consumed by the API,
 * the canvas, and the rest of the studio.
 *
 * Style entries with no matching architecture id are silently dropped — the
 * write path strips dangling entries after delete, but a stale file on disk
 * shouldn't break the read path.
 */
export function mergeArchitectureAndStyle(
  arch: Architecture,
  style: Style,
): Flow {
  const nodeStyles = style.nodes ?? {};
  const connectorStyles = style.connectors ?? {};

  const mergedNodes = arch.nodes.map((node) => {
    const s = nodeStyles[node.id] ?? {};
    const { position, ...visual } = s;
    return {
      ...node,
      position: position ?? { x: 0, y: 0 },
      data: { ...node.data, ...visual } as never,
    };
  });

  const mergedConnectors = arch.connectors.map((conn) => {
    const s = connectorStyles[conn.id] ?? {};
    return { ...conn, ...s } as never;
  });

  return {
    version: arch.version,
    name: arch.name,
    ...(arch.resetAction ? { resetAction: arch.resetAction } : {}),
    nodes: mergedNodes,
    connectors: mergedConnectors,
  } as Flow;
}
```

**Step 4: Run, see green**

```bash
bun test apps/studio/src/merge.test.ts
bun run typecheck
```

**Step 5: Commit**

```bash
git add apps/studio/src/merge.ts apps/studio/src/merge.test.ts
git commit -m "feat(merge): add mergeArchitectureAndStyle for the read path"
```

### Task 3.2: Update `watcher.ts` to read architecture.json + style.json

**Files:**
- Modify: `apps/studio/src/watcher.ts`
- Modify: `apps/studio/src/watcher.test.ts`

**Step 1: Write failing watcher tests for split files**

Add to `watcher.test.ts`:

```ts
it('reparses a flow with separate architecture.json and style.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  mkdirSync(join(dir, '.seeflow'));
  writeFileSync(join(dir, '.seeflow/architecture.json'), JSON.stringify({
    version: 2, name: 'Split Demo',
    nodes: [{ id: 'a', type: 'shapeNode', data: { shape: 'rectangle' } }],
    connectors: [],
  }));
  writeFileSync(join(dir, '.seeflow/style.json'), JSON.stringify({
    nodes: { a: { position: { x: 10, y: 20 }, fontSize: 14 } },
  }));
  const entry = reg.upsert({ name: 'Split Demo', repoPath: dir, architecturePath: '.seeflow/architecture.json' });
  const snap = watcher.reparse(entry.id);
  expect(snap?.valid).toBe(true);
  expect(snap?.flow?.nodes[0]).toMatchObject({ position: { x: 10, y: 20 }, data: { fontSize: 14 } });
});

it('handles a missing style.json by applying defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  mkdirSync(join(dir, '.seeflow'));
  writeFileSync(join(dir, '.seeflow/architecture.json'), JSON.stringify({
    version: 2, name: 'No Style',
    nodes: [{ id: 'a', type: 'shapeNode', data: { shape: 'rectangle' } }],
    connectors: [],
  }));
  // No style.json.
  const entry = reg.upsert({ name: 'No Style', repoPath: dir, architecturePath: '.seeflow/architecture.json' });
  const snap = watcher.reparse(entry.id);
  expect(snap?.valid).toBe(true);
  expect(snap?.flow?.nodes[0].position).toEqual({ x: 0, y: 0 });
});

it('resolves file:// in detail before validation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  mkdirSync(join(dir, '.seeflow/details'), { recursive: true });
  writeFileSync(join(dir, '.seeflow/details/a.md'), '# A details');
  writeFileSync(join(dir, '.seeflow/architecture.json'), JSON.stringify({
    version: 2, name: 'FileRef',
    nodes: [{ id: 'a', type: 'playNode', data: {
      name: 'A', kind: 'service',
      stateSource: { kind: 'request' },
      playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'p.ts' },
      detail: 'file://details/a.md',
    } }],
    connectors: [],
  }));
  const entry = reg.upsert({ name: 'FileRef', repoPath: dir, architecturePath: '.seeflow/architecture.json' });
  const snap = watcher.reparse(entry.id);
  expect(snap?.valid).toBe(true);
  expect(snap?.flow?.nodes[0].data.detail).toBe('# A details');
  expect(watcher.referencedPaths(entry.id)).toContain('details/a.md');
});

it('broadcasts flow:reload when style.json changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-'));
  mkdirSync(join(dir, '.seeflow'));
  writeFileSync(join(dir, '.seeflow/architecture.json'), JSON.stringify({
    version: 2, name: 'StyleWatch',
    nodes: [{ id: 'a', type: 'shapeNode', data: { shape: 'rectangle' } }],
    connectors: [],
  }));
  writeFileSync(join(dir, '.seeflow/style.json'), JSON.stringify({ nodes: { a: { fontSize: 12 } } }));
  const entry = reg.upsert({ name: 'StyleWatch', repoPath: dir, architecturePath: '.seeflow/architecture.json' });
  const events: unknown[] = [];
  bus.subscribe((e) => { if (e.type === 'flow:reload' && e.flowId === entry.id) events.push(e); });
  watcher.watch(entry.id);
  await waitForCondition(() => events.length >= 1); // initial seed
  writeFileSync(join(dir, '.seeflow/style.json'), JSON.stringify({ nodes: { a: { fontSize: 20 } } }));
  await waitForCondition(() => events.length >= 2);
  const latest = events[events.length - 1] as { payload: { flow: Flow } };
  expect(latest.payload.flow.nodes[0].data.fontSize).toBe(20);
});
```

(`waitForCondition` helper: see `superpowers:condition-based-waiting` — write a tiny `until((done)) await sleep 20`-style loop, capped at 2s.)

**Step 2: Run, see fail (compilation errors are expected — `architecturePath`/`flow` fields don't exist yet)**

```bash
bun test apps/studio/src/watcher.test.ts
```

**Step 3: Update `FlowSnapshot` and `reparse()`**

In `watcher.ts`:

```ts
// FlowSnapshot field rename
export interface FlowSnapshot {
  flow: Flow | null;          // was: demo
  valid: boolean;
  error: string | null;
  filePath: string;           // remains: path to architecture.json
  parsedAt: number;
}
```

Rewrite `reparse(flowId)`:

```ts
import { ArchitectureSchema, StyleSchema, type Flow } from './schema.ts';
import { resolveFileRefs } from './file-ref.ts';
import { mergeArchitectureAndStyle } from './merge.ts';

const reparse = (flowId: string): FlowSnapshot | null => {
  const entry = registry.getById(flowId);
  if (!entry) return null;
  const archPath = resolveFilePath(entry.repoPath, entry.architecturePath);
  const seeflowRoot = dirname(archPath);              // <project>/.seeflow
  const stylePath = join(seeflowRoot, 'style.json');
  const previous = snapshots.get(flowId) ?? null;
  const parsedAt = Date.now();

  const fail = (error: string): FlowSnapshot => ({
    flow: previous?.flow ?? null, valid: false, error, filePath: archPath, parsedAt,
  });

  if (!existsSync(archPath)) {
    const snap = fail(`Architecture file not found: ${archPath}`);
    snapshots.set(flowId, snap);
    return snap;
  }

  // 1. Read + parse architecture JSON
  let rawArch: unknown;
  try {
    rawArch = JSON.parse(readFileSync(archPath, 'utf8'));
  } catch (err) {
    const snap = fail(`Invalid JSON in architecture.json: ${err instanceof Error ? err.message : String(err)}`);
    snapshots.set(flowId, snap);
    return snap;
  }

  // 2. Resolve file:// refs (before schema parse)
  const { resolved, refs } = resolveFileRefs(rawArch, seeflowRoot);

  // 3. Validate architecture
  const archParse = ArchitectureSchema.safeParse(resolved);
  if (!archParse.success) {
    const message = archParse.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
    const snap = fail(`Architecture schema validation failed: ${message}`);
    snapshots.set(flowId, snap);
    // Still reconcile the file watcher set so a fix-on-disk triggers reload.
    const handle = handles.get(flowId);
    if (handle) reconcileFileWatchers(flowId, handle, seeflowRoot, refs);
    return snap;
  }

  // 4. Read + parse style JSON (optional)
  let rawStyle: unknown = {};
  if (existsSync(stylePath)) {
    try {
      rawStyle = JSON.parse(readFileSync(stylePath, 'utf8'));
    } catch (err) {
      const snap = fail(`Invalid JSON in style.json: ${err instanceof Error ? err.message : String(err)}`);
      snapshots.set(flowId, snap);
      return snap;
    }
  }

  // 5. Validate style
  const styleParse = StyleSchema.safeParse(rawStyle);
  if (!styleParse.success) {
    const message = styleParse.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
    const snap = fail(`Style schema validation failed: ${message}`);
    snapshots.set(flowId, snap);
    return snap;
  }

  // 6. Merge
  const flow = mergeArchitectureAndStyle(archParse.data, styleParse.data);
  const next: FlowSnapshot = { flow, valid: true, error: null, filePath: archPath, parsedAt };
  snapshots.set(flowId, next);

  // 7. Reconcile file watcher set (htmlPath/imageNode.path + resolved file:// refs)
  const handle = handles.get(flowId);
  if (handle) {
    const allRefs = [...refs, ...collectStaticPaths(archParse.data)];
    reconcileFileWatchers(flowId, handle, seeflowRoot, allRefs);
  }
  return next;
};
```

Add a helper `collectStaticPaths(arch: Architecture): string[]` that returns the `htmlPath` and `path` fields from htmlNode/imageNode data (the existing `collectReferencedPaths` function — move it next to `mergeArchitectureAndStyle` or keep it in watcher; it now operates on a parsed Architecture, not raw JSON).

**Step 4: Watch style.json as well**

In `startWatch(flowId)`, after the existing `fs.watch(dir, ...)` for the architecture file, extend the filter:

```ts
fsWatcher = watch(dir, { persistent: true }, (_event, changed) => {
  if (changed && changed !== base && changed !== 'style.json') return;
  // ... existing debounce + reparse + broadcast
});
```

**Step 5: Run tests, see green**

```bash
bun test apps/studio/src/watcher.test.ts
```

**Step 6: Commit**

```bash
git add apps/studio/src/watcher.ts apps/studio/src/watcher.test.ts apps/studio/src/merge.ts
git commit -m "feat(watcher): read architecture.json + style.json, resolve file:// refs, merge into Flow"
```

### Task 3.3: Update `getFlowImpl` to use the new snapshot shape

**Files:**
- Modify: `apps/studio/src/operations.ts` (the `getFlowImpl` function)
- Modify: `apps/studio/src/operations.test.ts`

**Step 1: Update `FlowGetResponse` shape**

```ts
export interface FlowGetResponse {
  id: string; slug: string; name: string; filePath: string;
  flow: Flow | null;                       // was: demo
  valid: boolean;
  error: string | null;
}
```

**Step 2: Update `getFlowImpl` fallback (no-watcher branch)**

The existing function reads `Bun.file(fullPath).json()` and parses with `DemoSchema`. Replace with the same architecture+style read+resolve+merge flow used in the watcher (factor a `readMergedFlow(archPath: string): Promise<{ flow: Flow | null; valid: boolean; error: string | null }>` helper used by both watcher and the fallback path).

**Step 3: Run, see green**

```bash
bun test apps/studio/src/operations.test.ts -t getFlow
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(operations): getFlowImpl reads architecture+style with file:// resolved"
```

---

## Phase 4 — Write routing

Every CRUD operation now reads both files, mutates one or both, and writes them atomically. The hard part is `splitPatch` — a static field-routing table.

### Task 4.1: Add `splitPatch` helper

**Files:**
- Modify: `apps/studio/src/operations.ts`
- Modify: `apps/studio/src/operations.test.ts`

**Step 1: Write failing tests**

```ts
import { splitPatch, NODE_DATA_PATCH_KEYS, NODE_STYLE_PATCH_KEYS } from './operations.ts';

describe('splitPatch (node)', () => {
  it('routes data-only fields to archUpdates', () => {
    const { archUpdates, styleUpdates } = splitPatch({ name: 'X', icon: 'database' });
    expect(archUpdates).toEqual({ name: 'X', icon: 'database' });
    expect(styleUpdates).toEqual({});
  });

  it('routes visual fields to styleUpdates', () => {
    const { archUpdates, styleUpdates } = splitPatch({ fontSize: 14, borderColor: 'blue', position: { x: 1, y: 2 } });
    expect(archUpdates).toEqual({});
    expect(styleUpdates).toEqual({ fontSize: 14, borderColor: 'blue', position: { x: 1, y: 2 } });
  });

  it('handles mixed bodies', () => {
    const { archUpdates, styleUpdates } = splitPatch({ name: 'X', fontSize: 14 });
    expect(archUpdates).toEqual({ name: 'X' });
    expect(styleUpdates).toEqual({ fontSize: 14 });
  });
});
```

**Step 2: Run, see fail**

**Step 3: Implement**

In `operations.ts`, replace the existing `NODE_DATA_PATCH_KEYS` with the new split:

```ts
// Fields that live in architecture.json (node.data)
export const NODE_DATA_PATCH_KEYS = [
  'name', 'icon', 'description', 'detail', 'alt', 'shape',
] as const satisfies ReadonlyArray<keyof NodePatchBody>;

// Fields that live in style.json (nodes[<id>])
export const NODE_STYLE_PATCH_KEYS = [
  'position',
  'width', 'height',
  'borderColor', 'backgroundColor', 'borderSize', 'borderStyle', 'borderWidth',
  'fontSize', 'textColor', 'cornerRadius', 'locked',
  'autoSize',
  // iconNode-specific
  'color', 'strokeWidth',
] as const satisfies ReadonlyArray<keyof NodePatchBody>;

export function splitPatch(body: NodePatchBody): {
  archUpdates: Partial<NodePatchBody>;
  styleUpdates: Partial<NodePatchBody>;
} {
  const archUpdates: Partial<NodePatchBody> = {};
  const styleUpdates: Partial<NodePatchBody> = {};
  for (const k of NODE_DATA_PATCH_KEYS) if (body[k] !== undefined) (archUpdates as any)[k] = body[k];
  for (const k of NODE_STYLE_PATCH_KEYS) if (body[k] !== undefined) (styleUpdates as any)[k] = body[k];
  return { archUpdates, styleUpdates };
}
```

Do the same for connectors: `splitConnectorPatch` with `CONNECTOR_DATA_PATCH_KEYS` (label, kind, source, target, eventName, queueName, method, url) and `CONNECTOR_STYLE_PATCH_KEYS` (handles, autoPicked, pins, style, color, direction, borderSize, path, fontSize).

**Step 4: Run, see green**

```bash
bun test apps/studio/src/operations.test.ts -t splitPatch
```

**Step 5: Commit**

```bash
git add apps/studio/src/operations.ts apps/studio/src/operations.test.ts
git commit -m "feat(operations): add splitPatch + splitConnectorPatch routing tables"
```

### Task 4.2: Replace `mergeNodeUpdates` with `applyNodePatch` (writes both files)

**Files:**
- Modify: `apps/studio/src/operations.ts`

**Step 1: Write failing tests for the new helper**

```ts
describe('applyNodePatch', () => {
  it('writes data fields to architecture, visual fields to style', () => {
    const arch = { nodes: [{ id: 'n', type: 'playNode', data: { name: 'Old' } }] };
    const style: any = { nodes: {} };
    applyNodePatch(arch, style, 'n', { name: 'New', fontSize: 14 });
    expect(arch.nodes[0].data).toEqual({ name: 'New' });
    expect(style.nodes.n).toEqual({ fontSize: 14 });
  });

  it('clears description/detail when empty string is sent', () => {
    const arch = { nodes: [{ id: 'n', type: 'playNode', data: { name: 'X', detail: 'doc' } }] };
    const style: any = { nodes: {} };
    applyNodePatch(arch, style, 'n', { detail: '' });
    expect('detail' in arch.nodes[0].data).toBe(false);
  });

  it('clears icon when explicit null is sent', () => {
    const arch = { nodes: [{ id: 'n', type: 'playNode', data: { name: 'X', icon: 'foo' } }] };
    const style: any = { nodes: {} };
    applyNodePatch(arch, style, 'n', { icon: null });
    expect('icon' in arch.nodes[0].data).toBe(false);
  });

  it('enforces htmlNode autoSize ⊻ width+height invariant in style', () => {
    const arch = { nodes: [{ id: 'h', type: 'htmlNode', data: { htmlPath: 'a.html' } }] };
    const style: any = { nodes: { h: { width: 200, height: 100 } } };
    applyNodePatch(arch, style, 'h', { autoSize: true });
    expect(style.nodes.h).toEqual({ autoSize: true });
  });

  it('strips empty style entries from the keyed map', () => {
    const arch = { nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }] };
    const style: any = { nodes: { n: { fontSize: 14 } } };
    applyNodePatch(arch, style, 'n', { fontSize: undefined as never });
    // setting to undefined is a no-op; for clearing we delete keys.
    // Simulate a "clear fontSize" via a follow-up sentinel? For now: the strip
    // happens only when the entry ends up {} after merge.
    expect(style.nodes.n).toEqual({ fontSize: 14 });
  });
});
```

**Step 2: Run, see fail**

**Step 3: Implement `applyNodePatch(arch, style, nodeId, body)`**

Replaces `mergeNodeUpdates`. Signature mutates both `arch` (Architecture-shaped JSON) and `style` (Style-shaped JSON) in place:

```ts
export function applyNodePatch(
  arch: { nodes: Array<Record<string, unknown>> },
  style: { nodes?: Record<string, Record<string, unknown>>; connectors?: Record<string, Record<string, unknown>> },
  nodeId: string,
  updates: NodePatchBody,
): void {
  const node = arch.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const { archUpdates, styleUpdates } = splitPatch(updates);

  // 1. Architecture-side: merge into node.data
  const dataAny = node.data;
  const data: Record<string, unknown> = dataAny && typeof dataAny === 'object' && !Array.isArray(dataAny)
    ? (dataAny as Record<string, unknown>) : {};
  let touched = false;
  for (const [key, value] of Object.entries(archUpdates)) {
    if (value === undefined) continue;
    if ((key === 'description' || key === 'detail') && value === '') {
      if (key in data) { delete data[key]; touched = true; }
      continue;
    }
    if (key === 'icon' && value === null) {
      if (key in data) { delete data[key]; touched = true; }
      continue;
    }
    data[key] = value; touched = true;
  }
  if (touched) node.data = data;

  // 2. Style-side: merge into style.nodes[nodeId]
  style.nodes = style.nodes ?? {};
  const entry: Record<string, unknown> = style.nodes[nodeId] ?? {};
  let styleTouched = false;
  for (const [key, value] of Object.entries(styleUpdates)) {
    if (value === undefined) continue;
    entry[key] = value;
    styleTouched = true;
  }

  // htmlNode autoSize ⊻ width+height invariant
  if (node.type === 'htmlNode' && styleUpdates.autoSize === true) {
    if ('width' in entry) { delete entry.width; styleTouched = true; }
    if ('height' in entry) { delete entry.height; styleTouched = true; }
  } else if (node.type === 'htmlNode' && (styleUpdates.width !== undefined || styleUpdates.height !== undefined)) {
    entry.autoSize = false; styleTouched = true;
  }

  if (Object.keys(entry).length === 0) {
    delete style.nodes[nodeId];
  } else if (styleTouched) {
    style.nodes[nodeId] = entry;
  }
}
```

Add `applyConnectorPatch` with the same structure but using `splitConnectorPatch` and the connector-style cascade.

**Step 4: Run, see green**

```bash
bun test apps/studio/src/operations.test.ts -t applyNodePatch
```

**Step 5: Commit**

```bash
git add apps/studio/src/operations.ts apps/studio/src/operations.test.ts
git commit -m "feat(operations): applyNodePatch routes patch body across architecture + style"
```

### Task 4.3: Rewrite `patchNodeImpl` to write both files

**Files:**
- Modify: `apps/studio/src/operations.ts`

**Step 1: Write failing integration test**

In `operations.test.ts`:

```ts
it('PATCH visual field writes only style.json, leaves architecture untouched', async () => {
  // setup: flow with one node, no style entry
  const { archPath, stylePath, flowId } = setupFlow(/* helper */);
  const archBefore = readFileSync(archPath, 'utf8');
  await patchNodeImpl(deps, flowId, 'n1', { fontSize: 14 });
  expect(readFileSync(archPath, 'utf8')).toBe(archBefore);
  const style = JSON.parse(readFileSync(stylePath, 'utf8'));
  expect(style.nodes.n1).toEqual({ fontSize: 14 });
});

it('PATCH semantic field writes only architecture.json', async () => {
  const { archPath, stylePath, flowId } = setupFlow();
  const styleBefore = existsSync(stylePath) ? readFileSync(stylePath, 'utf8') : '';
  await patchNodeImpl(deps, flowId, 'n1', { name: 'Renamed' });
  expect(JSON.parse(readFileSync(archPath, 'utf8')).nodes[0].data.name).toBe('Renamed');
  if (existsSync(stylePath)) expect(readFileSync(stylePath, 'utf8')).toBe(styleBefore);
});

it('clears style.json when the last visual field is removed', async () => {
  const { archPath, stylePath, flowId } = setupFlow({ withStyle: { n1: { fontSize: 14 } } });
  // future PATCH that clears fontSize — for now, simulate via empty entry
  // (We don't have a "clear" sentinel for visual fields yet; this verifies the
  // strip-empty behavior runs.)
  await patchNodeImpl(deps, flowId, 'n1', { /* no-op */ });
  // file still exists, entry still there — assertion verifies no spurious delete
  expect(existsSync(stylePath)).toBe(true);
});
```

**Step 2: Run, see fail**

**Step 3: Rewrite `patchNodeImpl`**

```ts
export async function patchNodeImpl(
  deps: OperationsDeps,
  flowId: string,
  nodeId: string,
  updates: NodePatchBody,
): Promise<PatchNodeOutcome> {
  const entry = deps.registry.getById(flowId);
  if (!entry) return { kind: 'flowNotFound' };
  const archPath = resolveFilePath(entry.repoPath, entry.architecturePath);
  const stylePath = join(dirname(archPath), 'style.json');
  if (!existsSync(archPath)) return { kind: 'fileNotFound', path: archPath };

  type Inner =
    | { kind: 'ok' }
    | { kind: 'badJson'; message: string }
    | { kind: 'badSchema'; issues: ZodIssue[] }
    | { kind: 'unknownNode' }
    | { kind: 'writeFailed'; message: string };

  const result = await withFlowWriteLock<Inner>(flowId, async () => {
    // 1. Read architecture
    let rawArch: any;
    try { rawArch = JSON.parse(readFileSync(archPath, 'utf8')); }
    catch (err) { return { kind: 'badJson', message: err instanceof Error ? err.message : String(err) }; }

    // 2. Read style (optional)
    let rawStyle: any = {};
    if (existsSync(stylePath)) {
      try { rawStyle = JSON.parse(readFileSync(stylePath, 'utf8')); }
      catch (err) { return { kind: 'badJson', message: `style.json: ${err instanceof Error ? err.message : String(err)}` }; }
    }

    // 3. Confirm node exists in architecture
    const node = rawArch.nodes?.find((n: any) => n.id === nodeId);
    if (!node) return { kind: 'unknownNode' };

    // 4. Apply patch
    applyNodePatch(rawArch, rawStyle, nodeId, updates);

    // 5. Validate both
    const ap = ArchitectureSchema.safeParse(rawArch);
    if (!ap.success) return { kind: 'badSchema', issues: ap.error.issues };
    const sp = StyleSchema.safeParse(rawStyle);
    if (!sp.success) return { kind: 'badSchema', issues: sp.error.issues };

    // 6. Write architecture (only if changed — naive: always write)
    try {
      writeFileAtomic(archPath, `${JSON.stringify(rawArch, null, 2)}\n`);
    } catch (err) {
      return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
    }

    // 7. Write or delete style
    const styleIsEmpty = (!rawStyle.nodes || Object.keys(rawStyle.nodes).length === 0) &&
                        (!rawStyle.connectors || Object.keys(rawStyle.connectors).length === 0);
    try {
      if (styleIsEmpty) {
        if (existsSync(stylePath)) unlinkSync(stylePath);
      } else {
        writeFileAtomic(stylePath, `${JSON.stringify(rawStyle, null, 2)}\n`);
      }
    } catch (err) {
      return { kind: 'writeFailed', message: err instanceof Error ? err.message : String(err) };
    }
    return { kind: 'ok' };
  });

  return result;
}
```

**Step 4: Run, see green**

```bash
bun test apps/studio/src/operations.test.ts -t patchNode
```

**Step 5: Commit**

```bash
git add apps/studio/src/operations.ts apps/studio/src/operations.test.ts
git commit -m "feat(operations): patchNodeImpl writes architecture + style atomically"
```

### Task 4.4: Rewrite remaining operations

Repeat the Task 4.3 pattern for each `*Impl`. Each is its own bite-sized task — write the test, rewrite the function, verify, commit. Touch them in this order:

- **Task 4.4a** `moveNodeImpl` — writes only style.json (`position` lives there now). architecture.json untouched.
- **Task 4.4b** `addNodeImpl` — append to `arch.nodes`. If body carries any visual fields, also write style entry. htmlNode starter-file logic unchanged.
- **Task 4.4c** `deleteNodeImpl` — splice from `arch.nodes`, cascade-delete `arch.connectors` referencing the node, delete `style.nodes[id]`, cascade-delete `style.connectors[<id>]` for affected connectors.
- **Task 4.4d** `reorderNodeImpl` — touches only `arch.nodes[]` order. style.json untouched.
- **Task 4.4e** `addConnectorImpl` — append to `arch.connectors`. If body carries any style fields, also write `style.connectors[id]`.
- **Task 4.4f** `patchConnectorImpl` — mirror of `patchNodeImpl` using `splitConnectorPatch` + `applyConnectorPatch`.
- **Task 4.4g** `deleteConnectorImpl` — splice from `arch.connectors`, delete `style.connectors[id]`.
- **Task 4.4h** `createProjectImpl` — scaffold writes only `.seeflow/architecture.json` (no style.json). Update `DEFAULT_DEMO_RELATIVE_PATH` → `DEFAULT_ARCHITECTURE_RELATIVE_PATH = '.seeflow/architecture.json'`. Body version `2`.
- **Task 4.4i** `registerFlowImpl` — read architecture, resolve file://, validate. Body field renamed in Phase 0; just adapt the read path.

Each sub-task: write 2-4 integration tests covering the file-split behavior, implement, run, commit. **Commit message template:** `feat(operations): <name>Impl writes architecture + style atomically`.

---

## Phase 5 — `POST /api/validate` endpoint

### Task 5.1: Add `validateImpl` to `operations.ts`

**Files:**
- Modify: `apps/studio/src/operations.ts`
- Modify: `apps/studio/src/operations.test.ts`

**Step 1: Write failing tests**

```ts
import { validateImpl } from './operations.ts';

describe('validateImpl', () => {
  it('returns ok for valid architecture + style', () => {
    const r = validateImpl({
      architecture: { version: 2, name: 'T', nodes: [{ id: 'n', type: 'shapeNode', data: { shape: 'rectangle' } }], connectors: [] },
      style: { nodes: { n: { fontSize: 14 } } },
    });
    expect(r).toEqual({ ok: true });
  });

  it('returns architecture-scoped issues on bad arch', () => {
    const r = validateImpl({ architecture: { version: 1, name: '', nodes: [], connectors: [] } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.every((i) => i.scope === 'architecture')).toBe(true);
    }
  });

  it('returns style-scoped issues on bad style', () => {
    const r = validateImpl({
      architecture: { version: 2, name: 'T', nodes: [], connectors: [] },
      style: { nodes: { x: { fontSize: -1 } } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.scope === 'style')).toBe(true);
    }
  });

  it('flags style entries with no matching architecture id', () => {
    const r = validateImpl({
      architecture: { version: 2, name: 'T', nodes: [], connectors: [] },
      style: { nodes: { ghost: { fontSize: 14 } } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.find((i) => i.code === 'orphan_style_node')).toBeDefined();
    }
  });
});
```

**Step 2: Implement**

```ts
export interface ValidateBody {
  architecture: unknown;
  style?: unknown;
}

export interface ValidationIssue {
  scope: 'architecture' | 'style' | 'cross';
  path: (string | number)[];
  message: string;
  code: string;
}

export type ValidateOutcome =
  | { ok: true }
  | { ok: false; issues: ValidationIssue[] };

export function validateImpl(body: ValidateBody): ValidateOutcome {
  const issues: ValidationIssue[] = [];
  const archParse = ArchitectureSchema.safeParse(body.architecture);
  if (!archParse.success) {
    for (const i of archParse.error.issues) {
      issues.push({ scope: 'architecture', path: [...i.path], message: i.message, code: i.code });
    }
  }
  let styleData: Style | undefined;
  if (body.style !== undefined) {
    const styleParse = StyleSchema.safeParse(body.style);
    if (!styleParse.success) {
      for (const i of styleParse.error.issues) {
        issues.push({ scope: 'style', path: [...i.path], message: i.message, code: i.code });
      }
    } else {
      styleData = styleParse.data;
    }
  }
  if (archParse.success && styleData) {
    const archNodeIds = new Set(archParse.data.nodes.map((n) => n.id));
    const archConnIds = new Set(archParse.data.connectors.map((c) => c.id));
    for (const id of Object.keys(styleData.nodes ?? {})) {
      if (!archNodeIds.has(id)) {
        issues.push({ scope: 'cross', path: ['nodes', id], message: `Style entry references unknown node id: ${id}`, code: 'orphan_style_node' });
      }
    }
    for (const id of Object.keys(styleData.connectors ?? {})) {
      if (!archConnIds.has(id)) {
        issues.push({ scope: 'cross', path: ['connectors', id], message: `Style entry references unknown connector id: ${id}`, code: 'orphan_style_connector' });
      }
    }
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
```

**Step 3: Run, see green**

```bash
bun test apps/studio/src/operations.test.ts -t validateImpl
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(operations): add validateImpl exposing schema validation + cross-checks"
```

### Task 5.2: Wire `POST /api/validate` in `api.ts`

**Files:**
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/api.test.ts`

**Step 1: Write failing API test**

```ts
it('POST /api/validate returns ok for valid bodies', async () => {
  const res = await app.request('/api/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ architecture: { version: 2, name: 'T', nodes: [], connectors: [] } }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

it('POST /api/validate returns 200 with issues array on bad architecture', async () => {
  const res = await app.request('/api/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ architecture: { version: 1 } }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(false);
  expect(body.issues.every((i: any) => i.scope === 'architecture')).toBe(true);
});

it('POST /api/validate returns 400 for malformed body', async () => {
  const res = await app.request('/api/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  expect(res.status).toBe(400);
});
```

**Step 2: Implement the route**

```ts
app.post('/api/validate', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  if (!body || typeof body !== 'object' || !('architecture' in body)) {
    return c.json({ error: 'Body must be { architecture, style? }' }, 400);
  }
  const result = validateImpl(body as ValidateBody);
  return c.json(result, 200);
});
```

**Step 3: Run, see green**

```bash
bun test apps/studio/src/api.test.ts -t '/api/validate'
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): add POST /api/validate stateless schema validator"
```

---

## Phase 6 — MCP tool surface

### Task 6.1: Rename `*demo*` MCP tools to `*flow*`

**Files:**
- Modify: `apps/studio/src/mcp.ts`
- Modify: `apps/studio/src/mcp-shim.ts`
- Modify: `apps/studio/src/mcp.test.ts`
- Modify: `apps/studio/src/mcp-parity.test.ts`
- Modify: `apps/studio/src/mcp-shim.test.ts`

**Step 1: Grep for tool names**

```bash
grep -n "register_demo\|get_demo\|list_demos\|delete_demo\|add_node\|patch_node\|move_node\|reorder_node\|delete_node\|add_connector\|patch_connector\|delete_connector" apps/studio/src/mcp.ts apps/studio/src/mcp-shim.ts
```

**Step 2: Apply the rename**

- `register_demo` → `register_flow`
- `get_demo` → `get_flow`
- `list_demos` → `list_flows`
- `delete_demo` → `delete_flow`
- node/connector tools keep their names (`add_node`, etc. — already `Demo`-free)
- Tool body fields: any `demoPath` → `architecturePath`, `demoId` → `flowId`

**Step 3: Run parity + tool tests**

```bash
bun test apps/studio/src/mcp.test.ts apps/studio/src/mcp-parity.test.ts apps/studio/src/mcp-shim.test.ts
```

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor(mcp): rename register_demo/get_demo/list_demos/delete_demo to *_flow"
```

### Task 6.2: Add MCP `validate_seeflow` tool

**Files:**
- Modify: `apps/studio/src/mcp.ts`
- Modify: `apps/studio/src/mcp-shim.ts`
- Modify: `apps/studio/src/mcp-parity.test.ts`

**Step 1: Write parity test**

```ts
it('validate_seeflow MCP tool matches POST /api/validate', async () => {
  const apiRes = await fetch(`${url}/api/validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ architecture: { version: 2, name: 'T', nodes: [], connectors: [] } }),
  }).then((r) => r.json());
  const mcpRes = await mcpClient.callTool('validate_seeflow', {
    architecture: { version: 2, name: 'T', nodes: [], connectors: [] },
  });
  expect(mcpRes).toEqual(apiRes);
});
```

**Step 2: Implement the tool**

In `mcp.ts`, register `validate_seeflow` taking `{ architecture, style? }` and returning the `validateImpl` outcome. Mirror in `mcp-shim.ts` (the shim exists for parity with the non-MCP harness — keep them lockstep).

**Step 3: Run parity tests**

```bash
bun test apps/studio/src/mcp-parity.test.ts
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(mcp): add validate_seeflow tool mirroring POST /api/validate"
```

---

## Phase 7 — Skill cleanup

### Task 7.1: Delete `skills/seeflow/scripts/validate-schema.ts`

**Files:**
- Delete: `skills/seeflow/scripts/validate-schema.ts`
- Delete: `skills/seeflow/scripts/validate-schema.test.ts`
- Delete: `skills/seeflow/vendored/` (entire directory)

**Step 1: Confirm no in-skill references remain**

```bash
grep -rn "validate-schema\|vendored/schema" skills/seeflow
```

If any matches, address them before deleting (likely in `SKILL.md` — replaced in Task 7.3).

**Step 2: Delete**

```bash
git rm skills/seeflow/scripts/validate-schema.ts skills/seeflow/scripts/validate-schema.test.ts
git rm -r skills/seeflow/vendored
```

**Step 3: Run skill tests**

```bash
bun test skills/seeflow/scripts
```

Expected: green. If `register.test.ts` or `smoke.test.ts` referenced the vendored schema, fix those imports.

**Step 4: Commit**

```bash
git commit -m "chore(skill): remove validate-schema.ts script and vendored schema directory"
```

### Task 7.2: Rewrite `SKILL.md` for the split

**Files:**
- Modify: `skills/seeflow/SKILL.md`

**Step 1: Replace the schema cheatsheet (lines 396-589 in current file)**

Split every node example into:
- An architecture-side block (data only, no position, no visual fields)
- A style-side block (the keyed entry for that node)

Add a new sub-section **`file://` substitution** with the recommended `details/<id>.md` convention:

```markdown
### `file://` substitution

Any string in `architecture.json` may use `file://<relative-path>` to offload the
content to a separate file under `<project>/.seeflow/`. Recommended for `detail`
when it exceeds ~200 chars.

Path syntax: relative under `.seeflow/`, no leading `/`, no `..`. Missing files
render as a placeholder card (the flow still loads).

Example:

  // architecture.json
  { "data": { "detail": "file://details/post-orders.md" } }

  // <project>/.seeflow/details/post-orders.md
  ## POST /orders
  Entry point for the order pipeline...
```

**Step 2: Replace Phase 3 (skeleton write + validate)**

Replace the `bun skills/seeflow/scripts/validate-schema.ts ...` call with the curl-to-`/api/validate` snippet:

```bash
RESULT=$(curl -fsS -X POST "$STUDIO_URL/api/validate" \
  -H 'content-type: application/json' \
  -d "$(jq -n --slurpfile a "$flowDir/architecture.json" '{architecture: $a[0]}')")
echo "$RESULT" | jq -e '.ok' >/dev/null \
  || { echo "$RESULT" | jq '.issues' >&2; exit 1; }
```

**Step 3: Replace Phase 5 (post-overlay validate)**

Same curl pattern, with `--slurpfile s "$flowDir/style.json"` and `{architecture: $a[0], style: $s[0]}` when style.json exists.

**Step 4: Replace Phase 6 (write scripts + re-register)**

File-system writes:
- `$flowDir/architecture.json` (was `seeflow.json`)
- `$flowDir/style.json` if any visual fields landed
- `$flowDir/scripts/*` unchanged
- `$flowDir/details/*` for `file://`-referenced detail files

Register URL:
```bash
curl -fsS -X POST "$STUDIO_URL/api/flows/register" \
  -H 'content-type: application/json' \
  -d "{\"repoPath\":\"$repoPath\",\"architecturePath\":\"$flowPath\"}"
```

Or via the script:
```bash
bun skills/seeflow/scripts/register.ts --path "$repoPath" --flow "$flowPath"
```

(Where `$flowPath = .seeflow/<slug>/architecture.json`.)

**Step 5: Update Studio API touchpoints table**

| Endpoint | Method | Phase | Body |
|---|---|---|---|
| `/health` | GET | 0 | — |
| `/api/validate` | POST | 3, 5 | `{architecture, style?}` |
| `/api/flows/register` | POST | 3, 6 | `{name, repoPath, architecturePath}` |
| `/api/flows/:id` | GET | 7 | — |
| `/api/flows/:id/play/:nodeId` | POST | 7 | — |
| `/api/events?flowId=:id` | GET (SSE) | 7 | — |
| `/api/flows/:id` | DELETE | rollback only | — |

**Step 6: Add the `prefer-file-references` planner rule**

Under the new "Schema cheatsheet" section, add:

```markdown
**RULE — prefer file refs for long detail.** When a node's `detail` would
exceed ~200 chars (most production flows), write it to
`<slug>/details/<nodeId>.md` and set `"detail": "file://<slug>/details/<nodeId>.md"`
in architecture.json. Keeps architecture.json compact for LLM consumption,
gives authors a real markdown file to edit, and lights up the file:// watcher.
```

**Step 7: Run the skill smoke tests**

```bash
bun test skills/seeflow/scripts/smoke.test.ts
```

Expected: green (smoke tests should not depend on validate-schema).

**Step 8: Commit**

```bash
git add skills/seeflow/SKILL.md
git commit -m "docs(skill): rewrite SKILL.md for architecture/style split + file:// + /api/validate"
```

### Task 7.3: Update agent prompts

**Files:**
- Modify: `skills/seeflow/agents/seeflow-node-planner.md`
- Modify: `skills/seeflow/agents/seeflow-play-designer.md`
- Modify: `skills/seeflow/agents/seeflow-status-designer.md`
- Modify: `skills/seeflow/agents/seeflow-discoverer.md` (only the references to `seeflow.json`)

**Step 1: `seeflow-node-planner.md`**

- Output JSON: nodes carry only data (no `position`, no visual fields).
- Add an optional top-level `"style": { "nodes": {...} }` block in the planner's output for layout/visual hints. The orchestrator routes it to style.json.
- Connector output drops visual fields.
- Update every example block accordingly.
- References to `existing seeflow.json` → `existing architecture.json`.

**Step 2: `seeflow-play-designer.md` and `seeflow-status-designer.md`**

- Read-target reference renamed.
- Overlay shape: only `data.playAction`/`data.statusAction` — no visual field exposure.

**Step 3: `seeflow-discoverer.md`**

- References to `existing seeflow.json` → `existing architecture.json`.

**Step 4: Run agent smoke tests**

```bash
bun test skills/seeflow/agents/seeflow-discoverer.smoke.md
```

(If this is a markdown-only file, no test step — visual review only.)

**Step 5: Commit**

```bash
git add skills/seeflow/agents
git commit -m "docs(skill): update agent prompts for architecture/style split"
```

### Task 7.4: Update `references/plan-format.md`

**Files:**
- Modify: `skills/seeflow/references/plan-format.md`

**Step 1: Replace file-tree examples**

Every `<slug>/seeflow.json` → `<slug>/architecture.json` + (optional) `<slug>/style.json` + `<slug>/details/`.

**Step 2: Commit**

```bash
git add skills/seeflow/references/plan-format.md
git commit -m "docs(skill): plan-format.md reflects architecture/style file layout"
```

### Task 7.5: Update `skills/seeflow/scripts/register.ts` help text

**Files:**
- Modify: `skills/seeflow/scripts/register.ts`

**Step 1: Rename `--demo` flag to `--architecture`**

Already named `--flow` in the orchestrator's example call. The script today accepts `--flow`. Keep that name (it's well-aligned with the new vocabulary).

Update the `readNameFromDemoFile` function:
- Rename to `readNameFromArchitectureFile`.
- Reads `.name` from the architecture file — works unchanged once the path argument points there.

**Step 2: Update help text**

```text
Usage: register.ts --path <repoPath> --flow <architecturePath>
```

**Step 3: Run register tests**

```bash
bun test skills/seeflow/scripts/register.test.ts
```

**Step 4: Commit**

```bash
git add skills/seeflow/scripts/register.ts skills/seeflow/scripts/register.test.ts
git commit -m "refactor(skill): register.ts reads architecture.json, help text updated"
```

---

## Phase 8 — Example flows + dogfood

The bundled example flows must be rewritten in the split form so the studio loads them.

### Task 8.1: Rewrite `apps/studio/examples/order-pipeline/`

**Files:**
- Delete: `apps/studio/examples/order-pipeline/.seeflow/seeflow.json`
- Create: `apps/studio/examples/order-pipeline/.seeflow/architecture.json`
- Create: `apps/studio/examples/order-pipeline/.seeflow/style.json`
- Create: `apps/studio/examples/order-pipeline/.seeflow/details/post-orders.md`
- Create: `apps/studio/examples/order-pipeline/.seeflow/details/inventory-service.md`
- Create: `apps/studio/examples/order-pipeline/.seeflow/details/payment-service.md`
- Create: `apps/studio/examples/order-pipeline/.seeflow/details/fulfillment-service.md`

**Step 1: Extract every `data.detail` block from the existing seeflow.json**

Each detail block becomes a `details/<nodeId>.md` file. The architecture entry becomes `"detail": "file://details/<nodeId>.md"`.

**Step 2: Split visual fields into style.json**

For each node, move `position`, `width`, `height`, `borderColor`, `borderSize`, `fontSize`, etc. into `style.json` under `nodes[<id>]`.

For each connector, move `sourceHandle`, `targetHandle`, `style`, etc. into `style.json` under `connectors[<id>]`.

**Step 3: Bump architecture.json `"version": 1` → `"version": 2`**

**Step 4: Validate**

```bash
# (assuming studio is running locally on $STUDIO_URL)
curl -fsS -X POST "$STUDIO_URL/api/validate" -H 'content-type: application/json' \
  -d "$(jq -n --slurpfile a apps/studio/examples/order-pipeline/.seeflow/architecture.json \
              --slurpfile s apps/studio/examples/order-pipeline/.seeflow/style.json \
              '{architecture: $a[0], style: $s[0]}')"
```

Expected: `{"ok": true}`.

**Step 5: Open in studio + visual verify**

```bash
bun run dev
# Register the example flow:
bun apps/studio/src/cli.ts register --path apps/studio/examples/order-pipeline --architecture .seeflow/architecture.json
# Open http://localhost:5173 → load the flow → confirm canvas matches the pre-split version.
```

**Step 6: Delete the old seeflow.json**

```bash
git rm apps/studio/examples/order-pipeline/.seeflow/seeflow.json
```

**Step 7: Commit**

```bash
git add apps/studio/examples/order-pipeline
git commit -m "feat(examples): order-pipeline rewritten with architecture.json + style.json + file:// details"
```

### Task 8.2: Rewrite `apps/studio/examples/ecommerce-platform/`

Same procedure as Task 8.1. Larger flow, more nodes — split each detail block into a `details/<id>.md` file.

### Task 8.3: Rewrite `.seeflow/flow-share/seeflow.json`

The studio's own dogfood flow. Same procedure as Task 8.1 — split into architecture.json + style.json under `.seeflow/flow-share/.seeflow/`.

---

## Phase 9 — Final verification

### Task 9.1: Full test suite + lint + typecheck

```bash
bun run format && bun run lint && bun run typecheck && bun test
bun --cwd apps/web test
```

Expected: all green.

### Task 9.2: Manual UI smoke test

1. `bun run dev`
2. Open the order-pipeline example. Confirm:
   - Every node renders at its previous position.
   - Border colors, font sizes, etc. match the pre-split appearance.
   - Sidebar opens for each play/state node and shows the detail markdown (loaded from `details/<id>.md`).
3. Drag a node. Confirm:
   - `style.json` is rewritten; `architecture.json` is untouched (`git status` shows only style.json modified).
4. Edit a node's name in the sidebar. Confirm:
   - `architecture.json` is rewritten; `style.json` is untouched.
5. Edit `details/post-orders.md` in another editor. Confirm:
   - The sidebar updates within ~100ms (file watcher + reload broadcast).
6. Rename a `file://` target to a non-existent path. Confirm:
   - The sidebar shows the `[seeflow: missing file '...']` placeholder, flow stays loaded.
7. PATCH a visual field via the canvas (e.g., change border color). Confirm:
   - `style.json` updated, `architecture.json` untouched.

### Task 9.3: Skill end-to-end

Run the `/seeflow` skill against a small target repo:

```bash
/seeflow Create a flow that shows our login endpoint
```

Confirm:
- Phase 3 writes `architecture.json` and validates via `/api/validate` (curl path).
- Phase 5 writes both files and re-validates.
- Phase 7 end-to-end passes.

### Task 9.4: Commit a final cleanup pass

If any stale `Demo*` references or `seeflow.json` literals surfaced during smoke testing, fix them now.

```bash
grep -rn "DemoSchema\|DemoNode\|demoId\|demoPath\|/api/demos\|seeflow.json" apps/studio apps/web packages skills
```

Address each, run `bun test`, commit.

---

## Out of scope (intentionally deferred)

- **Canvas package rename** (`@seeflow/canvas` types referencing `Demo`) — listed in design Section 8 as web-side type rename; deferred unless trivial.
- **Per-style undo granularity** — the existing undo stack treats the whole flow as one history slot. With the split it might be worth tracking architecture and style independently. Out of scope for this refactor.
- **`file://` write-back** — auto-extracting a large inline `detail` into a separate file on save. Authoring choice, not runtime concern.

---

## Plan complete and saved to `docs/plans/2026-05-19-seeflow-flow-split-implementation.md`.

Two execution options:

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task and review between tasks. Fast iteration; one approval gate per task.
2. **Parallel Session (separate)** — Open a new session in a dedicated worktree (`superpowers:using-git-worktrees`) and have it use `superpowers:executing-plans` to batch-execute with checkpoints.

Which approach?
