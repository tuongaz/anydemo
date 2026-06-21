# CLI In-Process Operations — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make the SeeFlow CLI call the shared `operations.ts` logic core directly (in-process) instead of going over HTTP to the studio. Add a registry file watcher so a running studio observes external (CLI) mutations and pushes live updates to the browser.

**Architecture:** `operations.ts` already exposes `*Impl()` functions over `OperationsDeps = { registry, watcher?, projectBaseDir? }`. The studio's REST API (`api.ts`) and MCP server (`mcp.ts`) already wrap those. The CLI (`cli.ts`) is the lone outlier, going over HTTP. We:
1. Add a thin `createOperations(deps)` factory so all three wrappers (API, MCP, CLI) consume the same handle.
2. Tighten `registry.ts` writes to be atomic.
3. Add a registry file watcher that broadcasts `registry:reload` so the studio and SPA pick up external registry edits live.
4. Rewire CLI read/mutation commands to call the handle directly. `play` / `reset` / `e2e` stay on HTTP — they're live, server-only features.
5. Add differentiated CLI exit codes from the `Outcome` discriminated union.

**Tech Stack:** Bun, TypeScript, Hono, Zod, `bun:test`, `node:fs.watch`.

**Reference design conversation:** This plan was produced from the brainstorm at `apps/studio/src/cli.ts:1-839`, `apps/studio/src/operations.ts`, `apps/studio/src/registry.ts:1-159`, `apps/studio/src/watcher.ts:1-528`, `apps/studio/src/api.ts:1-1423`, `apps/studio/src/mcp.ts:1-748`, `apps/studio/src/events.ts:1-71`.

---

## Pre-flight Checks

Before starting any task, verify the working tree is clean (or that you understand what's already modified) and tests pass on `main`:

```bash
git status --short                    # only seeflow-canvas.tsx is expected modified
bun install
bun run typecheck
bun test apps/studio/src              # baseline must be green
```

Expected: typecheck clean, all `apps/studio/src` tests green.

If any baseline test is red, stop and ask before proceeding.

---

## Phase 1 — Package operations into a handle

The `*Impl` functions stay (MCP imports them directly today). We add a wrapper layer so consumers can choose either style. Hidden agenda: makes the CLI side cleaner and codifies the deps shape.

### Task 1.1 — Add `createOperations(deps)` factory with `Operations` interface

**Files:**
- Modify: `apps/studio/src/operations.ts` (append at end)
- Test: `apps/studio/src/operations.test.ts` (append a new describe block)

**Context for the engineer:**
The file is large (~26k tokens). At the top it already exports `OperationsDeps`, every `*Impl` function, and helper exports like `writeFileAtomic` and `resolveFilePath`. We're adding ONE additional export that delegates to the existing functions — no behaviour change.

**Step 1: Write the failing test**

Append to `apps/studio/src/operations.test.ts`:

```ts
describe('createOperations factory', () => {
  it('exposes every *Impl as a method that delegates to the underlying function', async () => {
    const tmp = await Bun.write(
      `${tmpdir()}/registry-${crypto.randomUUID()}.json`,
      '[]',
    );
    const registry = createRegistry({ path: tmp.name });
    const ops = createOperations({ registry });

    const result = await ops.listFlows();
    expect(result.data).toEqual([]);
  });

  it('throws a clear error when a play-style op is invoked without a spawner', async () => {
    // Reserved for a future play handle if added. For now, verify the handle
    // does not silently swallow missing deps.
    const registry = createRegistry({ path: ':memory:' });
    const ops = createOperations({ registry });
    // No play method exists on the handle today (play stays HTTP-only).
    expect('play' in ops).toBe(false);
  });
});
```

Replace `tmpdir()` import with `import { tmpdir } from 'node:os';` at the top of the file if not already there.

**Step 2: Run test to verify it fails**

```bash
bun test apps/studio/src/operations.test.ts -t "createOperations factory"
```

Expected: FAIL — `createOperations is not a function`.

**Step 3: Implement the factory**

Append to `apps/studio/src/operations.ts` (just before the final newline of the file):

```ts
// ---------------------------------------------------------------------------
// createOperations — thin handle that exposes every *Impl as a bound method.
// Consumers (api.ts, mcp.ts, cli.ts) construct one of these at startup so they
// don't re-thread `deps` through every call site. No behaviour change — every
// method delegates to the existing *Impl function.
// ---------------------------------------------------------------------------

export interface Operations {
  listFlows(): ReturnType<typeof listDemosImpl>;
  listFlowsSummary(): ReturnType<typeof listFlowsSummaryImpl>;
  getFlow(id: string): ReturnType<typeof getFlowImpl>;
  getFlowGraph(id: string): ReturnType<typeof getFlowGraphImpl>;
  getNode(flowId: string, nodeId: string): ReturnType<typeof getNodeImpl>;
  addNode(flowId: string, body: Record<string, unknown>): ReturnType<typeof addNodeImpl>;
  addNodesBulk(
    flowId: string,
    body: Parameters<typeof addNodesBulkImpl>[2],
  ): ReturnType<typeof addNodesBulkImpl>;
  patchNode(
    flowId: string,
    nodeId: string,
    body: Parameters<typeof patchNodeImpl>[3],
  ): ReturnType<typeof patchNodeImpl>;
  moveNode(
    flowId: string,
    nodeId: string,
    body: Parameters<typeof moveNodeImpl>[3],
  ): ReturnType<typeof moveNodeImpl>;
  reorderNode(
    flowId: string,
    nodeId: string,
    body: Parameters<typeof reorderNodeImpl>[3],
  ): ReturnType<typeof reorderNodeImpl>;
  deleteNode(flowId: string, nodeId: string): ReturnType<typeof deleteNodeImpl>;
  addConnector(
    flowId: string,
    body: Record<string, unknown>,
  ): ReturnType<typeof addConnectorImpl>;
  addConnectorsBulk(
    flowId: string,
    body: Parameters<typeof addConnectorsBulkImpl>[2],
  ): ReturnType<typeof addConnectorsBulkImpl>;
  patchConnector(
    flowId: string,
    connectorId: string,
    body: Parameters<typeof patchConnectorImpl>[3],
  ): ReturnType<typeof patchConnectorImpl>;
  deleteConnector(
    flowId: string,
    connectorId: string,
  ): ReturnType<typeof deleteConnectorImpl>;
  registerFlow(
    body: Parameters<typeof registerFlowImpl>[1],
  ): ReturnType<typeof registerFlowImpl>;
  createProject(
    body: Parameters<typeof createProjectImpl>[1],
  ): ReturnType<typeof createProjectImpl>;
  deleteFlow(id: string): ReturnType<typeof deleteFlowImpl>;
  validate(body: ValidateBody): ReturnType<typeof validateImpl>;
}

export function createOperations(deps: OperationsDeps): Operations {
  return {
    listFlows: () => listDemosImpl(deps),
    listFlowsSummary: () => listFlowsSummaryImpl(deps),
    getFlow: (id) => getFlowImpl(deps, id),
    getFlowGraph: (id) => getFlowGraphImpl(deps, id),
    getNode: (flowId, nodeId) => getNodeImpl(deps, flowId, nodeId),
    addNode: (flowId, body) => addNodeImpl(deps, flowId, body),
    addNodesBulk: (flowId, body) => addNodesBulkImpl(deps, flowId, body),
    patchNode: (flowId, nodeId, body) => patchNodeImpl(deps, flowId, nodeId, body),
    moveNode: (flowId, nodeId, body) => moveNodeImpl(deps, flowId, nodeId, body),
    reorderNode: (flowId, nodeId, body) =>
      reorderNodeImpl(deps, flowId, nodeId, body),
    deleteNode: (flowId, nodeId) => deleteNodeImpl(deps, flowId, nodeId),
    addConnector: (flowId, body) => addConnectorImpl(deps, flowId, body),
    addConnectorsBulk: (flowId, body) => addConnectorsBulkImpl(deps, flowId, body),
    patchConnector: (flowId, connectorId, body) =>
      patchConnectorImpl(deps, flowId, connectorId, body),
    deleteConnector: (flowId, connectorId) =>
      deleteConnectorImpl(deps, flowId, connectorId),
    registerFlow: (body) => registerFlowImpl(deps, body),
    createProject: (body) => createProjectImpl(deps, body),
    deleteFlow: (id) => deleteFlowImpl(deps, id),
    validate: (body) => validateImpl(body),
  };
}
```

**Step 4: Run test to verify it passes**

```bash
bun test apps/studio/src/operations.test.ts -t "createOperations factory"
```

Expected: PASS.

**Step 5: Run full suite to confirm no regression**

```bash
bun run typecheck
bun test apps/studio/src/operations.test.ts
```

Expected: typecheck clean, all operations tests green.

**Step 6: Commit**

```bash
git add apps/studio/src/operations.ts apps/studio/src/operations.test.ts
git commit -m "feat(operations): add createOperations factory"
```

---

### Task 1.2 — Migrate `api.ts` route handlers to use the handle

**Files:**
- Modify: `apps/studio/src/api.ts:219-1422` (every handler that calls a `*Impl` function)

**Why:** Forces all three wrappers (API, MCP, CLI) onto the same handle and proves the new interface is sufficient before the CLI starts depending on it.

**Step 1: Run existing API tests baseline**

```bash
bun test apps/studio/src/api.test.ts
```

Expected: green.

**Step 2: Refactor the handler call sites**

Inside `createApi()` (around line 219), after the `const proxy = …;` line, add:

```ts
const ops = createOperations({ registry, watcher, projectBaseDir });
```

Import `createOperations` from `./operations.ts` at the top of the file.

Then in each handler, replace:
- `await registerFlowImpl({ registry, watcher }, parsed.data)` → `await ops.registerFlow(parsed.data)`
- `listDemosImpl({ registry })` → `ops.listFlows()`
- `listFlowsSummaryImpl({ registry, watcher })` → `ops.listFlowsSummary()`
- `await getFlowImpl({ registry, watcher }, c.req.param('id'))` → `await ops.getFlow(c.req.param('id'))`
- `await getFlowGraphImpl({ registry, watcher }, c.req.param('id'))` → `await ops.getFlowGraph(c.req.param('id'))`
- `await getNodeImpl({ registry, watcher }, …)` → `await ops.getNode(…)`
- `await createProjectImpl({ registry, watcher, projectBaseDir }, parsed.data)` → `await ops.createProject(parsed.data)`
- `deleteFlowImpl({ registry, watcher }, c.req.param('id'))` → `ops.deleteFlow(c.req.param('id'))`
- `await moveNodeImpl(…)`, `await reorderNodeImpl(…)`, `await patchNodeImpl(…)`, `await addNodeImpl(…)`, `await addNodesBulkImpl(…)`, `await deleteNodeImpl(…)`, `await patchConnectorImpl(…)`, `await addConnectorImpl(…)`, `await addConnectorsBulkImpl(…)`, `await deleteConnectorImpl(…)` → matching `ops.*`
- `validateImpl(body as ValidateBody)` → `ops.validate(body as ValidateBody)`

Leave alone: anything involving `proxy.runPlay`, `proxy.runReset`, `statusRunner.*`, `events.broadcast`, `streamSSE`, raw `computeLayout`, the multipart upload route — those don't go through the *Impl layer.

Remove now-unused imports from the `./operations.ts` import block at the top of `api.ts` (everything except `RegisterBodySchema`, `NodePatchBodySchema`, `PositionBodySchema`, `ReorderBodySchema`, `ConnectorPatchBodySchema`, `NodesBulkBodySchema`, `ConnectorsBulkBodySchema`, `CreateProjectBodySchema`, `type ValidateBody`, `resolveFilePath`, `writeFileAtomic`, `createOperations`).

**Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: clean. Fix any type drift between the handle return types and the previous direct calls before continuing.

**Step 4: Run API tests**

```bash
bun test apps/studio/src/api.test.ts
```

Expected: PASS — behaviour is identical, only the call shape changed.

**Step 5: Commit**

```bash
git add apps/studio/src/api.ts
git commit -m "refactor(api): route handlers go through createOperations"
```

---

### Task 1.3 — Migrate `mcp.ts` tool handlers to use the handle

**Files:**
- Modify: `apps/studio/src/mcp.ts:193-710` (every tool handler that calls a `*Impl`)
- Modify: `apps/studio/src/mcp.ts:718-723` (`createMcpServer` — construct the handle once)

**Step 1: Run baseline**

```bash
bun test apps/studio/src/mcp.test.ts
```

Expected: green.

**Step 2: Refactor `buildTools`**

Change `buildTools(deps: OperationsDeps): McpTool[]` to `buildTools(ops: Operations): McpTool[]`.

Inside each tool's handler, replace direct `*Impl` calls with the matching handle method, e.g.:
- `listDemosImpl(deps)` → `ops.listFlows()`
- `await getFlowImpl(deps, v.flowId)` → `await ops.getFlow(v.flowId)`
- `await addNodeImpl(deps, flowId, node)` → `await ops.addNode(flowId, node)`
- etc.

In `createMcpServer`, replace:
```ts
const tools = buildTools({
  registry: options.registry,
  watcher: options.watcher,
  projectBaseDir: options.projectBaseDir,
});
```
with:
```ts
const ops = createOperations({
  registry: options.registry,
  watcher: options.watcher,
  projectBaseDir: options.projectBaseDir,
});
const tools = buildTools(ops);
```

Import `Operations, createOperations` from `./operations.ts`. Remove the now-unused `*Impl` imports and the `OperationsDeps` import.

**Step 3: Typecheck + test**

```bash
bun run typecheck
bun test apps/studio/src/mcp.test.ts
```

Expected: green.

**Step 4: Commit**

```bash
git add apps/studio/src/mcp.ts
git commit -m "refactor(mcp): tool handlers go through createOperations"
```

---

## Phase 2 — Atomic Registry Writes + `onChange` Subscription

`registry.ts` currently does `writeFileSync(path, …)` which is NOT atomic — a concurrent reader can see truncated JSON. We're about to add an external watcher that polls this file, so atomicity matters.

### Task 2.1 — Make registry writes atomic

**Files:**
- Modify: `apps/studio/src/registry.ts:84-87`
- Test: `apps/studio/src/registry.test.ts` (append)

**Step 1: Write the failing test**

Append to `apps/studio/src/registry.test.ts`:

```ts
describe('atomic registry writes', () => {
  it('never leaves the registry file in a half-written state', async () => {
    const path = join(tmpdir(), `reg-atomic-${crypto.randomUUID()}.json`);
    const registry = createRegistry({ path });

    // Spawn 50 concurrent upserts; in between, read the file. Every read
    // must parse as valid JSON (either old or new contents — never partial).
    const writes = Array.from({ length: 50 }, (_, i) =>
      Promise.resolve().then(() =>
        registry.upsert({
          name: `flow-${i}`,
          repoPath: `/tmp/repo-${i}`,
          flowPath: '.seeflow/flow.json',
        }),
      ),
    );
    const reads = Array.from({ length: 50 }, () =>
      Promise.resolve().then(() => {
        if (!existsSync(path)) return; // pre-first-write window
        const content = readFileSync(path, 'utf8');
        expect(() => JSON.parse(content)).not.toThrow();
      }),
    );
    await Promise.all([...writes, ...reads]);
  });
});
```

Add the imports `import { existsSync, readFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';` at the top if not already present.

**Step 2: Run to confirm it fails (or is flaky)**

```bash
bun test apps/studio/src/registry.test.ts -t "atomic registry writes"
```

Expected: at least intermittent failure (truncated JSON parse). If it accidentally passes the first time, run it 5 times to confirm flakiness:

```bash
for i in 1 2 3 4 5; do bun test apps/studio/src/registry.test.ts -t "atomic registry writes" || break; done
```

**Step 3: Implement atomic write**

In `apps/studio/src/registry.ts`, import `writeFileAtomic` from `./operations.ts` (it already lives there and is exported):

```ts
import { writeFileAtomic } from './operations.ts';
```

Replace the body of `persist`:

```ts
const persist = () => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, JSON.stringify([...entries.values()], null, 2));
};
```

**Step 4: Confirm the test passes (run it 5x)**

```bash
for i in 1 2 3 4 5; do bun test apps/studio/src/registry.test.ts -t "atomic registry writes" || break; done
```

Expected: 5 green runs.

**Step 5: Commit**

```bash
git add apps/studio/src/registry.ts apps/studio/src/registry.test.ts
git commit -m "fix(registry): persist with atomic write"
```

---

### Task 2.2 — Add `onChange` subscription + own-write echo suppression

**Files:**
- Modify: `apps/studio/src/registry.ts` (extend `Registry` interface + factory return)
- Test: `apps/studio/src/registry.test.ts` (append)

**Why:** The future `registry-watcher.ts` will use `onChange` so the studio's in-memory registry stays in sync with external mutations. Own-write hash ring prevents the studio from double-reloading after its own `upsert`/`remove`.

**Step 1: Write the failing test**

Append to `apps/studio/src/registry.test.ts`:

```ts
describe('onChange subscription', () => {
  it('records the hash of every persisted state for own-echo dedupe', () => {
    const path = join(tmpdir(), `reg-onchange-${crypto.randomUUID()}.json`);
    const registry = createRegistry({ path });

    registry.upsert({
      name: 'a',
      repoPath: '/tmp/a',
      flowPath: '.seeflow/flow.json',
    });
    const persisted = readFileSync(path, 'utf8');

    // External writer changes the file (simulated CLI write). The hash on
    // disk now differs from any hash the in-process registry produced.
    expect(registry.isOwnWrite(persisted)).toBe(true);
    expect(registry.isOwnWrite('[]')).toBe(false);
  });

  it('fires onChange listeners when reload() is called', () => {
    const path = join(tmpdir(), `reg-reload-${crypto.randomUUID()}.json`);
    const registry = createRegistry({ path });
    const observed: number[] = [];
    const unsub = registry.onChange(() => observed.push(registry.list().length));

    // Simulate external CLI writing 2 entries.
    writeFileSync(
      path,
      JSON.stringify(
        [
          {
            id: 'a',
            slug: 'a',
            name: 'a',
            repoPath: '/tmp/a',
            flowPath: '.seeflow/flow.json',
            lastModified: 0,
            valid: true,
          },
          {
            id: 'b',
            slug: 'b',
            name: 'b',
            repoPath: '/tmp/b',
            flowPath: '.seeflow/flow.json',
            lastModified: 0,
            valid: true,
          },
        ],
        null,
        2,
      ),
    );

    registry.reload();
    expect(observed).toEqual([2]);
    unsub();
  });
});
```

Add `writeFileSync` to the `node:fs` import if not present.

**Step 2: Run to confirm fail**

```bash
bun test apps/studio/src/registry.test.ts -t "onChange subscription"
```

Expected: FAIL — `registry.isOwnWrite` / `registry.onChange` / `registry.reload` are not functions.

**Step 3: Implement**

Modify `apps/studio/src/registry.ts`:

```ts
import { createHash } from 'node:crypto';

// ... existing FlowEntry/RegisterInput types ...

export interface Registry {
  list(): FlowEntry[];
  getById(id: string): FlowEntry | undefined;
  getBySlug(slug: string): FlowEntry | undefined;
  getByRepoPath(repoPath: string): FlowEntry | undefined;
  getByRepoPathAndFlowPath(repoPath: string, flowPath: string): FlowEntry | undefined;
  upsert(input: RegisterInput): FlowEntry;
  remove(id: string): boolean;
  /** Subscribe to external changes detected via reload(). Returns unsubscribe. */
  onChange(fn: () => void): () => void;
  /** Drop the in-memory cache and reread from disk. Fires onChange listeners. */
  reload(): void;
  /** True when `contents` matches a hash this registry recently persisted. */
  isOwnWrite(contents: string): boolean;
}
```

Inside `createRegistry`, before the `return { … }` block, add:

```ts
const OWN_WRITE_RING_SIZE = 4;
const writtenHashes: string[] = [];
const listeners = new Set<() => void>();

const sha256 = (s: string): string =>
  createHash('sha256').update(s).digest('hex');

const rememberWrite = (contents: string) => {
  writtenHashes.push(sha256(contents));
  if (writtenHashes.length > OWN_WRITE_RING_SIZE) writtenHashes.shift();
};

const loadFromDisk = () => {
  entries.clear();
  if (!existsSync(path)) return;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(parsed)) return;
    for (const e of parsed) {
      if (
        e &&
        typeof e.id === 'string' &&
        typeof e.slug === 'string' &&
        typeof e.repoPath === 'string' &&
        typeof e.flowPath === 'string'
      ) {
        const entry = e as FlowEntry;
        if (entry.description !== undefined && typeof entry.description !== 'string') {
          entry.description = undefined;
        }
        entries.set(entry.id, entry);
      }
    }
  } catch (err) {
    console.error(`[registry] failed to load ${path}:`, err);
  }
};
```

Refactor the initial file load to call `loadFromDisk()` instead of inlining the parse logic.

Change `persist`:

```ts
const persist = () => {
  mkdirSync(dirname(path), { recursive: true });
  const contents = JSON.stringify([...entries.values()], null, 2);
  rememberWrite(contents);
  writeFileAtomic(path, contents);
};
```

Add these to the returned object:

```ts
return {
  // ... existing methods ...
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  reload() {
    loadFromDisk();
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        console.error('[registry] onChange listener threw:', err);
      }
    }
  },
  isOwnWrite(contents) {
    return writtenHashes.includes(sha256(contents));
  },
};
```

**Step 4: Run tests**

```bash
bun run typecheck
bun test apps/studio/src/registry.test.ts
```

Expected: green.

**Step 5: Commit**

```bash
git add apps/studio/src/registry.ts apps/studio/src/registry.test.ts
git commit -m "feat(registry): onChange + isOwnWrite + reload"
```

---

## Phase 3 — Registry Watcher + SPA Consumer

External writes to `~/.seeflow/registry.json` (from a CLI process) must be detected by the running studio and broadcast to the browser so the flow list updates live.

### Task 3.1 — Extend EventBus types for `registry:reload`

**Files:**
- Modify: `apps/studio/src/events.ts:7-14`

**Step 1: Append `'registry:reload'` to the type union**

```ts
export type StudioEventType =
  | 'flow:reload'
  | 'demo:reset'
  | 'node:running'
  | 'node:done'
  | 'node:error'
  | 'node:status'
  | 'file:changed'
  | 'registry:reload';
```

**Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: clean.

**Step 3: Commit**

```bash
git add apps/studio/src/events.ts
git commit -m "feat(events): add registry:reload event type"
```

---

### Task 3.2 — Create `registry-watcher.ts` (mirror of `watcher.ts`)

**Files:**
- Create: `apps/studio/src/registry-watcher.ts`
- Test: `apps/studio/src/registry-watcher.test.ts`

**Reference:** `apps/studio/src/watcher.ts:1-528` — same patterns (fs.watch with debounce, own-write echo suppression). Smaller because we only watch one file globally, not per-flow.

**Step 1: Write the failing tests**

Create `apps/studio/src/registry-watcher.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventBus } from './events.ts';
import { createRegistry } from './registry.ts';
import { createRegistryWatcher } from './registry-watcher.ts';

// Channel name used by registry events. Exported for SPA consumption parity.
const REGISTRY_CHANNEL = '__registry__';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('createRegistryWatcher', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reg-watcher-'));
    path = join(dir, 'registry.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('broadcasts registry:reload when an external write modifies the file', async () => {
    const registry = createRegistry({ path });
    const events = createEventBus();
    const watcher = createRegistryWatcher({ registry, events, debounceMs: 25 });
    watcher.start();

    let observed = 0;
    const unsub = events.subscribe(REGISTRY_CHANNEL, (e) => {
      if (e.type === 'registry:reload') observed += 1;
    });

    // External CLI writes the file directly.
    writeFileSync(
      path,
      JSON.stringify(
        [
          {
            id: 'a',
            slug: 'a',
            name: 'a',
            repoPath: '/tmp/a',
            flowPath: '.seeflow/flow.json',
            lastModified: 0,
            valid: true,
          },
        ],
        null,
        2,
      ),
    );

    await wait(120);
    expect(observed).toBeGreaterThanOrEqual(1);
    expect(registry.list().length).toBe(1);

    unsub();
    watcher.close();
  });

  it('suppresses the echo of an in-process upsert', async () => {
    const registry = createRegistry({ path });
    const events = createEventBus();
    const watcher = createRegistryWatcher({ registry, events, debounceMs: 25 });
    watcher.start();

    let observed = 0;
    const unsub = events.subscribe(REGISTRY_CHANNEL, () => {
      observed += 1;
    });

    // In-process write — the registry persists, the fs watcher fires, but the
    // hash matches and the echo is dropped.
    registry.upsert({
      name: 'b',
      repoPath: '/tmp/b',
      flowPath: '.seeflow/flow.json',
    });

    await wait(120);
    expect(observed).toBe(0);

    unsub();
    watcher.close();
  });

  it('handles the file not existing at start time', async () => {
    // Registry file deliberately missing.
    expect(existsSync(path)).toBe(false);
    const registry = createRegistry({ path });
    const events = createEventBus();
    const watcher = createRegistryWatcher({ registry, events, debounceMs: 25 });
    watcher.start(); // must not throw

    let observed = 0;
    events.subscribe(REGISTRY_CHANNEL, () => {
      observed += 1;
    });

    writeFileSync(
      path,
      JSON.stringify(
        [
          {
            id: 'a',
            slug: 'a',
            name: 'a',
            repoPath: '/tmp/a',
            flowPath: '.seeflow/flow.json',
            lastModified: 0,
            valid: true,
          },
        ],
        null,
        2,
      ),
    );

    await wait(150);
    expect(observed).toBeGreaterThanOrEqual(1);

    watcher.close();
  });
});
```

**Step 2: Run to confirm fail**

```bash
bun test apps/studio/src/registry-watcher.test.ts
```

Expected: FAIL — `createRegistryWatcher` does not exist.

**Step 3: Implement `registry-watcher.ts`**

Create `apps/studio/src/registry-watcher.ts`:

```ts
import { type FSWatcher, existsSync, readFileSync, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { EventBus } from './events.ts';
import type { Registry } from './registry.ts';

const DEFAULT_DEBOUNCE_MS = 100;

/**
 * Internal sentinel flowId used to broadcast registry-scoped events on the
 * (flowId-keyed) EventBus. Subscribers listen for this exact key.
 */
export const REGISTRY_CHANNEL = '__registry__';

export interface RegistryWatcherDeps {
  registry: Registry;
  events: EventBus;
  /** Override for tests. */
  debounceMs?: number;
}

export interface RegistryWatcher {
  start(): void;
  close(): void;
}

export function createRegistryWatcher(deps: RegistryWatcherDeps): RegistryWatcher {
  const { registry, events } = deps;
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let fsWatcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let started = false;

  // The registry file path is private to registry.ts. We piggyback on the
  // standard ~/.seeflow/registry.json location by re-importing the default
  // path helper. Tests inject the path via a fresh registry sharing the same
  // disk location, so observing fs events on that directory is sufficient.
  // We watch the directory (not the file) so the watcher survives an atomic
  // rename that swaps the file out from under us.
  const { defaultRegistryPath } = require('./registry.ts') as typeof import('./registry.ts');
  const filePath =
    (registry as { path?: string }).path ?? defaultRegistryPath();
  const dir = dirname(filePath);
  const base = basename(filePath);

  const onChange = () => {
    if (!existsSync(filePath)) return;
    let contents: string;
    try {
      contents = readFileSync(filePath, 'utf8');
    } catch {
      return;
    }
    if (registry.isOwnWrite(contents)) return;
    registry.reload();
    events.broadcast({
      type: 'registry:reload',
      flowId: REGISTRY_CHANNEL,
      payload: {},
    });
  };

  return {
    start() {
      if (started) return;
      started = true;
      if (!existsSync(dir)) {
        // First write will create the dir; defer setup until then. We poll
        // once a debounce window later — cheap and runs at most a handful of
        // times before the studio gives up. For now, hook into the first
        // event by watching the parent if it exists.
        // Simplest pragmatic path: try-watch and let fs.watch error
        // surface in dev.
      }
      try {
        fsWatcher = watch(dir, { persistent: true }, (_event, changed) => {
          if (changed && changed !== base) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            onChange();
          }, debounceMs);
        });
      } catch (err) {
        console.error(`[registry-watcher] failed to watch ${dir}:`, err);
      }
    },
    close() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = null;
      if (fsWatcher) fsWatcher.close();
      fsWatcher = null;
      started = false;
    },
  };
}
```

**Critical note for the engineer:** The line `const { defaultRegistryPath } = require('./registry.ts') …` uses CommonJS-style require because we want to avoid a circular import at module-eval time. If your Bun build chokes on `require` in TS, replace with a top-of-file `import { defaultRegistryPath } from './registry.ts';` — there's no actual cycle at runtime (registry.ts doesn't import registry-watcher.ts). The require-form was just defensive; prefer the cleaner import.

Also: `Registry` doesn't currently expose its `path`. To support tests that inject a custom path, expose it. Add to the `Registry` interface in `registry.ts`:

```ts
export interface Registry {
  // ... existing methods ...
  /** Resolved path of the registry file on disk. */
  readonly path: string;
}
```

And in `createRegistry`, before the return: assign and include in the returned object literal:

```ts
return {
  path,
  // ... existing methods ...
};
```

**Step 4: Run tests**

```bash
bun run typecheck
bun test apps/studio/src/registry-watcher.test.ts
```

Expected: green. If timing-flaky, bump the `wait(120)` calls to `wait(200)`.

**Step 5: Commit**

```bash
git add apps/studio/src/registry-watcher.ts apps/studio/src/registry-watcher.test.ts apps/studio/src/registry.ts
git commit -m "feat(registry-watcher): broadcast registry:reload on external writes"
```

---

### Task 3.3 — Wire the registry watcher into `server.ts`

**Files:**
- Modify: `apps/studio/src/server.ts` (around the existing watcher setup, ~line 72-100)

**Step 1: Find the existing watcher wiring**

```bash
grep -n "createWatcher\|watchAll\|FlowWatcher" /Users/tuongaz/dev/seeflow/apps/studio/src/server.ts
```

Expected: a block that constructs the flow watcher and starts it.

**Step 2: Add registry watcher beside it**

Adjacent to the existing flow watcher:

```ts
import { createRegistryWatcher } from './registry-watcher.ts';

// ... inside serve() / server setup, after `const watcher = createWatcher(...)`
const registryWatcher = createRegistryWatcher({ registry, events });
registryWatcher.start();
```

And on shutdown, alongside `watcher.closeAll()`:

```ts
registryWatcher.close();
```

**Step 3: Add an SSE endpoint for the global registry channel**

In `api.ts`, alongside the existing `/events` route, add `/registry/events`:

```ts
api.get('/registry/events', (c) => {
  if (!events) return c.json({ error: 'events not enabled' }, 500);

  return streamSSE(c, async (stream) => {
    let active = true;
    const queue: Array<{ event: string; data: string }> = [];
    let resume: (() => void) | null = null;

    const wake = () => {
      if (resume) {
        const r = resume;
        resume = null;
        r();
      }
    };

    const unsubscribe = events.subscribe('__registry__', (e) => {
      queue.push({ event: e.type, data: JSON.stringify({ ts: e.ts }) });
      wake();
    });

    stream.onAbort(() => {
      active = false;
      unsubscribe();
      wake();
    });

    await stream.writeSSE({
      event: 'hello',
      data: JSON.stringify({ channel: 'registry', ts: Date.now() }),
    });

    try {
      while (active) {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) break;
          await stream.writeSSE(next);
        }
        if (!active) break;
        await new Promise<void>((r) => {
          resume = r;
        });
      }
    } finally {
      unsubscribe();
    }
  });
});
```

**Step 4: Add an API integration test**

Append to `apps/studio/src/api.test.ts` a test that POSTs `/flows/register`, then within ~200ms an SSE subscriber on `/api/registry/events` receives a `registry:reload`. Pattern after the existing SSE tests if any; otherwise stub the EventBus and assert `events.broadcast` was called with the registry channel.

**Step 5: Run tests**

```bash
bun run typecheck
bun test apps/studio/src/api.test.ts
```

**Step 6: Commit**

```bash
git add apps/studio/src/server.ts apps/studio/src/api.ts apps/studio/src/api.test.ts
git commit -m "feat(server): wire registry watcher + SSE channel"
```

---

### Task 3.4 — SPA subscribes to `registry:reload`

**Files:**
- Modify: `apps/web/src/hooks/use-studio-events.ts:5` (event-type union)
- Modify: `apps/web/src/App.tsx` or wherever the flow-list query lives — add a new hook `use-registry-events.ts` next to `use-studio-events.ts`.

**Step 1: Find the flow-list query**

```bash
grep -rn "/api/flows\b\|flows:list\b" /Users/tuongaz/dev/seeflow/apps/web/src --include="*.ts" --include="*.tsx"
```

Identify the consumer (likely `App.tsx` or a sibling hook in `apps/web/src/hooks/`).

**Step 2: Create `use-registry-events.ts`**

Mirror `use-studio-events.ts` but hit `/api/registry/events` (no `flowId` query param) and only listen for the `registry:reload` event. Surface an `onRegistryReload` callback prop.

**Step 3: Plug it into the flow-list owner**

Wherever the flow list is fetched (likely `App.tsx`), mount `useRegistryEvents({ onRegistryReload: () => refetchFlows() })`.

**Step 4: Smoke test in the browser**

```bash
bun run dev
```

In one terminal: open `http://localhost:5173` in a browser. In a second terminal: `bun apps/studio/src/cli.ts register --path /tmp/some-test-repo --flow .seeflow/flow.json` (assuming a test fixture). The flow list in the browser should update without manual refresh.

**Step 5: Commit**

```bash
git add apps/web/src/hooks/use-registry-events.ts apps/web/src/App.tsx
git commit -m "feat(web): subscribe to registry:reload SSE"
```

---

## Phase 4 — CLI: Migrate Read Commands

These are the lowest-risk changes — pure reads, no disk writes. Once they're in-process, `flows:list`, `flows:get`, etc. stop auto-spawning the studio.

### Task 4.1 — Add a CLI `ops` factory helper + noop EventBus

**Files:**
- Create: `apps/studio/src/cli-ops.ts`

**Step 1: Write the helper**

```ts
import { createEventBus } from './events.ts';
import { createOperations, type Operations } from './operations.ts';
import { createRegistry } from './registry.ts';

/**
 * Build a single Operations handle for in-process CLI use.
 *
 * The CLI has no watcher (no SSE clients to notify locally — the running
 * studio's flow watcher picks up our disk writes externally) and no
 * statusRunner (play/reset are server-only features that still go via HTTP).
 *
 * The EventBus is a real-but-orphan instance: operations.ts calls
 * `events.broadcast(...)` after mutations, but no one is subscribed inside
 * the CLI process so those events are dropped. Harmless.
 */
export function createCliOperations(): Operations {
  return createOperations({
    registry: createRegistry(),
    events: createEventBus(),
  });
}
```

Note: `OperationsDeps` includes `events?: EventBus` (see `operations.ts` and `mcp.ts` — confirm by reading `OperationsDeps` definition in operations.ts; the type may or may not currently include `events`). If `events` is NOT in `OperationsDeps`, drop the `createEventBus()` line. The handle methods that call `events.broadcast` will then guard on `events &&`.

**Step 2: Confirm OperationsDeps shape**

```bash
grep -n "OperationsDeps" /Users/tuongaz/dev/seeflow/apps/studio/src/operations.ts | head
```

Adjust the helper to match the real shape — pass only the deps the `*Impl` functions actually consume.

**Step 3: Commit**

```bash
git add apps/studio/src/cli-ops.ts
git commit -m "feat(cli): add createCliOperations helper"
```

---

### Task 4.2 — Migrate `flows:list`, `flows:summary`, `flows:get`, `flows:graph`, `nodes:get` to in-process

**Files:**
- Modify: `apps/studio/src/cli.ts:595-681` (the five read handlers)

**Step 1: Run existing CLI tests**

```bash
bun test apps/studio/src/cli.test.ts
```

Expected: green baseline.

**Step 2: Add an outcome-printer helper to `cli-helpers.ts`**

Open `apps/studio/src/cli-helpers.ts` (or create a new helper file alongside it) and add:

```ts
/**
 * Print an Operations Outcome and exit with the right code.
 *  - kind: 'ok' → printOk(data), exit 0
 *  - kind: anything else → stderr {error, code}, exit code mapped by `kind`
 */
export function printOutcome<T extends { kind: string }>(outcome: T): never {
  if (outcome.kind === 'ok') {
    printOk((outcome as unknown as { data: unknown }).data);
    process.exit(0);
  }
  const message = describeOutcome(outcome);
  const exitCode = outcomeExitCode(outcome.kind);
  process.stderr.write(`${JSON.stringify({ error: message, code: outcome.kind })}\n`);
  process.exit(exitCode);
}

function describeOutcome(outcome: { kind: string } & Record<string, unknown>): string {
  // Mirror the strings used by api.ts so CLI output stays stable.
  switch (outcome.kind) {
    case 'notFound':
    case 'flowNotFound':
      return 'not found';
    case 'fileNotFound':
      return `Flow file not found: ${String(outcome.path ?? '')}`;
    case 'unknownNode':
      return `Unknown nodeId: ${String(outcome.nodeId ?? '')}`;
    case 'unknownConnector':
      return `Unknown connectorId: ${String(outcome.connectorId ?? '')}`;
    case 'badJson':
      return `Flow file is not valid JSON: ${String(outcome.detail ?? outcome.message ?? '')}`;
    case 'badSchema':
      return `Flow failed schema validation: ${JSON.stringify(outcome.issues ?? [])}`;
    case 'duplicateIdInBatch':
      return `Duplicate id in batch: ${String(outcome.id ?? '')}`;
    case 'idAlreadyExists':
      return `Id already exists: ${String(outcome.id ?? '')}`;
    case 'writeFailed':
      return `Failed to write demo file: ${String(outcome.message ?? '')}`;
    case 'sdkWriteFailed':
      return `Failed to write SDK helper: ${String(outcome.message ?? '')}`;
    case 'scaffoldFailed':
      return `Failed to scaffold project: ${String(outcome.message ?? '')}`;
    default:
      return String(outcome.message ?? outcome.kind);
  }
}

function outcomeExitCode(kind: string): number {
  if (kind === 'badSchema' || kind === 'badJson') return 2;
  if (kind === 'notFound' || kind === 'flowNotFound' || kind === 'fileNotFound') return 3;
  if (kind === 'unknownNode' || kind === 'unknownConnector') return 3;
  if (kind === 'duplicateIdInBatch' || kind === 'idAlreadyExists') return 4;
  if (kind === 'writeFailed' || kind === 'sdkWriteFailed' || kind === 'scaffoldFailed') return 5;
  return 1;
}
```

**Step 3: Migrate `runFlowsList`**

Replace its body (`apps/studio/src/cli.ts:595-600`) with:

```ts
async function runFlowsList() {
  const ops = createCliOperations();
  const result = ops.listFlows();
  printOk({ flows: result.data });
}
```

Add at top: `import { createCliOperations } from './cli-ops.ts';`

**Step 4: Migrate the other four readers**

Apply the same pattern to `runFlowsSummary`, `runFlowsGet`, `runFlowsGraph`, `runNodesGet`. For ops returning `Outcome` (`ok` / `notFound` / etc), use `printOutcome(result)` instead of `printOk` so error cases map to the right exit code.

Example for `runFlowsGet`:

```ts
async function runFlowsGet() {
  const flowId = requireArg(1, '<flowId>');
  const ops = createCliOperations();
  const result = await ops.getFlow(flowId);
  printOutcome(result);
}
```

**Step 5: Update CLI tests**

In `apps/studio/src/cli.test.ts`, the tests for these five commands should no longer expect HTTP calls. Update them to call the migrated handlers and assert in-process behaviour (use a temp registry path via env var or test seam).

If the CLI test harness today shells out to the built binary, you may need to add an in-process invocation path. Pattern after the existing tests for `runStart` or `runStop` which exercise local code.

**Step 6: Run tests**

```bash
bun run typecheck
bun test apps/studio/src/cli.test.ts
```

Expected: green.

**Step 7: Commit**

```bash
git add apps/studio/src/cli.ts apps/studio/src/cli-helpers.ts apps/studio/src/cli.test.ts
git commit -m "feat(cli): in-process read commands"
```

---

### Task 4.3 — Remove `studioUrlOrDie` from read paths

Already done implicitly in 4.2 (handlers no longer call it). This task verifies nothing slipped through.

**Step 1: Search for residual calls**

```bash
grep -n "studioUrlOrDie" /Users/tuongaz/dev/seeflow/apps/studio/src/cli.ts
```

Expected: now only present in `runFlowsLayout`, `runFlowsPlay`, `runNodesAdd*`, `runNodesPatch`, `runNodesMove`, `runNodesReorder`, `runNodesDelete`, `runConnectors*`, `runValidate`, `runE2e`. (Layout + mutations + validate + play + e2e — all of which Phases 5-7 will migrate or keep on HTTP.)

**Step 2: Manual smoke test**

With no studio running:

```bash
bun apps/studio/src/cli.ts flows:list
```

Expected: outputs `{"flows":[]}` (or seeded examples), exits 0, no daemon spawned. Confirm by checking `~/.seeflow/seeflow.pid` doesn't appear afterwards.

**Step 3: No commit needed** — this is a verification task.

---

## Phase 5 — CLI: Migrate Flow/Style Mutation Commands

Bigger surface, but each migration is mechanical and isolated. The studio's existing flow watcher (`watcher.ts`) detects external disk writes and broadcasts `flow:reload`, so a browser-connected user sees the change live.

### Task 5.1 — Migrate `nodes:add`

**Files:**
- Modify: `apps/studio/src/cli.ts:654-661` (`runNodesAdd`)
- Test: `apps/studio/src/cli.test.ts` (existing test for `runNodesAdd` if any; add one if not)

**Step 1: Write the failing test (or update an existing one)**

```ts
it('nodes:add writes to disk via createOperations', async () => {
  const fixture = await makeTempFlowFixture(); // helper that creates a tmp flow.json + registers it
  const ops = createCliOperations();
  // Drive the CLI as if argv were `nodes:add <flowId> --json '{"type":"stateNode","data":{}}'`
  // Either invoke the exported handler or shell into the binary with a path env override.
  // …assert ops.getFlow returns a flow with the new node…
});
```

If `cli.test.ts` doesn't already have a temp-fixture helper, add one.

**Step 2: Run to confirm fail**

```bash
bun test apps/studio/src/cli.test.ts -t "nodes:add writes to disk"
```

**Step 3: Migrate the handler**

```ts
async function runNodesAdd() {
  const flowId = requireArg(1, '<flowId>');
  const body = await bodyFromFlags();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    printError('Body must be an object');
  }
  const ops = createCliOperations();
  const result = await ops.addNode(flowId, body as Record<string, unknown>);
  printOutcome(result);
}
```

**Step 4: Tests + typecheck**

```bash
bun run typecheck
bun test apps/studio/src/cli.test.ts -t "nodes:add"
```

**Step 5: Commit**

```bash
git add apps/studio/src/cli.ts apps/studio/src/cli.test.ts
git commit -m "feat(cli): in-process nodes:add"
```

---

### Task 5.2 — Migrate the remaining `nodes:*` commands

Apply the same pattern to: `runNodesAddBulk`, `runNodesPatch`, `runNodesMove`, `runNodesReorder`, `runNodesDelete`.

Each one becomes:
1. Parse args/body.
2. Construct `const ops = createCliOperations();`.
3. Call `await ops.<method>(...)`.
4. `printOutcome(result)`.

**Per-command notes:**
- `runNodesMove`: body is `{ x, y }`, build it before calling `ops.moveNode(flowId, nodeId, { x, y })`.
- `runNodesReorder`: body is `{ op, index? }` — same as today.
- `runNodesAddBulk`: body must be `{ nodes: [...] }` matching `NodesBulkBodySchema`. The handle's `addNodesBulk` expects the same shape.

**Step 1-4 per command:** test, fail, implement, pass.

**Step 5: One commit per command (or one batched commit):**

```bash
git add apps/studio/src/cli.ts apps/studio/src/cli.test.ts
git commit -m "feat(cli): in-process nodes:* commands"
```

---

### Task 5.3 — Migrate `connectors:*` commands

Mirror Task 5.2 for: `runConnectorsAdd`, `runConnectorsAddBulk`, `runConnectorsPatch`, `runConnectorsDelete`.

**Commit:**

```bash
git commit -m "feat(cli): in-process connectors:* commands"
```

---

### Task 5.4 — Migrate `flows:layout`

**Special handling:** `/api/flows/:id/layout` does more than the existing `*Impl` functions cover — it computes ELK layout and writes `style.json` atomically. We need an `applyLayoutImpl` in `operations.ts`.

**Files:**
- Modify: `apps/studio/src/operations.ts` (new export `applyLayoutImpl` extracted from `api.ts:750-832`)
- Modify: `apps/studio/src/operations.ts` (new `applyLayout` method on the `Operations` handle in Task 1.1's interface)
- Modify: `apps/studio/src/api.ts:750-832` — replace the inline implementation with `await ops.applyLayout(id, options?)`
- Modify: `apps/studio/src/cli.ts:633-640` (`runFlowsLayout`)
- Test: `apps/studio/src/operations.test.ts` (new test for `applyLayoutImpl`)

**Step 1: Write the failing test in operations.test.ts**

```ts
describe('applyLayoutImpl', () => {
  it('writes style.json next to flow.json and returns ok on success', async () => {
    const { registry, flowId, repoDir } = await seedTempFlow(/* ... */);
    const ops = createOperations({ registry });
    const result = await ops.applyLayout(flowId, undefined);
    expect(result.kind).toBe('ok');
    expect(existsSync(join(repoDir, '.seeflow', 'style.json'))).toBe(true);
  });

  it('returns badSchema when flow.json is invalid', async () => {
    const { registry, flowId } = await seedTempFlow({ malformed: true });
    const ops = createOperations({ registry });
    const result = await ops.applyLayout(flowId, undefined);
    expect(result.kind).toBe('badSchema');
  });
});
```

**Step 2: Run to confirm fail**

```bash
bun test apps/studio/src/operations.test.ts -t "applyLayoutImpl"
```

**Step 3: Extract `applyLayoutImpl`**

Copy the body of the `/flows/:id/layout` handler in `api.ts:750-832` into a new exported function in `operations.ts`:

```ts
export interface ApplyLayoutOk { kind: 'ok'; data: { result: unknown } }
export interface ApplyLayoutFlowNotFound { kind: 'flowNotFound' }
export interface ApplyLayoutFileNotFound { kind: 'fileNotFound'; path: string }
export interface ApplyLayoutBadJson { kind: 'badJson'; detail: string }
export interface ApplyLayoutBadSchema { kind: 'badSchema'; issues: unknown[] }
export interface ApplyLayoutWriteFailed { kind: 'writeFailed'; message: string }
export type ApplyLayoutOutcome =
  | ApplyLayoutOk
  | ApplyLayoutFlowNotFound
  | ApplyLayoutFileNotFound
  | ApplyLayoutBadJson
  | ApplyLayoutBadSchema
  | ApplyLayoutWriteFailed;

export async function applyLayoutImpl(
  deps: OperationsDeps,
  flowId: string,
  options: LayoutOptions | undefined,
): Promise<ApplyLayoutOutcome> {
  // Move api.ts:751-831 verbatim, returning the outcome union instead of c.json(...).
}
```

Update the `Operations` interface (Task 1.1) and `createOperations` to expose `applyLayout`.

In `api.ts`, replace the route body with:

```ts
api.post('/flows/:id/layout', async (c) => {
  const id = c.req.param('id');
  let options: LayoutOptions | undefined;
  const text = await c.req.text();
  if (text.length > 0) {
    try {
      options = (JSON.parse(text) as { options?: LayoutOptions })?.options;
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
  }
  const result = await ops.applyLayout(id, options);
  switch (result.kind) {
    case 'ok':
      return c.json({ ok: true });
    case 'flowNotFound':
      return c.json({ error: 'unknown demo' }, 404);
    case 'fileNotFound':
      return c.json({ error: `Flow file not found: ${result.path}` }, 404);
    case 'badJson':
      return c.json({ error: 'Flow file is not valid JSON', detail: result.detail }, 400);
    case 'badSchema':
      return c.json({ ok: false as const, issues: result.issues });
    case 'writeFailed':
      return c.json({ error: `Failed to write style file: ${result.message}` }, 500);
  }
});
```

Migrate `runFlowsLayout`:

```ts
async function runFlowsLayout() {
  const flowId = requireArg(1, '<flowId>');
  const body = (await bodyFromFlags()) as { options?: unknown } | undefined;
  const options = body?.options as LayoutOptions | undefined;
  const ops = createCliOperations();
  const result = await ops.applyLayout(flowId, options);
  printOutcome(result);
}
```

Import `LayoutOptions` from `./layout.ts` if not already in scope.

**Step 4: Run tests**

```bash
bun run typecheck
bun test apps/studio/src/operations.test.ts apps/studio/src/api.test.ts apps/studio/src/cli.test.ts
```

**Step 5: Commit**

```bash
git add apps/studio/src/operations.ts apps/studio/src/api.ts apps/studio/src/cli.ts
git commit -m "feat(cli): in-process flows:layout"
```

---

### Task 5.5 — Integration test: CLI mutation + studio observes `flow:reload`

**Files:**
- Modify: `apps/studio/integration/cli.it.ts` (or create a new `.it.ts` if appropriate)

**Step 1: Add a test that:**
1. Starts the studio (in-process via `serve(...)`).
2. Registers a flow.
3. Subscribes a test consumer to the studio's EventBus for `flow:reload`.
4. Invokes the CLI's `nodes:add` handler with a body that adds a node.
5. Asserts the consumer sees a `flow:reload` event within ~300ms (debounce window + slack).

```ts
it('CLI mutation triggers flow:reload from the studio watcher', async () => {
  const { registry, events, watcher, server } = await startStudioWithTempHome();
  const { flowId, repoDir } = await registerFixture(registry, watcher);

  const reloads: number[] = [];
  events.subscribe(flowId, (e) => {
    if (e.type === 'flow:reload') reloads.push(Date.now());
  });

  // Invoke the CLI's handler in-process (same registry path via env).
  await invokeCli([
    'nodes:add',
    flowId,
    '--json',
    JSON.stringify({ type: 'stateNode', data: { name: 'observed' } }),
  ]);

  await waitFor(() => reloads.length > 0, { timeout: 1_000 });
  expect(reloads.length).toBeGreaterThanOrEqual(1);

  await server.stop();
});
```

`startStudioWithTempHome`, `registerFixture`, `invokeCli`, `waitFor` are helpers — if not already present in the integration test harness, define them in a colocated `apps/studio/integration/helpers.ts`.

**Step 2: Run**

```bash
bun test apps/studio/integration/cli.it.ts
```

**Step 3: Commit**

```bash
git add apps/studio/integration/cli.it.ts apps/studio/integration/helpers.ts
git commit -m "test(integration): CLI mutation triggers flow:reload"
```

---

## Phase 6 — CLI: Migrate Registry-Mutating Commands + `validate`

### Task 6.1 — Migrate `register` / `flows:register`

**Files:**
- Modify: `apps/studio/src/cli.ts:467-536` (`runRegister`)

**Step 1: Write the failing test**

```ts
it('register writes to the registry in-process without auto-spawning the studio', async () => {
  const fixture = await makeFlowOnDisk(/* tmp repo with .seeflow/flow.json */);
  await invokeCli(['register', '--path', fixture.repoPath]);

  const reg = createRegistry({ path: tempRegistryPath });
  expect(reg.list()).toHaveLength(1);
  expect(reg.list()[0].repoPath).toBe(fixture.repoPath);
  // No daemon pid file should exist.
  expect(existsSync(defaultPidPath())).toBe(false);
});
```

**Step 2: Run to confirm fail**

**Step 3: Migrate**

```ts
async function runRegister() {
  const repoPath = resolve(flagValue('path') ?? '.');
  const demoPathArg = flagValue('flow') ?? DEFAULT_FLOW_PATH;
  const fullPath = isAbsolute(demoPathArg) ? demoPathArg : join(repoPath, demoPathArg);
  if (!existsSync(fullPath)) {
    console.error(`No demo file at ${fullPath}`);
    console.error(`Create ${DEFAULT_FLOW_PATH} in your repo, or pass --flow <path>.`);
    process.exit(1);
  }

  let demo: unknown;
  try {
    demo = await Bun.file(fullPath).json();
  } catch (err) {
    console.error(`Failed to parse ${fullPath}: ${String(err)}`);
    process.exit(1);
  }

  const parsed = FlowSchema.safeParse(demo);
  if (!parsed.success) {
    console.error(`${fullPath} failed schema validation:`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.') || '<root>'}: ${issue.message}`);
    }
    process.exit(1);
  }

  const ops = createCliOperations();
  const result = await ops.registerFlow({
    name: parsed.data.name,
    description: parsed.data.description,
    repoPath,
    flowPath: demoPathArg,
  });

  if (result.kind !== 'ok') {
    printOutcome(result);
  }

  const body = result.data;
  console.log(`Registered "${parsed.data.name}" → ${body.slug}`);
  if (body.sdk?.outcome === 'written') {
    console.log(`Wrote ${body.sdk.filePath} (event-bound state node detected)`);
  } else if (body.sdk?.outcome === 'present') {
    console.log(`SDK helper already present at ${body.sdk.filePath} (skipped)`);
  }
}
```

Note the user-facing text loses the previous `→ ${url}/d/${body.slug}` because no URL is known when the studio isn't running. Replace with just the slug. If the studio's URL needs to appear when it IS running, branch on `readPid()`:

```ts
const pid = readPid();
if (pid && isPidAlive(pid)) {
  const config = readConfig();
  console.log(`Registered "${parsed.data.name}" → ${studioUrl(config)}/d/${body.slug}`);
} else {
  console.log(`Registered "${parsed.data.name}" (slug: ${body.slug})`);
}
```

**Step 4: Run tests**

**Step 5: Commit**

```bash
git add apps/studio/src/cli.ts apps/studio/src/cli.test.ts
git commit -m "feat(cli): in-process register"
```

---

### Task 6.2 — Migrate `projects:create`

**Files:**
- Modify: `apps/studio/src/cli.ts:586-593` (`runProjectsCreate`)

```ts
async function runProjectsCreate() {
  const name = flagValue('name');
  if (!name) printError('Missing required flag: --name');
  const ops = createCliOperations();
  const result = await ops.createProject({ name: name as string });
  printOutcome(result);
}
```

If `createProjectImpl` requires more body fields than `name`, parse them out of flags first.

**Test + commit:**

```bash
bun test apps/studio/src/cli.test.ts -t "projects:create"
git add apps/studio/src/cli.ts apps/studio/src/cli.test.ts
git commit -m "feat(cli): in-process projects:create"
```

---

### Task 6.3 — Migrate `flows:delete`

```ts
async function runFlowsDelete() {
  const flowId = requireArg(1, '<flowId>');
  const ops = createCliOperations();
  const result = ops.deleteFlow(flowId);
  printOutcome(result);
}
```

**Test + commit.**

---

### Task 6.4 — Migrate `validate` to fully local

**Files:**
- Modify: `apps/studio/src/cli.ts:798-825` (`runValidate`)

Today `runValidate` reads the file locally, then POSTs to `/api/validate`. The handle's `validate` method calls `validateImpl` directly with no IO of its own.

```ts
async function runValidate() {
  const file = flagValue('file');
  const styleFile = flagValue('style');
  if (!file) printError('Missing required flag: --file <flow.json>');
  let flow: unknown;
  try {
    flow = JSON.parse(readFileSync(file as string, 'utf8'));
  } catch (err) {
    printError(`Failed to read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let style: unknown;
  if (styleFile) {
    try {
      style = JSON.parse(readFileSync(styleFile, 'utf8'));
    } catch (err) {
      printError(`Failed to read ${styleFile}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const ops = createCliOperations();
  const body = ops.validate({ flow, style });
  if (body.ok === false) {
    printError(`Schema validation failed: ${JSON.stringify(body.issues ?? [])}`);
  }
  printOk(body);
}
```

**Test + commit.**

---

### Task 6.5 — Integration test: CLI register + studio observes `registry:reload`

Mirror Task 5.5 but with `registry:reload` on the `__registry__` channel. Confirms the registry watcher is functioning end-to-end.

**Commit:**

```bash
git commit -m "test(integration): CLI register triggers registry:reload"
```

---

## Phase 7 — Cleanup & Verification

### Task 7.1 — Delete unused HTTP helpers in `cli.ts`

**Files:**
- Modify: `apps/studio/src/cli.ts:67-103`

**Step 1: Audit usage**

```bash
grep -n "postJson\|patchJson\|deleteRequest\|handleResponse\|studioUrlOrDie\|bodyFromFlags" /Users/tuongaz/dev/seeflow/apps/studio/src/cli.ts
```

`runFlowsPlay`, `runE2e` still need `studioUrlOrDie`. `bodyFromFlags` is still used by mutation commands (the body parsing itself, not the HTTP call) — keep it.

If `postJson` / `patchJson` / `deleteRequest` / `handleResponse` have no remaining callers, delete their definitions.

**Step 2: Typecheck + test**

```bash
bun run typecheck
bun test apps/studio/src/cli.test.ts
```

**Step 3: Commit**

```bash
git add apps/studio/src/cli.ts
git commit -m "chore(cli): remove unused HTTP helpers"
```

---

### Task 7.2 — Update help text

**Files:**
- Modify: `apps/studio/src/cli.ts:173-240` (`printHelp`)

Update wording where the CLI's behaviour has materially changed:
- The help text currently implies the studio must be running for most commands. Adjust the "Global options" section to clarify that only `play` / `e2e` require a running studio.
- Mention that `--no-start` now applies only to `play` / `e2e`.

**Commit:**

```bash
git commit -m "docs(cli): update help text for in-process commands"
```

---

### Task 7.3 — Enhanced `help` for AI agents

Make the CLI self-describing so agents (the seeflow plugin, MCP clients, future automation) can discover every command, its arguments, flags, body shape, and example without scraping prose. The current `printHelp` stays as the default human-readable view.

**Files:**
- Create: `apps/studio/src/cli-manifest.ts` (the single source of command metadata)
- Modify: `apps/studio/src/cli.ts:113-115` (route `help` / `--help` / `-h` to a richer handler)
- Modify: `apps/studio/src/cli.ts:173-240` (`printHelp` now consumes the manifest)
- Test: `apps/studio/src/cli-manifest.test.ts`

**Design:**
- `seeflow help` → current human-readable list (unchanged for humans).
- `seeflow help <command>` → detailed page for one command: synopsis, every flag, body shape (Zod schema rendered to JSON Schema or pretty text), an example invocation, expected stdout shape, error kinds + exit codes, and whether the studio must be running.
- `seeflow help --json` → the whole manifest as JSON, agent-consumable. One stable shape; downstream tools parse it programmatically.
- `seeflow help <command> --json` → manifest entry for one command.

**Manifest entry shape (`CommandManifest`):**

```ts
export interface CommandFlag {
  name: string;           // without leading --
  valuePlaceholder?: string; // e.g. "<n>", "<path>", "<JSON>"
  description: string;
  required?: boolean;
}

export interface CommandArg {
  name: string;           // e.g. "flowId"
  required: boolean;
  description: string;
}

export interface CommandManifestEntry {
  name: string;                   // "nodes:add"
  synopsis: string;               // "seeflow nodes:add <flowId> [--json|--file|--stdin] <body>"
  description: string;            // one-paragraph what + why
  category: 'lifecycle' | 'flows' | 'nodes' | 'connectors' | 'project' | 'live' | 'meta';
  args: CommandArg[];
  flags: CommandFlag[];
  body?: {
    /** Reference to a Zod schema name exported from operations.ts/schema.ts. */
    schemaRef?: string;
    /** Concrete example body the agent can copy. */
    example?: unknown;
  };
  outputs: {
    /** Stdout JSON shape on success. */
    okExample?: unknown;
    /** Possible error `kind` values, mapped to exit codes. */
    errorKinds?: string[];
  };
  requiresStudio: boolean;
  examples: string[];
}

export const COMMAND_MANIFEST: CommandManifestEntry[] = [
  // populated for every command in cli.ts
];
```

**Step 1: Write the failing tests**

Create `apps/studio/src/cli-manifest.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { COMMAND_MANIFEST, renderManifestJson, renderCommandHelp, renderCommandList } from './cli-manifest.ts';

describe('COMMAND_MANIFEST', () => {
  it('has an entry for every command routed in cli.ts', () => {
    const names = COMMAND_MANIFEST.map((e) => e.name).sort();
    // The full list of subcommands the CLI dispatches on (cli.ts:117-167):
    expect(names).toEqual(
      [
        'start',
        'stop',
        'version',
        'help',
        'register',
        'flows:register',
        'flows:list',
        'flows:summary',
        'flows:get',
        'flows:graph',
        'flows:delete',
        'flows:layout',
        'flows:play',
        'projects:create',
        'nodes:add',
        'nodes:add-bulk',
        'nodes:get',
        'nodes:patch',
        'nodes:move',
        'nodes:reorder',
        'nodes:delete',
        'connectors:add',
        'connectors:add-bulk',
        'connectors:patch',
        'connectors:delete',
        'validate',
        'e2e',
      ].sort(),
    );
  });

  it('marks live-only commands as requiresStudio: true', () => {
    const live = COMMAND_MANIFEST.filter((e) => e.requiresStudio).map((e) => e.name);
    expect(live.sort()).toEqual(['e2e', 'flows:play'].sort());
  });

  it('flag/arg names are unique within each command', () => {
    for (const entry of COMMAND_MANIFEST) {
      const flagNames = entry.flags.map((f) => f.name);
      expect(new Set(flagNames).size).toBe(flagNames.length);
      const argNames = entry.args.map((a) => a.name);
      expect(new Set(argNames).size).toBe(argNames.length);
    }
  });
});

describe('renderManifestJson', () => {
  it('returns the manifest as a parseable JSON document with a version + commands key', () => {
    const out = renderManifestJson();
    const parsed = JSON.parse(out);
    expect(typeof parsed.version).toBe('string');
    expect(Array.isArray(parsed.commands)).toBe(true);
    expect(parsed.commands.length).toBe(COMMAND_MANIFEST.length);
  });
});

describe('renderCommandHelp', () => {
  it('returns a multi-section help page for a known command', () => {
    const out = renderCommandHelp('nodes:add');
    expect(out).toContain('nodes:add');
    expect(out).toContain('Synopsis');
    expect(out).toContain('Flags');
    expect(out).toContain('Example');
  });

  it('throws or returns a not-found marker for an unknown command', () => {
    expect(() => renderCommandHelp('nope:nope')).toThrow();
  });
});

describe('renderCommandList', () => {
  it('groups commands by category and lists every one', () => {
    const out = renderCommandList();
    for (const entry of COMMAND_MANIFEST) {
      expect(out).toContain(entry.name);
    }
  });
});
```

**Step 2: Run to confirm fail**

```bash
bun test apps/studio/src/cli-manifest.test.ts
```

Expected: FAIL — `cli-manifest.ts` does not exist.

**Step 3: Implement `cli-manifest.ts`**

Create `apps/studio/src/cli-manifest.ts`. Populate `COMMAND_MANIFEST` with one entry per command — minimum required fields per entry. Use the Zod schemas already in `operations.ts` / `schema.ts` (`AddNodeBody`, `NodePatchBodySchema`, `ConnectorPatchBodySchema`, `NodesBulkBodySchema`, `ConnectorsBulkBodySchema`, `CreateProjectBodySchema`, `RegisterBodySchema`, `PositionBodySchema`, `ReorderBodySchema`) to derive `body.schemaRef` strings and pull concrete examples from existing tests.

Add three rendering functions:

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';

export function renderManifestJson(): string {
  // Resolve schemaRef to inline JSON Schema for each entry so the JSON output
  // is self-contained — agents don't need to look up Zod definitions.
  const commands = COMMAND_MANIFEST.map((entry) => ({
    ...entry,
    body: entry.body
      ? {
          ...entry.body,
          schema: entry.body.schemaRef
            ? resolveSchemaRef(entry.body.schemaRef)
            : undefined,
        }
      : undefined,
  }));
  return JSON.stringify({ version: '1', commands }, null, 2);
}

export function renderCommandHelp(name: string): string {
  const entry = COMMAND_MANIFEST.find((e) => e.name === name);
  if (!entry) throw new Error(`Unknown command: ${name}`);
  const lines: string[] = [];
  lines.push(`# ${entry.name}`);
  lines.push('');
  lines.push(entry.description);
  lines.push('');
  lines.push('## Synopsis');
  lines.push(`  ${entry.synopsis}`);
  lines.push('');
  if (entry.args.length > 0) {
    lines.push('## Arguments');
    for (const a of entry.args) {
      lines.push(`  <${a.name}>${a.required ? '' : ' (optional)'} — ${a.description}`);
    }
    lines.push('');
  }
  if (entry.flags.length > 0) {
    lines.push('## Flags');
    for (const f of entry.flags) {
      const value = f.valuePlaceholder ? ` ${f.valuePlaceholder}` : '';
      lines.push(`  --${f.name}${value}${f.required ? '' : ' (optional)'} — ${f.description}`);
    }
    lines.push('');
  }
  if (entry.body) {
    lines.push('## Body');
    if (entry.body.schemaRef) lines.push(`  Schema: ${entry.body.schemaRef}`);
    if (entry.body.example !== undefined) {
      lines.push('  Example:');
      lines.push(`    ${JSON.stringify(entry.body.example)}`);
    }
    lines.push('');
  }
  lines.push('## Output');
  if (entry.outputs.okExample !== undefined) {
    lines.push('  On success:');
    lines.push(`    ${JSON.stringify(entry.outputs.okExample)}`);
  }
  if (entry.outputs.errorKinds?.length) {
    lines.push(`  Error kinds: ${entry.outputs.errorKinds.join(', ')}`);
  }
  lines.push('');
  if (entry.examples.length > 0) {
    lines.push('## Examples');
    for (const ex of entry.examples) {
      lines.push(`  ${ex}`);
    }
    lines.push('');
  }
  lines.push(`Requires studio running: ${entry.requiresStudio ? 'yes' : 'no'}`);
  return lines.join('\n');
}

export function renderCommandList(): string {
  // Group by category and render a flat list with one-line descriptions.
  const byCategory = new Map<string, CommandManifestEntry[]>();
  for (const entry of COMMAND_MANIFEST) {
    const arr = byCategory.get(entry.category) ?? [];
    arr.push(entry);
    byCategory.set(entry.category, arr);
  }
  const lines: string[] = [];
  lines.push('seeflow — local studio for file-defined interactive demos');
  lines.push('');
  for (const [category, entries] of byCategory) {
    lines.push(`## ${category}`);
    for (const e of entries) {
      const liveMarker = e.requiresStudio ? ' (requires running studio)' : '';
      lines.push(`  ${e.name} — ${e.description.split('\n')[0]}${liveMarker}`);
    }
    lines.push('');
  }
  lines.push('Run `seeflow help <command>` for details on one command,');
  lines.push('or `seeflow help --json` for the full machine-readable manifest.');
  return lines.join('\n');
}

function resolveSchemaRef(ref: string): unknown {
  // Map of schemaRef → Zod schema. Keep in sync with the schemas referenced
  // from COMMAND_MANIFEST entries.
  switch (ref) {
    case 'NodePatchBody':
      return zodToJsonSchema(NodePatchBodySchema, { $refStrategy: 'none' });
    case 'ConnectorPatchBody':
      return zodToJsonSchema(ConnectorPatchBodySchema, { $refStrategy: 'none' });
    case 'NodesBulkBody':
      return zodToJsonSchema(NodesBulkBodySchema, { $refStrategy: 'none' });
    case 'ConnectorsBulkBody':
      return zodToJsonSchema(ConnectorsBulkBodySchema, { $refStrategy: 'none' });
    case 'CreateProjectBody':
      return zodToJsonSchema(CreateProjectBodySchema, { $refStrategy: 'none' });
    case 'RegisterBody':
      return zodToJsonSchema(RegisterBodySchema, { $refStrategy: 'none' });
    case 'PositionBody':
      return zodToJsonSchema(PositionBodySchema, { $refStrategy: 'none' });
    case 'ReorderBody':
      return zodToJsonSchema(ReorderBodySchema, { $refStrategy: 'none' });
    default:
      return undefined;
  }
}
```

Imports at the top of the new file pull the Zod schemas from `./operations.ts`.

**Step 4: Wire `help` in `cli.ts`**

Replace the help-dispatch branch (around line 113-115) and the `printHelp` body:

```ts
} else if (sub === 'help' || sub === '--help' || sub === '-h') {
  await runHelp();
}

async function runHelp() {
  const wantsJson = hasFlag('json');
  const target = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
  if (target) {
    if (wantsJson) {
      const entry = COMMAND_MANIFEST.find((e) => e.name === target);
      if (!entry) {
        printError(`Unknown command: ${target}`);
      }
      printOk({ command: entry });
      return;
    }
    try {
      console.log(renderCommandHelp(target));
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
    return;
  }
  if (wantsJson) {
    process.stdout.write(renderManifestJson());
    process.stdout.write('\n');
    return;
  }
  console.log(renderCommandList());
}
```

Import `COMMAND_MANIFEST`, `renderManifestJson`, `renderCommandHelp`, `renderCommandList` from `./cli-manifest.ts`.

The old `printHelp` function can stay as a fallback OR be deleted in favour of `renderCommandList`. Prefer to delete it once the new path is shipping the same content.

**Step 5: Manual smoke test**

```bash
bun apps/studio/src/cli.ts help
bun apps/studio/src/cli.ts help nodes:add
bun apps/studio/src/cli.ts help --json | head -40
bun apps/studio/src/cli.ts help nodes:patch --json
```

Expected: human view, per-command details, JSON manifest, single-command JSON, all consistent.

**Step 6: Run full tests**

```bash
bun run typecheck
bun test apps/studio/src/cli-manifest.test.ts apps/studio/src/cli.test.ts
```

**Step 7: Commit**

```bash
git add apps/studio/src/cli-manifest.ts apps/studio/src/cli-manifest.test.ts apps/studio/src/cli.ts
git commit -m "feat(cli): structured help manifest for AI agents"
```

---

### Task 7.4 — End-to-end verification

**Step 1: Full test suite**

```bash
bun run typecheck
bun run lint
bun test
```

Expected: all green.

**Step 2: Visual e2e**

```bash
bun run test:it:e2e
```

Expected: visual baselines pass (these aren't CLI-driven so they shouldn't be affected, but confirm).

**Step 3: Manual smoke**

```bash
# Studio off
bun apps/studio/src/cli.ts flows:list                      # exits 0, no daemon
bun apps/studio/src/cli.ts validate --file ./examples/order-pipeline/.seeflow/flow.json

# Studio on (run in another terminal): bun run dev
bun apps/studio/src/cli.ts register --path /tmp/some-fixture
# Watch browser — flow list should update without manual refresh
bun apps/studio/src/cli.ts nodes:add <flowId> --json '{"type":"stateNode","data":{"name":"hello"}}'
# Watch browser — canvas should add the node within ~300ms
```

**Step 4: Production build check**

```bash
bun run build  # whatever the studio's build command is
```

If the CLI is shipped as a Bun-built binary, confirm it bundles `operations.ts`, `registry.ts`, `cli-ops.ts`, and `watcher.ts`/`registry-watcher.ts` without errors.

---

## Risk Hot-Spots (Re-read before Phase 7)

1. **Atomic registry writes (Phase 2).** If `writeFileAtomic` doesn't already use temp-file-then-rename, fix it before Phase 3 ships. Look for it in `operations.ts` and confirm semantics.
2. **Own-write echo dedupe (Phase 2 + 3).** Get the hash ring wrong and the studio reloads in a loop after every UI-driven mutation. The tests in Task 2.2 + 3.2 cover this — don't skip them.
3. **CLI bundling.** Bun-built `seeflow` binary must still find every newly imported module. Run `bun build` at the end of Phase 7.
4. **`Registry.path` exposure.** If `registry.ts` tests don't already cover `.path`, add one. The registry-watcher relies on this to know which file to fs.watch.
5. **The require-form in `registry-watcher.ts`.** Replace with a top-level import; the defensive form is only there in case of import cycles, which there aren't.

---

## Out of Scope

- `flows:play`, `flows:reset`, `e2e` CLI commands. Live, server-only features.
- The SSE event-channel design for non-flow events. The `__registry__` sentinel works; a proper "global channel" abstraction is a follow-up.
- Watching project-scoped files (htmlNode `view.html`, `nodes/*/detail.md`) from the CLI side — the studio's existing watcher already covers these.
