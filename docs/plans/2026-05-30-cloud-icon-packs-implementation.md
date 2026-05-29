# Cloud icon packs (AWS / GCP / Azure) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let SeeFlow authors install and use AWS, GCP, and Azure architecture icon packs — driven from the canvas Browse Packs UI (one-click install with live progress) and a parity `seeflow icons` CLI.

**Architecture:** A shared installer module in `apps/studio/src/icons/installer.ts` owns vendor pack download + extraction + indexing into `~/.seeflow/icons/<vendor>/<version>/`. Both the CLI (`apps/studio/src/cli.ts`) and the studio HTTP server (`apps/studio/src/api.ts`) invoke it; the HTTP path streams `InstallEvent`s back via SSE for the picker's progress UI. On the disk schema, `data.icon` stays a single string — already validated by `apps/studio/src/schema.ts` — using a `vendor:name` encoding (`"aws:lambda"`, `"iconify:logos:google-cloud"`; unprefixed names keep their current meaning as bundled Lucide icons, preserving every existing flow). In `@seeflow/canvas`, a new `resolveIcon(iconId)` returns either a Lucide component, a remote SVG URL served from the studio, or an inline Iconify component, and the existing `IconPickerPopover` grows vendor tabs + a Browse Packs view.

**Tech Stack:** Bun + Hono (studio), TypeScript strict + `noUncheckedIndexedAccess`, Zod schemas, React 18 + xyflow (canvas), Tailwind v4 with `sf:` prefix (canvas package only), Biome for lint/format, `fflate` for ZIP extraction (already in `apps/studio/devDependencies`), `@iconify-json/logos` (new dependency, MIT).

**Conventions you must follow before writing any code:**

- Format BEFORE lint: `bun run format && bun run lint`.
- TS: 2-space indent, 100-char width, single quotes, trailing commas, semicolons (Biome).
- Tests live beside sources (`foo.ts` + `foo.test.ts`). Run unit tests with `bun test`.
- Integration tests: `apps/studio/integration/*.it.ts`, run with `bun run test:it:bun` or `bun run test:it`.
- E2E: `apps/studio/e2e/*.e2e.ts` — Playwright dispatched to chromium-linux Docker on darwin via `bun run test:it:e2e`.
- After ANY edit to `apps/studio/src/schema.ts`, run `make sync-seeflow-schema` then `make verify-seeflow-schema-sync`. CI gates on the verify step.
- Canvas package uses Tailwind v4 `sf:` prefix on EVERY class. Run `bun run --filter @seeflow/canvas build` after any canvas edit.
- Canvas hook-shim tests rely on stable `useState` declaration order. Any new `useState` inside `seeflow-canvas.tsx` MUST be appended at the END of the body (see `packages/canvas/CLAUDE.md`). Same rule for any other component with a dispatcher-shim test.
- Canvas mutations route through `CanvasAdapter` (`packages/canvas/src/adapter/types.ts`). The picker MUST NOT `fetch()` directly — extend the adapter with icon methods and let the host (`apps/web`) implement them.
- Commit frequency: one commit per task. Use Conventional Commit prefixes (`feat:`, `test:`, `chore:`, `docs:`).

**Out of scope (do not attempt in this plan):**

- Bundling official packs into the published `@tuongaz/seeflow` artifact. Packs are user-installed at runtime.
- Per-project icon overrides. Cache is global at `~/.seeflow/icons/`.
- Search across vendors by alias ("functions" → Lambda + Azure Functions + Cloud Functions). Search is per-name, vendor-scoped.

---

## Stage 0: Identifier layer (foundation, ~5 tasks)

### Task 0.1: Create the `IconId` parser + formatter

**Files:**
- Create: `packages/canvas/src/lib/icon-id.ts`
- Test: `packages/canvas/src/lib/icon-id.test.ts`

**Step 1: Write the failing test**

```ts
// packages/canvas/src/lib/icon-id.test.ts
import { describe, expect, it } from 'bun:test';
import { formatIconId, parseIconId, type IconId } from './icon-id.ts';

describe('parseIconId', () => {
  it('treats an unprefixed name as a bundled Lucide icon', () => {
    expect(parseIconId('database')).toEqual({ vendor: 'lucide', name: 'database' });
  });

  it('parses a vendor prefix', () => {
    expect(parseIconId('aws:lambda')).toEqual({ vendor: 'aws', name: 'lambda' });
    expect(parseIconId('gcp:cloud-functions')).toEqual({ vendor: 'gcp', name: 'cloud-functions' });
    expect(parseIconId('azure:functions')).toEqual({ vendor: 'azure', name: 'functions' });
  });

  it('parses an iconify prefix with a collection segment', () => {
    expect(parseIconId('iconify:logos:google-cloud')).toEqual({
      vendor: 'iconify',
      name: 'logos:google-cloud',
    });
  });

  it('returns null for empty input or unknown vendor', () => {
    expect(parseIconId('')).toBeNull();
    expect(parseIconId('unknown:foo')).toBeNull();
  });
});

describe('formatIconId', () => {
  it('omits the vendor prefix for Lucide', () => {
    expect(formatIconId({ vendor: 'lucide', name: 'database' })).toBe('database');
  });

  it('prefixes every other vendor', () => {
    expect(formatIconId({ vendor: 'aws', name: 'lambda' })).toBe('aws:lambda');
    expect(formatIconId({ vendor: 'iconify', name: 'logos:google-cloud' })).toBe(
      'iconify:logos:google-cloud',
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/canvas/src/lib/icon-id.test.ts`
Expected: FAIL with `Cannot find module './icon-id.ts'`.

**Step 3: Write minimal implementation**

```ts
// packages/canvas/src/lib/icon-id.ts
export type IconVendor = 'lucide' | 'aws' | 'gcp' | 'azure' | 'iconify';

export interface IconId {
  vendor: IconVendor;
  name: string;
}

const VENDORS: ReadonlySet<IconVendor> = new Set(['lucide', 'aws', 'gcp', 'azure', 'iconify']);

export function parseIconId(raw: string): IconId | null {
  if (raw.length === 0) return null;
  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) return { vendor: 'lucide', name: raw };
  const prefix = raw.slice(0, colonIdx);
  const rest = raw.slice(colonIdx + 1);
  if (rest.length === 0) return null;
  if (!VENDORS.has(prefix as IconVendor)) return null;
  return { vendor: prefix as IconVendor, name: rest };
}

export function formatIconId(id: IconId): string {
  if (id.vendor === 'lucide') return id.name;
  return `${id.vendor}:${id.name}`;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test packages/canvas/src/lib/icon-id.test.ts`
Expected: PASS, 5/5 expectations.

**Step 5: Commit**

```bash
bun run format && bun run lint
git add packages/canvas/src/lib/icon-id.ts packages/canvas/src/lib/icon-id.test.ts
git commit -m "feat(canvas): add IconId parser + formatter for vendor-prefixed icons"
```

---

### Task 0.2: Export the new types through the canvas public barrel

**Files:**
- Modify: `packages/canvas/src/index.ts` (append in the existing alphabetized "lib" section — look for the closest neighbor, e.g. `icon-recents` or `icon-registry` re-exports)

**Step 1: Read the current barrel to find the correct numbered section**

Run: `grep -n "icon-registry\|icon-recents\|icon-insert" packages/canvas/src/index.ts`

**Step 2: Add the export at the end of that section**

```ts
export { type IconId, type IconVendor, formatIconId, parseIconId } from './lib/icon-id.ts';
```

**Step 3: Verify the canvas builds**

Run: `bun run --filter @seeflow/canvas build`
Expected: build succeeds, no TS errors.

**Step 4: Commit**

```bash
git add packages/canvas/src/index.ts
git commit -m "chore(canvas): export IconId helpers from public barrel"
```

---

### Task 0.3: Document the `data.icon` encoding on the Zod schema (no shape change)

`apps/studio/src/schema.ts` already declares `data.icon` as `z.string()`. We are NOT changing the schema shape — just widening the human description so agents authoring flows know about the `vendor:name` encoding.

**Files:**
- Modify: `apps/studio/src/schema.ts` — two `.describe(...)` calls at lines `~84-89` (decorative `icon` in `NodeSemanticBaseShape`) and `~573-578` (required `icon` in the `type:'icon'` data schema)

**Step 1: Write the failing test**

```ts
// apps/studio/src/schema.test.ts (append to existing file)
import { FlowSchema } from './schema.ts';

it('accepts vendor-prefixed icon names on the decorative icon field', () => {
  const flow = {
    id: 'p/f',
    name: 'F',
    nodes: [
      {
        id: 'n1',
        type: 'rectangle',
        position: { x: 0, y: 0 },
        data: { icon: 'aws:lambda' },
      },
    ],
    connectors: [],
  };
  expect(FlowSchema.safeParse(flow).success).toBe(true);
});

it('accepts vendor-prefixed icon names on type:icon nodes', () => {
  const flow = {
    id: 'p/f',
    name: 'F',
    nodes: [
      {
        id: 'n1',
        type: 'icon',
        position: { x: 0, y: 0 },
        data: { icon: 'azure:functions' },
      },
    ],
    connectors: [],
  };
  expect(FlowSchema.safeParse(flow).success).toBe(true);
});
```

Read the existing `schema.test.ts` first to match the surrounding `describe()` block and to confirm node shapes (id, position formats) the existing tests use — adjust the fixtures accordingly so the test assertions are about the icon field, not unrelated fields.

**Step 2: Run test to verify both pass already**

Run: `bun test apps/studio/src/schema.test.ts -t 'vendor-prefixed'`
Expected: PASS (the schema is permissive about icon string content — these assertions document existing behavior so a future tightening doesn't regress us).

**Step 3: Update the descriptions**

In `apps/studio/src/schema.ts` change the two icon `.describe(...)` strings to include the prefix convention. Example for the decorative one (line ~88):

```ts
icon: z
  .string()
  .optional()
  .describe(
    "Decorative header glyph. Unprefixed = bundled Lucide kebab-name (e.g. 'database', 'cloud-upload'). Vendor-prefixed = installed pack: 'aws:lambda', 'gcp:cloud-functions', 'azure:functions', or 'iconify:<collection>:<name>'. Falls back to a placeholder when unknown. On type:'icon' nodes the icon IS the visual and is required.",
  ),
```

Mirror the change in the `type:'icon'` data block (line ~573).

**Step 4: Sync the vendored schema**

Run: `make sync-seeflow-schema && make verify-seeflow-schema-sync`
Expected: both succeed; the vendored copy at `skills/seeflow/vendored/schema.ts` is updated.

**Step 5: Run unit tests**

Run: `bun test apps/studio/src/schema.test.ts`
Expected: PASS, no regressions.

**Step 6: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/schema.ts skills/seeflow/vendored/schema.ts apps/studio/src/schema.test.ts
git commit -m "docs(schema): document vendor:name icon encoding"
```

---

## Stage 1: Cache + installer (AWS only, ~9 tasks)

This stage builds the installer module that the CLI and HTTP server will both call. AWS is the first vendor — GCP and Azure piggyback on the same shape in Stage 5.

### Task 1.1: Paths for the icon cache

**Files:**
- Create: `apps/studio/src/icons/paths.ts`
- Test: `apps/studio/src/icons/paths.test.ts`

**Step 1: Write the failing test**

```ts
// apps/studio/src/icons/paths.test.ts
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { seeflowHome } from '../paths.ts';
import { iconCacheRoot, iconIndexPath, iconLockPath, iconVendorRoot } from './paths.ts';

describe('icon paths', () => {
  it('roots the cache at ~/.seeflow/icons', () => {
    expect(iconCacheRoot()).toBe(join(seeflowHome(), 'icons'));
  });

  it('namespaces the vendor directory and the version tag', () => {
    expect(iconVendorRoot('aws', '2026-05-30')).toBe(
      join(seeflowHome(), 'icons', 'aws', '2026-05-30'),
    );
  });

  it('keeps locks separate from data', () => {
    expect(iconLockPath('aws')).toBe(join(seeflowHome(), 'icons', '.locks', 'aws.lock'));
  });

  it('places the index at the cache root', () => {
    expect(iconIndexPath()).toBe(join(seeflowHome(), 'icons', 'index.json'));
  });
});
```

**Step 2: Run test to verify failure**

Run: `bun test apps/studio/src/icons/paths.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```ts
// apps/studio/src/icons/paths.ts
import { join } from 'node:path';
import { seeflowHome } from '../paths.ts';

export type IconVendor = 'aws' | 'gcp' | 'azure';

export const iconCacheRoot = (): string => join(seeflowHome(), 'icons');
export const iconVendorRoot = (vendor: IconVendor, version: string): string =>
  join(iconCacheRoot(), vendor, version);
export const iconLockPath = (vendor: IconVendor): string =>
  join(iconCacheRoot(), '.locks', `${vendor}.lock`);
export const iconIndexPath = (): string => join(iconCacheRoot(), 'index.json');
```

**Step 4: Run tests**

Run: `bun test apps/studio/src/icons/paths.test.ts`
Expected: PASS, 4/4.

**Step 5: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/icons/
git commit -m "feat(icons): paths helpers for ~/.seeflow/icons cache"
```

---

### Task 1.2: Pack index reader/writer (atomic)

`index.json` is the source of truth for what's installed and where each icon resolves. Read it on every cache query; write it atomically (via `atomic-write.ts`, already in `apps/studio/src/`).

**Files:**
- Create: `apps/studio/src/icons/index-store.ts`
- Test: `apps/studio/src/icons/index-store.test.ts`

**Step 1: Write the failing test**

```ts
// apps/studio/src/icons/index-store.test.ts
import { describe, expect, it, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type IconIndex, readIndex, upsertPack, writeIndex } from './index-store.ts';

let cacheRoot: string;
beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'sf-icons-'));
});

describe('readIndex', () => {
  it('returns an empty index when the file is missing', () => {
    const idx = readIndex(cacheRoot);
    expect(idx).toEqual({ version: 1, packs: {} });
  });
});

describe('writeIndex / upsertPack', () => {
  it('round-trips an installed pack', () => {
    const idx: IconIndex = { version: 1, packs: {} };
    const next = upsertPack(idx, {
      vendor: 'aws',
      version: '2026-05-30',
      installedAt: 1000,
      sizeBytes: 12345,
      icons: { lambda: 'aws/2026-05-30/lambda.svg' },
    });
    writeIndex(cacheRoot, next);
    expect(readIndex(cacheRoot)).toEqual(next);
  });

  it('replaces an existing vendor entry on re-install', () => {
    const first: IconIndex = {
      version: 1,
      packs: { aws: { vendor: 'aws', version: '1', installedAt: 1, sizeBytes: 1, icons: {} } },
    };
    writeIndex(cacheRoot, first);
    const next = upsertPack(first, {
      vendor: 'aws',
      version: '2',
      installedAt: 2,
      sizeBytes: 2,
      icons: { lambda: 'aws/2/lambda.svg' },
    });
    expect(next.packs.aws?.version).toBe('2');
  });
});

// cleanup
import { afterEach } from 'bun:test';
afterEach(() => rmSync(cacheRoot, { recursive: true, force: true }));
```

**Step 2: Run to verify failure**

Run: `bun test apps/studio/src/icons/index-store.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```ts
// apps/studio/src/icons/index-store.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from '../atomic-write.ts';
import type { IconVendor } from './paths.ts';

export interface InstalledPack {
  vendor: IconVendor;
  version: string;
  installedAt: number;
  sizeBytes: number;
  /** Map of canonical icon name → cache-root-relative SVG path. */
  icons: Record<string, string>;
}

export interface IconIndex {
  version: 1;
  packs: Partial<Record<IconVendor, InstalledPack>>;
}

const EMPTY: IconIndex = { version: 1, packs: {} };

export function readIndex(cacheRoot: string): IconIndex {
  const file = join(cacheRoot, 'index.json');
  if (!existsSync(file)) return { ...EMPTY };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as IconIndex;
    if (parsed?.version !== 1 || typeof parsed.packs !== 'object') return { ...EMPTY };
    return parsed;
  } catch {
    return { ...EMPTY };
  }
}

export function writeIndex(cacheRoot: string, idx: IconIndex): void {
  writeFileAtomic(join(cacheRoot, 'index.json'), JSON.stringify(idx, null, 2));
}

export function upsertPack(idx: IconIndex, pack: InstalledPack): IconIndex {
  return { version: 1, packs: { ...idx.packs, [pack.vendor]: pack } };
}

export function removePack(idx: IconIndex, vendor: IconVendor): IconIndex {
  const { [vendor]: _omit, ...rest } = idx.packs;
  return { version: 1, packs: rest };
}
```

**Step 4: Verify `atomic-write.ts` exports `writeFileAtomic` with that name and signature**

Run: `grep -n "export" apps/studio/src/atomic-write.ts | head`
Expected: `export function writeFileAtomic(path: string, content: string)` or similar. Adjust the import name in the implementation to match exactly.

**Step 5: Run tests**

Run: `bun test apps/studio/src/icons/index-store.test.ts`
Expected: PASS, 3/3.

**Step 6: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/icons/index-store.ts apps/studio/src/icons/index-store.test.ts
git commit -m "feat(icons): atomic JSON index store for installed packs"
```

---

### Task 1.3: Installer event union + types

**Files:**
- Create: `apps/studio/src/icons/installer-types.ts`

**Step 1: Implement (no test needed — types only)**

```ts
// apps/studio/src/icons/installer-types.ts
import type { IconVendor } from './paths.ts';

export type InstallEvent =
  | { type: 'terms-required'; vendor: IconVendor; licenseUrl: string }
  | { type: 'download-started'; vendor: IconVendor; expectedBytes: number | null }
  | { type: 'download-progress'; vendor: IconVendor; receivedBytes: number }
  | { type: 'extracting'; vendor: IconVendor }
  | { type: 'indexing'; vendor: IconVendor; iconCount: number }
  | { type: 'done'; vendor: IconVendor; version: string; iconCount: number }
  | { type: 'error'; vendor: IconVendor; message: string };

export interface InstallOptions {
  acceptTerms?: boolean;
  /** Optional URL override for tests; production picks the vendor default. */
  packUrl?: string;
}
```

**Step 2: Confirm typecheck passes**

Run: `bun run typecheck`
Expected: PASS.

**Step 3: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/icons/installer-types.ts
git commit -m "feat(icons): installer event union types"
```

---

### Task 1.4: AWS filename → canonical name normalizer

AWS pack filenames look like `Arch_AWS-Lambda_64.svg`, `Arch_Amazon-S3_64.svg`, `Arch-Category_Compute_64.svg`. We want canonical kebab-names: `lambda`, `s3`, `compute`.

**Files:**
- Create: `apps/studio/src/icons/normalize-aws.ts`
- Test: `apps/studio/src/icons/normalize-aws.test.ts`

**Step 1: Write the failing test**

```ts
// apps/studio/src/icons/normalize-aws.test.ts
import { describe, expect, it } from 'bun:test';
import { canonicalAwsName } from './normalize-aws.ts';

describe('canonicalAwsName', () => {
  it('strips Arch_ and AWS-/Amazon- prefixes and size suffix', () => {
    expect(canonicalAwsName('Arch_AWS-Lambda_64.svg')).toBe('lambda');
    expect(canonicalAwsName('Arch_Amazon-S3_64.svg')).toBe('s3');
    expect(canonicalAwsName('Arch_Amazon-EC2_64.svg')).toBe('ec2');
  });

  it('handles category icons', () => {
    expect(canonicalAwsName('Arch-Category_Compute_64.svg')).toBe('compute');
  });

  it('lowercases and kebabs multi-word service names', () => {
    expect(canonicalAwsName('Arch_AWS-Step-Functions_64.svg')).toBe('step-functions');
    expect(canonicalAwsName('Arch_Amazon-API-Gateway_64.svg')).toBe('api-gateway');
  });

  it('returns null for non-SVG files', () => {
    expect(canonicalAwsName('README.txt')).toBeNull();
  });
});
```

**Step 2: Run to fail**

Run: `bun test apps/studio/src/icons/normalize-aws.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```ts
// apps/studio/src/icons/normalize-aws.ts
const STRIP_PREFIXES = ['Arch_AWS-', 'Arch_Amazon-', 'Arch_', 'Arch-Category_'];
const SIZE_SUFFIX = /_(?:16|32|48|64)$/;

export function canonicalAwsName(filename: string): string | null {
  if (!filename.toLowerCase().endsWith('.svg')) return null;
  let base = filename.slice(0, -'.svg'.length);
  for (const prefix of STRIP_PREFIXES) {
    if (base.startsWith(prefix)) {
      base = base.slice(prefix.length);
      break;
    }
  }
  base = base.replace(SIZE_SUFFIX, '');
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
```

**Step 4: Run tests**

Run: `bun test apps/studio/src/icons/normalize-aws.test.ts`
Expected: PASS, 4/4.

**Step 5: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/icons/normalize-aws.ts apps/studio/src/icons/normalize-aws.test.ts
git commit -m "feat(icons): AWS filename → canonical name normalizer"
```

---

### Task 1.5: ZIP extraction utility (wraps `fflate`)

`fflate` is already in `apps/studio/devDependencies` — move it to `dependencies` so it ships with the published package.

**Files:**
- Modify: `apps/studio/package.json` (move `fflate` from `devDependencies` to `dependencies`)
- Create: `apps/studio/src/icons/extract-zip.ts`
- Test: `apps/studio/src/icons/extract-zip.test.ts`

**Step 1: Move fflate to dependencies**

Edit `apps/studio/package.json`: remove `fflate` from `devDependencies`, add `"fflate": "^0.8.2"` to `dependencies` keeping alpha order.

Run: `bun install`
Expected: lock file updates, fflate resolves.

**Step 2: Write the failing test**

```ts
// apps/studio/src/icons/extract-zip.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { extractZipToDir } from './extract-zip.ts';

let dest: string;
beforeEach(() => {
  dest = mkdtempSync(join(tmpdir(), 'sf-extract-'));
});
afterEach(() => rmSync(dest, { recursive: true, force: true }));

it('extracts every .svg from a ZIP, ignoring other entries', async () => {
  const zip = zipSync({
    'Arch_AWS-Lambda_64.svg': strToU8('<svg>lambda</svg>'),
    'README.txt': strToU8('skip me'),
    'subdir/Arch_Amazon-S3_64.svg': strToU8('<svg>s3</svg>'),
  });
  const written = await extractZipToDir(Buffer.from(zip), dest);
  expect(written.sort()).toEqual(['Arch_AWS-Lambda_64.svg', 'Arch_Amazon-S3_64.svg'].sort());
  expect(readFileSync(join(dest, 'Arch_AWS-Lambda_64.svg'), 'utf8')).toBe('<svg>lambda</svg>');
});

it('rejects paths that escape the dest dir', async () => {
  const zip = zipSync({ '../escape.svg': strToU8('<svg/>') });
  await expect(extractZipToDir(Buffer.from(zip), dest)).rejects.toThrow(/escape/);
});
```

**Step 3: Run to verify failure**

Run: `bun test apps/studio/src/icons/extract-zip.test.ts`
Expected: FAIL — module not found.

**Step 4: Implement**

```ts
// apps/studio/src/icons/extract-zip.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { unzipSync } from 'fflate';

export async function extractZipToDir(buffer: Buffer, destDir: string): Promise<string[]> {
  const entries = unzipSync(new Uint8Array(buffer));
  const written: string[] = [];
  const root = normalize(destDir) + sep;
  for (const [entryPath, data] of Object.entries(entries)) {
    if (!entryPath.toLowerCase().endsWith('.svg')) continue;
    const flatName = entryPath.split(/[\\/]/).pop();
    if (!flatName) continue;
    const target = normalize(join(destDir, flatName));
    if (!target.startsWith(root)) {
      throw new Error(`Zip entry escapes destination: ${entryPath}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    written.push(flatName);
  }
  return written;
}
```

**Step 5: Run tests**

Run: `bun test apps/studio/src/icons/extract-zip.test.ts`
Expected: PASS, 2/2.

**Step 6: Commit**

```bash
bun run format && bun run lint
git add apps/studio/package.json apps/studio/src/icons/extract-zip.ts apps/studio/src/icons/extract-zip.test.ts bun.lock
git commit -m "feat(icons): zip extraction utility (flattens, traversal-safe)"
```

---

### Task 1.6: Vendor descriptors (URLs + license metadata)

**Files:**
- Create: `apps/studio/src/icons/vendors.ts`

**Step 1: Implement (no test — pure data)**

```ts
// apps/studio/src/icons/vendors.ts
import type { IconVendor } from './paths.ts';
import { canonicalAwsName } from './normalize-aws.ts';

export interface VendorDescriptor {
  vendor: IconVendor;
  label: string;
  defaultPackUrl: string;
  /** Short summary; UI shows it inline. Authoritative terms live at `licenseUrl`. */
  licenseSummary: string;
  licenseUrl: string;
  /** Whether the user must affirmatively accept terms before install. */
  requiresAcceptance: boolean;
  /** Filename → canonical kebab-name; null = skip entry. */
  canonicalName: (filename: string) => string | null;
}

const AWS: VendorDescriptor = {
  vendor: 'aws',
  label: 'AWS',
  defaultPackUrl:
    'https://d1.awsstatic.com/webteam/architecture-icons/q1-2025/Asset-Package_02072025.7e4c5e.zip',
  licenseSummary:
    'Free to use in architecture diagrams. Attribution required for any public publication. See license URL for full terms.',
  licenseUrl: 'https://aws.amazon.com/architecture/icons/',
  requiresAcceptance: false,
  canonicalName: canonicalAwsName,
};

export const VENDOR_DESCRIPTORS: Record<IconVendor, VendorDescriptor> = {
  aws: AWS,
  gcp: AWS, // placeholder — overwritten in Stage 5.1
  azure: AWS, // placeholder — overwritten in Stage 5.2
};

export function vendorDescriptor(vendor: IconVendor): VendorDescriptor {
  return VENDOR_DESCRIPTORS[vendor];
}
```

> Note: GCP and Azure descriptors are stubbed to AWS here so the type system is satisfied. Stage 5 replaces them. The CLI will gate GCP/Azure behind explicit Stage 5 work by an `unsupportedVendor` check in the installer; do not let users install GCP/Azure with the placeholder URL.

**Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS.

**Step 3: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/icons/vendors.ts
git commit -m "feat(icons): vendor descriptor registry (AWS only — GCP/Azure stubbed)"
```

---

### Task 1.7: Concurrency lock (vendor-scoped)

**Files:**
- Create: `apps/studio/src/icons/lock.ts`
- Test: `apps/studio/src/icons/lock.test.ts`

**Step 1: Write the failing test**

```ts
// apps/studio/src/icons/lock.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withVendorLock } from './lock.ts';

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'sf-icons-lock-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('serializes concurrent installs of the same vendor', async () => {
  const lockPath = join(dir, 'aws.lock');
  const order: string[] = [];
  const a = withVendorLock(lockPath, async () => {
    order.push('a-start');
    await Bun.sleep(20);
    order.push('a-end');
  });
  const b = withVendorLock(lockPath, async () => {
    order.push('b-start');
    order.push('b-end');
  });
  await Promise.all([a, b]);
  expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
});
```

**Step 2: Run to fail**

Run: `bun test apps/studio/src/icons/lock.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement (in-memory mutex per lock path — single-process is sufficient; multi-process is out of scope per the plan header)**

```ts
// apps/studio/src/icons/lock.ts
const queues = new Map<string, Promise<unknown>>();

export async function withVendorLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(lockPath) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  queues.set(
    lockPath,
    run.catch(() => undefined),
  );
  try {
    return await run;
  } finally {
    if (queues.get(lockPath) === run.catch(() => undefined)) queues.delete(lockPath);
  }
}
```

**Step 4: Run tests**

Run: `bun test apps/studio/src/icons/lock.test.ts`
Expected: PASS, 1/1.

**Step 5: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/icons/lock.ts apps/studio/src/icons/lock.test.ts
git commit -m "feat(icons): in-process vendor lock for installer serialization"
```

---

### Task 1.8: The installer (`installIconPack`)

**Files:**
- Create: `apps/studio/src/icons/installer.ts`
- Test: `apps/studio/src/icons/installer.test.ts`

This is the centerpiece. The function returns an `AsyncGenerator<InstallEvent>` so callers can stream progress.

**Step 1: Write the failing test (uses a mocked `fetcher` to stay offline)**

```ts
// apps/studio/src/icons/installer.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { installIconPack } from './installer.ts';
import type { InstallEvent } from './installer-types.ts';
import { readIndex } from './index-store.ts';

let cache: string;
beforeEach(() => (cache = mkdtempSync(join(tmpdir(), 'sf-installer-'))));
afterEach(() => rmSync(cache, { recursive: true, force: true }));

function makeAwsZipBuffer(): Buffer {
  const zip = zipSync({
    'Arch_AWS-Lambda_64.svg': strToU8('<svg>lambda</svg>'),
    'Arch_Amazon-S3_64.svg': strToU8('<svg>s3</svg>'),
  });
  return Buffer.from(zip);
}

describe('installIconPack', () => {
  it('emits the full event sequence and writes the index', async () => {
    const events: InstallEvent[] = [];
    for await (const ev of installIconPack(
      { vendor: 'aws', acceptTerms: true },
      {
        cacheRoot: cache,
        now: () => 1000,
        version: () => '2026-05-30',
        fetcher: async () => makeAwsZipBuffer(),
      },
    )) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toEqual([
      'download-started',
      'extracting',
      'indexing',
      'done',
    ]);
    const idx = readIndex(cache);
    expect(idx.packs.aws?.icons).toEqual({
      lambda: 'aws/2026-05-30/Arch_AWS-Lambda_64.svg',
      s3: 'aws/2026-05-30/Arch_Amazon-S3_64.svg',
    });
    expect(existsSync(join(cache, 'aws', '2026-05-30', 'Arch_AWS-Lambda_64.svg'))).toBe(true);
    expect(readFileSync(join(cache, 'aws', '2026-05-30', 'Arch_Amazon-S3_64.svg'), 'utf8')).toBe(
      '<svg>s3</svg>',
    );
  });

  it('emits an error event when the fetcher throws', async () => {
    const events: InstallEvent[] = [];
    for await (const ev of installIconPack(
      { vendor: 'aws' },
      {
        cacheRoot: cache,
        now: () => 1,
        version: () => '1',
        fetcher: async () => {
          throw new Error('network down');
        },
      },
    )) {
      events.push(ev);
    }
    expect(events.at(-1)?.type).toBe('error');
  });
});
```

**Step 2: Run to fail**

Run: `bun test apps/studio/src/icons/installer.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```ts
// apps/studio/src/icons/installer.ts
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { extractZipToDir } from './extract-zip.ts';
import { readIndex, upsertPack, writeIndex } from './index-store.ts';
import type { InstallEvent, InstallOptions } from './installer-types.ts';
import { withVendorLock } from './lock.ts';
import { iconLockPath, iconVendorRoot, type IconVendor } from './paths.ts';
import { vendorDescriptor } from './vendors.ts';

export interface InstallerDeps {
  cacheRoot: string;
  /** Wall clock for installedAt. */
  now: () => number;
  /** Version tag for the pack (default: ISO date of `now()`). */
  version: () => string;
  /** ZIP fetcher; the production wiring uses `fetch` with progress reporting. */
  fetcher: (url: string) => Promise<Buffer>;
}

export async function* installIconPack(
  args: { vendor: IconVendor } & InstallOptions,
  deps: InstallerDeps,
): AsyncGenerator<InstallEvent> {
  const desc = vendorDescriptor(args.vendor);
  if (desc.requiresAcceptance && !args.acceptTerms) {
    yield { type: 'terms-required', vendor: args.vendor, licenseUrl: desc.licenseUrl };
    return;
  }

  const events: InstallEvent[] = [];
  await withVendorLock(iconLockPath(args.vendor), async () => {
    try {
      events.push({ type: 'download-started', vendor: args.vendor, expectedBytes: null });
      const buffer = await deps.fetcher(args.packUrl ?? desc.defaultPackUrl);

      events.push({ type: 'extracting', vendor: args.vendor });
      const version = deps.version();
      const destDir = iconVendorRoot(args.vendor, version);
      rmSync(destDir, { recursive: true, force: true });
      mkdirSync(destDir, { recursive: true });
      const writtenFilenames = await extractZipToDir(buffer, destDir);

      const icons: Record<string, string> = {};
      for (const filename of writtenFilenames) {
        const canonical = desc.canonicalName(filename);
        if (!canonical) continue;
        icons[canonical] = `${args.vendor}/${version}/${filename}`;
      }
      events.push({ type: 'indexing', vendor: args.vendor, iconCount: Object.keys(icons).length });

      const sizeBytes = Object.values(icons).length; // approximate; refine in 1.9
      const idx = readIndex(deps.cacheRoot);
      const next = upsertPack(idx, {
        vendor: args.vendor,
        version,
        installedAt: deps.now(),
        sizeBytes,
        icons,
      });
      writeIndex(deps.cacheRoot, next);

      events.push({
        type: 'done',
        vendor: args.vendor,
        version,
        iconCount: Object.keys(icons).length,
      });
    } catch (err) {
      events.push({
        type: 'error',
        vendor: args.vendor,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  for (const ev of events) yield ev;
}
```

**Step 4: Run tests**

Run: `bun test apps/studio/src/icons/installer.test.ts`
Expected: PASS, 2/2.

**Step 5: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/icons/installer.ts apps/studio/src/icons/installer.test.ts
git commit -m "feat(icons): installIconPack with event stream"
```

---

### Task 1.9: Production `fetcher` with byte-progress reporting

Wraps the global `fetch`. Reads the response body in chunks and emits `download-progress` via a callback.

**Files:**
- Create: `apps/studio/src/icons/fetcher.ts`
- Test: `apps/studio/src/icons/fetcher.test.ts` (uses a mock `fetch`)

**Step 1: Write the failing test**

```ts
// apps/studio/src/icons/fetcher.test.ts
import { describe, expect, it } from 'bun:test';
import { fetchWithProgress } from './fetcher.ts';

it('reads the body and reports byte progress', async () => {
  const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
  const fetchFn = async (): Promise<Response> => {
    const stream = new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(ch);
        c.close();
      },
    });
    return new Response(stream, { headers: { 'content-length': '5' } });
  };
  const progress: number[] = [];
  const buf = await fetchWithProgress('https://example.test/pack.zip', {
    fetchFn,
    onProgress: (received) => progress.push(received),
  });
  expect(Array.from(buf)).toEqual([1, 2, 3, 4, 5]);
  expect(progress).toEqual([3, 5]);
});
```

**Step 2: Run to fail**

Run: `bun test apps/studio/src/icons/fetcher.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```ts
// apps/studio/src/icons/fetcher.ts
export interface FetchWithProgressOptions {
  fetchFn?: typeof fetch;
  onProgress?: (receivedBytes: number) => void;
}

export async function fetchWithProgress(
  url: string,
  opts: FetchWithProgressOptions = {},
): Promise<Buffer> {
  const f = opts.fetchFn ?? fetch;
  const res = await f(url);
  if (!res.ok || !res.body) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      opts.onProgress?.(received);
    }
  }
  const total = chunks.reduce((acc, ch) => acc + ch.byteLength, 0);
  const buf = Buffer.alloc(total);
  let offset = 0;
  for (const ch of chunks) {
    buf.set(ch, offset);
    offset += ch.byteLength;
  }
  return buf;
}
```

**Step 4: Run tests**

Run: `bun test apps/studio/src/icons/fetcher.test.ts`
Expected: PASS, 1/1.

**Step 5: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/icons/fetcher.ts apps/studio/src/icons/fetcher.test.ts
git commit -m "feat(icons): fetchWithProgress streams body + reports bytes"
```

---

## Stage 2: CLI commands (~4 tasks)

### Task 2.1: `runIcons*` dispatcher in `cli.ts`

Add a single `runIcons()` function that switches on `argv[1]` (`list`, `add`, `update`, `remove`). This pattern mirrors the existing `runFlows*` family.

**Files:**
- Modify: `apps/studio/src/cli.ts` — add `else if (sub === 'icons')` branch in the dispatcher (the if/else chain near line 175) and add `runIcons()` near the end of the file.

**Step 1: Add the dispatch branch**

After the `flows:layout` branch (~line 199), insert:

```ts
} else if (sub === 'icons') {
  await runIcons();
```

**Step 2: Implement `runIcons` (skeleton; per-subcommand bodies land in 2.2-2.4)**

Append at the end of `cli.ts`:

```ts
async function runIcons() {
  const action = argv[1];
  switch (action) {
    case undefined:
    case 'list':
      await runIconsList();
      break;
    case 'add':
      await runIconsAdd();
      break;
    case 'update':
      await runIconsUpdate();
      break;
    case 'remove':
      await runIconsRemove();
      break;
    default:
      console.error(`Unknown icons action: ${action}`);
      console.error('Usage: seeflow icons {list|add|update|remove} ...');
      process.exit(1);
  }
}

async function runIconsList() {
  /* implemented in Task 2.2 */
}
async function runIconsAdd() {
  /* implemented in Task 2.3 */
}
async function runIconsUpdate() {
  /* implemented in Task 2.3 */
}
async function runIconsRemove() {
  /* implemented in Task 2.4 */
}
```

**Step 3: Verify the CLI still builds**

Run: `bun run --filter @tuongaz/seeflow typecheck`
Expected: PASS.

**Step 4: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/cli.ts
git commit -m "feat(cli): icons dispatcher skeleton"
```

---

### Task 2.2: `seeflow icons list`

**Files:**
- Modify: `apps/studio/src/cli.ts` (flesh out `runIconsList`)
- Test: `apps/studio/src/icons/list-helper.test.ts` (extract list logic into a pure helper)
- Create: `apps/studio/src/icons/list-helper.ts`

**Step 1: Write the failing test for the helper**

```ts
// apps/studio/src/icons/list-helper.test.ts
import { describe, expect, it } from 'bun:test';
import { summarizePacks } from './list-helper.ts';

it('summarizes installed + available vendors', () => {
  const summary = summarizePacks({
    version: 1,
    packs: {
      aws: { vendor: 'aws', version: '2026-05-30', installedAt: 1, sizeBytes: 100, icons: { lambda: 'aws/2026-05-30/lambda.svg' } },
    },
  });
  expect(summary).toEqual([
    { vendor: 'aws', installed: true, version: '2026-05-30', iconCount: 1, sizeBytes: 100 },
    { vendor: 'gcp', installed: false },
    { vendor: 'azure', installed: false },
  ]);
});
```

**Step 2: Run to fail**

Run: `bun test apps/studio/src/icons/list-helper.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement the helper**

```ts
// apps/studio/src/icons/list-helper.ts
import type { IconIndex } from './index-store.ts';
import type { IconVendor } from './paths.ts';

const ALL: IconVendor[] = ['aws', 'gcp', 'azure'];

export type PackSummary =
  | { vendor: IconVendor; installed: true; version: string; iconCount: number; sizeBytes: number }
  | { vendor: IconVendor; installed: false };

export function summarizePacks(idx: IconIndex): PackSummary[] {
  return ALL.map((vendor) => {
    const p = idx.packs[vendor];
    if (!p) return { vendor, installed: false };
    return {
      vendor,
      installed: true,
      version: p.version,
      iconCount: Object.keys(p.icons).length,
      sizeBytes: p.sizeBytes,
    };
  });
}
```

**Step 4: Run tests**

Run: `bun test apps/studio/src/icons/list-helper.test.ts`
Expected: PASS.

**Step 5: Wire the CLI to call the helper**

Replace the `runIconsList` stub in `cli.ts`:

```ts
async function runIconsList() {
  const { iconCacheRoot } = await import('./icons/paths.ts');
  const { readIndex } = await import('./icons/index-store.ts');
  const { summarizePacks } = await import('./icons/list-helper.ts');
  const idx = readIndex(iconCacheRoot());
  printOk({ packs: summarizePacks(idx) });
}
```

**Step 6: Smoke-test the CLI**

Run: `bun run apps/studio/src/cli.ts icons list`
Expected: `{"ok":true,"packs":[{"vendor":"aws","installed":false},{"vendor":"gcp","installed":false},{"vendor":"azure","installed":false}]}`

**Step 7: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/cli.ts apps/studio/src/icons/list-helper.ts apps/studio/src/icons/list-helper.test.ts
git commit -m "feat(cli): seeflow icons list"
```

---

### Task 2.3: `seeflow icons add` + `seeflow icons update`

Both reuse `installIconPack`. `update` is `add` after a `remove`.

**Files:**
- Modify: `apps/studio/src/cli.ts` (flesh out `runIconsAdd`, `runIconsUpdate`)

**Step 1: Implement (replace the stubs)**

```ts
async function runIconsAdd() {
  const vendor = argv[2];
  if (vendor !== 'aws' && vendor !== 'gcp' && vendor !== 'azure') {
    printError(`Usage: seeflow icons add {aws|gcp|azure} [--accept-terms]`);
  }
  if (vendor !== 'aws') {
    printError(`Vendor ${vendor} is not yet supported (Stage 5 work).`);
  }

  const { installIconPack } = await import('./icons/installer.ts');
  const { iconCacheRoot } = await import('./icons/paths.ts');
  const { fetchWithProgress } = await import('./icons/fetcher.ts');

  const events: string[] = [];
  let lastBytes = 0;
  for await (const ev of installIconPack(
    { vendor, acceptTerms: hasFlag('accept-terms') },
    {
      cacheRoot: iconCacheRoot(),
      now: () => Date.now(),
      version: () => new Date().toISOString().slice(0, 10),
      fetcher: (url) =>
        fetchWithProgress(url, {
          onProgress: (received) => {
            if (received - lastBytes > 256 * 1024) {
              process.stderr.write(`\r  downloaded ${(received / 1024 / 1024).toFixed(1)} MB`);
              lastBytes = received;
            }
          },
        }),
    },
  )) {
    events.push(ev.type);
    if (ev.type === 'terms-required') {
      printError(`License acceptance required. Pass --accept-terms after reading ${ev.licenseUrl}`);
    }
    if (ev.type === 'error') {
      process.stderr.write('\n');
      printError(ev.message);
    }
  }
  process.stderr.write('\n');
  printOk({ events });
}

async function runIconsUpdate() {
  // No-op-then-reinstall semantics: the installer's rmSync clears the old version.
  await runIconsAdd();
}
```

**Step 2: Smoke-test (offline — point at a local fixture)**

Skip the live download — the unit test in 1.8 already covers the installer. For now just verify `runIconsAdd` parses args and rejects unsupported vendors:

Run: `bun run apps/studio/src/cli.ts icons add gcp 2>&1`
Expected: `Vendor gcp is not yet supported (Stage 5 work).`

Run: `bun run apps/studio/src/cli.ts icons add 2>&1`
Expected: `Usage: seeflow icons add {aws|gcp|azure} [--accept-terms]`

**Step 3: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/cli.ts
git commit -m "feat(cli): seeflow icons add + update (AWS)"
```

---

### Task 2.4: `seeflow icons remove`

**Files:**
- Modify: `apps/studio/src/cli.ts`
- Create: `apps/studio/src/icons/remove.ts`
- Test: `apps/studio/src/icons/remove.test.ts`

**Step 1: Write the failing test**

```ts
// apps/studio/src/icons/remove.test.ts
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readIndex, writeIndex } from './index-store.ts';
import { removeIconPack } from './remove.ts';

let cache: string;
beforeEach(() => (cache = mkdtempSync(join(tmpdir(), 'sf-rm-'))));
afterEach(() => rmSync(cache, { recursive: true, force: true }));

it('removes the pack dir and the index entry', () => {
  const vendorDir = join(cache, 'aws', 'v1');
  mkdirSync(vendorDir, { recursive: true });
  writeFileSync(join(vendorDir, 'a.svg'), '<svg/>');
  writeIndex(cache, {
    version: 1,
    packs: { aws: { vendor: 'aws', version: 'v1', installedAt: 1, sizeBytes: 1, icons: { a: 'aws/v1/a.svg' } } },
  });
  removeIconPack('aws', { cacheRoot: cache });
  expect(existsSync(join(cache, 'aws'))).toBe(false);
  expect(readIndex(cache).packs.aws).toBeUndefined();
});
```

**Step 2: Run to fail, implement, run to pass**

```ts
// apps/studio/src/icons/remove.ts
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readIndex, removePack, writeIndex } from './index-store.ts';
import type { IconVendor } from './paths.ts';

export function removeIconPack(vendor: IconVendor, deps: { cacheRoot: string }): void {
  rmSync(join(deps.cacheRoot, vendor), { recursive: true, force: true });
  writeIndex(deps.cacheRoot, removePack(readIndex(deps.cacheRoot), vendor));
}
```

Wire into CLI:

```ts
async function runIconsRemove() {
  const vendor = argv[2];
  if (vendor !== 'aws' && vendor !== 'gcp' && vendor !== 'azure') {
    printError('Usage: seeflow icons remove {aws|gcp|azure}');
  }
  const { removeIconPack } = await import('./icons/remove.ts');
  const { iconCacheRoot } = await import('./icons/paths.ts');
  removeIconPack(vendor, { cacheRoot: iconCacheRoot() });
  printOk({ removed: vendor });
}
```

**Step 3: Run tests + smoke**

Run: `bun test apps/studio/src/icons/remove.test.ts`
Expected: PASS.

Run: `bun run apps/studio/src/cli.ts icons remove aws`
Expected: `{"ok":true,"removed":"aws"}`

**Step 4: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/cli.ts apps/studio/src/icons/remove.ts apps/studio/src/icons/remove.test.ts
git commit -m "feat(cli): seeflow icons remove"
```

---

### Task 2.5: COMMAND_MANIFEST entries + help text

**Files:**
- Modify: `apps/studio/src/cli-manifest.ts` — append four entries to `COMMAND_MANIFEST` for `icons:list`, `icons:add`, `icons:update`, `icons:remove`. Use the existing entries (e.g. `flows:list`) as templates.
- Modify: `apps/studio/src/cli.ts` — add an `icons` section to `printHelp()`.

**Step 1: Read `cli-manifest.ts` to find a representative entry to copy from**

Run: `grep -n "name: 'flows:list'" apps/studio/src/cli-manifest.ts`

**Step 2: Add the four entries** (category: `'lifecycle'` is closest given they manage local state, not flows)

Example shape:

```ts
{
  name: 'icons:list',
  synopsis: 'seeflow icons list',
  description: 'List installed icon packs and which vendors are still available to install.',
  category: 'lifecycle',
  args: [],
  flags: [],
  outputs: {
    okExample: {
      packs: [
        { vendor: 'aws', installed: true, version: '2026-05-30', iconCount: 317, sizeBytes: 4500000 },
        { vendor: 'gcp', installed: false },
        { vendor: 'azure', installed: false },
      ],
    },
  },
  requiresStudio: false,
  examples: ['seeflow icons list'],
},
```

Repeat for `icons:add`, `icons:update`, `icons:remove`.

**Step 3: Update `printHelp()` in `cli.ts`** — add an `Icons (local cache):` section listing the four subcommands.

**Step 4: Verify the manifest tests still pass**

Run: `bun test apps/studio/src/cli-manifest.test.ts`
Expected: PASS. If a snapshot exists for the full manifest length, update via `bun test -u`.

**Step 5: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/cli-manifest.ts apps/studio/src/cli.ts
git commit -m "docs(cli): manifest + help entries for icons subcommands"
```

---

## Stage 3: Studio endpoints + SSE (~5 tasks)

### Task 3.1: Job registry for in-flight installs

**Files:**
- Create: `apps/studio/src/icons/jobs.ts`
- Test: `apps/studio/src/icons/jobs.test.ts`

**Step 1: Write the failing test**

```ts
// apps/studio/src/icons/jobs.test.ts
import { describe, expect, it } from 'bun:test';
import { createJobRegistry } from './jobs.ts';

it('issues distinct ids and stores events in order', () => {
  const reg = createJobRegistry();
  const id = reg.create('aws');
  reg.append(id, { type: 'extracting', vendor: 'aws' });
  reg.append(id, { type: 'done', vendor: 'aws', version: 'v', iconCount: 1 });
  const j = reg.get(id);
  expect(j?.events.map((e) => e.type)).toEqual(['extracting', 'done']);
  expect(j?.vendor).toBe('aws');
});

it('refuses to start a second job for the same vendor while one is in flight', () => {
  const reg = createJobRegistry();
  const first = reg.create('aws');
  expect(() => reg.create('aws')).toThrow(/already in flight/);
  reg.markComplete(first);
  expect(() => reg.create('aws')).not.toThrow();
});
```

**Step 2: Implement**

```ts
// apps/studio/src/icons/jobs.ts
import { randomUUID } from 'node:crypto';
import type { InstallEvent } from './installer-types.ts';
import type { IconVendor } from './paths.ts';

interface Job {
  id: string;
  vendor: IconVendor;
  events: InstallEvent[];
  complete: boolean;
  subscribers: Set<(ev: InstallEvent) => void>;
  endSubscribers: Set<() => void>;
}

export interface JobRegistry {
  create(vendor: IconVendor): string;
  append(id: string, ev: InstallEvent): void;
  markComplete(id: string): void;
  get(id: string): Job | undefined;
  subscribe(id: string, onEvent: (ev: InstallEvent) => void, onEnd: () => void): () => void;
  inFlightFor(vendor: IconVendor): string | undefined;
}

export function createJobRegistry(): JobRegistry {
  const jobs = new Map<string, Job>();
  return {
    create(vendor) {
      for (const j of jobs.values()) {
        if (j.vendor === vendor && !j.complete) {
          throw new Error(`Install for vendor ${vendor} already in flight (job ${j.id})`);
        }
      }
      const id = randomUUID();
      jobs.set(id, {
        id,
        vendor,
        events: [],
        complete: false,
        subscribers: new Set(),
        endSubscribers: new Set(),
      });
      return id;
    },
    append(id, ev) {
      const j = jobs.get(id);
      if (!j) return;
      j.events.push(ev);
      for (const sub of j.subscribers) sub(ev);
    },
    markComplete(id) {
      const j = jobs.get(id);
      if (!j) return;
      j.complete = true;
      for (const onEnd of j.endSubscribers) onEnd();
    },
    get: (id) => jobs.get(id),
    subscribe(id, onEvent, onEnd) {
      const j = jobs.get(id);
      if (!j) return () => undefined;
      // Replay buffered events synchronously.
      for (const ev of j.events) onEvent(ev);
      if (j.complete) {
        onEnd();
        return () => undefined;
      }
      j.subscribers.add(onEvent);
      j.endSubscribers.add(onEnd);
      return () => {
        j.subscribers.delete(onEvent);
        j.endSubscribers.delete(onEnd);
      };
    },
    inFlightFor(vendor) {
      for (const j of jobs.values()) if (j.vendor === vendor && !j.complete) return j.id;
      return undefined;
    },
  };
}
```

**Step 3: Run tests + commit**

Run: `bun test apps/studio/src/icons/jobs.test.ts` → PASS.

```bash
bun run format && bun run lint
git add apps/studio/src/icons/jobs.ts apps/studio/src/icons/jobs.test.ts
git commit -m "feat(icons): in-memory job registry for install pipelines"
```

---

### Task 3.2: HTTP route module

**Files:**
- Create: `apps/studio/src/icons/router.ts`
- Modify: `apps/studio/src/api.ts` to mount the router

**Step 1: Implement the router**

```ts
// apps/studio/src/icons/router.ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { fetchWithProgress } from './fetcher.ts';
import { readIndex } from './index-store.ts';
import { installIconPack } from './installer.ts';
import type { JobRegistry } from './jobs.ts';
import { summarizePacks } from './list-helper.ts';
import { iconCacheRoot, type IconVendor } from './paths.ts';
import { removeIconPack } from './remove.ts';
import { vendorDescriptor } from './vendors.ts';

const VendorParamSchema = z.enum(['aws', 'gcp', 'azure']);
const InstallBodySchema = z.object({
  vendor: VendorParamSchema,
  acceptTerms: z.boolean().optional(),
});

export function createIconsRouter(deps: { jobs: JobRegistry }): Hono {
  const r = new Hono();

  r.get('/packs', (c) => c.json({ packs: summarizePacks(readIndex(iconCacheRoot())) }));

  r.get('/licenses/:vendor', (c) => {
    const parsed = VendorParamSchema.safeParse(c.req.param('vendor'));
    if (!parsed.success) return c.json({ error: 'unknown vendor' }, 400);
    const d = vendorDescriptor(parsed.data);
    return c.json({
      vendor: parsed.data,
      label: d.label,
      summary: d.licenseSummary,
      url: d.licenseUrl,
      requiresAcceptance: d.requiresAcceptance,
    });
  });

  r.get('/:vendor/:name{[A-Za-z0-9._-]+}\\.svg', (c) => {
    const parsed = VendorParamSchema.safeParse(c.req.param('vendor'));
    if (!parsed.success) return c.json({ error: 'unknown vendor' }, 404);
    const idx = readIndex(iconCacheRoot());
    const pack = idx.packs[parsed.data];
    const name = c.req.param('name');
    const rel = pack?.icons[name];
    if (!rel) {
      return c.json(
        { error: 'icon not installed', install: `seeflow icons add ${parsed.data}` },
        404,
      );
    }
    const abs = join(iconCacheRoot(), rel);
    if (!existsSync(abs)) return c.json({ error: 'icon file missing' }, 404);
    const f = Bun.file(abs);
    return new Response(f.stream(), {
      headers: {
        'content-type': 'image/svg+xml',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  });

  r.post('/install', async (c) => {
    const body = InstallBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    let jobId: string;
    try {
      jobId = deps.jobs.create(body.data.vendor);
    } catch (err) {
      const existing = deps.jobs.inFlightFor(body.data.vendor);
      return c.json(
        { error: err instanceof Error ? err.message : String(err), jobId: existing },
        409,
      );
    }

    // Fire-and-forget — SSE picks up the events via the job registry.
    void (async () => {
      for await (const ev of installIconPack(
        { vendor: body.data.vendor, acceptTerms: body.data.acceptTerms },
        {
          cacheRoot: iconCacheRoot(),
          now: () => Date.now(),
          version: () => new Date().toISOString().slice(0, 10),
          fetcher: (url) => fetchWithProgress(url),
        },
      )) {
        deps.jobs.append(jobId, ev);
      }
      deps.jobs.markComplete(jobId);
    })();

    return c.json({ jobId });
  });

  r.get('/jobs/:id/events', (c) => {
    const id = c.req.param('id');
    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        const unsubscribe = deps.jobs.subscribe(
          id,
          (ev) => void stream.writeSSE({ data: JSON.stringify(ev) }),
          () => {
            unsubscribe();
            resolve();
          },
        );
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
    });
  });

  r.delete('/packs/:vendor', (c) => {
    const parsed = VendorParamSchema.safeParse(c.req.param('vendor'));
    if (!parsed.success) return c.json({ error: 'unknown vendor' }, 400);
    removeIconPack(parsed.data, { cacheRoot: iconCacheRoot() });
    return c.json({ removed: parsed.data });
  });

  return r;
}
```

**Step 2: Mount in `api.ts`**

Find `createApi(...)` (~top of file). Add a parameter `jobs: JobRegistry` to its options (`apps/studio/src/api.ts` exports `createApi` — extend the type alongside `events`, `watcher`, etc.). Inside `createApi`, after the existing route mounts, add:

```ts
app.route('/icons', createIconsRouter({ jobs }));
```

Then update `server.ts` (`createApp`) to instantiate the registry once and pass it in:

```ts
import { createJobRegistry } from './icons/jobs.ts';
// inside createApp:
const iconJobs = options.iconJobs ?? createJobRegistry();
// pass to createApi: createApi({ ..., jobs: iconJobs })
```

Add `iconJobs?: JobRegistry` to `CreateAppOptions`.

**Step 3: Type-check + smoke**

Run: `bun run --filter @tuongaz/seeflow typecheck` → PASS.

Boot the studio and curl:

```bash
bun run apps/studio/src/cli.ts start --foreground &
sleep 1
curl -s http://localhost:4321/api/icons/packs
```

Expected: `{"packs":[{"vendor":"aws","installed":false}, ...]}`. Stop the studio with `kill %1`.

**Step 4: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/icons/router.ts apps/studio/src/api.ts apps/studio/src/server.ts
git commit -m "feat(api): /api/icons router (packs, install, jobs/events, svg)"
```

---

### Task 3.3: Integration test — install pipeline via HTTP + SSE

**Files:**
- Create: `apps/studio/integration/icons-install.it.ts`

Read `apps/studio/integration/support/` to find the existing studio-boot harness (e.g. `start-studio.ts` or similar) — call out the helper(s) the test uses.

**Step 1: Write the test (offline — point the installer at a fake URL backed by a route in the test, or override the fetcher via a test-only export)**

Pattern: extend `CreateAppOptions` with an optional `iconFetcher?: (url: string) => Promise<Buffer>` that flows through to `createIconsRouter`. Default is `fetchWithProgress`. Tests pass a fixture.

```ts
// apps/studio/integration/icons-install.it.ts
import { describe, expect, it } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { startStudioInProcess } from './support/start-studio.ts';

describe('POST /api/icons/install', () => {
  it('streams events and writes the index', async () => {
    const zip = Buffer.from(
      zipSync({
        'Arch_AWS-Lambda_64.svg': strToU8('<svg>lambda</svg>'),
      }),
    );
    const studio = await startStudioInProcess({
      iconFetcher: async () => zip,
      iconCacheRoot: '<tmpdir>', // helper picks an isolated dir
    });
    try {
      const installRes = await fetch(`${studio.url}/api/icons/install`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vendor: 'aws', acceptTerms: true }),
      });
      const { jobId } = (await installRes.json()) as { jobId: string };

      const sseRes = await fetch(`${studio.url}/api/icons/jobs/${jobId}/events`);
      const text = await sseRes.text();
      const events = text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => JSON.parse(l.slice('data:'.length).trim()));
      expect(events.map((e) => e.type)).toContain('done');

      const packs = await (await fetch(`${studio.url}/api/icons/packs`)).json();
      expect(packs.packs.find((p: { vendor: string }) => p.vendor === 'aws')?.installed).toBe(true);

      const svg = await (await fetch(`${studio.url}/api/icons/aws/lambda.svg`)).text();
      expect(svg).toBe('<svg>lambda</svg>');
    } finally {
      await studio.stop();
    }
  });
});
```

**Step 2: Wire the `iconFetcher` + `iconCacheRoot` overrides** through `CreateAppOptions` → `createIconsRouter` (an `installer.ts` Dep injection point). Same wiring pattern as the existing `proxy`/`statusRunner` injection points in `server.ts`.

**Step 3: Run the test**

Run: `bun run test:it:bun -t 'icons/install'`
Expected: PASS.

**Step 4: Commit**

```bash
bun run format && bun run lint
git add apps/studio/integration/icons-install.it.ts apps/studio/src/icons/router.ts apps/studio/src/api.ts apps/studio/src/server.ts
git commit -m "test(icons): integration test for install → SSE → svg pipeline"
```

---

### Task 3.4: Concurrency endpoint test

**Files:**
- Modify: `apps/studio/integration/icons-install.it.ts` — add a second `it()` that POSTs twice in quick succession and asserts the second response is HTTP 409 with the existing `jobId` echoed back.

**Step 1: Add the test, run, commit** (one TDD pass; ~10 lines of test + 0 lines of code if the router already handles it).

```bash
bun run format && bun run lint
git add apps/studio/integration/icons-install.it.ts
git commit -m "test(icons): refuse parallel installs for the same vendor"
```

---

### Task 3.5: Mirror routes in OpenAPI / schema-catalog if applicable

**Files:**
- Modify: `apps/studio/src/schema-catalog.ts` if it exposes route docs (read the file first; skip this task entirely if it documents flow schemas only)

If schema-catalog covers REST routes (look for any `routes` list or similar), append `/icons/*` entries. Otherwise just skip and commit nothing.

---

## Stage 4: Canvas + web picker UI (~7 tasks)

The picker side requires changes in two packages — adapter extensions and renderer wiring in `@seeflow/canvas`, then a concrete implementation in `apps/web`.

### Task 4.1: Extend `CanvasAdapter` with icon methods

**Files:**
- Modify: `packages/canvas/src/adapter/types.ts`

**Step 1: Add to the `CanvasAdapter` interface**

```ts
// in CanvasAdapter:
icons?: {
  listPacks(): Promise<PackSummary[]>;
  install(vendor: 'aws' | 'gcp' | 'azure', opts: { acceptTerms?: boolean }): Promise<{ jobId: string }>;
  subscribeJob(jobId: string, onEvent: (ev: InstallEvent) => void): () => void;
  remove(vendor: 'aws' | 'gcp' | 'azure'): Promise<void>;
  getLicense(vendor: 'aws' | 'gcp' | 'azure'): Promise<{ summary: string; url: string; requiresAcceptance: boolean }>;
};
```

Define local `PackSummary` and `InstallEvent` types in the canvas package, not re-exported from studio — this is the adapter seam.

**Step 2: Typecheck**

Run: `bun run --filter @seeflow/canvas typecheck` → PASS.

**Step 3: Commit**

```bash
bun run format && bun run lint
git add packages/canvas/src/adapter/types.ts
git commit -m "feat(canvas): extend CanvasAdapter with optional icons methods"
```

---

### Task 4.2: `resolveIcon` — registry + URL + bundled iconify

**Files:**
- Modify: `packages/canvas/package.json` — add `@iconify-json/logos` (`^1`) to `dependencies`. Also add `@iconify/react` (`^5`) to `peerDependencies` + `devDependencies` with `peerDependenciesMeta.@iconify/react.optional = true`. Mark both as `external` in `tsup.config.ts` so they aren't inlined.
- Create: `packages/canvas/src/lib/icon-resolve.ts`
- Test: `packages/canvas/src/lib/icon-resolve.test.tsx`

**Step 1: Install deps**

Run: `bun install` after editing package.json.

**Step 2: Write the failing test**

```tsx
// packages/canvas/src/lib/icon-resolve.test.tsx
import { describe, expect, it } from 'bun:test';
import { Database } from 'lucide-react';
import { resolveIcon } from './icon-resolve.ts';

describe('resolveIcon', () => {
  it('returns a Lucide component for a bundled name', () => {
    const res = resolveIcon('database', { studioBaseUrl: 'http://localhost:4321' });
    expect(res).toEqual({ kind: 'lucide', component: Database });
  });

  it('returns an SVG URL for vendor-prefixed names', () => {
    const res = resolveIcon('aws:lambda', { studioBaseUrl: 'http://localhost:4321' });
    expect(res).toEqual({
      kind: 'svg-url',
      url: 'http://localhost:4321/api/icons/aws/lambda.svg',
    });
  });

  it('returns an iconify identifier for iconify-prefixed names', () => {
    const res = resolveIcon('iconify:logos:google-cloud', { studioBaseUrl: 'x' });
    expect(res).toEqual({ kind: 'iconify', identifier: 'logos:google-cloud' });
  });

  it('returns null for empty input', () => {
    expect(resolveIcon('', { studioBaseUrl: 'x' })).toBeNull();
  });
});
```

**Step 3: Implement**

```ts
// packages/canvas/src/lib/icon-resolve.ts
import type { ComponentType } from 'react';
import { ICON_REGISTRY } from './icon-registry.ts';
import { parseIconId } from './icon-id.ts';

export type Resolved =
  | { kind: 'lucide'; component: ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }
  | { kind: 'svg-url'; url: string }
  | { kind: 'iconify'; identifier: string };

export interface ResolveOptions {
  studioBaseUrl: string;
}

export function resolveIcon(raw: string, opts: ResolveOptions): Resolved | null {
  const id = parseIconId(raw);
  if (!id) return null;
  if (id.vendor === 'lucide') {
    const c = ICON_REGISTRY[id.name];
    return c ? { kind: 'lucide', component: c } : null;
  }
  if (id.vendor === 'iconify') {
    return { kind: 'iconify', identifier: id.name };
  }
  return { kind: 'svg-url', url: `${opts.studioBaseUrl}/api/icons/${id.vendor}/${id.name}.svg` };
}
```

**Step 4: Run tests**

Run: `bun test packages/canvas/src/lib/icon-resolve.test.tsx` → PASS, 4/4.

**Step 5: Commit**

```bash
bun run format && bun run lint
git add packages/canvas/package.json packages/canvas/tsup.config.ts packages/canvas/src/lib/icon-resolve.ts packages/canvas/src/lib/icon-resolve.test.tsx bun.lock
git commit -m "feat(canvas): resolveIcon dispatches lucide/url/iconify by prefix"
```

---

### Task 4.3: `IconRenderer` component (renders any kind)

**Files:**
- Create: `packages/canvas/src/components/icon-renderer.tsx`
- Test: `packages/canvas/src/components/icon-renderer.test.tsx`
- Modify: `packages/canvas/src/nodes/icon-node.tsx` to delegate to `IconRenderer` (only behavior change: it can now render non-Lucide icons via `resolveIcon`)

**Step 1: Write the failing test**

```tsx
// packages/canvas/src/components/icon-renderer.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import { IconRenderer } from './icon-renderer.tsx';

describe('IconRenderer', () => {
  it('renders a Lucide component', () => {
    render(<IconRenderer iconId="database" studioBaseUrl="http://localhost:4321" className="x" />);
    expect(document.querySelector('svg')).toBeTruthy();
  });

  it('renders an <img> for a vendor-prefixed icon', () => {
    render(<IconRenderer iconId="aws:lambda" studioBaseUrl="http://localhost:4321" />);
    const img = document.querySelector('img');
    expect(img?.getAttribute('src')).toBe('http://localhost:4321/api/icons/aws/lambda.svg');
  });

  it('renders a placeholder for unknown icons', () => {
    render(<IconRenderer iconId="" studioBaseUrl="x" />);
    expect(screen.getByTestId('icon-renderer-placeholder')).toBeInstanceOf(HTMLElement);
  });
});
```

**Step 2: Implement**

```tsx
// packages/canvas/src/components/icon-renderer.tsx
import { HelpCircle } from 'lucide-react';
import { resolveIcon } from '../lib/icon-resolve.ts';

export interface IconRendererProps {
  iconId: string;
  studioBaseUrl: string;
  className?: string;
  ariaLabel?: string;
}

export function IconRenderer({ iconId, studioBaseUrl, className, ariaLabel }: IconRendererProps) {
  const resolved = resolveIcon(iconId, { studioBaseUrl });
  if (!resolved) {
    return (
      <HelpCircle
        className={className}
        aria-hidden={!ariaLabel}
        aria-label={ariaLabel}
        data-testid="icon-renderer-placeholder"
      />
    );
  }
  if (resolved.kind === 'lucide') {
    const Component = resolved.component;
    return <Component className={className} aria-hidden={!ariaLabel} aria-label={ariaLabel} />;
  }
  if (resolved.kind === 'svg-url') {
    return (
      <img
        src={resolved.url}
        className={className}
        alt={ariaLabel ?? ''}
        loading="lazy"
        draggable={false}
      />
    );
  }
  // iconify: lazy-render via @iconify/react if installed; placeholder otherwise.
  return <IconifyOrPlaceholder identifier={resolved.identifier} className={className} ariaLabel={ariaLabel} />;
}

function IconifyOrPlaceholder({
  identifier,
  className,
  ariaLabel,
}: { identifier: string; className?: string; ariaLabel?: string }) {
  try {
    // require — dynamic import would force the whole component async; the
    // optional peer dep contract says either present or absent at boot.
    const { Icon } = require('@iconify/react');
    return <Icon icon={identifier} className={className} aria-label={ariaLabel} aria-hidden={!ariaLabel} />;
  } catch {
    return <HelpCircle className={className} aria-hidden data-testid="icon-renderer-placeholder" />;
  }
}
```

**Step 3: Update `icon-node.tsx` to delegate**

Replace the `requested = ICON_REGISTRY[data.icon]` block with a call to `<IconRenderer iconId={data.icon} studioBaseUrl={studioBaseUrl} ... />`. The `studioBaseUrl` plumbs in through the same context the existing canvas uses (look for `useCanvasPortalContainer`'s neighborhood — there's likely a base-URL context already). If there isn't one, add a `CanvasStudioContext` with `studioBaseUrl: string` in `packages/canvas/src/lib/canvas-studio-context.tsx`, mount in `seeflow-canvas.tsx`, consume in `icon-node.tsx`.

**Step 4: Update `icon-node.test.tsx` snapshots** if any.

**Step 5: Run all canvas tests**

Run: `bun test packages/canvas/`
Expected: PASS.

**Step 6: Commit**

```bash
bun run format && bun run lint
git add packages/canvas/src/components/icon-renderer.tsx packages/canvas/src/components/icon-renderer.test.tsx packages/canvas/src/nodes/icon-node.tsx packages/canvas/src/lib/canvas-studio-context.tsx packages/canvas/src/index.ts
git commit -m "feat(canvas): IconRenderer dispatches across lucide/url/iconify"
```

---

### Task 4.4: Extend `icon-registry` to enumerate non-Lucide icons

The picker needs to know about installed pack icons + bundled iconify provider logos.

**Files:**
- Modify: `packages/canvas/src/lib/icon-registry.ts` — keep `ICON_REGISTRY` (Lucide) as-is; export new `ICON_NAMES_BY_VENDOR: Record<IconVendor, string[]>` populated by an `applyPackSummaries(packs: PackSummary[])` function. Iconify logos list comes from a hand-curated constant for now (the popular AWS/Azure/GCP marks — `logos:aws`, `logos:google-cloud`, `logos:microsoft-azure`).

**Step 1: TDD a small helper that derives `ICON_NAMES_BY_VENDOR` from a pack list**

Use the same Lucide auto-build pattern as today.

**Step 2: Wire `applyPackSummaries` to fire when `<SeeflowCanvas>` first receives packs from the adapter** (add a single useEffect in `seeflow-canvas.tsx`, appended at the END per the hook-shim rule).

**Step 3: Commit**

```bash
bun run format && bun run lint
git add packages/canvas/src/lib/icon-registry.ts packages/canvas/src/lib/icon-registry.test.ts packages/canvas/src/seeflow-canvas.tsx
git commit -m "feat(canvas): vendor-grouped icon names with pack summary apply"
```

---

### Task 4.5: Picker — vendor tabs

**Files:**
- Modify: `packages/canvas/src/components/icon-picker-popover.tsx`

**Step 1: Add a tab bar above the search input** with entries `Bundled` (Lucide), `AWS`, `GCP`, `Azure`, `Logos` (iconify). Filter the visible icon set by the active tab. Disable tabs for non-installed packs but show them with a small "Install" affordance that opens the Browse Packs view (Task 4.6).

**Step 2: Update existing picker tests for the new tab DOM**; add a test that switching tabs re-filters the grid.

**Step 3: Run canvas tests**

Run: `bun test packages/canvas/src/components/`
Expected: PASS.

**Step 4: Commit**

```bash
bun run format && bun run lint
git add packages/canvas/src/components/icon-picker-popover.tsx packages/canvas/src/components/icon-picker-popover.test.tsx
git commit -m "feat(canvas): vendor tabs in icon picker"
```

---

### Task 4.6: Picker — Browse Packs view + install modal

**Files:**
- Create: `packages/canvas/src/components/browse-packs-panel.tsx`
- Create: `packages/canvas/src/components/browse-packs-panel.test.tsx`
- Modify: `packages/canvas/src/components/icon-picker-popover.tsx` — add a "Browse packs" footer button switching the popover content to `<BrowsePacksPanel>`.

**Step 1: TDD the panel rendering installed/uninstalled state from a pack-summary prop**

```tsx
// Sketch:
<BrowsePacksPanel
  packs={[
    { vendor: 'aws', installed: true, version: '2026-05-30', iconCount: 317, sizeBytes: 4500000 },
    { vendor: 'gcp', installed: false },
  ]}
  onInstall={(vendor) => /* triggers install modal */}
  onRemove={(vendor) => ...}
/>
```

**Step 2: Install modal**

A new `<InstallPackModal vendor licenseSummary licenseUrl requiresAcceptance onConfirm onCancel/>`. Confirm button is disabled until "I have read the license" is checked if `requiresAcceptance`. Calls `adapter.icons.install(vendor, { acceptTerms })`.

Tests assert: (a) confirm disabled until checkbox flips when required, (b) `onConfirm` payload includes `acceptTerms: true`.

**Step 3: Wire the install action to `CanvasAdapter.icons.install` + subscribe to job events**

After `install()` returns a `jobId`, call `adapter.icons.subscribeJob(jobId, onEvent)`. Render a progress toast (`InstallProgressToast`) at the popover root that reflects each event. On `done`, re-fetch packs and update the registry. On `error`, swap to an error state with retry.

**Step 4: Run canvas tests**

Run: `bun test packages/canvas/`
Expected: PASS.

**Step 5: Commit**

```bash
bun run format && bun run lint
git add packages/canvas/src/components/browse-packs-panel.tsx packages/canvas/src/components/browse-packs-panel.test.tsx packages/canvas/src/components/install-pack-modal.tsx packages/canvas/src/components/install-pack-modal.test.tsx packages/canvas/src/components/install-progress-toast.tsx packages/canvas/src/components/icon-picker-popover.tsx
git commit -m "feat(canvas): browse packs panel + install modal + progress toast"
```

---

### Task 4.7: `apps/web` adapter implementation

**Files:**
- Modify: `apps/web/src/` — find the adapter factory (search for usages of `CanvasAdapter` from `@seeflow/canvas`). Implement the optional `icons.*` block using `fetch` against `/api/icons/*` and `EventSource` for SSE.

**Step 1: Sketch implementation**

```ts
icons: {
  async listPacks() {
    return (await fetch(`${BASE}/api/icons/packs`).then((r) => r.json())).packs;
  },
  async install(vendor, opts) {
    const res = await fetch(`${BASE}/api/icons/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vendor, acceptTerms: opts.acceptTerms ?? false }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  },
  subscribeJob(jobId, onEvent) {
    const es = new EventSource(`${BASE}/api/icons/jobs/${jobId}/events`);
    es.onmessage = (e) => onEvent(JSON.parse(e.data));
    return () => es.close();
  },
  async remove(vendor) {
    await fetch(`${BASE}/api/icons/packs/${vendor}`, { method: 'DELETE' });
  },
  async getLicense(vendor) {
    return fetch(`${BASE}/api/icons/licenses/${vendor}`).then((r) => r.json());
  },
},
```

**Step 2: Run `apps/web` dev server + browse-packs flow manually**

Run: `bun run dev` (in the worktree). Open `http://localhost:5173`, open an icon picker on a `playNode`, click "Browse packs", click "Install" on AWS, accept (no terms required), watch progress, confirm icons appear and an `aws:lambda` selection renders the SVG.

> **If you cannot run the browser**, say so explicitly in the commit message — type checks alone do NOT verify feature correctness.

**Step 3: Commit**

```bash
bun run format && bun run lint
git add apps/web/src/
git commit -m "feat(web): wire CanvasAdapter.icons against /api/icons"
```

---

## Stage 5: GCP + Azure (~3 tasks)

### Task 5.1: GCP fetcher + normalizer + descriptor

**Files:**
- Create: `apps/studio/src/icons/normalize-gcp.ts` (+ test)
- Modify: `apps/studio/src/icons/vendors.ts` — replace the GCP stub with a real descriptor.

**Step 1: TDD the normalizer** (GCP packs use filenames like `Cloud Functions.svg`, `Cloud Run.svg`)

Same TDD shape as `normalize-aws.ts`.

**Step 2: Replace the GCP stub** with:

```ts
gcp: {
  vendor: 'gcp',
  label: 'Google Cloud',
  defaultPackUrl: 'https://cloud.google.com/static/architecture/icons/icons.zip',
  licenseSummary: 'Free to use in diagrams. Logos may be subject to Google brand guidelines. See license URL for full terms.',
  licenseUrl: 'https://cloud.google.com/architecture/icons',
  requiresAcceptance: false,
  canonicalName: canonicalGcpName,
},
```

**Step 3: Remove the `vendor !== 'aws'` guard** in `runIconsAdd` / `router.ts` for GCP. Add an installer integration test mirroring AWS.

**Step 4: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/icons/normalize-gcp.ts apps/studio/src/icons/normalize-gcp.test.ts apps/studio/src/icons/vendors.ts apps/studio/src/cli.ts apps/studio/integration/icons-install.it.ts
git commit -m "feat(icons): GCP pack support"
```

---

### Task 5.2: Azure with ToS acceptance gate

**Files:**
- Create: `apps/studio/src/icons/normalize-azure.ts` (+ test)
- Modify: `apps/studio/src/icons/vendors.ts` — Azure descriptor with `requiresAcceptance: true`

**Step 1: TDD the normalizer**

Azure filenames look like `10841-icon-service-Functions.svg` — strip the prefix number and `-icon-service-`.

**Step 2: Descriptor**

```ts
azure: {
  vendor: 'azure',
  label: 'Microsoft Azure',
  defaultPackUrl: 'https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V20.zip', // verify the live URL at implement time
  licenseSummary:
    'Microsoft requires you to accept the terms before downloading. Icons may be used in architecture diagrams; redistribution is restricted.',
  licenseUrl: 'https://learn.microsoft.com/en-us/azure/architecture/icons/',
  requiresAcceptance: true,
  canonicalName: canonicalAzureName,
},
```

**Step 3: Installer test path** — verify `terms-required` event fires for Azure when `acceptTerms` is missing, and the install proceeds when it's `true`.

**Step 4: Picker** — the existing `InstallPackModal` flow (Task 4.6) already handles `requiresAcceptance: true` via the checkbox. Add an explicit E2E pass for the Azure flow.

**Step 5: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/icons/normalize-azure.ts apps/studio/src/icons/normalize-azure.test.ts apps/studio/src/icons/vendors.ts apps/studio/integration/icons-install.it.ts
git commit -m "feat(icons): Azure pack support (requires ToS acceptance)"
```

---

### Task 5.3: Remove the unsupported-vendor guards in CLI

**Files:**
- Modify: `apps/studio/src/cli.ts` — drop the `if (vendor !== 'aws') printError(...)` line; GCP + Azure are now first-class.

**Step 1: Commit**

```bash
bun run format && bun run lint
git add apps/studio/src/cli.ts
git commit -m "chore(cli): allow GCP + Azure on seeflow icons add"
```

---

## Stage 6: E2E + docs (~4 tasks)

### Task 6.1: Playwright E2E — Browse Packs flow

**Files:**
- Create: `apps/studio/e2e/icon-install.e2e.ts`
- Create: `apps/studio/e2e/icon-install.e2e.ts-snapshots/` (will be populated on first `--update-snapshots`)

**Step 1: Write a Playwright test that:**
1. Boots a studio with `iconFetcher` overridden to return a fixture ZIP.
2. Opens an icon picker on a `playNode`.
3. Clicks "Browse packs", clicks Install on AWS.
4. Waits for the toast to show "Done".
5. Switches to the AWS tab and asserts the Lambda tile is present.
6. Snapshots the install modal, the in-progress toast, and the post-install picker.

**Step 2: Generate baselines**

Run: `bun run test:it:update-snapshots`
Expected: new `*-chromium-linux.png` files are generated. Commit only those, never `*-darwin.png`.

**Step 3: Verify**

Run: `bun run test:it:e2e -t 'icon-install'`
Expected: PASS.

**Step 4: Commit**

```bash
bun run format && bun run lint
git add apps/studio/e2e/icon-install.e2e.ts apps/studio/e2e/icon-install.e2e.ts-snapshots/
git commit -m "test(e2e): Browse Packs install flow + snapshots"
```

---

### Task 6.2: Update `design/design.html`

**Files:**
- Modify: `design/design.html`

**Step 1:** Add a "Browse packs" section showing the modal pattern, progress toast, and post-install picker tab. Reuse existing design tokens — no new colors or type scales.

**Step 2: Commit**

```bash
git add design/design.html
git commit -m "docs(design): Browse packs + install modal + progress toast patterns"
```

---

### Task 6.3: README + CHANGELOG

**Files:**
- Modify: `README.md` (root) — add an "Icon packs" section with the four CLI commands and the in-app Browse Packs description.
- Modify: `apps/studio/CHANGELOG.md` — entry for the next minor version.

**Step 1: Commit**

```bash
bun run format
git add README.md apps/studio/CHANGELOG.md
git commit -m "docs: icon packs section + changelog entry"
```

---

### Task 6.4: Update `CLAUDE.md` and per-package rules with icon-pack invariants

**Files:**
- Modify: `CLAUDE.md` (root) — short bullet under a new "Icon packs" subsection.
- Modify: `apps/studio/CLAUDE.md` if relevant icon rules emerged (cache location, vendor lock semantics).
- Modify: `packages/canvas/CLAUDE.md` — note the `data.icon` `vendor:name` encoding, the `studioBaseUrl` context dependency for `IconRenderer`, and that the picker MUST go through `CanvasAdapter.icons.*`.

**Step 1: Commit**

```bash
git add CLAUDE.md apps/studio/CLAUDE.md packages/canvas/CLAUDE.md
git commit -m "docs: icon-pack invariants in CLAUDE.md files"
```

---

## Final verification

Run, in order:

```bash
bun run format && bun run lint
bun run typecheck
bun test
bun run test:it          # integration + e2e via Docker on darwin
bun run --filter @seeflow/canvas build
```

All five must pass before the branch is considered done. If e2e snapshot updates were intentional, confirm only `*-chromium-linux.png` files were changed — `git diff --name-only apps/studio/e2e/ | grep -v chromium-linux` must be empty.

---

## Open risks / decisions deferred to implementation

- **Real vendor URLs drift.** The pinned `defaultPackUrl`s in `vendors.ts` were correct as of 2026-05-30; verify each before the first install attempt. Plan B: add a config knob `--pack-url <url>` to `seeflow icons add` for manual override (out of scope for this plan but trivial to add).
- **Resumable downloads.** Azure is ~80MB. The current `fetchWithProgress` does not resume on connection drop — it retries the whole download. If real-world failure rate is high, add Range-based resume to `fetcher.ts` post-launch.
- **Iconify peer dep optionality.** `@iconify/react` is declared optional. If the host doesn't install it, `iconify:*` icons render as the placeholder — which is correct but silent. Consider surfacing "Install @iconify/react to enable provider logos" in the picker's Logos tab when the dependency is missing.
- **Picker initial pack fetch.** Currently the canvas calls `adapter.icons.listPacks()` on mount via `applyPackSummaries`. If no studio is reachable (offline / pure static export), the call fails silently and only Lucide is available. Acceptable for v1; revisit if used in non-studio embedders.
