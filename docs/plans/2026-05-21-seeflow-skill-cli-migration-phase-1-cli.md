# SeeFlow Skill — CLI Migration, Phase 1 (Studio + CLI) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the studio so every flow mutation the skill needs is reachable via a `seeflow <subcommand>` CLI invocation, and switch per-node files to live under `.seeflow/nodes/<nodeId>/` so cascade-delete already covers scripts.

**Architecture:** Three localised studio changes (patch schema, scriptPath anchor, scriptPath hint), then a new HTTP-passthrough layer in `apps/studio/src/cli.ts` that mirrors the MCP tool names (`projects:create`, `nodes:add-bulk`, `connectors:patch`, …). The CLI ships with the studio package so version drift is impossible. Examples migrate to the new per-node anchor in the same PR so the seeded demos stay green.

**Tech Stack:** Bun ≥ 1.3, Hono via `hono/bun`, Zod, Biome. No new dependencies. CLI lives in a single TS file; tests use `bun:test` with a tmp-dir studio.

**Source of truth:** `docs/plans/2026-05-21-seeflow-skill-cli-migration-design.md`. This plan implements §"Studio code changes" and §"`apps/studio/examples/*`" only — the skill rewrite is Phase 2.

**Pre-flight (do once, before Task 1):**
- `bun install` at repo root (no-op if already done).
- `bun run typecheck && bun run lint && bun test` — record baseline. Every commit below must keep all three green.
- Confirm git is on a fresh branch with a clean tree (`git status`).

---

## Task 1: Extend `NodePatchBodySchema` with action overlays

**Why:** Phase 5 of the new skill pipeline patches `playAction`/`statusAction`/`stateSource` onto an already-created node. Today the patch schema rejects those keys (`strict()`), so the skill is forced back to file authoring.

**Files:**
- Modify: `apps/studio/src/operations.ts:78-149`
- Test: `apps/studio/src/operations.test.ts` (existing file — add a new `describe` block)

### Step 1: Locate existing schemas to reuse

Run: `grep -n "^export const \(PlayAction\|StatusAction\|StateSource\)Schema" apps/studio/src/schema.ts`

Expected: lines that export `PlayActionSchema`, `StatusActionSchema`, `StateSourceSchema`. If any are not exported, export them (add `export` in front of the `const`) — Biome will allow this; do not change their definitions.

If `PlayActionSchema` / `StatusActionSchema` are currently file-local (no `export`), add `export` to each. This is the only change to `schema.ts` in this task.

### Step 2: Write the failing test

Append to `apps/studio/src/operations.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { NodePatchBodySchema, mergeNodeUpdates } from './operations.ts';

describe('NodePatchBodySchema — action overlays', () => {
  it('accepts playAction in the patch body', () => {
    const parsed = NodePatchBodySchema.safeParse({
      playAction: {
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts statusAction in the patch body', () => {
    const parsed = NodePatchBodySchema.safeParse({
      statusAction: {
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/status.ts',
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts stateSource in the patch body', () => {
    const parsed = NodePatchBodySchema.safeParse({
      stateSource: { kind: 'request' },
    });
    expect(parsed.success).toBe(true);
  });

  it('mergeNodeUpdates writes playAction onto node.data', () => {
    const node: Record<string, unknown> = { id: 'n1', type: 'playNode', data: {} };
    mergeNodeUpdates(node, {
      playAction: {
        kind: 'script',
        interpreter: 'bun',
        scriptPath: 'scripts/play.ts',
      },
    });
    expect((node.data as Record<string, unknown>).playAction).toEqual({
      kind: 'script',
      interpreter: 'bun',
      scriptPath: 'scripts/play.ts',
    });
  });

  it('rejects unknown top-level keys (strict guarantee preserved)', () => {
    const parsed = NodePatchBodySchema.safeParse({ bogus: 1 });
    expect(parsed.success).toBe(false);
  });
});
```

### Step 3: Run the test — expect failure

Run: `bun test apps/studio/src/operations.test.ts --test-name-pattern "action overlays"`

Expected: at least the three "accepts …" cases fail with a Zod issue like `Unrecognized key(s) in object: 'playAction'`. The "mergeNodeUpdates writes …" case also fails.

### Step 4: Extend the patch schema

Edit `apps/studio/src/operations.ts`. Update the import block near the top so `PlayActionSchema`, `StatusActionSchema`, `StateSourceSchema` are pulled in from `./schema.ts` alongside the existing imports:

```ts
import {
  ColorTokenSchema,
  EdgePinSchema,
  type Flow,
  FlowSchema,
  PlayActionSchema,
  ResolvedFlowSchema,
  ShapeKindSchema,
  SourceHandleIdSchema,
  StateSourceSchema,
  StatusActionSchema,
  StyleSchema,
  TargetHandleIdSchema,
} from './schema.ts';
```

Then extend `NodePatchBodySchema` (around line 78). Add three optional fields just before the closing `.strict()`:

```ts
    // P5 overlay attach: lets the skill (or any consumer) wire executable
    // behaviour onto a previously-created node without re-issuing it. Final
    // validity is enforced by the post-merge ResolvedFlowSchema reparse —
    // e.g. statusAction is only valid on playNode / stateNode.
    playAction: PlayActionSchema.optional(),
    statusAction: StatusActionSchema.optional(),
    stateSource: StateSourceSchema.optional(),
```

Extend `NODE_DATA_PATCH_KEYS` (around line 128) to include the three new keys:

```ts
const NODE_DATA_PATCH_KEYS = [
  'name',
  // … existing keys …
  'html',
  'playAction',
  'statusAction',
  'stateSource',
] as const satisfies ReadonlyArray<keyof NodePatchBody>;
```

### Step 5: Re-run the test — expect pass

Run: `bun test apps/studio/src/operations.test.ts --test-name-pattern "action overlays"`

Expected: all five cases pass.

### Step 6: Run the full suite

Run: `bun test && bun run typecheck && bun run format && bun run lint`

Expected: green across the board. `bun run format` may rewrite import order — that's fine.

### Step 7: Commit

```bash
git add apps/studio/src/operations.ts apps/studio/src/operations.test.ts apps/studio/src/schema.ts
git commit -m "feat(operations): allow playAction/statusAction/stateSource in NodePatchBody"
```

---

## Task 2: Anchor `scriptPath` resolution at `.seeflow/nodes/<nodeId>/`

**Why:** Per-node files now live under `.seeflow/nodes/<nodeId>/`. The two `resolveScript` helpers still anchor at `.seeflow/` which means a script written by the skill at `.seeflow/nodes/n1/scripts/play.ts` needs `scriptPath: "nodes/n1/scripts/play.ts"` — leaking the node id into its own path. After this change `scriptPath: "scripts/play.ts"` resolves relative to the node folder.

**Files:**
- Modify: `apps/studio/src/proxy.ts:53-73` (signature + body) and the two call sites at `:160` and `:307`
- Modify: `apps/studio/src/status-runner.ts:65-85` (signature + body) and the call site at `:182`
- Test: `apps/studio/src/proxy.test.ts` and `apps/studio/src/status-runner.test.ts` (existing — extend)

### Step 1: Confirm existing tests pass

Run: `bun test apps/studio/src/proxy.test.ts apps/studio/src/status-runner.test.ts`

Expected: green. Record any pre-existing skipped cases so they don't get blamed on this task.

### Step 2: Write the failing test for proxy

Append to `apps/studio/src/proxy.test.ts` inside whichever `describe('runPlay …')` block already exists (or a new one):

```ts
it('resolves scriptPath relative to .seeflow/nodes/<nodeId>/', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'seeflow-proxy-anchor-'));
  const nodeDir = join(cwd, '.seeflow', 'nodes', 'checkout-api', 'scripts');
  mkdirSync(nodeDir, { recursive: true });
  writeFileSync(
    join(nodeDir, 'play.ts'),
    '#!/usr/bin/env bun\nconsole.log(JSON.stringify({ ok: true }));\n',
  );

  const events = createEventBus();
  const result = await runPlay({
    events,
    flowId: 'flow-1',
    nodeId: 'checkout-api',
    cwd,
    action: {
      kind: 'script',
      interpreter: 'bun',
      scriptPath: 'scripts/play.ts',
    },
  });

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ ok: true });
});
```

Imports likely already present: `mkdtempSync`, `mkdirSync`, `writeFileSync`, `tmpdir`, `join`, `createEventBus`, `runPlay`. Add anything missing.

### Step 3: Run the test — expect failure

Run: `bun test apps/studio/src/proxy.test.ts --test-name-pattern "relative to .seeflow/nodes"`

Expected: failure — current `resolveScript` looks at `.seeflow/scripts/play.ts`, which doesn't exist, so the call returns `SCRIPT_PATH_ESCAPE` and the test fails on `result.error`.

### Step 4: Update `resolveScript` in `proxy.ts`

Edit `apps/studio/src/proxy.ts`. Change the helper signature to require `nodeId` and anchor at the per-node folder. Replace the body of `resolveScript` (lines ~53-73):

```ts
// Resolve `<cwd>/.seeflow/nodes/<nodeId>/<scriptPath>` and verify via realpath
// it stays inside the node folder. The per-node anchor means scriptPath is
// "scripts/play.ts" — no node id leaks into its own path.
function resolveScript(cwd: string, nodeId: string, scriptPath: string): Resolved {
  const nodeRoot = join(cwd, '.seeflow', 'nodes', nodeId);
  let realRoot: string;
  try {
    realRoot = realpathSync(nodeRoot);
  } catch {
    return { ok: false };
  }
  const target = resolve(nodeRoot, scriptPath);
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    return { ok: false };
  }
  const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realTarget !== realRoot && !realTarget.startsWith(rootWithSep)) {
    return { ok: false };
  }
  return { ok: true, absPath: realTarget };
}
```

Update the two call sites:

- Line ~160 (inside `runPlay`): change `resolveScript(cwd, action.scriptPath)` → `resolveScript(cwd, nodeId, action.scriptPath)`. `nodeId` is already destructured from `options` at the top of the function.
- Line ~307 (inside `runReset`): `resetAction` has no nodeId in scope today. `resetAction` is **out of scope** per the design doc (decision #7). For now, hard-code the anchor at the demo root by passing the empty string and special-casing it — easier to keep the existing behaviour intact. Replace `resolveScript(cwd, action.scriptPath)` with a small inline helper:

  ```ts
  // resetAction stays anchored at .seeflow/ for now — design defers per-node
  // resetAction to a later round (decision #7). Mirrors the previous behaviour.
  const resolved = resolveResetScript(cwd, action.scriptPath);
  ```

  Add `resolveResetScript` near the top of the file (right after `resolveScript`):

  ```ts
  // Legacy anchor for resetAction (kept until resetAction gets its own design
  // round). Same realpath escape check as resolveScript, but rooted at
  // <cwd>/.seeflow/ rather than a per-node folder.
  function resolveResetScript(cwd: string, scriptPath: string): Resolved {
    const seeflowRoot = join(cwd, '.seeflow');
    let realRoot: string;
    try {
      realRoot = realpathSync(seeflowRoot);
    } catch {
      return { ok: false };
    }
    const target = resolve(seeflowRoot, scriptPath);
    let realTarget: string;
    try {
      realTarget = realpathSync(target);
    } catch {
      return { ok: false };
    }
    const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    if (realTarget !== realRoot && !realTarget.startsWith(rootWithSep)) {
      return { ok: false };
    }
    return { ok: true, absPath: realTarget };
  }
  ```

### Step 5: Run the proxy test — expect pass

Run: `bun test apps/studio/src/proxy.test.ts`

Expected: green, including the new anchor case AND every pre-existing case (the runReset path still uses the demo-root anchor).

### Step 6: Mirror the change in `status-runner.ts`

Write the failing test first. Append to `apps/studio/src/status-runner.test.ts` (or its closest equivalent — if it doesn't exist, create it; the existing `proxy.test.ts` is the closest pattern):

```ts
it('status-runner anchors scriptPath at .seeflow/nodes/<nodeId>/', async () => {
  // Minimal smoke: setup a tmp repo with a status script under the node
  // folder, register a one-node flow, start runner, expect a node:status
  // event to land (no SCRIPT_PATH_ESCAPE).
  // …mirror the proxy test's tmpdir setup; assertion is that the broadcast
  // payload's `state` is NOT 'error' with summary === 'scriptPath escapes …'.
});
```

Run: `bun test apps/studio/src/status-runner.test.ts --test-name-pattern "anchors scriptPath"` — expect failure.

Update `apps/studio/src/status-runner.ts:65-85` exactly as in proxy:

```ts
function resolveScript(repoPath: string, nodeId: string, scriptPath: string): ResolvedScript {
  const nodeRoot = join(repoPath, '.seeflow', 'nodes', nodeId);
  let realRoot: string;
  try {
    realRoot = realpathSync(nodeRoot);
  } catch {
    return { ok: false };
  }
  const target = resolve(nodeRoot, scriptPath);
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    return { ok: false };
  }
  const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realTarget !== realRoot && !realTarget.startsWith(rootWithSep)) {
    return { ok: false };
  }
  return { ok: true, absPath: realTarget };
}
```

Update the call site at line ~182: `resolveScript(repoPath, action.scriptPath)` → `resolveScript(repoPath, nodeId, action.scriptPath)`. `nodeId` is already destructured from `sn` two lines above.

Update the doc comment at line ~18 — change `proxy.ts:resolveScript — realpath` to reflect the per-node anchor.

Run: `bun test apps/studio/src/status-runner.test.ts` — expect pass.

### Step 7: Run the full suite

Run: `bun test && bun run typecheck && bun run format && bun run lint`

Expected: all green. If any pre-existing test depended on the old `.seeflow/scripts/<file>` anchor, it must be migrated under Task 6 (examples). Triage now: list the failures, do NOT skip them.

### Step 8: Commit

```bash
git add apps/studio/src/proxy.ts apps/studio/src/proxy.test.ts \
        apps/studio/src/status-runner.ts apps/studio/src/status-runner.test.ts
git commit -m "feat(runtime): anchor scriptPath at .seeflow/nodes/<nodeId>/"
```

---

## Task 3: Update `scriptPath` hint messages in `schema.ts`

**Why:** The schema's user-facing error message still says `relative path under .seeflow/`. After Task 2 the anchor is the node folder — keep the wording aligned so Zod errors don't lie to the caller.

**Files:**
- Modify: `apps/studio/src/schema.ts:73-74` and `:96-97` (the two `scriptPath` `.refine()` calls)

### Step 1: Confirm where the messages live

Run: `grep -n "scriptPath must be a relative path under" apps/studio/src/schema.ts`

Expected: exactly two matches — `ScriptActionSchema` (used by Play + Reset) and `StatusActionSchema`.

### Step 2: Update both messages

In both spots, change:

```ts
message: 'scriptPath must be a relative path under .seeflow/ (no absolute / traversal)',
```

to:

```ts
message: 'scriptPath must be a relative path under the node folder (no absolute / traversal)',
```

`isCleanRelativePath` itself stays untouched — it's still "no absolute, no `..`".

### Step 3: Run the suite

Run: `bun test && bun run typecheck && bun run format && bun run lint`

Expected: green. If any test pinned the old wording verbatim, update the assertion to the new wording in the same commit.

### Step 4: Commit

```bash
git add apps/studio/src/schema.ts
git commit -m "chore(schema): update scriptPath hint to reflect per-node anchor"
```

---

## Task 4: CLI scaffolding — shared body loader + outcome printer

**Why:** Every new subcommand needs to load a JSON payload (`--file`, `--stdin`, or `--json '…'`) and emit `{ ok: true, … }` to stdout / human errors to stderr. Build these once so the per-subcommand code stays short.

**Files:**
- Modify: `apps/studio/src/cli.ts` (extract helpers into the same file — no new module yet; YAGNI)
- Test: `apps/studio/src/cli-helpers.test.ts` (NEW)

### Step 1: Write the failing helper test

Create `apps/studio/src/cli-helpers.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBody } from './cli-helpers.ts';

describe('loadBody', () => {
  it('reads inline JSON from --json', async () => {
    const body = await loadBody({ json: '{"a":1}', file: undefined, stdin: false }, async () => '');
    expect(body).toEqual({ a: 1 });
  });

  it('reads a file from --file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seeflow-cli-helpers-'));
    const file = join(dir, 'body.json');
    writeFileSync(file, '{"hello":"world"}');
    const body = await loadBody({ json: undefined, file, stdin: false }, async () => '');
    expect(body).toEqual({ hello: 'world' });
  });

  it('reads stdin when --stdin set', async () => {
    const body = await loadBody(
      { json: undefined, file: undefined, stdin: true },
      async () => '{"from":"stdin"}',
    );
    expect(body).toEqual({ from: 'stdin' });
  });

  it('throws when more than one input source provided', async () => {
    await expect(
      loadBody({ json: '{}', file: '/tmp/x', stdin: false }, async () => ''),
    ).rejects.toThrow(/exactly one of --json, --file, --stdin/);
  });

  it('throws when none provided', async () => {
    await expect(
      loadBody({ json: undefined, file: undefined, stdin: false }, async () => ''),
    ).rejects.toThrow(/exactly one of --json, --file, --stdin/);
  });

  it('throws on malformed JSON with the file path in the message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seeflow-cli-helpers-'));
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{not json');
    await expect(
      loadBody({ json: undefined, file, stdin: false }, async () => ''),
    ).rejects.toThrow(new RegExp(file));
  });
});
```

### Step 2: Run the test — expect failure (no module)

Run: `bun test apps/studio/src/cli-helpers.test.ts`

Expected: failure — `cli-helpers.ts` does not exist.

### Step 3: Create the helpers module

Create `apps/studio/src/cli-helpers.ts`:

```ts
import { readFileSync } from 'node:fs';

export interface BodySource {
  json: string | undefined;
  file: string | undefined;
  stdin: boolean;
}

export type StdinReader = () => Promise<string>;

export async function loadBody(src: BodySource, readStdin: StdinReader): Promise<unknown> {
  const sources = [src.json !== undefined, src.file !== undefined, src.stdin].filter(Boolean).length;
  if (sources !== 1) {
    throw new Error('Provide exactly one of --json, --file, --stdin');
  }

  let raw: string;
  let label: string;
  if (src.json !== undefined) {
    raw = src.json;
    label = '--json';
  } else if (src.file !== undefined) {
    raw = readFileSync(src.file, 'utf8');
    label = src.file;
  } else {
    raw = await readStdin();
    label = '<stdin>';
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON from ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface CliOutcomeOptions {
  /** stream override for tests; defaults to process.stdout/stderr */
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  exit?: (code: number) => never;
}

/** Print { ok: true, … } JSON line to stdout and exit 0. */
export function printOk(payload: unknown, opts: CliOutcomeOptions = {}): never {
  const out = opts.stdout ?? ((s) => process.stdout.write(s));
  out(`${JSON.stringify({ ok: true, ...(payload as object) })}\n`);
  (opts.exit ?? process.exit)(0);
}

/** Print plain-text error to stderr and exit 1. */
export function printError(message: string, opts: CliOutcomeOptions = {}): never {
  const err = opts.stderr ?? ((s) => process.stderr.write(s));
  err(`${message}\n`);
  (opts.exit ?? process.exit)(1);
}

/** Default stdin reader — drains process.stdin to a UTF-8 string. */
export const drainStdin: StdinReader = async () => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};
```

### Step 4: Run the helper test — expect pass

Run: `bun test apps/studio/src/cli-helpers.test.ts`

Expected: green.

### Step 5: Run the full suite

Run: `bun test && bun run typecheck && bun run format && bun run lint`

Expected: green.

### Step 6: Commit

```bash
git add apps/studio/src/cli-helpers.ts apps/studio/src/cli-helpers.test.ts
git commit -m "feat(cli): add shared body loader + outcome printer helpers"
```

---

## Task 5: Wire the new subcommands into `cli.ts`

Implement all 19 subcommands listed in the design doc's CLI table. Group them into one task because each is essentially a thin HTTP passthrough — separate commits per group to keep blame readable.

**Files:**
- Modify: `apps/studio/src/cli.ts`
- Test: `apps/studio/src/cli.test.ts`

**Existing CLI shape:** `runStart`, `runStop`, `runRegister`. New subcommands slot into the dispatch block at line 49-68. Keep `register` working as today (backwards compat); add `flows:register` as a thin shim that calls the same function.

### Step 1: Add the dispatch routing skeleton

Edit `apps/studio/src/cli.ts`. In the top-level dispatch (`if (argv.includes('--version') …)`), add new branches **before** the `else { console.error('Unknown subcommand: …'); … }` fallback:

```ts
} else if (sub === 'flows:register') {
  await runRegister(); // alias of existing register
} else if (sub === 'projects:create') {
  await runProjectsCreate();
} else if (sub === 'flows:list') {
  await runFlowsList();
} else if (sub === 'flows:get') {
  await runFlowsGet();
} else if (sub === 'flows:delete') {
  await runFlowsDelete();
} else if (sub === 'flows:layout') {
  await runFlowsLayout();
} else if (sub === 'flows:play') {
  await runFlowsPlay();
} else if (sub === 'nodes:add') {
  await runNodesAdd();
} else if (sub === 'nodes:add-bulk') {
  await runNodesAddBulk();
} else if (sub === 'nodes:patch') {
  await runNodesPatch();
} else if (sub === 'nodes:move') {
  await runNodesMove();
} else if (sub === 'nodes:reorder') {
  await runNodesReorder();
} else if (sub === 'nodes:delete') {
  await runNodesDelete();
} else if (sub === 'connectors:add') {
  await runConnectorsAdd();
} else if (sub === 'connectors:add-bulk') {
  await runConnectorsAddBulk();
} else if (sub === 'connectors:patch') {
  await runConnectorsPatch();
} else if (sub === 'connectors:delete') {
  await runConnectorsDelete();
} else if (sub === 'validate') {
  await runValidate();
} else if (sub === 'e2e') {
  await runE2e();
```

Replace the existing `['unregister', 'list'].includes(sub)` stub branch (lines ~61-63) with the new `flows:list` / `flows:delete` handlers; remove the stub entirely.

Run: `bun run typecheck` — expect failure on every new `runXxx` until they're defined.

### Step 2: Add the studio-URL + body-load helper (cli.ts internals)

Inside `cli.ts`, just below `flagValue`, add:

```ts
import { drainStdin, loadBody, printError, printOk } from './cli-helpers.ts';

async function studioUrlOrDie(noStart: boolean): Promise<{ url: string; port: number }> {
  const config = readConfig();
  const overrideUrl = process.env.SEEFLOW_STUDIO_URL?.replace(/\/+$/, '');
  const url = overrideUrl ?? studioUrl(config);
  await ensureStudioRunning(url, config.port, noStart);
  return { url, port: config.port };
}

async function bodyFromFlags(): Promise<unknown> {
  return loadBody(
    { json: flagValue('json'), file: flagValue('file'), stdin: hasFlag('stdin') },
    drainStdin,
  );
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function handleResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  if (!res.ok) {
    const detail =
      typeof parsed === 'object' && parsed !== null
        ? JSON.stringify(parsed)
        : String(parsed).slice(0, 500);
    printError(`Studio returned ${res.status}: ${detail}`);
  }
  return parsed;
}

const requireArg = (idx: number, name: string): string => {
  const v = argv[idx];
  if (!v || v.startsWith('--')) printError(`Missing required positional argument: ${name}`);
  return v as string;
};
```

### Step 3: Implement each `runXxx` (single commit per resource group)

#### 3a. `runProjectsCreate`

```ts
async function runProjectsCreate() {
  const name = flagValue('name');
  if (!name) printError('Missing required flag: --name');
  const { url } = await studioUrlOrDie(hasFlag('no-start'));
  const res = await postJson(`${url}/api/projects`, { name });
  const body = (await handleResponse(res)) as { id: string; slug: string; scaffolded: boolean };
  printOk(body);
}
```

Test (append to `cli.test.ts`):

```ts
it('projects:create returns {id, slug, scaffolded}', async () => {
  const studio = startTestStudio();
  try {
    const r = await runCli(
      ['projects:create', '--no-start', '--name', 'Checkout'],
      { SEEFLOW_STUDIO_URL: studio.url },
    );
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.slug).toBe('checkout');
  } finally {
    studio.stop();
  }
});
```

Run, expect pass.

Commit:

```bash
git add apps/studio/src/cli.ts apps/studio/src/cli.test.ts
git commit -m "feat(cli): add projects:create subcommand"
```

#### 3b. `flows:list`, `flows:get`, `flows:delete`, `flows:layout`, `flows:play`

Implement each as a thin GET/POST/DELETE wrapper. Example for `flows:get`:

```ts
async function runFlowsGet() {
  const flowId = requireArg(1, '<flowId>');
  const { url } = await studioUrlOrDie(hasFlag('no-start'));
  const res = await fetch(`${url}/api/flows/${encodeURIComponent(flowId)}`);
  const body = await handleResponse(res);
  printOk(body as object);
}
```

For each subcommand, write a happy-path test in `cli.test.ts` that uses `startTestStudio`, seeds at least one flow via the existing `registry.upsert`, and asserts `r.code === 0` plus a key field in `JSON.parse(r.stdout)`. Add one error-path test per subcommand (unknown flowId → exit 1, stderr mentions the studio status code).

Commit per subcommand or per pair, depending on review preference:

```bash
git commit -m "feat(cli): add flows:list / flows:get / flows:delete subcommands"
git commit -m "feat(cli): add flows:layout / flows:play subcommands"
```

#### 3c. `nodes:add`, `nodes:add-bulk`, `nodes:patch`, `nodes:move`, `nodes:reorder`, `nodes:delete`

Same pattern. `nodes:add`, `nodes:add-bulk`, `nodes:patch` use `bodyFromFlags()`. `nodes:move` takes `--x N --y N`. `nodes:reorder` takes `--op forward|backward|toFront|toBack|toIndex` and optional `--index N` for `toIndex`.

Example `nodes:add-bulk`:

```ts
async function runNodesAddBulk() {
  const flowId = requireArg(1, '<flowId>');
  const body = await bodyFromFlags();
  const { url } = await studioUrlOrDie(hasFlag('no-start'));
  const res = await postJson(`${url}/api/flows/${encodeURIComponent(flowId)}/nodes/bulk`, body);
  const out = (await handleResponse(res)) as { nodes: Array<{ id: string }> };
  printOk(out);
}
```

Test happy + error paths (`duplicateIdInBatch` is the easiest error path — POST two items with the same id).

Commit per group.

#### 3d. `connectors:add`, `connectors:add-bulk`, `connectors:patch`, `connectors:delete`

Same pattern. Endpoints under `/api/flows/<id>/connectors[/<connId>]` and `…/connectors/bulk`. Test happy + one error.

Commit.

#### 3e. `validate`

```ts
async function runValidate() {
  const file = flagValue('file');
  const styleFile = flagValue('style');
  if (!file) printError('Missing required flag: --file');
  const flow = JSON.parse(readFileSync(file, 'utf8'));
  const style = styleFile ? JSON.parse(readFileSync(styleFile, 'utf8')) : undefined;
  const { url } = await studioUrlOrDie(hasFlag('no-start'));
  const res = await postJson(`${url}/api/validate`, { flow, style });
  const body = (await handleResponse(res)) as { ok: boolean; issues?: unknown[] };
  if (body.ok === false) {
    printError(`Schema validation failed: ${JSON.stringify(body.issues)}`);
  }
  printOk(body);
}
```

Test: valid flow → exit 0; flow with a dangling connector → exit 1, stderr contains "Schema validation failed".

Commit.

#### 3f. `e2e`

Port `validate-end-to-end.ts` into `cli.ts` (or a sibling `cli-e2e.ts` if it grows past ~120 lines). It opens an SSE stream at `/api/events?flowId=<id>`, fetches the flow, POSTs `/api/flows/<id>/play/<nodeId>` for each safe play, awaits the matching `node:done|error` events, returns `{ok, plays, statuses, skipped}`. Reference today's `skills/seeflow/scripts/validate-end-to-end.ts` for the exact algorithm — copy it, do NOT re-derive.

`--skip-nodes id1,id2` is a comma-separated list.

Test: spin up a tmp studio with one playNode whose `playAction` is `bun -e "console.log(JSON.stringify({ok:true}))"`, register it, run `seeflow e2e <id>`, expect `ok: true` and `plays[0].error` absent. Skip-nodes test: pass the node id in `--skip-nodes`, expect it in `skipped[]`.

Commit:

```bash
git commit -m "feat(cli): add e2e subcommand (replaces validate-end-to-end.ts)"
```

### Step 4: Update `printHelp()`

Append the new subcommands under `Commands:` in `printHelp()` (cli.ts line ~70). Group them: `projects:*`, `flows:*`, `nodes:*`, `connectors:*`, `validate`, `e2e`. Keep `register` listed as a backwards-compat alias of `flows:register`.

### Step 5: Run the full suite

Run: `bun test && bun run typecheck && bun run format && bun run lint`

Expected: green.

### Step 6: Final commit for help text

```bash
git add apps/studio/src/cli.ts
git commit -m "docs(cli): list new subcommands in --help"
```

---

## Task 6: Migrate seeded examples to per-node file layout

**Why:** After Task 2, `scripts/play.ts` resolves under `.seeflow/nodes/<nodeId>/scripts/` — but the seeded examples still anchor at `.seeflow/scripts/`. Without this migration, the studio's first-boot seed flows are broken (`SCRIPT_PATH_ESCAPE` on every play).

**Files:**
- Move: `apps/studio/examples/order-pipeline/.seeflow/scripts/play.ts` → per-node folders
- Move: `apps/studio/examples/order-pipeline/.seeflow/details/*.md` → `apps/studio/examples/order-pipeline/.seeflow/nodes/<nodeId>/detail.md` (note rename: `.../<id>.md` → `nodes/<id>/detail.md`)
- Move: `apps/studio/examples/ecommerce-platform/.seeflow/scripts/play.ts` → per-node folders
- Move: `apps/studio/examples/ecommerce-platform/.seeflow/scripts/platform-health.html` → `nodes/<htmlNodeId>/view.html` (the `htmlNode` externalizer expects `view.html`)
- Modify: both `flow.json` files — rewrite each `scriptPath` and `detail`/`html` `file://` ref.

### Step 1: Inventory current refs

Run: `grep -rn "scriptPath\|file://" apps/studio/examples/*/.seeflow/flow.json`

Capture the output to a scratchpad — you need every (nodeId, scriptPath, detail) triple to compute the destination paths.

### Step 2: Move each script + detail file

For each playNode in `order-pipeline/flow.json` that has a `playAction`:

```bash
# Example for nodeId=post-orders
mkdir -p apps/studio/examples/order-pipeline/.seeflow/nodes/post-orders/scripts
git mv apps/studio/examples/order-pipeline/.seeflow/scripts/play.ts \
       apps/studio/examples/order-pipeline/.seeflow/nodes/post-orders/scripts/play.ts
```

If multiple nodes share the SAME `play.ts` (likely for the example flows that use one trivial script everywhere), copy then `git rm` the original:

```bash
cp apps/studio/examples/order-pipeline/.seeflow/scripts/play.ts \
   apps/studio/examples/order-pipeline/.seeflow/nodes/inventory-service/scripts/play.ts
# … repeat for each consumer …
git rm apps/studio/examples/order-pipeline/.seeflow/scripts/play.ts
git add apps/studio/examples/order-pipeline/.seeflow/nodes/*/scripts/play.ts
```

For each `detail` field that currently points at `details/<file>.md`:

```bash
# Example for nodeId=post-orders → "detail": "file://details/post-orders.md"
mkdir -p apps/studio/examples/order-pipeline/.seeflow/nodes/post-orders
git mv apps/studio/examples/order-pipeline/.seeflow/details/post-orders.md \
       apps/studio/examples/order-pipeline/.seeflow/nodes/post-orders/detail.md
```

After all moves, the `details/` and root `scripts/` directories should be empty — remove them:

```bash
rmdir apps/studio/examples/order-pipeline/.seeflow/details
rmdir apps/studio/examples/order-pipeline/.seeflow/scripts
```

Repeat for `ecommerce-platform`. The `platform-health.html` move targets `nodes/<htmlNodeId>/view.html` — grep the flow.json to find which node owns it.

### Step 3: Rewrite `flow.json` refs

In each `flow.json`:

- Every `"scriptPath": "scripts/play.ts"` → `"scriptPath": "scripts/play.ts"` (unchanged STRING but the anchor moved — verify the file now exists at `nodes/<that-node-id>/scripts/play.ts`).
- Every `"detail": "file://details/<name>.md"` → `"detail": "file://nodes/<nodeId>/detail.md"`.
- Every `"html": "file://scripts/platform-health.html"` → `"html": "file://nodes/<nodeId>/view.html"`.

Use `Edit` per file rather than sed — the JSON has multi-line context that's worth eyeballing.

### Step 4: Re-seed locally to verify

Run: `rm -rf ~/.seeflow/order-pipeline ~/.seeflow/ecommerce-platform && bun apps/studio/src/cli.ts start --foreground &` then in another terminal:

```bash
curl -s http://localhost:4321/api/flows | jq '.[].slug'
```

Expected: both example slugs appear. Open `http://localhost:4321/d/order-pipeline` in a browser and click the play button on `post-orders` — expect a `node:done` event (no `SCRIPT_PATH_ESCAPE`).

Stop the studio: `bun apps/studio/src/cli.ts stop`.

### Step 5: Update any tests that point at the old example layout

Run: `grep -rn ".seeflow/scripts/\|.seeflow/details/" apps/studio/src/ skills/seeflow/`

Any matches in `apps/studio/src/**/*.test.ts` need their fixture paths updated to the new layout. Matches in `skills/seeflow/` are Phase 2 territory — leave them for now.

### Step 6: Run the suite

Run: `bun test && bun run typecheck && bun run format && bun run lint`

Expected: green. If `bun test` reseeds the examples into a tmp dir and asserts file presence, those assertions need updating too.

### Step 7: Commit

```bash
git add apps/studio/examples
git commit -m "refactor(examples): migrate to per-node file layout"
```

---

## Task 7: Sanity check — full integration smoke

**Why:** All the above changes ripple through one another. Run a final end-to-end smoke to catch anything missed.

### Step 1: Cold-boot smoke

```bash
rm -rf ~/.seeflow
bun run dev &
DEV_PID=$!
sleep 3
curl -s http://localhost:4321/api/flows | jq '.[].slug'
# expect: "order-pipeline" and "ecommerce-platform"

# Hit a few new subcommands
bun apps/studio/src/cli.ts projects:create --name "Smoke Test"
bun apps/studio/src/cli.ts flows:list
SMOKE_ID=$(bun apps/studio/src/cli.ts flows:list | jq -r '.flows[] | select(.slug=="smoke-test") | .id')
bun apps/studio/src/cli.ts nodes:add-bulk "$SMOKE_ID" --json '{"nodes":[{"id":"n1","type":"playNode","data":{"name":"hello","kind":"service","stateSource":{"kind":"request"}}}]}'
bun apps/studio/src/cli.ts flows:get "$SMOKE_ID" | jq '.flow.nodes | length'
# expect: 1
bun apps/studio/src/cli.ts flows:delete "$SMOKE_ID"

kill $DEV_PID
```

Each command should print `{"ok":true,…}` to stdout, exit 0, and have an empty stderr.

### Step 2: Final commit (if any tweaks fell out of smoke)

If smoke surfaced a fix:

```bash
git add -p   # stage only the smoke-driven fixes
git commit -m "fix(cli): <one-liner>"
```

---

## Definition of Done (Phase 1)

- [ ] `bun test && bun run typecheck && bun run lint` all green.
- [ ] `bun apps/studio/src/cli.ts --help` lists every new subcommand.
- [ ] Cold-boot of `bun run dev` seeds both examples and a play on `order-pipeline/post-orders` runs end-to-end.
- [ ] The skill in `skills/seeflow/` is **not** touched in this phase — that's Phase 2.
- [ ] Open follow-ups (resetAction, MCP-mode revival) explicitly deferred per design doc §"Open follow-ups".

Once these are checked, hand off to Phase 2: `docs/plans/2026-05-21-seeflow-skill-cli-migration-phase-2-skill.md`.
