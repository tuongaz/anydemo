import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Page, test as base } from '@playwright/test';
import { type StudioHandle, spawnStudio } from '../../integration/support/studio-harness.ts';
import { splitFlow } from '../../src/merge.ts';
import { ResolvedFlowSchema } from '../../src/schema.ts';

// US-007: pin every existing e2e test to the dark palette. All visual
// baselines under e2e/*-snapshots/ were captured before the default flipped
// to light, so we seed localStorage['seeflow:theme'] = 'dark' via an init
// script that runs before any inline FOUC script on the document. Tests that
// need a different theme (e.g. light baselines in US-008) call
// `setStudioTheme(page, 'light')` before navigating — addInitScript stacks,
// so the later call wins on the next document.
export type StudioTheme = 'light' | 'dark' | 'system';
const DEFAULT_E2E_THEME: StudioTheme = 'dark';
const THEME_STORAGE_KEY = 'seeflow:theme';

async function installThemeInitScript(page: Page, theme: StudioTheme): Promise<void> {
  // String form — the studio's tsconfig omits the DOM lib (it's a Bun
  // backend), so a function callback referencing `window`/`localStorage`
  // would fail typecheck. The script runs in the browser context where
  // those globals exist. JSON.stringify on the theme defends against the
  // (unlikely) future of quotes in the value.
  const script = `try { window.localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, ${JSON.stringify(theme)}); } catch (e) {}`;
  await page.addInitScript(script);
}

/**
 * Override the dark default for a single test. Must be called BEFORE
 * `page.goto(...)` — addInitScript only takes effect for documents loaded
 * after it's registered. Last-write-wins because Playwright runs init
 * scripts in registration order.
 */
export async function setStudioTheme(page: Page, theme: StudioTheme): Promise<void> {
  await installThemeInitScript(page, theme);
}

const STUDIO_DIR = resolve(import.meta.dir, '../..');
const FIXTURE_FLOW_PATH = join(STUDIO_DIR, 'integration/fixtures/kitchen-sink.flow.json');

export interface RegisteredFlow {
  id: string;
  slug: string;
  projectSlug: string;
  flowSlug: string;
  repoPath: string;
}

// Split the legacy registry slug `${projectSlug}/${flowSlug}` into its two
// segments so e2e tests can build the new `/projects/:project/flows/:flow`
// URL from a single helper result. Throws when the slug is malformed —
// the studio's registerFlow path always produces a `<project>/<flow>`
// shape (operations.ts synthesises both fields), so a slug without `/` is
// a contract violation worth surfacing loudly.
export function splitRegistrySlug(slug: string): { projectSlug: string; flowSlug: string } {
  const idx = slug.indexOf('/');
  if (idx < 0) throw new Error(`Registry slug missing '/': ${slug}`);
  return { projectSlug: slug.slice(0, idx), flowSlug: slug.slice(idx + 1) };
}

// US-027: build the new canvas-page URL `/projects/<project>/flows/<flow>`.
// Mirrors apps/web/src/lib/router.ts:flowPath — duplicated here so the e2e
// support module stays standalone (the web package isn't a dependency of
// the studio package's e2e suite).
export function projectFlowPath(projectSlug: string, flowSlug: string): string {
  return `/projects/${encodeURIComponent(projectSlug)}/flows/${encodeURIComponent(flowSlug)}`;
}

export interface KitchenSinkStudio {
  studio: StudioHandle;
  flow: RegisteredFlow;
}

interface RegisterResponse {
  id: string;
  slug: string;
}

// Spawn a studio + register the kitchen-sink fixture under it. Worker-scoped
// so all tests in a single Playwright worker share one studio + one
// registration (the canvas DOM/visual tests in US-013 are read-only against
// the fixture).
async function bootKitchenSinkStudio(): Promise<KitchenSinkStudio> {
  const studio = await spawnStudio();

  // Use a project dir SIBLING to the studio workspace so the fixture's
  // flow.json isn't accidentally re-scanned by any future workspace-wide
  // discovery — matches rest.it.ts's pattern for direct registration.
  const slug = 'kitchen-sink';
  const repoPath = join(studio.home, slug);
  mkdirSync(repoPath, { recursive: true });

  // The fixture file is a ResolvedFlow (has positions). The on-disk shape
  // expected by registerFlowImpl is FlowSchema (strict, no positions); use
  // splitFlow to produce the canonical disk pair.
  const raw = JSON.parse(readFileSync(FIXTURE_FLOW_PATH, 'utf8'));
  const resolved = ResolvedFlowSchema.parse(raw);
  const { flow, style } = splitFlow(resolved);

  writeFileSync(join(repoPath, 'flow.json'), `${JSON.stringify(flow, null, 2)}\n`);
  writeFileSync(join(repoPath, 'style.json'), `${JSON.stringify(style, null, 2)}\n`);

  const res = await fetch(`${studio.baseURL}/api/flows/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Kitchen Sink',
      repoPath,
      flowPath: 'flow.json',
    }),
  });
  if (res.status !== 200) {
    const detail = await res.text();
    await studio.stop();
    throw new Error(`Failed to register kitchen-sink fixture: ${res.status} ${detail}`);
  }
  const { id, slug: registeredSlug } = (await res.json()) as RegisterResponse;
  const { projectSlug, flowSlug } = splitRegistrySlug(registeredSlug);

  return {
    studio,
    flow: { id, slug: registeredSlug, projectSlug, flowSlug, repoPath },
  };
}

type WorkerFixtures = { studio: KitchenSinkStudio };

// Playwright's `extend<TestArgs, WorkerArgs>` needs an explicit empty
// TestArgs to put `studio` in the second (worker) slot so `scope: 'worker'`
// type-checks. `Record<never, never>` is the strict-mode equivalent of `{}`
// that Biome's noBannedTypes accepts.
type EmptyTestArgs = Record<never, never>;

export const test = base.extend<EmptyTestArgs, WorkerFixtures>({
  studio: [
    // Playwright introspects the first parameter's source text to discover
    // fixture dependencies and REQUIRES it to be an object destructuring
    // pattern — `_args` throws "First argument must use the object
    // destructuring pattern". Biome's `noEmptyPattern` rule otherwise
    // forbids `{}` here, so the ignore is load-bearing.
    // biome-ignore lint/correctness/noEmptyPattern: required by Playwright fixture API
    async ({}, use) => {
      const handle = await bootKitchenSinkStudio();
      try {
        await use(handle);
      } finally {
        await handle.studio.stop();
      }
    },
    { scope: 'worker' },
  ],
  page: async ({ page }, use) => {
    await installThemeInitScript(page, DEFAULT_E2E_THEME);
    await use(page);
  },
});

export { expect } from '@playwright/test';

// SSE-safe replacement for `waitForLoadState('networkidle')`. The studio SPA
// holds two persistent EventSource streams open for the lifetime of the page
// (/api/registry/events + /api/events?flowId=), so the in-flight request count
// never reaches zero and `networkidle` hangs until the test times out — which
// is also why Playwright deprecates `networkidle`. Waiting on
// `document.fonts.ready` plus two animation frames gives stable text metrics and
// a settled paint for visual snapshots without depending on connection counts.
// String-form eval because the studio tsconfig omits the DOM lib (see
// installThemeInitScript above) — a function callback referencing `document`
// would fail typecheck.
export async function waitForCanvasSettled(page: Page): Promise<void> {
  await page.evaluate(
    'document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))',
  );
}

// US-009: per-test flow registration helper. Lets new e2e tests seed
// arbitrary flow shapes (12-tag render matrix, capability-chrome-rectangle-
// only fences, draw-mode interactions) on top of the shared worker-scoped
// studio without polluting the kitchen-sink fixture. Each call provisions
// a new project dir + slug under the studio's home so flows stay isolated.
export async function registerFlow(
  studio: StudioHandle,
  slug: string,
  resolvedFlow: unknown,
  options: { name?: string } = {},
): Promise<RegisteredFlow> {
  const repoPath = join(studio.home, slug);
  mkdirSync(repoPath, { recursive: true });
  const resolved = ResolvedFlowSchema.parse(resolvedFlow);
  const { flow, style } = splitFlow(resolved);
  writeFileSync(join(repoPath, 'flow.json'), `${JSON.stringify(flow, null, 2)}\n`);
  writeFileSync(join(repoPath, 'style.json'), `${JSON.stringify(style, null, 2)}\n`);

  const res = await fetch(`${studio.baseURL}/api/flows/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: options.name ?? slug,
      repoPath,
      flowPath: 'flow.json',
    }),
  });
  if (res.status !== 200) {
    const detail = await res.text();
    throw new Error(`Failed to register flow ${slug}: ${res.status} ${detail}`);
  }
  const { id, slug: registeredSlug } = (await res.json()) as RegisterResponse;
  const { projectSlug, flowSlug } = splitRegistrySlug(registeredSlug);
  return { id, slug: registeredSlug, projectSlug, flowSlug, repoPath };
}

// US-027: register a manifest-driven project with N flows. Writes
// `seeflow.json` + `flows/<id>/flow.json` for each flow under a fresh
// project dir, then POSTs to `/api/flows/register` once with the default
// flow's manifest path so the registry picks up the projectSlug from the
// manifest's name. Subsequent flows already exist on disk and in the
// manifest; the manifest-CRUD endpoints (POST/PATCH/DELETE
// /api/projects/:project/flows) drive any additional mutations during
// the test. Only the default flow comes back as a `RegisteredFlow` because
// the legacy /api/flows/register endpoint is single-flow — that's enough
// for the e2e suite, which uses the multi-flow-CRUD paths to mutate the
// rest.
export async function registerManifestProject(
  studio: StudioHandle,
  opts: {
    projectDirName: string;
    name: string;
    defaultFlow: string;
    flows: ReadonlyArray<{ id: string; name: string; icon?: string }>;
  },
): Promise<RegisteredFlow> {
  const repoPath = join(studio.home, opts.projectDirName);
  mkdirSync(repoPath, { recursive: true });

  const manifest = {
    version: 1 as const,
    name: opts.name,
    defaultFlow: opts.defaultFlow,
    flows: opts.flows.map((f) => ({
      id: f.id,
      name: f.name,
      ...(f.icon ? { icon: f.icon } : {}),
    })),
  };
  writeFileSync(join(repoPath, 'seeflow.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // Each declared flow lands as an empty envelope on disk so the scanner
  // (cli-ops.registerProject, invoked via /api/projects/register) can walk
  // every flow folder and upsert one FlowEntry per declared flow with the
  // manifest's project name + per-flow names.
  for (const flow of opts.flows) {
    const flowDir = join(repoPath, 'flows', flow.id);
    mkdirSync(flowDir, { recursive: true });
    const envelope = { version: 2 as const, name: flow.name, nodes: [], connectors: [] };
    writeFileSync(join(flowDir, 'flow.json'), `${JSON.stringify(envelope, null, 2)}\n`);
  }

  const res = await fetch(`${studio.baseURL}/api/projects/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoPath }),
  });
  if (res.status !== 200) {
    const detail = await res.text();
    throw new Error(`Failed to register manifest project ${opts.name}: ${res.status} ${detail}`);
  }
  const payload = (await res.json()) as {
    ok: boolean;
    projectSlug: string;
    entries: ReadonlyArray<{
      id: string;
      slug: string;
      projectSlug: string;
      flowSlug: string;
      name: string;
      isDefault: boolean;
    }>;
  };
  const defaultEntry =
    payload.entries.find((e) => e.flowSlug === opts.defaultFlow) ?? payload.entries[0];
  if (!defaultEntry) {
    throw new Error(`Manifest project registration returned no entries: ${opts.name}`);
  }
  return {
    id: defaultEntry.id,
    slug: defaultEntry.slug,
    projectSlug: defaultEntry.projectSlug,
    flowSlug: defaultEntry.flowSlug,
    repoPath,
  };
}
