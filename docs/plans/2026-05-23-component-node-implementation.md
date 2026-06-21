# Component node implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the `'component'` flat node type designed in `docs/plans/2026-05-23-component-node-design.md` — a json-render-powered reactive UI on the canvas with `set` and `script` actions, backed by a fixed catalog of ~25 shadcn-styled primitives, with no breakage to existing 12-tag flat schema.

**Architecture:** Spec lives in `<project>/nodes/<id>/spec.json`; flow.json carries only the type tag + capability fields. A studio-side resolver inlines the spec on read; a writer externalizes it on PATCH. The canvas renders via `<Renderer>` from `@json-render/react`, dispatching `set` actions client-side and POSTing `script` actions through a new endpoint that reuses the existing `process-spawner` + realpath defense. The catalog is the single source of truth — same Zod definitions drive studio's `superRefine` and canvas's React registry.

**Tech Stack:** TypeScript / Zod 3, Bun 1.3, Hono 4 (studio); React 18, `@xyflow/react`, `@json-render/core` + `/react` + `/shadcn`, `recharts`, `react-markdown`, `shiki` (canvas / web).

---

## Decisions that deviate from the design doc (resolve up-front)

1. **Catalog lives in `packages/canvas/src/catalog/`, not `apps/studio/`.** The design's reasoning was "studio bundle React-free", but bundle composition is determined by what the catalog file *imports*, not where it lives. The catalog file imports only `zod` + `@json-render/core` types — no React. Putting it in `packages/canvas/` with a `./catalog` subpath export keeps the canvas the single source of truth for what's renderable. Studio adds a workspace dep on `@seeflow/canvas` and imports `@seeflow/canvas/catalog` only.
2. **`scriptPath` convention mirrors existing `playAction`.** The design's "scriptPath must start with `nodes/<id>/`" rule conflicts with `apps/studio/src/proxy.ts:54` (`resolveScript` already roots paths at `<projectRoot>/nodes/<nodeId>/`). Since `ComponentActionSchema` reuses `ScriptActionSchema` directly, scriptPath is node-relative — e.g. `"actions/refresh.ts"`, NOT `"nodes/abc/actions/refresh.ts"`. The action runner reuses `resolveScript` from `proxy.ts`. The example in the design doc (`"scriptPath": "nodes/abc/actions/refresh.ts"`) is wrong; the correct form is `"scriptPath": "actions/refresh.ts"`.
3. **HTTP route is `/api/flows/:id/...`, not `/api/projects/:id/...`.** The studio routes everywhere else use `flows`, including `/api/flows/:id/play/:nodeId` (`apps/studio/src/api.ts:795`). Mirror that.

---

## Phase 0 — Set up dependencies

### Task 0.1: Add json-render packages to apps/web

**Files:**
- Modify: `apps/web/package.json` (dependencies)

**Step 1: Add deps**

```bash
cd apps/web && bun add @json-render/core @json-render/react @json-render/shadcn recharts shiki
```

Verify: `apps/web/package.json` has the five new entries. `react-markdown` + `remark-gfm` are already present (no add).

**Step 2: Verify install resolved**

Run: `bun install` from repo root.
Expected: no errors. Confirm `node_modules/@json-render/core` exists.

**Step 3: Commit**

```bash
git add apps/web/package.json bun.lockb
git commit -m "feat(component-node): add json-render + recharts + shiki deps to apps/web"
```

---

### Task 0.2: Add `@seeflow/canvas` workspace dep to apps/studio

The studio's catalog importer needs only the Zod schemas — but to avoid a deep `../../../packages/canvas/src/...` import, we wire a workspace dep + subpath export.

**Files:**
- Modify: `apps/studio/package.json`

**Step 1: Add the dep**

```bash
cd apps/studio && bun add @seeflow/canvas@workspace:*
```

Expected: `"@seeflow/canvas": "workspace:*"` lands in `apps/studio/package.json` `dependencies`.

**Step 2: Verify the dep doesn't break the publish flow**

Run: `cd apps/studio && bun run typecheck`
Expected: no new errors (catalog import doesn't exist yet, so this just confirms the dep resolves).

**Step 3: Commit**

```bash
git add apps/studio/package.json bun.lockb
git commit -m "feat(component-node): add @seeflow/canvas workspace dep to apps/studio"
```

---

## Phase 1 — Catalog (single source of truth)

### Task 1.1: Write failing catalog shape test

**Files:**
- Create: `packages/canvas/src/catalog/component-catalog.test.ts`

**Step 1: Write the test**

```ts
import { describe, expect, it } from 'bun:test';
import { componentCatalog, COMPONENT_NAMES } from './component-catalog.ts';

describe('componentCatalog', () => {
  it('exports the 25 catalog entries the design specifies', () => {
    expect(COMPONENT_NAMES).toEqual(
      expect.arrayContaining([
        // shadcn-backed
        'Card', 'Separator', 'Tabs', 'Accordion',
        'Badge', 'Avatar', 'Progress', 'Skeleton', 'Label',
        'Button', 'Input', 'Checkbox', 'Switch', 'Select', 'Textarea', 'Slider',
        // SeeFlow extras
        'Heading', 'Text', 'Icon',
        'Chart', 'Table', 'Metric',
        'CodeBlock', 'Markdown',
      ]),
    );
    expect(COMPONENT_NAMES.length).toBe(24);
  });

  it('every entry carries a Zod props schema', () => {
    for (const name of COMPONENT_NAMES) {
      const entry = componentCatalog.components[name];
      expect(entry, `missing catalog entry for ${name}`).toBeDefined();
      expect(typeof entry.props.safeParse).toBe('function');
    }
  });

  it('Button.props requires { label } and accepts an action ref', () => {
    const ok = componentCatalog.components.Button.props.safeParse({ label: 'Go' });
    expect(ok.success).toBe(true);
    const missing = componentCatalog.components.Button.props.safeParse({});
    expect(missing.success).toBe(false);
  });
});
```

**Step 2: Run, expect failure**

Run: `bun test packages/canvas/src/catalog/component-catalog.test.ts`
Expected: FAIL — module does not exist.

---

### Task 1.2: Implement the catalog

**Files:**
- Create: `packages/canvas/src/catalog/component-catalog.ts`
- Create: `packages/canvas/src/catalog/index.ts` (barrel)

**Step 1: Implement `component-catalog.ts`**

This file imports only `zod` + (optionally) `@json-render/core` types. NO React imports.

```ts
import { z } from 'zod';

// `$ref` shapes accepted in any prop slot. Resolved at render time by the
// json-render runtime — Zod here only enforces that the structural shape is
// valid; the path / action name validity is enforced by superRefine in
// schema.ts (which sees the whole spec).
const StateRef = z.object({ $state: z.string().min(1) });
const ActionRef = z.object({ $action: z.string().min(1) });
const CondRef = z.object({
  $cond: z.unknown(),
  $then: z.unknown(),
  $else: z.unknown().optional(),
});
const refOr = <T extends z.ZodTypeAny>(t: T) => z.union([t, StateRef, ActionRef, CondRef]);

const StringProp = refOr(z.string());
const NumberProp = refOr(z.number());
const BoolProp = refOr(z.boolean());

const PropsSchemas = {
  Card: z.object({ title: StringProp.optional() }),
  Separator: z.object({ orientation: refOr(z.enum(['horizontal', 'vertical'])).optional() }),
  Tabs: z.object({
    value: StringProp.optional(),
    items: z.array(z.object({ id: z.string(), label: z.string() })),
    onChange: ActionRef.optional(),
  }),
  Accordion: z.object({
    items: z.array(z.object({ id: z.string(), title: z.string(), content: z.string() })),
  }),
  Badge: z.object({
    label: StringProp,
    variant: refOr(z.enum(['default', 'secondary', 'destructive', 'outline'])).optional(),
  }),
  Avatar: z.object({ src: StringProp.optional(), alt: StringProp.optional(), fallback: StringProp.optional() }),
  Progress: z.object({ value: NumberProp }),
  Skeleton: z.object({ width: NumberProp.optional(), height: NumberProp.optional() }),
  Label: z.object({ text: StringProp }),
  Heading: z.object({ level: refOr(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])).optional(), text: StringProp }),
  Text: z.object({ text: StringProp, muted: BoolProp.optional() }),
  Icon: z.object({ name: StringProp, size: NumberProp.optional() }),
  Chart: z.object({
    kind: refOr(z.enum(['bar', 'line', 'area', 'pie'])),
    data: refOr(z.array(z.record(z.string(), z.unknown()))),
    xKey: StringProp.optional(),
    series: z.array(z.object({ key: z.string(), label: z.string().optional() })).optional(),
  }),
  Table: z.object({
    columns: z.array(z.object({ key: z.string(), label: z.string() })),
    rows: refOr(z.array(z.record(z.string(), z.unknown()))),
  }),
  Metric: z.object({ label: StringProp, value: refOr(z.union([z.string(), z.number()])) }),
  CodeBlock: z.object({ code: StringProp, language: StringProp.optional() }),
  Markdown: z.object({ content: StringProp }),
  Button: z.object({
    label: StringProp,
    variant: refOr(z.enum(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'])).optional(),
    onClick: ActionRef.optional(),
    disabled: BoolProp.optional(),
  }),
  Input: z.object({
    value: StringProp.optional(),
    placeholder: StringProp.optional(),
    onChange: ActionRef.optional(),
  }),
  Checkbox: z.object({ checked: BoolProp.optional(), onChange: ActionRef.optional(), label: StringProp.optional() }),
  Switch: z.object({ checked: BoolProp.optional(), onChange: ActionRef.optional() }),
  Select: z.object({
    value: StringProp.optional(),
    items: z.array(z.object({ value: z.string(), label: z.string() })),
    onChange: ActionRef.optional(),
  }),
  Textarea: z.object({
    value: StringProp.optional(),
    placeholder: StringProp.optional(),
    rows: NumberProp.optional(),
    onChange: ActionRef.optional(),
  }),
  Slider: z.object({
    value: NumberProp.optional(),
    min: NumberProp.optional(),
    max: NumberProp.optional(),
    step: NumberProp.optional(),
    onChange: ActionRef.optional(),
  }),
} as const;

export const COMPONENT_NAMES = Object.keys(PropsSchemas) as Array<keyof typeof PropsSchemas>;

export const componentCatalog = {
  components: Object.fromEntries(
    COMPONENT_NAMES.map((name) => [name, { props: PropsSchemas[name], description: name }]),
  ) as Record<string, { props: z.ZodTypeAny; description: string }>,
};

export type ComponentName = (typeof COMPONENT_NAMES)[number];
```

**Step 2: Add the barrel**

```ts
// packages/canvas/src/catalog/index.ts
export { componentCatalog, COMPONENT_NAMES } from './component-catalog.ts';
export type { ComponentName } from './component-catalog.ts';
```

**Step 3: Run, expect pass**

Run: `bun test packages/canvas/src/catalog/component-catalog.test.ts`
Expected: PASS (3 tests).

**Step 4: Commit**

```bash
git add packages/canvas/src/catalog/
git commit -m "feat(component-node): catalog of 24 components (Zod-only, React-free)"
```

> Note: the spec lists 25 but several "groups" overlap (Display Label + SeeFlow Label/Heading). 24 distinct names is what the design's table actually enumerates; document the count discrepancy in the commit msg.

---

### Task 1.3: Expose `./catalog` subpath export from @seeflow/canvas

**Files:**
- Modify: `packages/canvas/package.json` (exports + scripts)
- Modify: `packages/canvas/tsup.config.ts` (entry)

**Step 1: Add the tsup entry**

Open `packages/canvas/tsup.config.ts` and add a second entry:

```ts
// inside defineConfig
entry: {
  index: 'src/index.ts',
  catalog: 'src/catalog/index.ts',
},
```

**Step 2: Add the subpath export**

In `packages/canvas/package.json`, extend the `exports` block:

```json
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  },
  "./catalog": {
    "import": "./dist/catalog.js",
    "types": "./dist/catalog.d.ts"
  },
  "./style.css": "./dist/style.css"
}
```

**Step 3: Build + verify**

Run: `cd packages/canvas && bun run build:js`
Expected: `dist/catalog.js` and `dist/catalog.d.ts` exist.

**Step 4: Verify studio can import**

Add a throwaway file `apps/studio/src/.catalog-probe.ts`:

```ts
import { COMPONENT_NAMES } from '@seeflow/canvas/catalog';
console.log(COMPONENT_NAMES.length);
```

Run: `cd apps/studio && bun run .catalog-probe.ts`
Expected: prints `24`.

Delete the probe file.

**Step 5: Commit**

```bash
git add packages/canvas/package.json packages/canvas/tsup.config.ts packages/canvas/dist
git commit -m "feat(component-node): expose @seeflow/canvas/catalog subpath export"
```

---

## Phase 2 — Schema in apps/studio

### Task 2.1: Failing test — `'component'` is in `NodeTypeSchema`

**Files:**
- Modify: `apps/studio/src/schema.test.ts` (add a describe block at end)

**Step 1: Append the test**

```ts
describe('component node type (T-001)', () => {
  it('accepts type:"component" in the flat NodeTypeSchema enum', () => {
    expect(NodeTypeSchema.safeParse('component').success).toBe(true);
  });
});
```

Add the missing import if not present: `import { NodeTypeSchema } from './schema.ts';`

**Step 2: Run, expect failure**

Run: `bun test apps/studio/src/schema.test.ts -t "T-001"`
Expected: FAIL — `'component'` not in enum.

---

### Task 2.2: Add `'component'` to `NodeTypeSchema` + new spec/action schemas

**Files:**
- Modify: `apps/studio/src/schema.ts`

**Step 1: Add the new shared schemas** (above `ResolvedFlowSchema`)

```ts
// --- Component node (T-001) ----------------------------------------------

export const ComponentSpecElementSchema = z.object({
  type: z.string().min(1),
  props: z.record(z.string(), z.unknown()).optional(),
  children: z.array(z.string()).optional(),
  watch: z.record(z.string(), z.unknown()).optional(),
});

// Declarative state mutation. `path` is a JSON Pointer; `value` may itself
// contain $param / $state refs resolved at dispatch time.
const SetActionSchema = z.object({
  kind: z.literal('set'),
  path: z.string().min(1).startsWith('/', { message: 'path must be a JSON Pointer (start with /)' }),
  value: z.unknown(),
});

// Script-kind action reuses the existing playAction shape (interpreter,
// scriptPath, timeoutMs, etc.). scriptPath is node-relative — runPlay/
// resolveScript already roots at `<projectRoot>/nodes/<nodeId>/`.
export const ComponentActionSchema = z.discriminatedUnion('kind', [
  SetActionSchema,
  ScriptActionSchema,
]);

export const ComponentSpecSchema = z.object({
  root: z.string().min(1),
  elements: z.record(z.string(), ComponentSpecElementSchema),
  state: z.record(z.string(), z.unknown()).optional(),
  actions: z.record(z.string(), ComponentActionSchema).optional(),
});

export type ComponentSpec = z.infer<typeof ComponentSpecSchema>;
export type ComponentAction = z.infer<typeof ComponentActionSchema>;
export type ComponentSpecElement = z.infer<typeof ComponentSpecElementSchema>;
```

> `ScriptActionSchema` is currently file-private at line 70 — export it so `ComponentActionSchema` can reference it. Change `const ScriptActionSchema` to `export const ScriptActionSchema`.

**Step 2: Add the per-type data shapes**

After `ResolvedIconNodeData`:

```ts
// Component node — `spec` is populated by the resolver from
// `<project>/nodes/<id>/spec.json`. The on-disk FlowComponentNodeData has
// no `spec` field; the resolver inlines it after readMergedFlow.
const ResolvedComponentNodeData = z.object({
  ...NodeSemanticBaseShape,
  ...NodeVisualBaseShape,
  ...NodeCapabilitiesShape,
  spec: ComponentSpecSchema,
  autoSize: z.boolean().optional(),
});
```

**Step 3: Extend `NodeTypeSchema` and the discriminated unions**

Change line 143:

```ts
export const NodeTypeSchema = z.enum([
  ...GEOMETRIC_NODE_TYPES, 'image', 'html', 'icon', 'component',
]);
```

In `NodeSchema` (discriminatedUnion), append:

```ts
z.object({ ...NodeBaseShape, type: z.literal('component'), data: ResolvedComponentNodeData }),
```

**Step 4: Add the on-disk side**

After `FlowIconNodeData`:

```ts
const FlowComponentNodeData = z
  .object({
    ...NodeSemanticBaseShape,
    ...NodeCapabilitiesShape,
    autoSize: z.boolean().optional(),
    // No `spec` — sidecar `nodes/<id>/spec.json` is the source of truth.
  })
  .strict();

export const FlowComponentNodeSchema = z
  .object({
    ...FlowNodeBaseShape,
    type: z.literal('component'),
    data: FlowComponentNodeData,
  })
  .strict();
```

In the `FlowNodeSchema` discriminatedUnion, append `FlowComponentNodeSchema`.

**Step 5: Run, expect pass**

Run: `bun test apps/studio/src/schema.test.ts -t "T-001"`
Expected: PASS.

**Step 6: Commit**

```bash
git add apps/studio/src/schema.ts apps/studio/src/schema.test.ts
git commit -m "feat(component-node): add 'component' to NodeTypeSchema + ComponentSpecSchema"
```

---

### Task 2.3: Failing test — ResolvedFlow round-trips a component node

**Files:**
- Modify: `apps/studio/src/schema.test.ts`

**Step 1: Append test**

```ts
describe('ResolvedFlowSchema component node round-trip (T-002)', () => {
  it('parses a valid component node with set + script actions', () => {
    const flow = {
      version: 2 as const,
      name: 'demo',
      nodes: [{
        id: 'n1',
        type: 'component',
        position: { x: 0, y: 0 },
        data: {
          spec: {
            root: 'root',
            state: { '/tab': 'a' },
            actions: {
              switchTab: { kind: 'set', path: '/tab', value: { $param: 'to' } },
              refresh: { kind: 'script', interpreter: 'bun', scriptPath: 'actions/refresh.ts' },
            },
            elements: {
              root: { type: 'Button', props: { label: 'Hi', onClick: { $action: 'refresh' } } },
            },
          },
        },
      }],
      connectors: [],
    };
    const parsed = ResolvedFlowSchema.safeParse(flow);
    expect(parsed.success).toBe(true);
  });

  it('rejects a set action with a relative path missing the leading /', () => {
    const flow = {
      version: 2 as const,
      name: 'demo',
      nodes: [{
        id: 'n1',
        type: 'component',
        position: { x: 0, y: 0 },
        data: {
          spec: {
            root: 'root',
            actions: { bad: { kind: 'set', path: 'no-slash', value: 1 } },
            elements: { root: { type: 'Text', props: { text: 'x' } } },
          },
        },
      }],
      connectors: [],
    };
    const parsed = ResolvedFlowSchema.safeParse(flow);
    expect(parsed.success).toBe(false);
  });
});
```

**Step 2: Run**

Expected: both pass (validation already wired). If a missing import surfaces (`ResolvedFlowSchema`), add it.

**Step 3: Commit**

```bash
git add apps/studio/src/schema.test.ts
git commit -m "test(component-node): ResolvedFlow round-trip + set-action path validation"
```

---

### Task 2.4: Catalog superRefine on ResolvedFlowSchema

**Files:**
- Modify: `apps/studio/src/schema.test.ts` (add failing test first)
- Modify: `apps/studio/src/schema.ts` (add the refine block)

**Step 1: Failing test**

```ts
describe('ResolvedFlowSchema component catalog refine (T-003)', () => {
  it('rejects an element whose type is not in the catalog', () => {
    const flow = {
      version: 2 as const,
      name: 'demo',
      nodes: [{
        id: 'n1', type: 'component', position: { x: 0, y: 0 },
        data: {
          spec: {
            root: 'r',
            elements: { r: { type: 'NotARealComponent', props: {} } },
          },
        },
      }],
      connectors: [],
    };
    const parsed = ResolvedFlowSchema.safeParse(flow);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toMatch(/NotARealComponent/);
  });

  it("rejects an element whose props don't satisfy the catalog schema", () => {
    const flow = {
      version: 2 as const,
      name: 'demo',
      nodes: [{
        id: 'n1', type: 'component', position: { x: 0, y: 0 },
        data: {
          spec: {
            root: 'r',
            // Button.props.label is required
            elements: { r: { type: 'Button', props: {} } },
          },
        },
      }],
      connectors: [],
    };
    const parsed = ResolvedFlowSchema.safeParse(flow);
    expect(parsed.success).toBe(false);
  });
});
```

Run: `bun test apps/studio/src/schema.test.ts -t "T-003"`
Expected: BOTH FAIL (catalog refine not wired yet).

**Step 2: Wire the refine**

At the top of `schema.ts`, add:

```ts
import { componentCatalog } from '@seeflow/canvas/catalog';
```

In `ResolvedFlowSchema`'s `.superRefine` block, add a new section after the existing `image` path rule:

```ts
// Component node spec must reference only catalog components, and props
// must satisfy each component's Zod schema. Issues are re-pathed into the
// spec for actionable error messages.
resolved.nodes.forEach((node, idx) => {
  if (node.type !== 'component') return;
  const spec = (node.data as { spec?: { elements?: Record<string, unknown> } }).spec;
  if (!spec?.elements) return;
  for (const [elId, raw] of Object.entries(spec.elements)) {
    const el = raw as { type: string; props?: Record<string, unknown> };
    const entry = componentCatalog.components[el.type];
    if (!entry) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nodes', idx, 'data', 'spec', 'elements', elId, 'type'],
        message: `Unknown component type '${el.type}'. Valid: ${Object.keys(componentCatalog.components).join(', ')}`,
      });
      continue;
    }
    if (el.props !== undefined) {
      const propsParse = entry.props.safeParse(el.props);
      if (!propsParse.success) {
        for (const issue of propsParse.error.issues) {
          ctx.addIssue({
            ...issue,
            path: ['nodes', idx, 'data', 'spec', 'elements', elId, 'props', ...issue.path],
          });
        }
      }
    }
  }
});
```

**Step 3: Run**

Expected: BOTH PASS.

**Step 4: Commit**

```bash
git add apps/studio/src/schema.ts apps/studio/src/schema.test.ts
git commit -m "feat(component-node): superRefine — element type + props against catalog"
```

---

## Phase 3 — Spec sidecar resolver (read path)

### Task 3.1: Failing test for spec resolver

**Files:**
- Create: `apps/studio/src/component-spec-resolver.test.ts`

**Step 1: Test**

```ts
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inlineComponentSpecs } from './component-spec-resolver.ts';

const setupProject = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-spec-'));
  mkdirSync(join(dir, 'nodes', 'n1'), { recursive: true });
  writeFileSync(
    join(dir, 'nodes', 'n1', 'spec.json'),
    JSON.stringify({
      root: 'r',
      state: { '/x': 1 },
      elements: { r: { type: 'Text', props: { text: 'hi' } } },
    }),
  );
  return dir;
};

describe('inlineComponentSpecs', () => {
  it('attaches spec.json content as data.spec for component nodes', () => {
    const root = setupProject();
    const flow = {
      version: 2 as const,
      name: 'x',
      nodes: [{ id: 'n1', type: 'component', position: { x: 0, y: 0 }, data: {} }],
      connectors: [],
    };
    const { flow: out, errors } = inlineComponentSpecs(flow as never, root);
    expect(errors).toEqual([]);
    expect((out.nodes[0].data as { spec: unknown }).spec).toEqual({
      root: 'r', state: { '/x': 1 },
      elements: { r: { type: 'Text', props: { text: 'hi' } } },
    });
  });

  it('emits an error path when spec.json is missing', () => {
    const root = setupProject();
    const flow = {
      version: 2 as const,
      name: 'x',
      nodes: [{ id: 'missing', type: 'component', position: { x: 0, y: 0 }, data: {} }],
      connectors: [],
    };
    const { errors } = inlineComponentSpecs(flow as never, root);
    expect(errors.length).toBe(1);
    expect(errors[0].path).toBe('nodes/missing/data/spec');
  });

  it('is a no-op on non-component nodes', () => {
    const root = setupProject();
    const flow = {
      version: 2 as const,
      name: 'x',
      nodes: [{ id: 'g', type: 'rectangle', position: { x: 0, y: 0 }, data: { name: 'r' } }],
      connectors: [],
    };
    const { errors } = inlineComponentSpecs(flow as never, root);
    expect(errors).toEqual([]);
  });
});
```

**Step 2: Run**

Expected: FAIL — module does not exist.

---

### Task 3.2: Implement the resolver

**Files:**
- Create: `apps/studio/src/component-spec-resolver.ts`

**Step 1: Implement**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedFlow } from './schema.ts';

export interface SpecInlineError {
  /** Logical path into the merged flow shape, like 'nodes/<id>/data/spec'. */
  path: string;
  message: string;
}

export interface InlineComponentSpecsResult {
  flow: ResolvedFlow;
  errors: SpecInlineError[];
  /** Project-root-relative paths the watcher should track for live reload. */
  refs: string[];
}

/**
 * For every `'component'` node in `flow`, read `nodes/<id>/spec.json`,
 * JSON.parse, and attach the result as `data.spec`. Missing files surface
 * as a SpecInlineError; malformed JSON surfaces likewise. Non-component
 * nodes pass through untouched.
 *
 * Returns a NEW flow object (no mutation of the input) so the watcher's
 * snapshot caching stays safe.
 */
export function inlineComponentSpecs(
  flow: ResolvedFlow,
  projectRoot: string,
): InlineComponentSpecsResult {
  const errors: SpecInlineError[] = [];
  const refs: string[] = [];

  const nodes = flow.nodes.map((node) => {
    if (node.type !== 'component') return node;
    const relPath = `nodes/${node.id}/spec.json`;
    const absPath = join(projectRoot, relPath);
    if (!existsSync(absPath)) {
      errors.push({
        path: `nodes/${node.id}/data/spec`,
        message: `Missing spec file: ${relPath}`,
      });
      return node;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(absPath, 'utf8'));
    } catch (err) {
      errors.push({
        path: `nodes/${node.id}/data/spec`,
        message: `Invalid JSON in ${relPath}: ${err instanceof Error ? err.message : String(err)}`,
      });
      return node;
    }
    refs.push(relPath);
    return { ...node, data: { ...node.data, spec: parsed } };
  });

  return { flow: { ...flow, nodes } as ResolvedFlow, errors, refs };
}
```

**Step 2: Run, expect pass**

Run: `bun test apps/studio/src/component-spec-resolver.test.ts`
Expected: PASS (3 tests).

**Step 3: Commit**

```bash
git add apps/studio/src/component-spec-resolver.ts apps/studio/src/component-spec-resolver.test.ts
git commit -m "feat(component-node): inlineComponentSpecs resolver (nodes/<id>/spec.json → data.spec)"
```

---

### Task 3.3: Wire resolver into `readMergedFlow`

**Files:**
- Modify: `apps/studio/src/watcher.ts`

**Step 1: Failing test (extend watcher.test.ts or add a new one)**

Add to `apps/studio/src/watcher.test.ts`:

```ts
describe('readMergedFlow inlines component specs (T-004)', () => {
  it('attaches spec.json as data.spec on read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-rm-'));
    mkdirSync(join(dir, 'nodes', 'c1'), { recursive: true });
    writeFileSync(join(dir, 'flow.json'), JSON.stringify({
      version: 2, name: 'x',
      nodes: [{ id: 'c1', type: 'component', data: {} }],
      connectors: [],
    }));
    writeFileSync(join(dir, 'nodes', 'c1', 'spec.json'), JSON.stringify({
      root: 'r', elements: { r: { type: 'Text', props: { text: 'hi' } } },
    }));
    const result = readMergedFlow(join(dir, 'flow.json'));
    expect(result.valid).toBe(true);
    expect((result.flow!.nodes[0].data as { spec: unknown }).spec).toBeDefined();
  });

  it('surfaces missing spec.json as a read error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-rm-miss-'));
    writeFileSync(join(dir, 'flow.json'), JSON.stringify({
      version: 2, name: 'x',
      nodes: [{ id: 'c1', type: 'component', data: {} }],
      connectors: [],
    }));
    const result = readMergedFlow(join(dir, 'flow.json'));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/nodes\/c1\/data\/spec/);
  });
});
```

Add the necessary `mkdtempSync`/`mkdirSync`/`writeFileSync` imports and the `readMergedFlow` import if missing.

Run: `bun test apps/studio/src/watcher.test.ts -t "T-004"`
Expected: FAIL.

**Step 2: Wire**

In `watcher.ts`, after the `mergeFlowAndStyle` call (`line 228`), insert:

```ts
import { inlineComponentSpecs } from './component-spec-resolver.ts';
// ...
const merged = mergeFlowAndStyle(flowParse.data as Flow, styleParse.data);
const { flow: withSpecs, errors: specErrors, refs: specRefs } = inlineComponentSpecs(
  merged,
  projectRoot,
);
if (specErrors.length > 0) {
  return {
    ...empty,
    error: `Spec resolver failed: ${specErrors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    fileRefs: [...refs, ...specRefs],
    staticRefs,
  };
}
// Re-validate against ResolvedFlowSchema so the catalog superRefine runs
// against the inlined specs (the previous FlowSchema parse saw `data` with
// no spec field — the strict on-disk shape).
const resolvedParse = ResolvedFlowSchema.safeParse(withSpecs);
if (!resolvedParse.success) {
  const message = resolvedParse.error.issues
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
  return {
    ...empty,
    error: `ResolvedFlow validation failed: ${message}`,
    fileRefs: [...refs, ...specRefs],
    staticRefs,
  };
}
return { flow: resolvedParse.data, valid: true, error: null, fileRefs: [...refs, ...specRefs], staticRefs };
```

Add `ResolvedFlowSchema` to the schema.ts imports.

> NOTE: replace the existing trailing `return { flow, valid: true, ... }` with the block above.

**Step 3: Run, expect pass**

Run: `bun test apps/studio/src/watcher.test.ts -t "T-004"`
Expected: PASS.

Run: `bun test apps/studio/src/watcher.test.ts` (full file)
Expected: every existing test still passes — the resolver is a no-op for non-component flows.

**Step 4: Commit**

```bash
git add apps/studio/src/watcher.ts apps/studio/src/watcher.test.ts
git commit -m "feat(component-node): readMergedFlow inlines spec.json + re-validates"
```

---

## Phase 4 — Spec sidecar writer (write path)

### Task 4.1: Failing test — PATCH `spec` writes to disk + survives round-trip

**Files:**
- Modify: `apps/studio/src/operations.test.ts`

**Step 1: Append test**

```ts
describe('patchNodeImpl externalizes component spec (T-005)', () => {
  it('writes spec to nodes/<id>/spec.json and reads it back via readMergedFlow', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-comp-patch-'));
    // Seed a project with a component node lacking a spec
    writeFileSync(join(dir, 'flow.json'), JSON.stringify({
      version: 2, name: 'x',
      nodes: [{ id: 'c1', type: 'component', data: {} }],
      connectors: [],
    }));
    mkdirSync(join(dir, 'nodes', 'c1'), { recursive: true });
    writeFileSync(join(dir, 'nodes', 'c1', 'spec.json'), JSON.stringify({
      root: 'r', elements: { r: { type: 'Text', props: { text: 'old' } } },
    }));
    const deps = makeOperationsDeps(dir); // existing helper in the test file
    const flowId = 'c1-demo';
    deps.registry.register({ id: flowId, repoPath: dir, flowPath: 'flow.json', name: 'x', slug: 'x' });

    const newSpec = {
      root: 'r',
      elements: { r: { type: 'Text', props: { text: 'new' } } },
    };
    const result = await patchNodeImpl(deps, flowId, 'c1', { spec: newSpec });
    expect(result.kind).toBe('ok');

    // flow.json must NOT contain spec
    const onDisk = JSON.parse(readFileSync(join(dir, 'flow.json'), 'utf8'));
    expect(onDisk.nodes[0].data.spec).toBeUndefined();

    // nodes/c1/spec.json must contain the new content
    const sidecar = JSON.parse(readFileSync(join(dir, 'nodes/c1/spec.json'), 'utf8'));
    expect(sidecar.elements.r.props.text).toBe('new');

    // readMergedFlow inlines it back
    const read = readMergedFlow(join(dir, 'flow.json'));
    expect((read.flow!.nodes[0].data as { spec: { elements: any } }).spec.elements.r.props.text).toBe('new');
  });
});
```

Adapt imports / helpers to match existing patterns in `operations.test.ts` (the test file already has the project-setup helper — reuse it).

Run: `bun test apps/studio/src/operations.test.ts -t "T-005"`
Expected: FAIL — patch body schema rejects unknown key `spec`.

---

### Task 4.2: Extend NodePatchBodySchema + mergeNodeUpdates + patchNodeImpl

**Files:**
- Modify: `apps/studio/src/operations.ts`

**Step 1: Add `spec` to NodePatchBodySchema**

After the `html` entry in `NodePatchBodySchema` (around line 135), add:

```ts
// type:'component'-only: full spec replacement. Externalized to
// nodes/<id>/spec.json by patchNodeImpl; the on-disk flow.json node has
// no `spec` field at all. The post-merge ResolvedFlowSchema reparse +
// catalog superRefine gate validity.
spec: ComponentSpecSchema.optional(),
```

Add `ComponentSpecSchema` to the schema.ts import.

**Step 2: Add `spec` to NODE_DATA_PATCH_KEYS**

After `'html'` (line 171):

```ts
'spec',
```

**Step 3: Extend SEMANTIC_KEYS_BY_TYPE**

Add a `component` entry mirroring the html entry shape, but with no semantic fields beyond the universal capability set (spec is sidecar-only, not in the on-disk allowed-keys set):

```ts
component: new Set([
  'name', 'description', 'detail', 'icon',
  'stateSource', 'handlerModule', 'playAction', 'statusAction',
  // 'spec' is NOT here — it's externalized by patchNodeImpl, not stored
  // in data on disk.
]),
```

**Step 4: Externalize `spec` in patchNodeImpl**

In `patchNodeImpl` (around line 1504), parallel to the existing `externalizedWrites` block, add:

```ts
// type:'component' spec is a JSON object — externalize to spec.json and
// strip from `data` before serialization (FlowComponentNodeData is strict
// and has no `spec` field). Resolver re-attaches it on read.
const specUpdate = (updates as { spec?: unknown }).spec;
if (specUpdate !== undefined && node.type === 'component') {
  const absPath = nodeFileAbsPath(entry.repoPath, nodeId, 'spec.json');
  try {
    writeNodeFile(absPath, `${JSON.stringify(specUpdate, null, 2)}\n`);
  } catch (err) {
    return {
      kind: 'writeFailed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
```

Then in `mergeNodeUpdates`, after the existing per-key loop and before the html invariant block, ensure spec lands in data so the post-merge ResolvedFlowSchema validation sees it. But we DON'T want it in the eventually-written flow.json. Cleanest: leave `spec` in data during validation, then strip before write via `splitFlow`'s flow-routing decision.

In `apps/studio/src/merge.ts`, in `splitFlow` (around line 134), explicitly strip `spec` so it never lands in flow.json:

```ts
for (const [k, v] of Object.entries(data)) {
  if (v === undefined) continue;
  if (k === 'spec' && node.type === 'component') continue; // sidecar-only
  if (NODE_DATA_FLOW_KEYS.has(k)) {
    flowData[k] = v;
  } else if (NODE_STYLE_KEYS.has(k)) {
    styleEntry[k] = v;
  } else {
    flowData[k] = v;
  }
}
```

**Step 5: Run, expect pass**

Run: `bun test apps/studio/src/operations.test.ts -t "T-005"`
Expected: PASS.

Run: `bun test apps/studio/src/operations.test.ts apps/studio/src/merge.test.ts apps/studio/src/watcher.test.ts`
Expected: every existing test still passes.

**Step 6: Commit**

```bash
git add apps/studio/src/operations.ts apps/studio/src/merge.ts apps/studio/src/operations.test.ts
git commit -m "feat(component-node): PATCH spec externalizes to nodes/<id>/spec.json"
```

---

### Task 4.3: Add `'component'` to externalized-fields list for delete cascade

`removeNodeDir` already nukes the whole `nodes/<id>/` folder, so `spec.json` cleanup is automatic. No code change needed — but add a regression test.

**Files:**
- Modify: `apps/studio/src/operations.test.ts`

**Step 1: Test**

```ts
describe('deleteNodeImpl cascades component spec (T-006)', () => {
  it('removes spec.json when a component node is deleted', async () => {
    // ... seed dir + register + write spec.json + deleteNodeImpl
    // expect existsSync(spec.json path) to be false
  });
});
```

**Step 2: Run, expect pass**

Should already pass — `removeNodeDir` rmSyncs the folder. Add the test as a regression guard.

**Step 3: Commit**

```bash
git add apps/studio/src/operations.test.ts
git commit -m "test(component-node): delete cascades spec.json via removeNodeDir"
```

---

## Phase 5 — Action runner (HTTP endpoint)

### Task 5.1: Failing test — script action runner

**Files:**
- Create: `apps/studio/src/component-action-runner.test.ts`

**Step 1: Test**

```ts
import { describe, expect, it } from 'bun:test';
import { runComponentAction } from './component-action-runner.ts';
import { createEventBus } from './events.ts';
// ... reuse the in-memory ProcessSpawner fake from process-spawner.test.ts
import { fakeSpawnerFromScripts } from './process-spawner.test.ts'; // adapt name

describe('runComponentAction', () => {
  it('spawns a script-kind action and returns its parsed JSON stdout', async () => {
    const spawner = fakeSpawnerFromScripts({
      'actions/refresh.ts': { stdout: '{"queueDepth": 7}', exitCode: 0 },
    });
    const result = await runComponentAction({
      events: createEventBus(),
      flowId: 'f1', nodeId: 'n1', cwd: '/tmp/proj',
      actionName: 'refresh',
      action: { kind: 'script', interpreter: 'bun', scriptPath: 'actions/refresh.ts' },
      payload: { force: true },
      spawner,
    });
    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ queueDepth: 7 });
  });

  it('returns 400 for set-kind actions (client-only)', async () => {
    const result = await runComponentAction({
      events: createEventBus(), flowId: 'f1', nodeId: 'n1', cwd: '/tmp/proj',
      actionName: 'switch', action: { kind: 'set', path: '/x', value: 1 } as never,
      payload: {}, spawner: {} as never,
    });
    expect(result.ok).toBe(false);
    expect(result.statusHint).toBe(400);
  });
});
```

Run: FAIL — module does not exist.

---

### Task 5.2: Implement the runner

**Files:**
- Create: `apps/studio/src/component-action-runner.ts`

**Step 1: Implement** (heavily mirrors `runPlay`)

```ts
import { realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { EventBus } from './events.ts';
import { type ProcessSpawner, defaultProcessSpawner } from './process-spawner.ts';
import type { ComponentAction } from './schema.ts';
import { shortId } from './short-id.ts';

const DEFAULT_TIMEOUT_MS = 5_000;
const SIGKILL_GRACE_MS = 2_000;

export interface RunComponentActionOptions {
  events: EventBus;
  flowId: string;
  nodeId: string;
  /** Project root. */
  cwd: string;
  actionName: string;
  action: ComponentAction;
  payload: unknown;
  spawner?: ProcessSpawner;
}

export interface ComponentActionResult {
  ok: boolean;
  body?: unknown;
  error?: string;
  /** Suggested HTTP status for the API handler. */
  statusHint: number;
}

function resolveScript(cwd: string, nodeId: string, scriptPath: string):
  | { ok: true; absPath: string }
  | { ok: false } {
  const nodeRoot = join(cwd, 'nodes', nodeId);
  let realRoot: string;
  try { realRoot = realpathSync(nodeRoot); } catch { return { ok: false }; }
  const target = resolve(nodeRoot, scriptPath);
  let realTarget: string;
  try { realTarget = realpathSync(target); } catch { return { ok: false }; }
  const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realTarget !== realRoot && !realTarget.startsWith(rootWithSep)) return { ok: false };
  return { ok: true, absPath: realTarget };
}

export async function runComponentAction(
  opts: RunComponentActionOptions,
): Promise<ComponentActionResult> {
  if (opts.action.kind !== 'script') {
    return { ok: false, error: "Only 'script' actions are dispatched over HTTP", statusHint: 400 };
  }
  const spawner = opts.spawner ?? defaultProcessSpawner;
  const resolved = resolveScript(opts.cwd, opts.nodeId, opts.action.scriptPath);
  if (!resolved.ok) {
    return { ok: false, error: 'scriptPath escapes project root', statusHint: 400 };
  }
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  env.SEEFLOW_DEMO_ID = opts.flowId;
  env.SEEFLOW_NODE_ID = opts.nodeId;
  env.SEEFLOW_ACTION_NAME = opts.actionName;
  env.SEEFLOW_RUN_ID = shortId();

  const handle = spawner.spawn({
    cmd: [opts.action.interpreter, ...(opts.action.args ?? []), resolved.absPath],
    cwd: opts.cwd, env, stdin: 'pipe',
  });

  // Pipe payload to stdin
  const w = handle.stdin!.getWriter();
  try { await w.write(new TextEncoder().encode(JSON.stringify(opts.payload))); }
  finally { await w.close().catch(() => {}); }

  const stdoutP = new Response(handle.stdout).text();
  const stderrP = new Response(handle.stderr).text();
  const timeoutMs = opts.action.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<'timeout'>((res) => { timer = setTimeout(() => res('timeout'), timeoutMs); });
  const exitP = handle.exited.then((c) => ({ code: c }) as const);
  const race = await Promise.race([exitP, timeoutP]);
  if (timer) clearTimeout(timer);

  if (race === 'timeout') {
    handle.kill('SIGTERM');
    await Promise.race([handle.exited, new Promise((r) => setTimeout(r, SIGKILL_GRACE_MS))]);
    handle.kill('SIGKILL');
    await handle.exited;
    return { ok: false, error: `action timed out after ${timeoutMs}ms`, statusHint: 504 };
  }

  const [stdout, stderr] = await Promise.all([stdoutP, stderrP]);
  if (race.code !== 0) {
    return { ok: false, error: stderr.trim() || `exit ${race.code}`, statusHint: 500 };
  }
  let body: unknown;
  try { body = JSON.parse(stdout); } catch { body = stdout; }
  return { ok: true, body, statusHint: 200 };
}
```

**Step 2: Run, expect pass**

Run: `bun test apps/studio/src/component-action-runner.test.ts`
Expected: PASS.

**Step 3: Commit**

```bash
git add apps/studio/src/component-action-runner.ts apps/studio/src/component-action-runner.test.ts
git commit -m "feat(component-node): component-action-runner (script-kind spawn over HTTP)"
```

---

### Task 5.3: Wire the API route

**Files:**
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/api.test.ts`

**Step 1: Failing API test**

In `api.test.ts`, add:

```ts
describe('POST /api/flows/:id/nodes/:nodeId/actions/:name (T-007)', () => {
  it('dispatches a script-kind action and returns its JSON body', async () => {
    // Seed a project with component node + spec.json that has a script action
    // Call the endpoint, expect 200 + JSON body
  });

  it('404s on unknown action name', async () => { /* ... */ });

  it('400s when the node is not a component', async () => { /* ... */ });

  it('400s when the action exists but is set-kind', async () => { /* ... */ });
});
```

Use the existing api.test.ts harness for seeding + dispatch.

**Step 2: Wire the route**

Below `/flows/:id/play/:nodeId` (after line 851), add:

```ts
api.post('/flows/:id/nodes/:nodeId/actions/:name', async (c) => {
  const id = c.req.param('id');
  const nodeId = c.req.param('nodeId');
  const actionName = c.req.param('name');
  const entry = registry.getById(id);
  if (!entry) return c.json({ error: 'unknown demo' }, 404);
  if (!events) return c.json({ error: 'events not enabled' }, 500);

  const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
  if (!existsSync(fullPath)) return c.json({ error: `Flow file not found: ${fullPath}` }, 404);
  const merged = readMergedFlow(fullPath);
  if (!merged.flow) return c.json({ error: merged.error ?? 'Flow read failed' }, 400);

  const node = merged.flow.nodes.find((n) => n.id === nodeId);
  if (!node) return c.json({ error: `Unknown nodeId: ${nodeId}` }, 404);
  if (node.type !== 'component') {
    return c.json({ error: `Node ${nodeId} is not a component node` }, 400);
  }
  const action = (node.data as { spec: { actions?: Record<string, ComponentAction> } })
    .spec.actions?.[actionName];
  if (!action) return c.json({ error: `Unknown action: ${actionName}` }, 404);

  const payload = await c.req.json().catch(() => ({}));
  const result = await runComponentAction({
    events, flowId: id, nodeId, cwd: entry.repoPath,
    actionName, action, payload,
    spawner: processSpawner,
  });
  if (!result.ok) return c.json({ error: result.error }, result.statusHint as never);
  return c.json(result.body);
});
```

Add imports for `runComponentAction` + `ComponentAction`.

**Step 3: Run, expect pass**

Run: `bun test apps/studio/src/api.test.ts -t "T-007"`
Expected: PASS.

**Step 4: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/api.test.ts
git commit -m "feat(component-node): POST /api/flows/:id/nodes/:nodeId/actions/:name endpoint"
```

---

## Phase 6 — Canvas registry + runtime

### Task 6.1: Add ComponentNodeData to canvas types

**Files:**
- Modify: `packages/canvas/src/types.ts`

**Step 1: Append after `HtmlNodeData`**

```ts
// Component spec primitives (mirrors apps/studio/src/schema.ts; the studio
// schema is the source of truth — these mirrors exist so the canvas doesn't
// import server-side Zod just to type its render path).
export interface ComponentSpecElement {
  type: string;
  props?: Record<string, unknown>;
  children?: string[];
  watch?: Record<string, unknown>;
}

export type ComponentAction =
  | { kind: 'set'; path: string; value: unknown }
  | { kind: 'script'; interpreter: string; args?: string[]; scriptPath: string; input?: unknown; timeoutMs?: number };

export interface ComponentSpec {
  root: string;
  elements: Record<string, ComponentSpecElement>;
  state?: Record<string, unknown>;
  actions?: Record<string, ComponentAction>;
}

export interface ComponentNodeData extends NodeSemanticBase, NodeVisual, NodeCapabilities {
  spec: ComponentSpec;
  autoSize?: boolean;
}
```

Update the `FlowNode` union to include the component variant:

```ts
| (NodeBase & { type: 'component'; data: ComponentNodeData });
```

Update `NodeType`:

```ts
export type NodeType = GeometricNodeType | 'image' | 'html' | 'icon' | 'component';
```

**Step 2: Typecheck**

Run: `cd packages/canvas && bun run typecheck`
Expected: no errors. (Any tests referencing exhaustive type unions may need a `'component'` arm.)

**Step 3: Commit**

```bash
git add packages/canvas/src/types.ts
git commit -m "feat(component-node): add ComponentNodeData to @seeflow/canvas types"
```

---

### Task 6.2: Failing test for ComponentRuntime — set action

**Files:**
- Create: `packages/canvas/src/nodes/component-runtime.test.tsx`

**Step 1: Test (use the existing hook-shim test pattern from html-node.test.tsx)**

```tsx
import { describe, expect, it } from 'bun:test';
import { render, screen, fireEvent } from '@testing-library/react'; // or whatever harness exists
import { ComponentRuntime } from './component-runtime.tsx';
import type { ComponentSpec } from '../types.ts';

const spec: ComponentSpec = {
  root: 'r',
  state: { '/count': 0 },
  actions: { inc: { kind: 'set', path: '/count', value: { $param: 'next' } } },
  elements: {
    r: { type: 'Button', props: { label: { $state: '/count' }, onClick: { $action: 'inc' } } },
  },
};

describe('ComponentRuntime', () => {
  it('renders initial state into props', () => {
    render(<ComponentRuntime spec={spec} nodeId="n1" />);
    expect(screen.getByRole('button').textContent).toBe('0');
  });

  it('dispatches a set action that mutates state and re-renders', () => {
    render(<ComponentRuntime spec={spec} nodeId="n1" />);
    fireEvent.click(screen.getByRole('button'));
    // onClick passes no payload, but the action's value resolves $param.next → undefined
    // Use a more realistic test: bind a Button that passes a literal value
    // (Adjust the spec accordingly.)
  });
});
```

> Adapt to the actual test harness used by the canvas package — `packages/canvas/src/nodes/html-node.test.tsx` is the canonical example. If it uses a hook-shim (no DOM), the test should call ComponentRuntime as a function and assert against the returned tree.

Run: FAIL — module does not exist.

---

### Task 6.3: Implement ComponentRuntime

**Files:**
- Create: `packages/canvas/src/nodes/component-runtime.tsx`

The runtime needs to:
1. Seed React state from `spec.state ?? {}` (keyed by JSON Pointer paths).
2. Resolve `$state` / `$action` / `$cond` references in props at render time.
3. Provide a dispatch function that handles both `set` (sync, in-process) and `script` (POST to backend).
4. Mount the catalog-registered React components.

**Step 1: Implement**

```tsx
import { useCallback, useReducer, type ReactNode } from 'react';
import type { ComponentSpec, ComponentAction } from '../types.ts';
import { componentRegistry } from '../registry/component-registry.tsx';

// JSON Pointer get/set on a plain object tree.
const ptrGet = (state: Record<string, unknown>, path: string): unknown => state[path];
const ptrSet = (state: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> => ({ ...state, [path]: value });

type Action =
  | { kind: 'set'; path: string; value: unknown }
  | { kind: 'merge'; partial: Record<string, unknown> };

function reducer(state: Record<string, unknown>, action: Action): Record<string, unknown> {
  if (action.kind === 'set') return ptrSet(state, action.path, action.value);
  if (action.kind === 'merge') return { ...state, ...action.partial };
  return state;
}

function isRef(v: unknown): v is { $state?: string; $action?: string; $param?: string; $cond?: unknown; $then?: unknown; $else?: unknown } {
  return v !== null && typeof v === 'object' && (
    '$state' in v || '$action' in v || '$param' in v || '$cond' in v
  );
}

function resolveProps(
  props: Record<string, unknown> | undefined,
  state: Record<string, unknown>,
  dispatch: (name: string, payload?: unknown) => void,
  actionNames: Set<string>,
): Record<string, unknown> {
  if (!props) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = resolveValue(v, state, dispatch, actionNames);
  }
  return out;
}

function resolveValue(
  v: unknown,
  state: Record<string, unknown>,
  dispatch: (name: string, payload?: unknown) => void,
  actionNames: Set<string>,
): unknown {
  if (!isRef(v)) return v;
  if (typeof v.$state === 'string') return ptrGet(state, v.$state);
  if (typeof v.$action === 'string' && actionNames.has(v.$action)) {
    return (payload?: unknown) => dispatch(v.$action!, payload);
  }
  if ('$cond' in v) {
    const cond = resolveValue(v.$cond, state, dispatch, actionNames);
    return cond ? resolveValue(v.$then, state, dispatch, actionNames)
                : resolveValue(v.$else, state, dispatch, actionNames);
  }
  return v;
}

export interface ComponentRuntimeProps {
  spec: ComponentSpec;
  nodeId: string;
  /** When provided, script-kind actions POST here. Tests can override. */
  apiBaseUrl?: string;
  flowId?: string;
}

export function ComponentRuntime({ spec, nodeId, apiBaseUrl = '/api', flowId }: ComponentRuntimeProps): ReactNode {
  const [state, dispatchState] = useReducer(reducer, spec.state ?? {});
  const actionNames = new Set(Object.keys(spec.actions ?? {}));

  const dispatch = useCallback(async (name: string, payload?: unknown) => {
    const action = spec.actions?.[name];
    if (!action) return;
    if (action.kind === 'set') {
      // Resolve { $param: ... } in value against the call payload.
      const resolveParam = (v: unknown): unknown => {
        if (v !== null && typeof v === 'object' && '$param' in v) {
          const ref = (v as { $param: string }).$param;
          return (payload as Record<string, unknown> | undefined)?.[ref];
        }
        if (v !== null && typeof v === 'object' && '$state' in v) {
          return ptrGet(state, (v as { $state: string }).$state);
        }
        return v;
      };
      dispatchState({ kind: 'set', path: action.path, value: resolveParam(action.value) });
      return;
    }
    // script kind: POST to action runner
    if (!flowId) return;
    try {
      const res = await fetch(`${apiBaseUrl}/flows/${flowId}/nodes/${nodeId}/actions/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });
      if (!res.ok) {
        const errText = await res.text();
        dispatchState({ kind: 'set', path: `/__errors/${name}`, value: errText });
        return;
      }
      const body = await res.json();
      if (body && typeof body === 'object') {
        dispatchState({ kind: 'merge', partial: body as Record<string, unknown> });
      }
    } catch (err) {
      dispatchState({ kind: 'set', path: `/__errors/${name}`, value: err instanceof Error ? err.message : String(err) });
    }
  }, [spec.actions, flowId, apiBaseUrl, nodeId, state]);

  const renderElement = (id: string): ReactNode => {
    const el = spec.elements[id];
    if (!el) return null;
    const Impl = componentRegistry.components[el.type];
    if (!Impl) return null;
    const props = resolveProps(el.props, state, dispatch, actionNames);
    const children = (el.children ?? []).map((cid) => <span key={cid}>{renderElement(cid)}</span>);
    return <Impl {...props}>{children.length > 0 ? children : undefined}</Impl>;
  };

  return <>{renderElement(spec.root)}</>;
}
```

**Step 2: Run, expect pass**

Run: `bun test packages/canvas/src/nodes/component-runtime.test.tsx`
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/canvas/src/nodes/component-runtime.tsx packages/canvas/src/nodes/component-runtime.test.tsx
git commit -m "feat(component-node): ComponentRuntime — state store, action dispatch, prop resolution"
```

---

### Task 6.4: Build the component registry (catalog → React impls)

**Files:**
- Create: `packages/canvas/src/registry/component-registry.tsx`

**Step 1: Implement**

```tsx
import { lazy, type ComponentType, type ReactNode } from 'react';
import { COMPONENT_NAMES } from '../catalog/component-catalog.ts';

// Static shadcn-backed primitives are loaded eagerly — they're small.
// Heavy components (Chart, Markdown, CodeBlock) are lazy.
import * as Shadcn from '@json-render/shadcn';

const LazyChart = lazy(() => import('./impls/chart.tsx'));
const LazyMarkdown = lazy(() => import('./impls/markdown.tsx'));
const LazyCodeBlock = lazy(() => import('./impls/code-block.tsx'));

// SeeFlow extras — small + eager.
import { SeeFlowHeading } from './impls/heading.tsx';
import { SeeFlowText } from './impls/text.tsx';
import { SeeFlowIcon } from './impls/icon.tsx';
import { SeeFlowTable } from './impls/table.tsx';
import { SeeFlowMetric } from './impls/metric.tsx';

type Impl = ComponentType<Record<string, unknown> & { children?: ReactNode }>;

const impls: Record<string, Impl> = {
  Card: Shadcn.Card,
  Separator: Shadcn.Separator,
  Tabs: Shadcn.Tabs,
  Accordion: Shadcn.Accordion,
  Badge: Shadcn.Badge,
  Avatar: Shadcn.Avatar,
  Progress: Shadcn.Progress,
  Skeleton: Shadcn.Skeleton,
  Label: Shadcn.Label,
  Button: Shadcn.Button,
  Input: Shadcn.Input,
  Checkbox: Shadcn.Checkbox,
  Switch: Shadcn.Switch,
  Select: Shadcn.Select,
  Textarea: Shadcn.Textarea,
  Slider: Shadcn.Slider,
  Heading: SeeFlowHeading,
  Text: SeeFlowText,
  Icon: SeeFlowIcon,
  Table: SeeFlowTable,
  Metric: SeeFlowMetric,
  Chart: LazyChart as Impl,
  Markdown: LazyMarkdown as Impl,
  CodeBlock: LazyCodeBlock as Impl,
};

// Sanity check at load time: every catalog name has an impl.
for (const name of COMPONENT_NAMES) {
  if (!impls[name]) {
    throw new Error(`componentRegistry: missing impl for catalog entry '${name}'`);
  }
}

export const componentRegistry = { components: impls };
```

**Step 2: Implement the SeeFlow extras + lazy entries**

Stub each impl file under `packages/canvas/src/registry/impls/`:

- `heading.tsx`: simple `<h1>`..`<h4>` based on `level` prop.
- `text.tsx`: `<p>` with optional `muted` class.
- `icon.tsx`: re-export the existing `Icon` from `../../ui/icon.tsx`.
- `table.tsx`: a small `<table>` rendering columns + rows.
- `metric.tsx`: a card with a label + a big number.
- `chart.tsx`: dynamic-import `recharts`, render BarChart/LineChart/AreaChart/PieChart by `kind`.
- `markdown.tsx`: `<ReactMarkdown remarkPlugins={[remarkGfm]}>`.
- `code-block.tsx`: dynamic-import `shiki`, render highlighted `<pre>`.

Each file uses literal Tailwind class strings (`sf:` prefix) per `packages/canvas/CLAUDE.md`.

**Step 3: Smoke test**

Add `packages/canvas/src/registry/component-registry.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { componentRegistry } from './component-registry.tsx';
import { COMPONENT_NAMES } from '../catalog/component-catalog.ts';

describe('componentRegistry', () => {
  it('has an impl for every catalog entry', () => {
    for (const name of COMPONENT_NAMES) {
      expect(componentRegistry.components[name]).toBeDefined();
    }
  });
});
```

Run: `bun test packages/canvas/src/registry/component-registry.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/canvas/src/registry/
git commit -m "feat(component-node): component-registry maps catalog → React impls (lazy heavy)"
```

---

### Task 6.5: Build the canvas node wrapper

**Files:**
- Create: `packages/canvas/src/nodes/component-node.tsx`
- Modify: `packages/canvas/src/nodes/index.ts` (export)
- Modify: `packages/canvas/src/index.ts` (public re-export)

**Step 1: Implement**

Mirror `html-node.tsx` for the chrome (handles, ResizeControls, label) but wrap the body in `<ComponentRuntime>`.

```tsx
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { memo, type CSSProperties } from 'react';
import { cn } from '../lib/cn.ts';
import { colorTokenStyle } from '../lib/color-tokens.ts';
import type { ComponentNodeData } from '../types.ts';
import { ComponentRuntime } from './component-runtime.tsx';
import { ResizeControls } from './resize-controls.tsx';
import { useResizeGesture } from './use-resize-gesture.ts';

export type ComponentNodeRuntimeData = ComponentNodeData & {
  onResize?: (id: string, dims: { width: number; height: number; x: number; y: number }) => void;
  onResizeEnd?: (id: string, dims: { width: number; height: number; x: number; y: number }) => void;
  setResizing?: (on: boolean) => void;
  /** flowId injected by the host so script-kind action dispatches can POST. */
  flowId?: string;
  apiBaseUrl?: string;
};
export type ComponentNodeType = Node<ComponentNodeRuntimeData, 'component'>;
export const COMPONENT_DEFAULT_SIZE = { width: 320, height: 240 } as const;

const HANDLE_CLASS = 'sf:opacity-0 sf:transition-opacity';

function ComponentNodeImpl({ id, data, selected, isConnectable }: NodeProps<ComponentNodeType>) {
  const { onResizeStart, onResizeEvent, onResizeEnd } = useResizeGesture({
    onResize: (dims) => data.onResize?.(id, dims),
    onResizeEnd: (dims) => data.onResizeEnd?.(id, dims),
    setResizing: data.setResizing,
  });
  const chromeStyle: CSSProperties = {
    ...(data.backgroundColor ? { backgroundColor: colorTokenStyle(data.backgroundColor, 'node').backgroundColor } : {}),
    ...(data.borderColor ? { borderColor: colorTokenStyle(data.borderColor, 'node').borderColor } : {}),
    ...(data.borderSize !== undefined ? { borderWidth: data.borderSize } : {}),
    ...(data.borderStyle !== undefined ? { borderStyle: data.borderStyle } : {}),
    ...(data.cornerRadius !== undefined ? { borderRadius: data.cornerRadius } : {}),
  };
  return (
    <div
      className="sf:group sf:relative"
      style={{ width: data.width ?? COMPONENT_DEFAULT_SIZE.width, height: data.height ?? COMPONENT_DEFAULT_SIZE.height }}
      data-testid="component-node"
      data-node-type="component"
    >
      <ResizeControls
        visible={!!selected && !!data.onResize}
        cornerVariant="visible"
        minWidth={80} minHeight={40}
        onResizeStart={onResizeStart} onResize={onResizeEvent} onResizeEnd={onResizeEnd}
      />
      <Handle type="target" position={Position.Top} id="t" isConnectable={isConnectable} className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')} />
      <Handle type="target" position={Position.Left} id="l" isConnectable={isConnectable} className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')} />
      <div className="sf:h-full sf:w-full sf:overflow-auto" style={chromeStyle}>
        <ComponentRuntime spec={data.spec} nodeId={id} flowId={data.flowId} apiBaseUrl={data.apiBaseUrl} />
      </div>
      <Handle type="source" position={Position.Right} id="r" isConnectable={isConnectable} className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')} />
      <Handle type="source" position={Position.Bottom} id="b" isConnectable={isConnectable} className={cn(HANDLE_CLASS, selected && 'sf:opacity-100!')} />
    </div>
  );
}

export const ComponentNode = memo(ComponentNodeImpl);
```

**Step 2: Export**

Add to `packages/canvas/src/nodes/index.ts`:

```ts
export { COMPONENT_DEFAULT_SIZE, ComponentNode } from './component-node.tsx';
export type { ComponentNodeRuntimeData, ComponentNodeType } from './component-node.tsx';
```

And update `packages/canvas/src/index.ts` in the matching numbered section (sorted).

**Step 3: Wire into seeflow-canvas**

`packages/canvas/src/components/seeflow-canvas.tsx:1140` — add `component: ComponentNode` to the `nodeTypes` map. Import `ComponentNode` at the top.

**Step 4: Test the wrapper**

Create `packages/canvas/src/nodes/component-node.test.tsx` mirroring `html-node.test.tsx`'s shape (hook-shim or RTL — match what exists).

**Step 5: Run + commit**

```bash
git add packages/canvas/src/nodes/component-node.tsx packages/canvas/src/nodes/component-node.test.tsx \
        packages/canvas/src/nodes/index.ts packages/canvas/src/index.ts \
        packages/canvas/src/components/seeflow-canvas.tsx
git commit -m "feat(component-node): ComponentNode canvas wrapper + seeflow-canvas registration"
```

---

## Phase 7 — Web integration + flowId injection

### Task 7.1: Thread `flowId` into component node data

**Files:**
- Modify: `apps/web/src/...` (wherever `sourceNodes` is built — search for `projectId` injection used by ImageNode for the pattern)

**Step 1: Find the injection point**

```bash
grep -rn "projectId\s*[:=]" apps/web/src/ | head -10
```

The canvas takes a `projectId` prop and the host's `sourceNodes` builder injects per-node fields like `_uploading` for images. Add a parallel injector for `'component'` nodes that copies `projectId` → `flowId` so script-kind dispatches know where to POST.

**Step 2: Inject**

In the builder, for each `'component'` node, set `data.flowId = projectId` and `data.apiBaseUrl` to the configured base (default `/api`).

**Step 3: Manual smoke test**

Run: `bun run dev`
Create a flow with a component node (use a hand-written `nodes/<id>/spec.json` containing a Button + set action).
Click the button, expect state mutation to re-render.

**Step 4: Commit**

```bash
git commit -m "feat(component-node): inject flowId into component node runtime data"
```

---

## Phase 8 — End-to-end test

### Task 8.1: Playwright E2E

**Files:**
- Create: `apps/studio/e2e/component-node.spec.ts`
- Create: `apps/studio/e2e/fixtures/component-demo/flow.json`
- Create: `apps/studio/e2e/fixtures/component-demo/nodes/c1/spec.json`
- Create: `apps/studio/e2e/fixtures/component-demo/nodes/c1/actions/inc.ts`

**Step 1: Build the fixture**

`flow.json`:

```json
{
  "version": 2,
  "name": "component demo",
  "nodes": [{ "id": "c1", "type": "component", "data": {} }],
  "connectors": []
}
```

`nodes/c1/spec.json`:

```json
{
  "root": "wrap",
  "state": { "/count": 0 },
  "actions": {
    "inc":  { "kind": "set",    "path": "/count", "value": { "$param": "next" } },
    "fetch": { "kind": "script", "interpreter": "bun", "scriptPath": "actions/inc.ts" }
  },
  "elements": {
    "wrap": { "type": "Card", "props": { "title": "Counter" }, "children": ["m", "b1", "b2"] },
    "m":    { "type": "Metric", "props": { "label": "Count", "value": { "$state": "/count" } } },
    "b1":   { "type": "Button", "props": { "label": "Reset", "onClick": { "$action": "inc" } } },
    "b2":   { "type": "Button", "props": { "label": "Fetch",  "onClick": { "$action": "fetch" } } }
  }
}
```

`nodes/c1/actions/inc.ts`:

```ts
const chunks: Uint8Array[] = [];
for await (const c of Bun.stdin.stream()) chunks.push(c);
const payload = JSON.parse(Buffer.concat(chunks).toString() || '{}');
console.log(JSON.stringify({ '/count': (payload.from ?? 0) + 1 }));
```

**Step 2: Test**

```ts
test('component node — set action mutates state', async ({ page }) => { /* ... */ });
test('component node — script action POSTs and merges response into state', async ({ page }) => { /* ... */ });
```

Use the existing e2e harness (`apps/studio/scripts/run-e2e.ts` auto-runs through Docker on non-Linux).

**Step 3: Generate baselines**

Run: `bun run test:it:update-snapshots`
Commit only the `*-chromium-linux.png` outputs (per `CLAUDE.md`).

**Step 4: Commit**

```bash
git add apps/studio/e2e/component-node.spec.ts apps/studio/e2e/fixtures/component-demo/ apps/studio/e2e/__snapshots__/component-node*
git commit -m "test(component-node): e2e covering set + script actions"
```

---

## Phase 9 — Docs

### Task 9.1: Update README + design status

**Files:**
- Modify: `docs/plans/2026-05-23-component-node-design.md` (flip Status: Design → Status: Implemented)
- Modify: `README.md` (add a one-paragraph entry about the `'component'` type and where `spec.json` lives)
- Optional: a small `docs/component-node-quickstart.md`

**Step 1: Update both files**

**Step 2: Commit**

```bash
git commit -m "docs(component-node): mark design as implemented + readme update"
```

---

## Open issues / follow-ups (NOT part of this plan)

- **Auto-exposed CLI surfaces** (`seeflow schema node`, MCP shim) — these reflect off `NodeTypeSchema` automatically per the design doc's "Auto-exposed surfaces" section. Verify in a follow-up; no per-type wiring needed unless something's hardcoded.
- **HTML-style autoSize on component nodes.** The schema includes `autoSize?: boolean` for parity; this plan does NOT implement the measure-and-fit machinery (mirror `htmlNode`'s AutoSizeObserver in a follow-up if authors ask).
- **Visual editor for spec authoring** — out of scope per design Non-goal #3.
- **Cross-node state syncing / SSE state mirror** — out of scope per Non-goal #5.

---

## Verification checklist (run before declaring done)

- [ ] `bun run typecheck` — green across all workspaces
- [ ] `bun run lint` (Biome) — green
- [ ] `bun test` — all unit tests green
- [ ] `bun run test:it:e2e` — e2e green (with `*-chromium-linux.png` baselines)
- [ ] Manual: create a component node fixture, run `bun run dev`, click through a set + script action in the browser
- [ ] `seeflow schema node` lists `'component'` (sanity)
- [ ] `git diff --stat origin/main..HEAD` matches the file plan above (no surprise touches)
