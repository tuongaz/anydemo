# Multi-flow Projects Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a single SeeFlow project host multiple flows, switchable from a Figma-style popover in the canvas.

**Architecture:** A new top-level `seeflow.json` manifest declares the flows in a project; each flow lives in its own folder under `flows/<id>/`. All studio HTTP routes move under `/api/projects/:project/flows/:flow/…`. CLI and MCP tools take explicit `--project` + `--flow` arguments. The canvas adapter rebinds on flow switch.

**Tech Stack:** Bun + Hono (`apps/studio/`), React + Vite + React Flow (`apps/web/`), Zod schemas (`apps/studio/src/schema.ts`), Biome lint/format, Vitest unit tests, Playwright e2e (`apps/studio/e2e/`).

**Design source:** `docs/plans/2026-05-26-multi-flow-projects-design.md`. Read it before starting — every decision and rejected alternative is there.

**Repository conventions you MUST follow** (see also `CLAUDE.md`):
- **Bun only** — never `node`, never `pnpm`. Commands: `bun run dev`, `bun run typecheck`, `bun run lint`, `bun test`.
- **`hono/bun`** — never `@hono/node-server`.
- **Run `bun run format` before `bun run lint`** (Biome handles both).
- **Single Zod source of truth** is `apps/studio/src/schema.ts`.
- **Design system source of truth** is `design/design.html` — consult it before touching any UI tokens, spacing, colors, copy.
- **Playwright visual baselines** are pinned to `chromium-linux`. On macOS the test orchestrator routes through Docker — Docker Desktop must be running. Regenerate via `bun run test:it:update-snapshots`. Never commit `*-darwin.png`.

**Sibling repo work (out of scope for this plan but blocks Commit 5):** `seeflow-viewer` needs `POST /api/projects`, `GET /api/projects/<uuid>`, `GET /api/projects/<uuid>/files/<proxy+>`, and a viewer-side flow switcher. Coordinate before flipping the export feature flag.

---

## Commit map

| Commit | Tasks |
|---|---|
| 1. Schema + scanner + migration | 1–9 |
| 2. API rewrite + adapter (incl. MCP App bundle) | 10–15 (incl. 14b) |
| 3. Manifest CRUD + CLI + MCP server | 16–25 |
| 4. Page-switcher UI | 26–32 |
| 5. Project export (flagged) | 33–37 |
| 6. Playwright baselines (incl. mcp-app.e2e snapshots) | 38 |
| 7. Skill update | 39–46 |

**Multi-surface scope** — three frontends consume the studio API and all change together: `apps/web/` (the studio UI), `apps/mcp-app/` (single-file canvas bundle embedded in Claude Desktop), and the MCP server's `WidgetState` payloads emitted from `apps/studio/src/mcp.ts`. Task 14 covers the studio web app; Task 14b covers the MCP App bundle; Task 25 covers the MCP server tool surface and the widget-state emission that drives the MCP App iframe.

Each task is 2–5 minutes of focused work. TDD throughout: failing test first, minimal implementation, passing test, commit at task boundaries unless a task explicitly defers to a later commit.

---

# Commit 1 — Schema + scanner + migration

The scanner must accept the new `seeflow.json` layout the moment we migrate fixtures. These tasks land atomically as one commit.

## Task 1: Add `SeeflowManifestSchema` to schema.ts

**Files:**
- Modify: `apps/studio/src/schema.ts` (append at end, before any re-exports)
- Test: `apps/studio/src/schema.test.ts`

**Step 1: Write the failing tests**

Add to `apps/studio/src/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SeeflowManifestSchema, FlowIdPattern } from './schema.ts';

describe('SeeflowManifestSchema', () => {
  it('accepts a minimal manifest with one flow', () => {
    const result = SeeflowManifestSchema.safeParse({
      version: 1,
      name: 'Order Pipeline',
      defaultFlow: 'main',
      flows: [{ id: 'main', name: 'Main' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts multiple flows with optional icon', () => {
    const result = SeeflowManifestSchema.safeParse({
      version: 1,
      name: 'Order Pipeline',
      defaultFlow: 'main',
      flows: [
        { id: 'main', name: 'Main' },
        { id: 'retry', name: 'Retry', icon: 'alert' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an id that starts with a non-lowercase character', () => {
    const result = SeeflowManifestSchema.safeParse({
      version: 1,
      name: 'X',
      defaultFlow: 'Main',
      flows: [{ id: 'Main', name: 'Main' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty flows array', () => {
    const result = SeeflowManifestSchema.safeParse({
      version: 1,
      name: 'X',
      defaultFlow: 'main',
      flows: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate flow ids', () => {
    const result = SeeflowManifestSchema.safeParse({
      version: 1,
      name: 'X',
      defaultFlow: 'main',
      flows: [
        { id: 'main', name: 'Main' },
        { id: 'main', name: 'Main 2' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a defaultFlow that does not exist in flows[]', () => {
    const result = SeeflowManifestSchema.safeParse({
      version: 1,
      name: 'X',
      defaultFlow: 'ghost',
      flows: [{ id: 'main', name: 'Main' }],
    });
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test apps/studio/src/schema.test.ts -t SeeflowManifestSchema`
Expected: 6 tests fail with `SeeflowManifestSchema is not defined`.

**Step 3: Implement the schema**

Append to `apps/studio/src/schema.ts`:

```ts
export const FlowIdPattern = /^[a-z0-9][a-z0-9-]*$/;

const FlowManifestEntrySchema = z.object({
  id: z.string().regex(FlowIdPattern, {
    message: 'flow id must match ^[a-z0-9][a-z0-9-]*$',
  }),
  name: z.string().min(1),
  icon: z.string().optional(),
});

export const SeeflowManifestSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
    description: z.string().optional(),
    defaultFlow: z.string(),
    flows: z.array(FlowManifestEntrySchema).min(1, {
      message: 'a project must declare at least one flow',
    }),
  })
  .refine(
    (m) => new Set(m.flows.map((f) => f.id)).size === m.flows.length,
    { message: 'flow ids must be unique within a project', path: ['flows'] },
  )
  .refine((m) => m.flows.some((f) => f.id === m.defaultFlow), {
    message: 'defaultFlow must reference an entry in flows[]',
    path: ['defaultFlow'],
  });

export type SeeflowManifest = z.infer<typeof SeeflowManifestSchema>;
```

**Step 4: Run tests to verify they pass**

Run: `bun test apps/studio/src/schema.test.ts -t SeeflowManifestSchema`
Expected: 6 tests pass.

**Step 5: Do not commit yet** — Commit 1 lands atomically after Task 9.

---

## Task 2: Extend `FlowEntry` shape in registry.ts

**Files:**
- Modify: `apps/studio/src/registry.ts` (`FlowEntry` interface + `RegisterInput`)
- Test: `apps/studio/src/registry.test.ts`

**Step 1: Write the failing test**

Append to `apps/studio/src/registry.test.ts`:

```ts
describe('FlowEntry shape', () => {
  it('exposes projectSlug, flowSlug, isDefault, and icon', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const entry = reg.upsert({
      name: 'Main',
      repoPath: '/tmp/order-pipeline',
      flowPath: 'flows/main/flow.json',
      projectSlug: 'order-pipeline',
      flowSlug: 'main',
      isDefault: true,
    });
    expect(entry.projectSlug).toBe('order-pipeline');
    expect(entry.flowSlug).toBe('main');
    expect(entry.isDefault).toBe(true);
  });
});
```

(`tmpRegistryPath` already exists in this file — reuse it.)

**Step 2: Run test to verify it fails**

Run: `bun test apps/studio/src/registry.test.ts -t 'FlowEntry shape'`
Expected: fails with type error or missing property.

**Step 3: Add fields**

In `apps/studio/src/registry.ts`, update:

```ts
export interface FlowEntry {
  id: string;
  slug: string;            // legacy single-id slug, kept for resolve() fallback
  projectSlug: string;
  flowSlug: string;
  name: string;
  description?: string;
  icon?: string;
  isDefault: boolean;
  repoPath: string;
  flowPath: string;
  lastModified: number;
  valid: boolean;
}

export interface RegisterInput {
  name: string;
  description?: string;
  icon?: string;
  projectSlug: string;
  flowSlug: string;
  isDefault: boolean;
  repoPath: string;
  flowPath: string;
  valid?: boolean;
  lastModified?: number;
}
```

In `upsert()`, replace the slug derivation with:
```ts
const slug = `${input.projectSlug}/${input.flowSlug}`; // canonical addressing
```

Carry `projectSlug`, `flowSlug`, `isDefault`, `icon` through both the create and update paths. Persist them too (`persist()` writes JSON; the new fields ride along).

**Step 4: Run tests**

Run: `bun test apps/studio/src/registry.test.ts`
Expected: all pass.

**Step 5: Defer commit.**

---

## Task 3: Add scanner module that reads `seeflow.json`

**Files:**
- Create: `apps/studio/src/project-scanner.ts`
- Create: `apps/studio/src/project-scanner.test.ts`

**Step 1: Write the failing test**

`apps/studio/src/project-scanner.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scanProject } from './project-scanner.ts';

const tmp = () => join(tmpdir(), 'seeflow-scan-' + randomBytes(4).toString('hex'));

describe('scanProject', () => {
  it('returns one entry per flow', () => {
    const root = tmp();
    mkdirSync(join(root, 'flows', 'main'), { recursive: true });
    mkdirSync(join(root, 'flows', 'retry'), { recursive: true });
    writeFileSync(
      join(root, 'seeflow.json'),
      JSON.stringify({
        version: 1,
        name: 'Order Pipeline',
        defaultFlow: 'main',
        flows: [
          { id: 'main', name: 'Main' },
          { id: 'retry', name: 'Retry' },
        ],
      }),
    );
    writeFileSync(join(root, 'flows', 'main', 'flow.json'), '{}');
    writeFileSync(join(root, 'flows', 'retry', 'flow.json'), '{}');

    const result = scanProject(root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.flows).toHaveLength(2);
    expect(result.flows[0].flowSlug).toBe('main');
    expect(result.flows[0].isDefault).toBe(true);
    expect(result.flows[1].flowSlug).toBe('retry');
    expect(result.flows[1].isDefault).toBe(false);
  });

  it('errors when seeflow.json is missing', () => {
    const root = tmp();
    mkdirSync(root, { recursive: true });
    const result = scanProject(root);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('manifest-missing');
  });

  it('errors when flow.json is at the project root', () => {
    const root = tmp();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'flow.json'), '{}');
    writeFileSync(
      join(root, 'seeflow.json'),
      JSON.stringify({ version: 1, name: 'X', defaultFlow: 'main', flows: [{ id: 'main', name: 'M' }] }),
    );
    const result = scanProject(root);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('legacy-root-flow');
  });

  it('errors when a declared flow folder is missing flow.json', () => {
    const root = tmp();
    mkdirSync(join(root, 'flows', 'main'), { recursive: true });
    writeFileSync(
      join(root, 'seeflow.json'),
      JSON.stringify({ version: 1, name: 'X', defaultFlow: 'main', flows: [{ id: 'main', name: 'M' }] }),
    );
    const result = scanProject(root);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('flow-json-missing');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test apps/studio/src/project-scanner.test.ts`
Expected: 4 tests fail (module not found).

**Step 3: Implement the scanner**

`apps/studio/src/project-scanner.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { SeeflowManifestSchema, type SeeflowManifest } from './schema.ts';
import { slugify } from './slugify.ts'; // create this small helper if missing — see Task 4

export type ScanError =
  | { kind: 'error'; code: 'manifest-missing'; repoPath: string }
  | { kind: 'error'; code: 'manifest-invalid'; repoPath: string; message: string }
  | { kind: 'error'; code: 'legacy-root-flow'; repoPath: string }
  | { kind: 'error'; code: 'flow-json-missing'; repoPath: string; flowId: string };

export interface ScannedFlow {
  flowSlug: string;
  name: string;
  description?: string;
  icon?: string;
  isDefault: boolean;
  flowPath: string; // relative: flows/<id>/flow.json
}

export type ScanResult =
  | { kind: 'ok'; projectSlug: string; manifest: SeeflowManifest; flows: ScannedFlow[] }
  | ScanError;

export function scanProject(repoPath: string): ScanResult {
  const manifestPath = join(repoPath, 'seeflow.json');
  if (!existsSync(manifestPath)) {
    return { kind: 'error', code: 'manifest-missing', repoPath };
  }
  if (existsSync(join(repoPath, 'flow.json'))) {
    return { kind: 'error', code: 'legacy-root-flow', repoPath };
  }
  let parsed: SeeflowManifest;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const result = SeeflowManifestSchema.safeParse(raw);
    if (!result.success) {
      return {
        kind: 'error',
        code: 'manifest-invalid',
        repoPath,
        message: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      };
    }
    parsed = result.data;
  } catch (err) {
    return { kind: 'error', code: 'manifest-invalid', repoPath, message: (err as Error).message };
  }

  const flows: ScannedFlow[] = [];
  for (const entry of parsed.flows) {
    const flowJsonPath = join(repoPath, 'flows', entry.id, 'flow.json');
    if (!existsSync(flowJsonPath)) {
      return { kind: 'error', code: 'flow-json-missing', repoPath, flowId: entry.id };
    }
    flows.push({
      flowSlug: entry.id,
      name: entry.name,
      icon: entry.icon,
      isDefault: entry.id === parsed.defaultFlow,
      flowPath: `flows/${entry.id}/flow.json`,
    });
  }

  return {
    kind: 'ok',
    projectSlug: slugify(parsed.name) || basename(repoPath),
    manifest: parsed,
    flows,
  };
}
```

**Step 4: Verify**

Run: `bun test apps/studio/src/project-scanner.test.ts`
Expected: 4 pass.

**Step 5: Defer commit.**

---

## Task 4: Extract `slugify` helper

**Files:**
- Create: `apps/studio/src/slugify.ts` (only if it doesn't already exist — grep first)
- Test: `apps/studio/src/slugify.test.ts`

**Step 1: Check for existing slugify**

Run: `grep -rn "function slugify\|export.*slugify" apps/studio/src/`

If it exists in `registry.ts`, **move** it to `slugify.ts` and re-export. If it doesn't exist (unlikely — registry uses one), the implementation below is the canonical form.

**Step 2: Write test**

`apps/studio/src/slugify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { slugify } from './slugify.ts';

describe('slugify', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugify('Order Pipeline')).toBe('order-pipeline');
  });
  it('strips repeated non-alphanumeric runs', () => {
    expect(slugify('Hello -- World!!')).toBe('hello-world');
  });
  it('trims leading/trailing dashes', () => {
    expect(slugify('  ---X---  ')).toBe('x');
  });
});
```

**Step 3: Implement**

`apps/studio/src/slugify.ts`:

```ts
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

**Step 4: Verify and replace duplicates**

Run: `bun test apps/studio/src/slugify.test.ts` (pass).
Grep for any other `slugify` definitions inside `apps/studio/src/` and replace with `import { slugify } from './slugify.ts';`.

**Step 5: Defer commit.**

---

## Task 5: Wire scanner into the registry's project loader

**Files:**
- Modify: `apps/studio/src/cli-ops.ts` (the function that scans a repo when `seeflow flows:register` is called) — search for `registerFlow` and any helper that reads `flow.json` from a repo
- Modify: `apps/studio/src/server.ts` (the `seedExample` call sequence in startup — uses `registerFlow` per example today)

**Step 1: Read existing registration flow**

Run: `grep -n "registerFlow\|flow.json" apps/studio/src/cli-ops.ts`

The current code reads `repoPath/flow.json` directly. We need it to call `scanProject(repoPath)` and register **one FlowEntry per scanned flow**.

**Step 2: Write the failing test**

In `apps/studio/src/cli-ops.test.ts` (create if missing — model after `apps/studio/src/registry.test.ts`):

```ts
it('registerProject() registers one FlowEntry per flow in seeflow.json', async () => {
  // build a tmp project with seeflow.json declaring 2 flows
  // call registerProject({ repoPath })
  // assert registry.list() returns 2 entries, both with the right projectSlug
});
```

**Step 3: Implement**

Replace `registerFlow` (single-flow scoped) with `registerProject` (returns the array of entries). Inside, call `scanProject(repoPath)`, error-out cleanly on `ScanError`, otherwise `registry.upsert()` once per scanned flow.

Keep the old `registerFlow` export as a thin alias that calls `registerProject` and returns the first entry, **only if** any caller still relies on it during this commit — then delete it in Commit 3.

**Step 4: Verify**

Run: `bun test apps/studio/src/cli-ops.test.ts apps/studio/src/registry.test.ts`
Expected: pass.

**Step 5: Defer commit.**

---

## Task 6: Migrate example `order-pipeline` to new layout

**Files:**
- Move: `apps/studio/examples/order-pipeline/flow.json` → `apps/studio/examples/order-pipeline/flows/main/flow.json`
- Move (if exists): `apps/studio/examples/order-pipeline/nodes/` → `apps/studio/examples/order-pipeline/flows/main/nodes/`
- Create: `apps/studio/examples/order-pipeline/seeflow.json`

**Step 1: Inspect**

Run: `find apps/studio/examples/order-pipeline -type f | sort` — list every file currently in the project so nothing is lost.

**Step 2: Move files**

```bash
cd apps/studio/examples/order-pipeline
mkdir -p flows/main
git mv flow.json flows/main/flow.json
[ -d nodes ] && git mv nodes flows/main/nodes
[ -d scripts ] && git mv scripts flows/main/scripts
# any other per-flow sidecars (style.json, detail.md, .tmp/, state/) move too
```

**Step 3: Write the manifest**

`apps/studio/examples/order-pipeline/seeflow.json`:

```json
{
  "version": 1,
  "name": "Order Pipeline",
  "defaultFlow": "main",
  "flows": [
    { "id": "main", "name": "Main" }
  ]
}
```

(Keep the name field consistent with the previous `flow.json#/name` so the project slug stays stable.)

**Step 4: Sanity-scan**

Add a one-off test or run an inline check: `bun -e "import('./apps/studio/src/project-scanner.ts').then(m => console.log(m.scanProject('apps/studio/examples/order-pipeline')))"`
Expected: `{ kind: 'ok', projectSlug: 'order-pipeline', flows: [{flowSlug: 'main', ...}] }`.

**Step 5: Defer commit.**

---

## Task 7: Migrate `component-showcase` example

Same procedure as Task 6, applied to `apps/studio/examples/component-showcase/`. Name in `seeflow.json` mirrors the current `flow.json#/name`.

---

## Task 8: Migrate `ecommerce-platform` example

Same procedure as Task 6, applied to `apps/studio/examples/ecommerce-platform/`.

---

## Task 9: Migrate `component-demo` e2e fixture + commit

**Files:**
- Move: `apps/studio/e2e/fixtures/component-demo/flow.json` → `…/component-demo/flows/main/flow.json`
- Move per-node sidecars under `flows/main/`
- Create: `…/component-demo/seeflow.json`

**Step 1: Move and create manifest** (same procedure).

**Step 2: Run the full suite**

Run in order:
```
bun run format
bun run lint
bun run typecheck
bun test
```
Expected: all green. Playwright tests will fail because UI doesn't know the new shape yet — they're addressed in Commits 4 and 6. If `bun test` includes the Playwright orchestrator, gate it out for now (`bun test --exclude apps/studio/e2e`).

**Step 3: Commit**

```bash
git add apps/studio/src/schema.ts apps/studio/src/schema.test.ts \
        apps/studio/src/registry.ts apps/studio/src/registry.test.ts \
        apps/studio/src/project-scanner.ts apps/studio/src/project-scanner.test.ts \
        apps/studio/src/slugify.ts apps/studio/src/slugify.test.ts \
        apps/studio/src/cli-ops.ts apps/studio/src/cli-ops.test.ts \
        apps/studio/examples/ apps/studio/e2e/fixtures/component-demo/
git commit -m "feat(scanner): seeflow.json manifest + flows/<id>/ layout

Add SeeflowManifestSchema, project-scanner module, and migrate all
example projects + e2e fixture to the new flows/<id>/flow.json layout.
Scanner emits one FlowEntry per flow with separate projectSlug/flowSlug
fields. flow.json at project root is now rejected outright.

Design: docs/plans/2026-05-26-multi-flow-projects-design.md"
```

Expected: clean working tree on `git status` afterward.

---

# Commit 2 — API rewrite + adapter

Every flow-scoped HTTP route moves under `/api/projects/:project/flows/:flow/…`. The canvas adapter takes `{project, flow}` instead of `{flowId}`. Old routes are deleted (pre-launch — no aliases).

## Task 10: Add a route-resolution helper

**Files:**
- Create: `apps/studio/src/route-resolve.ts`
- Create: `apps/studio/src/route-resolve.test.ts`

**Step 1: Test**

```ts
import { describe, expect, it } from 'vitest';
import { resolveProjectFlow } from './route-resolve.ts';

describe('resolveProjectFlow', () => {
  it('returns the flow entry for a project+flow slug pair', () => {
    const registry = makeFixtureRegistry([
      { projectSlug: 'order-pipeline', flowSlug: 'main' },
      { projectSlug: 'order-pipeline', flowSlug: 'retry' },
    ]);
    const result = resolveProjectFlow(registry, 'order-pipeline', 'retry');
    expect(result.kind).toBe('ok');
  });
  it('returns not-found when the project does not exist', () => {
    const registry = makeFixtureRegistry([]);
    const result = resolveProjectFlow(registry, 'ghost', 'main');
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('project-not-found');
  });
  it('returns flow-not-found when the project exists but the flow does not', () => {
    const registry = makeFixtureRegistry([{ projectSlug: 'order-pipeline', flowSlug: 'main' }]);
    const result = resolveProjectFlow(registry, 'order-pipeline', 'retry');
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.code).toBe('flow-not-found');
  });
});
```

**Step 2: Implement**

```ts
import type { FlowEntry, Registry } from './registry.ts';

export type Resolution =
  | { kind: 'ok'; entry: FlowEntry }
  | { kind: 'error'; code: 'project-not-found' | 'flow-not-found' };

export function resolveProjectFlow(
  registry: Registry,
  projectSlug: string,
  flowSlug: string,
): Resolution {
  const all = registry.list();
  const projectEntries = all.filter((e) => e.projectSlug === projectSlug);
  if (projectEntries.length === 0) return { kind: 'error', code: 'project-not-found' };
  const entry = projectEntries.find((e) => e.flowSlug === flowSlug);
  if (!entry) return { kind: 'error', code: 'flow-not-found' };
  return { kind: 'ok', entry };
}
```

**Step 3: Verify and defer commit.**

---

## Task 11: Rewrite flow-scoped GET routes

**Files:**
- Modify: `apps/studio/src/api.ts` (every `/flows/:id/...` handler, ~lines 501–1310)
- Modify: `apps/studio/src/api.test.ts` (every test that hits `/api/flows/:id/...`)

**Step 1: Replace route prefixes**

For each of the following handlers, change the path from `/flows/:id/…` to `/projects/:project/flows/:flow/…` and replace the `c.req.param('id')` lookup with:

```ts
const projectSlug = c.req.param('project');
const flowSlug = c.req.param('flow');
const resolution = resolveProjectFlow(registry, projectSlug, flowSlug);
if (resolution.kind !== 'ok') {
  return c.json({ ok: false, error: resolution.code }, 404);
}
const entry = resolution.entry;
```

Routes to migrate (use the line numbers as a guide — verify with grep):
- `GET /flows/:id` → `GET /projects/:project/flows/:flow`
- `GET /flows/:id/graph`
- `GET /flows/:id/nodes/:nodeId`
- `DELETE /flows/:id`
- `POST /flows/:id/layout`
- `POST /flows/:id/play/:nodeId`
- `POST /flows/:id/nodes/:nodeId/actions/:name`
- `POST /flows/:id/reset`
- `PATCH /flows/:id/nodes/:nodeId/position`
- `PATCH /flows/:id/nodes/:nodeId/order`
- `PATCH /flows/:id/nodes/:nodeId`
- `POST /flows/:id/nodes`
- `POST /flows/:id/bulk`
- `DELETE /flows/:id/nodes/:nodeId`
- `PATCH /flows/:id/connectors/:connId`
- `POST /flows/:id/connectors`
- `DELETE /flows/:id/connectors/:connId`

`GET /flows` (list) stays at `/flows` for now — Task 16 introduces the project-scoped listing.

**Step 2: Update every related test in api.test.ts**

Search-and-replace `/flows/${flowId}` → `/projects/${projectSlug}/flows/${flowSlug}`. Fixture factories need both fields — extend the test helper accordingly.

**Step 3: Run**

`bun test apps/studio/src/api.test.ts` — Expected: pass.

**Step 4: Defer commit.**

---

## Task 12: Rewrite asset/upload routes

**Files:**
- Modify: `apps/studio/src/api.ts`

**Routes to move:**
- `GET /projects/:id/files/:path{.+}` → `GET /projects/:project/files/:path{.+}` (project-scoped — shared across flows)
- `POST /projects/:id/files/open` → `POST /projects/:project/files/open`
- `POST /projects/:id/files/reveal` → `POST /projects/:project/files/reveal`
- `POST /projects/:id/nodes/:nodeId/files/upload` → `POST /projects/:project/flows/:flow/nodes/:nodeId/files/upload` (flow-scoped — new path)

**Path resolution change:** the upload handler resolves the on-disk target. Update from `<repoPath>/nodes/<nodeId>/<filename>` to `<repoPath>/<dirname(entry.flowPath)>/nodes/<nodeId>/<filename>` (i.e. `<repoPath>/flows/<flow>/nodes/<nodeId>/<filename>`). Use `dirname(entry.flowPath)` rather than rebuilding the path to keep the entry as source of truth.

**Cascade delete:** when `DELETE /projects/:project/flows/:flow/nodes/:nodeId` cleans up node sidecars, anchor that path under `<repoPath>/<dirname(entry.flowPath)>/nodes/<nodeId>/` as well. Search for the existing `rm` or `rmSync` call in the node-delete handler.

**Tests:** mirror the new paths in `api.test.ts` and `node-files.test.ts`.

Defer commit.

---

## Task 13: Update REST adapter to take `{project, flow}`

**Files:**
- Modify: `packages/canvas/src/adapter/rest.ts`
- Modify: `packages/canvas/src/adapter/rest.test.ts`

**Step 1: Update test**

In `rest.test.ts`, find the factory that constructs `createRestAdapter({ baseUrl, flowId })` and change to `createRestAdapter({ baseUrl, project, flow })`. Failing tests pinpoint every URL that needs updating.

**Step 2: Update types**

```ts
export interface RestAdapterOptions {
  baseUrl: string;
  project: string;
  flow: string;
  // ...rest unchanged (fetchImpl, etc.)
}
```

Delete the `flowId` field. Inside the adapter, replace `flowId` references with `${project}/flows/${flow}` segments:

```ts
const demoBase = `${baseUrl}/api/projects/${encodeURIComponent(project)}/flows/${encodeURIComponent(flow)}`;
// asset URLs:
const filesBase = `${baseUrl}/api/projects/${encodeURIComponent(project)}/files`;
// upload URL:
`${baseUrl}/api/projects/${encodeURIComponent(project)}/flows/${encodeURIComponent(flow)}/nodes/${encodeURIComponent(nodeId)}/files/upload`
```

**Step 3: Run tests**

`bun test packages/canvas/src/adapter/rest.test.ts` — expected pass.

**Step 4: Defer commit.**

---

## Task 14: Update `apps/web/` to construct the adapter with `{project, flow}`

**Files:**
- Modify: `apps/web/src/pages/demo-view.tsx` (around line 387)
- Modify: `apps/web/src/lib/api.ts` (search for any `flowId` URL builders — fetchFlowDetail, etc.)
- Modify: `apps/web/src/hooks/*` (any hook that builds `/api/flows/...` URLs)
- Modify: any test under `apps/web/src/**/*.test.{ts,tsx}` that mocks these URLs

**Step 1: Identify URL builders**

Run: `grep -rn "/api/flows\|/api/projects" apps/web/src/`

Every match needs the new shape.

**Step 2: Routing**

The URL today is presumably `/d/<slug>` or `/flow/<flowId>`. Change to `/projects/<project>/flows/<flow>`. Update React Router routes (likely in `App.tsx`) and the `useParams` extraction.

**Step 3: Adapter construction**

```ts
const project = useParams().project;
const flow = useParams().flow;
const adapter = useMemo(
  () => (project && flow ? createRestAdapter({ baseUrl: '', project, flow }) : null),
  [project, flow],
);
```

**Step 4: Run the web tests**

`bun test apps/web/src` — expected pass.

**Step 5: Defer commit.**

---

## Task 14b: Update the MCP App (`apps/mcp-app/`) — the *other* adapter consumer

`apps/mcp-app/` is a separate Vite single-file bundle that mounts the SeeFlow canvas inside Claude Desktop's MCP-Apps host iframe. The studio serves the built `dist/index.html` as the `ui://seeflow/canvas` resource (see `apps/studio/src/mcp-ui.ts`). It uses the same `createRestAdapter` and hits `/api/flows/…` directly — every flowId code path needs the same treatment as `apps/web/`.

**Files:**
- Modify: `apps/mcp-app/src/App.tsx` (flow resolution + adapter construction, lines ~120–225)
- Modify: `apps/mcp-app/src/bridge.ts` (`WidgetState` type)
- Modify: `apps/mcp-app/CLAUDE.md` (the "Mounting the canvas" paragraph still describes `GET /api/flows` → find by slug → `GET /api/flows/:id`)
- Modify: `apps/studio/src/mcp-ui.ts` (`CanvasWidgetState` type — kept in sync with `bridge.ts`'s `WidgetState`)
- Test: `apps/mcp-app/src/bridge.test.ts`, `apps/mcp-app/src/canvas-bridge.test.ts`

**Step 1: Make `projectSlug` required in `WidgetState`**

In `apps/mcp-app/src/bridge.ts`:

```ts
export type WidgetState =
  | { kind: 'navigate'; projectSlug: string; flowSlug: string; nodeId?: string }
  | { kind: 'create'; projectSlug?: string };
```

Mirror the same change in `apps/studio/src/mcp-ui.ts`'s `CanvasWidgetState`. The two types are explicitly kept in sync — the comment on `mcp-ui.ts:38` says so.

**Step 2: Update flow resolution in App.tsx**

Today (`apps/mcp-app/src/App.tsx:131`):

```ts
const flows = await fetchJson<FlowsIndexEntry[]>(`${backendUrl}/api/flows`, headers);
const match = flows.find((f) => f.slug === widgetState.flowSlug);
const resolved = await fetchJson(`${backendUrl}/api/flows/${match.id}`, headers);
```

Replace with:

```ts
const resolved = await fetchJson(
  `${backendUrl}/api/projects/${encodeURIComponent(widgetState.projectSlug)}/flows/${encodeURIComponent(widgetState.flowSlug)}`,
  headers,
);
```

(No more index-then-lookup — we have both slugs directly.)

**Step 3: Update adapter construction**

```ts
const base = createRestAdapter({
  baseUrl: backendUrl,
  project: widgetState.projectSlug,
  flow: widgetState.flowSlug,
});
```

The `projectId={load.flowId}` prop on `<SeeflowCanvas>` (line 221) becomes `projectId={`${project}/${flow}`}` or whatever the canvas component now expects — verify with the type.

**Step 4: Update `apps/mcp-app/CLAUDE.md`**

In the "Mounting the canvas" paragraph, replace:

> The Studio HTTP API has no slug → id shortcut: do `GET /api/flows` → find by slug → `GET /api/flows/:id` for the merged flow.

with:

> The Studio HTTP API takes the slugs directly: `GET /api/projects/:project/flows/:flow` returns the merged flow.

**Step 5: Run tests + rebuild the single-file bundle**

```bash
bun test apps/mcp-app
bun run --filter @seeflow/mcp-app build
```

The build is required because `apps/studio/src/mcp-ui.ts` reads `apps/mcp-app/dist/index.html` at runtime. Commit the rebuilt `dist/index.html` IF the repo currently checks it in (search: `git log --diff-filter=A -- apps/mcp-app/dist/index.html`). Otherwise the production build pipeline regenerates it.

**Step 6: Defer commit.**

---

## Task 15: Commit Commit 2

```bash
bun run format && bun run lint && bun run typecheck && bun test
```

If green:

```bash
git add apps/studio/src/api.ts apps/studio/src/api.test.ts \
        apps/studio/src/route-resolve.ts apps/studio/src/route-resolve.test.ts \
        apps/studio/src/node-files.ts apps/studio/src/node-files.test.ts \
        packages/canvas/src/adapter/ \
        apps/web/src/
git commit -m "feat(api): move flow-scoped routes under /api/projects/:project/flows/:flow

All flow-scoped HTTP endpoints rehoused under the new project+flow
hierarchy; old /api/flows/:flowId/... routes deleted. Canvas adapter
takes { project, flow } instead of { flowId } and rebinds on switch.
Asset uploads resolve under flows/<flow>/nodes/<id>/.

Design: docs/plans/2026-05-26-multi-flow-projects-design.md"
```

---

# Commit 3 — Manifest CRUD + CLI + MCP

## Task 16: `GET /api/projects` listing + `GET /api/projects/:project` metadata

**Files:**
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/api.test.ts`

**Step 1: Failing tests**

```ts
describe('GET /api/projects', () => {
  it('lists distinct projects from the registry', async () => {
    // arrange registry with 3 flows across 2 projects
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects.map((p) => p.projectSlug).sort()).toEqual(['ecommerce', 'order-pipeline']);
  });
});

describe('GET /api/projects/:project', () => {
  it('returns project metadata and flow list', async () => {
    const res = await request(app).get('/api/projects/order-pipeline');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Order Pipeline');
    expect(body.flows).toHaveLength(2);
  });
});
```

**Step 2: Implement** — read the manifest at `<repoPath>/seeflow.json` and the registry entries; merge.

**Step 3: Verify and defer commit.**

---

## Task 17: `GET /api/projects/:project/flows` listing

**Files:**
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/api.test.ts`

**Step 1: Test**

```ts
it('GET /api/projects/:project/flows returns flow entries scoped to one project', async () => {
  const res = await request(app).get('/api/projects/order-pipeline/flows');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.flows).toHaveLength(2);
  expect(body.flows[0]).toMatchObject({ flowSlug: 'main', isDefault: true });
});
```

**Step 2: Implement** — filter `registry.list()` by `projectSlug`.

Defer commit.

---

## Task 18: `POST /api/projects/:project/flows` (create flow)

**Files:**
- Modify: `apps/studio/src/api.ts`, `apps/studio/src/cli-manifest.ts` (helper to mutate `seeflow.json`)
- Test: `apps/studio/src/api.test.ts`

**Step 1: Test**

```ts
it('POST /api/projects/:project/flows creates a flow folder + flow.json + appends to manifest', async () => {
  const res = await request(app)
    .post('/api/projects/order-pipeline/flows')
    .send({ id: 'happy-path', name: 'Happy Path' });
  expect(res.status).toBe(201);
  // assert file system: seeflow.json now contains the entry, flows/happy-path/flow.json exists
});
```

**Step 2: Implement**

The handler:
1. Resolves the project (404 if missing).
2. Validates `{id, name, icon?}` body against a Zod inline schema. `id` matches `FlowIdPattern`. Reject duplicates.
3. Atomically writes `flows/<id>/flow.json` (an empty `{ version, name, nodes: [], connectors: [] }` envelope).
4. Appends to `seeflow.json` via `atomic-write.ts`.
5. Re-scans the project + reconciles into the registry (or call `registry.upsert()` directly with the new entry).

Returns `201` with the new FlowEntry.

**Step 3: Verify and defer commit.**

---

## Task 19: `PATCH /api/projects/:project/flows/:flow` (rename)

**Files:**
- Modify: `apps/studio/src/api.ts`
- Test: `apps/studio/src/api.test.ts`

**Step 1: Test**

```ts
it('PATCH rename: changing id moves the folder and edits seeflow.json atomically', async () => {
  const res = await request(app)
    .patch('/api/projects/order-pipeline/flows/retry')
    .send({ id: 'retry-v2', name: 'Retry v2' });
  expect(res.status).toBe(200);
  // assert: flows/retry-v2/ exists; flows/retry/ does not; manifest reflects new id
});
it('PATCH name-only does not move the folder', async () => { /* ... */ });
```

**Step 2: Implement**

Body shape: `{ id?, name?, icon? }`. Validate the new `id` if provided (pattern + non-collision). Sequence:
1. Read current manifest.
2. Build new manifest entry.
3. If `id` is changing: `fs.renameSync(oldFolder, newFolder)` first.
4. Write the new manifest atomically.
5. If folder rename succeeded but manifest write failed, roll back the folder rename (try/catch).
6. Update the registry entry.

Defer commit.

---

## Task 20: `DELETE /api/projects/:project/flows/:flow`

**Files:**
- Modify: `apps/studio/src/api.ts`
- Test: `apps/studio/src/api.test.ts`

**Step 1: Test**

```ts
it('DELETE removes the flow folder and the manifest entry', async () => { /* ... */ });
it('DELETE refuses when target is the only flow', async () => { /* expect 409 */ });
it('DELETE refuses when target is the defaultFlow and no replacement is provided', async () => {
  // expect 409 with code "default-flow-no-replacement"
});
it('DELETE accepts ?newDefault=<other-flow> when removing the default flow', async () => { /* ... */ });
```

**Step 2: Implement** — guards as above; cascade-deletes the `flows/<id>/` folder.

Defer commit.

---

## Task 21: Update `projects:create` CLI to write `seeflow.json` + first flow

**Files:**
- Modify: `apps/studio/src/cli.ts` (the `projects:create` handler) and the underlying `cli-manifest.ts` / `cli-ops.ts` function it calls.
- Test: `apps/studio/src/cli.test.ts`

**Step 1: Test**

```ts
it('projects:create writes seeflow.json with one flow named "main"', async () => {
  const dir = tmp();
  await runCli(['projects:create', '--path', dir, '--name', 'Order Pipeline']);
  expect(readFileSync(join(dir, 'seeflow.json'), 'utf-8')).toContain('"defaultFlow": "main"');
  expect(existsSync(join(dir, 'flows', 'main', 'flow.json'))).toBe(true);
});
```

**Step 2: Implement**

Replace the existing logic that writes `flow.json` at the project root with logic that:
1. Creates `seeflow.json` with `{ version: 1, name, defaultFlow: 'main', flows: [{ id: 'main', name: 'Main' }] }`.
2. Creates `flows/main/flow.json` envelope.
3. Calls `registerProject(repoPath)` (Task 5).

Defer commit.

---

## Task 22: Add `flows:create` CLI verb

**Files:**
- Modify: `apps/studio/src/cli.ts` (dispatch + handler)
- Modify: `apps/studio/src/cli.test.ts`

**Step 1: Test**

```ts
it('flows:create appends a flow to an existing project', async () => {
  // seed a project via projects:create
  await runCli(['flows:create', '--project', 'order-pipeline', '--flow', 'retry', '--name', 'Retry']);
  // assert manifest now has 2 flows, flows/retry/flow.json exists
});
```

**Step 2: Implement**

The handler:
1. Parses `--project --flow --name [--icon]`.
2. POSTs to `${$STUDIO_URL}/api/projects/${project}/flows` with `{id: flow, name, icon}`.
3. Prints JSON response.

Defer commit.

---

## Task 23: Add `flows:rename` + `flows:delete` CLI verbs

Mirror Task 22 for `PATCH` and `DELETE`. Test cases mirror Tasks 19 and 20. Defer commit.

---

## Task 24: Add `--project --flow` flags to every flow-scoped CLI verb

**Files:**
- Modify: `apps/studio/src/cli.ts` (every handler under `flows:*`, `nodes:*`, `connectors:*`, `flow:add-bulk`, `e2e`)
- Modify: `apps/studio/src/cli-helpers.ts` (introduce a `parseProjectFlow(argv)` helper)
- Update `apps/studio/src/cli.ts` `help` block — replace `<id>` synopsis with `--project <p> --flow <f>` everywhere.

**Step 1: Helper test**

```ts
it('parseProjectFlow extracts --project and --flow, erroring if either is missing', () => {
  expect(() => parseProjectFlow(['--project', 'x'])).toThrow(/--flow/);
});
```

**Step 2: Implement** — straightforward argv walker.

**Step 3: Update every handler**

Each handler that previously did `const id = positional[0]` now does:
```ts
const { project, flow } = parseProjectFlow(argv);
```
…and the downstream HTTP call uses the new nested URL.

**Step 4: Update CLI help text** (`apps/studio/src/cli.ts` line ~189 onward).

**Step 5: Run `bun test apps/studio/src/cli.test.ts`** — expected pass.

Defer commit.

---

## Task 25: Update MCP server (`mcp.ts` + `mcp-shim.ts`) with `{project, flow}` arg pairs

**Files:**
- Modify: `apps/studio/src/mcp.ts` (the tool definitions — ~600+ lines; this is the bulk of the change)
- Modify: `apps/studio/src/mcp-shim.ts`, `apps/studio/src/mcp-shim.test.ts`
- Modify: `apps/studio/src/mcp-parity.test.ts`
- Modify: `apps/studio/src/mcp-ui.test.ts` (widget-state assertions — see below)

**Step 1: Read existing tool definitions**

Run: `grep -n "flowId\|tool\|inputSchema" apps/studio/src/mcp.ts | head -80`

The current shape: every flow-scoped tool takes `{ flowId: string }`. The helper `requireFlowId` (`mcp.ts:130`) validates it. Several composite input schemas (`mcp.ts:141`, `:151`, `:163`, `:194`, `:204`, `:213`, `:218`) extend `{ flowId, nodeId, ... }`.

**Step 2: Rewrite the input schemas**

Replace every `flowId: z.string().min(1)` (and corresponding JSON Schema shape on `mcp.ts:120–138`) with:

```ts
project: z.string().min(1),
flow: z.string().min(1),
```

And the JSON Schema equivalent:
```ts
properties: {
  project: { type: 'string', minLength: 1, description: 'Project slug (folder name under .seeflow/)' },
  flow:    { type: 'string', minLength: 1, description: 'Flow id within the project (matches seeflow.json#/flows[].id)' },
},
required: ['project', 'flow'],
```

Each field gets its own `description` — separate descriptions are how the model picks the right slot.

Update `requireFlowId` → `requireProjectFlow` returning `{ project, flow } | { error }`.

**Step 3: Update every tool handler**

Each handler currently calls something like `ops.getFlow(v.flowId)`. After this commit, those ops take `(project, flow)` instead — the underlying cli-ops functions changed in Tasks 11–12. Pass both fields through.

**Step 4: Update widget-state emission**

`canvasMetaFor` (`mcp.ts:70`) currently emits `{ kind: 'navigate', flowSlug: ... }`. The call sites at `mcp.ts:373`, `:396`, `:440-441`, `:473` all need to also pass `projectSlug` — pull it from the resolved `FlowEntry`:

```ts
const entry = ctx.registry.resolve(/* now project + flow */);
const meta = canvasMetaFor(ctx, {
  kind: 'navigate',
  projectSlug: entry.projectSlug,
  flowSlug: entry.flowSlug,
  nodeId,
});
```

This makes `WidgetState` self-sufficient for the iframe (no more `/api/flows` index lookup, per Task 14b).

**Step 5: Verify `mcp-parity` + `mcp-ui` tests**

`mcp-parity.test.ts` cross-checks the MCP tool surface against the CLI. Ensure both report the new `{project, flow}` shape.

`mcp-ui.test.ts` asserts the `_meta` payload shape — update fixtures to include `projectSlug`.

**Step 6: Commit Commit 3**

```bash
bun run format && bun run lint && bun run typecheck && bun test

git add apps/studio/src/ packages/canvas/
git commit -m "feat(cli,api,mcp): explicit --project --flow addressing

CRUD HTTP endpoints (POST/PATCH/DELETE) for flows within a project.
projects:create now writes seeflow.json + flows/main/flow.json.
flows:create / flows:rename / flows:delete CLI verbs. Every
flow-scoped CLI and MCP tool takes --project + --flow as separate
required args.

Design: docs/plans/2026-05-26-multi-flow-projects-design.md"
```

---

# Commit 4 — Page-switcher UI

## Task 26: URL routing `/projects/<project>/flows/<flow>`

**Files:**
- Modify: `apps/web/src/App.tsx` (router config)
- Modify: `apps/web/src/pages/demo-view.tsx`

**Step 1: Test**

Add a route test using React Router's test utilities (search for existing examples in `apps/web/src/`).

**Step 2: Update routes**

```tsx
<Route path="/projects/:project/flows/:flow" element={<DemoView />} />
<Route path="/projects/:project" element={<ProjectIndex />} /> // redirects to defaultFlow
```

Replace any old `/d/:slug` or `/flow/:flowId` routes. Keep a one-line 404 page; pre-launch we don't need redirects.

**Step 3: Verify and defer commit.**

---

## Task 27: Flow-switcher popover component skeleton

**Files:**
- Create: `apps/web/src/components/flow-switcher.tsx`
- Create: `apps/web/src/components/flow-switcher.test.tsx`

**Step 1: Test the rendering contract**

```tsx
it('renders one row per flow with active state on the current flow', () => {
  render(<FlowSwitcher project="order-pipeline" activeFlow="retry" flows={fixtureFlows} />);
  expect(screen.getByRole('option', { name: 'Retry' })).toHaveAttribute('aria-current', 'true');
});
it('shows a "+ New flow" footer button', () => {
  render(<FlowSwitcher project="order-pipeline" activeFlow="main" flows={fixtureFlows} />);
  expect(screen.getByTestId('flow-switcher-create')).toBeInTheDocument();
});
```

**Step 2: Implement**

Pattern: mirror `apps/web/src/components/project-switcher.tsx` (already 226 lines — read it first). Same popover primitive, same data-testid conventions (`flow-switcher-trigger`, `flow-switcher-popover`, `flow-switcher-create`, `flow-switcher-rename`, `flow-switcher-delete`).

Use tokens from `design/design.html`. Do NOT introduce new colors / spacing.

**Step 3: Verify and defer commit.**

---

## Task 28: Wire flow switcher to `GET /api/projects/:project/flows`

**Files:**
- Modify: `apps/web/src/components/flow-switcher.tsx`
- Modify: `apps/web/src/lib/api.ts` (add `fetchProjectFlows(project)`)
- Modify: `apps/web/src/hooks/use-project-flows.ts` (create — small SWR/React Query-style fetch hook; check what pattern other hooks use)

**Step 1: Test the hook contract** with a mocked `fetch`.
**Step 2: Implement.**
**Step 3: Defer commit.**

---

## Task 29: Wire "+ New flow" + rename + delete actions

**Files:**
- Modify: `apps/web/src/components/flow-switcher.tsx`
- Create: `apps/web/src/components/flow-create-dialog.tsx` (mirror `create-project-dialog.tsx`)
- Modify: `apps/web/src/hooks/use-project-flows.ts` (mutation helpers — POST/PATCH/DELETE)
- Test files alongside.

Each mutation calls the corresponding endpoint from Tasks 18–20 and invalidates the local cache.

Defer commit.

---

## Task 30: `localStorage` last-opened flow per project

**Files:**
- Modify: `apps/web/src/pages/demo-view.tsx` or wherever the redirect from `/projects/:project` happens
- Test: `apps/web/src/pages/demo-view.test.tsx` (or component-level)

Key shape: `seeflow:last-flow:<project> = <flowSlug>`. Fallback order: URL → localStorage → manifest `defaultFlow`.

Defer commit.

---

## Task 31: Canvas remount on flow switch

**Files:**
- Modify: `apps/web/src/pages/demo-view.tsx`

The adapter is already a `useMemo([project, flow])` from Task 14. Add a `key={`${project}/${flow}`}` to the React Flow root so internal state resets cleanly on switch. Cover with a quick test that asserts the canvas's `data-flow-key` (or similar) updates after navigation.

Defer commit.

---

## Task 32: Update Playwright e2e tests for the popover + commit

**Files:**
- Modify: `apps/studio/e2e/multi-flow.spec.ts` (create)
- Modify: existing e2e specs whose URLs changed

Write one Playwright spec that:
1. Boots the studio (existing fixtures handle this).
2. Navigates to `/projects/component-demo/flows/main`.
3. Opens the flow switcher, clicks "+ New flow", names it "Retry", asserts the URL becomes `/projects/component-demo/flows/retry`.
4. Renames it, deletes it, asserts the switcher updates.

Update any existing spec that used the old URL shape. Don't worry about pixel baselines here — Commit 6 regenerates them.

Run: `bun run test:it:e2e` (routes through Docker on macOS — Docker Desktop must be up).

Commit:
```bash
bun run format && bun run lint && bun run typecheck && bun test
git add apps/web/ apps/studio/e2e/
git commit -m "feat(web): figma-style flow switcher with full CRUD

Page-switcher popover anchored top-left lists flows in the active
project, with create/rename/delete actions wired to the new manifest
CRUD endpoints. URL routing: /projects/<project>/flows/<flow>.
Last-opened flow per project persisted in localStorage.

Design: docs/plans/2026-05-26-multi-flow-projects-design.md"
```

---

# Commit 5 — Project export (studio side, flagged)

Requires sibling PR in `seeflow-viewer` repo. Code lands behind a Vite env flag.

## Task 33: Feature flag plumbing

**Files:**
- Modify: `apps/web/vite-env.d.ts` (add `VITE_SEEFLOW_PROJECT_EXPORT?: string`)
- Create: `apps/web/src/lib/feature-flags.ts` (export `IS_PROJECT_EXPORT_ENABLED = import.meta.env.VITE_SEEFLOW_PROJECT_EXPORT === '1'`)

No test for the flag itself; tests inject the value where needed.

Defer commit.

---

## Task 34: Bundle builder for the new zip shape

**Files:**
- Create: `apps/web/src/lib/build-project-bundle.ts`
- Create: `apps/web/src/lib/build-project-bundle.test.ts`

**Step 1: Test**

```ts
it('build-project-bundle produces seeflow.json + flows/<id>/flow.json for every flow', async () => {
  const zip = await buildProjectBundle({
    project: fixtureProject,
    flows: [fixtureFlow('main'), fixtureFlow('retry')],
  });
  const unzipped = unzipSync(zip);
  expect(Object.keys(unzipped).sort()).toEqual([
    'flows/main/flow.json',
    'flows/retry/flow.json',
    'seeflow.json',
  ]);
});
```

**Step 2: Implement** — `fflate.zipSync` over the entries. For image-node files, fetch `${baseUrl}/api/projects/${project}/files/${path}` and emit at `flows/${flowSlug}/files/${path}`.

Defer commit.

---

## Task 35: New export hook + dialog copy

**Files:**
- Modify: `apps/web/src/hooks/use-export-to-cloud.ts`
- Modify: `apps/web/src/components/export-dialog.tsx`

Behind the flag:
- Dialog title: "Export project to seeflow.dev"
- Hook: builds the project bundle, POSTs to `https://seeflow.dev/api/projects` (env-overridable for testing).
- Result URL: `seeflow.dev/project/<uuid>`.

When flag is off: existing single-flow export keeps working unchanged.

Tests cover both branches.

Defer commit.

---

## Task 36: Cloud-side coordination check

**Manual step** — verify the `seeflow-viewer` sibling PR has:
- `POST /api/projects` accepting the new bundle.
- `GET /project/<uuid>` rendering the viewer with a switcher.

Document the sibling PR URL in the commit message. If sibling isn't ready, the flag stays off — that's the point.

---

## Task 37: Commit Commit 5

```bash
bun run format && bun run lint && bun run typecheck && bun test
git add apps/web/
git commit -m "feat(web): multi-flow project export (behind VITE_SEEFLOW_PROJECT_EXPORT)

Bundle the whole project (seeflow.json + flows/<id>/...) and POST to
seeflow.dev/api/projects. Old single-flow export remains the default
until the seeflow-viewer cloud PR ships and the flag flips on.

Sibling PR: <link>
Design: docs/plans/2026-05-26-multi-flow-projects-design.md"
```

---

# Commit 6 — Playwright baselines

## Task 38: Regenerate visual snapshots

**Step 1: Ensure Docker Desktop is running** (macOS host).

**Step 2: Rebuild the MCP App bundle first**

```bash
bun run --filter @seeflow/mcp-app build
```

Required because `apps/studio/e2e/mcp-app.e2e.ts-snapshots/` covers the MCP App scenario — Playwright loads the freshly built `apps/mcp-app/dist/index.html`. Stale bundle = bogus snapshot diff.

**Step 3: Regenerate**

```bash
bun run test:it:update-snapshots
```

This produces fresh `*-chromium-linux.png` files under `apps/studio/e2e/__snapshots__/` and `apps/studio/e2e/mcp-app.e2e.ts-snapshots/`.

**Step 3: Sanity-diff**

Run: `git status apps/studio/e2e/__snapshots__/` — only `*-chromium-linux.png` files should appear. If you see `*-darwin.png` or other host suffixes, **delete them** before committing. They will cause CI mismatches.

**Step 4: Commit**

```bash
git add apps/studio/e2e/__snapshots__/
git commit -m "test(e2e): regenerate visual baselines for multi-flow UI

UI surfaces affected: flow switcher popover, export dialog copy,
URL routing. All baselines regenerated under chromium-linux per
the CLAUDE.md convention.

Design: docs/plans/2026-05-26-multi-flow-projects-design.md"
```

---

# Commit 7 — Skill update

The `/seeflow` and `/seeflow-lookup` skills encode the old `<host>/.seeflow/<flow-name>/flow.json` layout in prose. Update every reference.

## Task 39: Update `skills/seeflow/SKILL.md`

**File:** `skills/seeflow/SKILL.md`

Sections to rewrite (read the file end-to-end before edits — it's tightly written):

1. **Project layout convention** (currently L20–34): replace tree diagram with:
   ```
   <host>/
     .seeflow/
       LEARN.md                       ← shared across projects + flows
       <project-name>/
         seeflow.json
         flows/
           <flow-id>/
             flow.json
             style.json
             nodes/<id>/
             .tmp/
             state/
   ```
2. **Conventions table**: add rows `$projectSlug` and `$flowSlug` (default `main`). Update `$SEEFLOW_TMP` to `$repoPath/flows/$flowSlug/.tmp/`.
3. **Inputs section**: replace `<project>/flow.json` references with `<project>/flows/<flowSlug>/flow.json`. `$repoPath` is still the project root.
4. **Pipeline P3 description**: note that `projects:create` writes the manifest + first flow.

Defer commit until Task 46.

---

## Task 40: Update `skills/seeflow/references/cli.md`

**File:** `skills/seeflow/references/cli.md`

Every command example gains `--project $projectSlug --flow $flowSlug`. Add the new verbs at the bottom:

```
flows:create   --project <p> --flow <id> --name <n> [--icon <i>]
flows:rename   --project <p> --flow <id> [--new-id <x>] [--name <n>]
flows:delete   --project <p> --flow <id>
projects:list
```

Defer commit.

---

## Task 41: Update `skills/seeflow/references/schema.md`

**File:** `skills/seeflow/references/schema.md`

Per-node sidecar paths re-anchored at `<repoPath>/flows/<flowSlug>/nodes/<id>/`. Action `scriptPath` examples unchanged shape (still `scripts/play.ts`) but file location is now under `flows/<flowSlug>/nodes/<id>/scripts/`.

Defer commit.

---

## Task 42: Update `skills/seeflow/references/phases/p3-scaffold.md`

**File:** `skills/seeflow/references/phases/p3-scaffold.md`

Key changes:
1. `projects:create` now writes `seeflow.json` + `flows/main/flow.json` — note in the "what this command does" section.
2. Subsequent CLI calls (`flow:add-bulk`, `nodes:patch`, `flows:layout`) gain `--project --flow`.
3. New no-fallback rule: if a `flow.json` is discovered at project root, abort and surface a migration message rather than registering it.

Defer commit.

---

## Task 43: Update `skills/seeflow/references/phases/p5-patch-overlays.md` + `p6-validation.md`

**Files:**
- `skills/seeflow/references/phases/p5-patch-overlays.md`
- `skills/seeflow/references/phases/p6-validation.md`

Every CLI invocation example gains `--project --flow`. The `e2e` command in P6 picks up the new flags.

Defer commit.

---

## Task 44: Update sub-agent prompts

**Files:**
- `skills/seeflow/agents/seeflow-code-analyzer.md`
- `skills/seeflow/agents/seeflow-node-planner.md`
- `skills/seeflow/agents/seeflow-play-designer.md`
- `skills/seeflow/agents/seeflow-status-designer.md`
- `skills/seeflow/agents/seeflow-system-analyzer.md` (if it exists)

Each prompt: re-anchor any file path it constructs at `flows/<flowSlug>/nodes/<id>/`. Update CLI example invocations.

Defer commit.

---

## Task 45: Update `skills/seeflow-lookup/SKILL.md`

**File:** `skills/seeflow-lookup/SKILL.md`

Changes:
- Canvas URL pattern at L31 (`$STUDIO_URL/d/<slug>`) → update to `$STUDIO_URL/projects/<projectSlug>/flows/<flowSlug>` (or whatever short-link form `apps/web/` ships in Task 26).
- Add a one-liner under "First step" about project + flow tier matching.

Defer commit.

---

## Task 46: Skill test fixtures + commit

**Files:**
- `skills/seeflow/test/` (audit every fixture file — search for `flow.json` paths)
- `skills/seeflow-lookup/test/` (likewise)

Update any fixture that hard-codes the old layout. If snapshots exist, regenerate (`bun test skills/...` — depends on what the skill tests look like; they're hand-rolled).

```bash
git add skills/
git commit -m "skill(seeflow): align with multi-flow projects layout

Update /seeflow and /seeflow-lookup to reflect the new manifest-driven
multi-flow layout: seeflow.json + flows/<flow-id>/flow.json, every
CLI invocation gains --project + --flow, sub-agent prompts re-anchor
file paths under flows/<flowSlug>/.

Design: docs/plans/2026-05-26-multi-flow-projects-design.md"
```

---

# Verification gate

Before opening the PR:

1. `bun run format && bun run lint && bun run typecheck && bun test` — all green.
2. `bun run test:it:e2e` — all green (Docker Desktop up on macOS).
3. `git log --oneline main..HEAD` — exactly 7 commits with the messages above.
4. Manually:
   - `bun run dev`
   - Open one of the migrated example projects, switch between flows in the popover, create + rename + delete a flow.
   - Verify the URL updates and the canvas remounts cleanly.
5. Sibling `seeflow-viewer` PR is open with linked URL in Commit 5 message.
6. CLAUDE.md doesn't reference the old layout (search: `grep -n "flow.json" CLAUDE.md` — if any reference exists, update it).

---

# Plan complete

Saved to `docs/plans/2026-05-26-multi-flow-projects.md`.

Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Uses `superpowers:subagent-driven-development`.

**2. Parallel Session (separate)** — Open a new session (ideally in a worktree via `superpowers:using-git-worktrees`), then use `superpowers:executing-plans` with batched execution + checkpoints.

Which approach?
