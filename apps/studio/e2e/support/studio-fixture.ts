import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test as base } from '@playwright/test';
import { type StudioHandle, spawnStudio } from '../../integration/support/studio-harness.ts';
import { splitFlow } from '../../src/merge.ts';
import { ResolvedFlowSchema } from '../../src/schema.ts';

const STUDIO_DIR = resolve(import.meta.dir, '../..');
const FIXTURE_FLOW_PATH = join(STUDIO_DIR, 'integration/fixtures/kitchen-sink.flow.json');
const FIXTURE_NOOP_PATH = join(STUDIO_DIR, 'integration/fixtures/scripts/noop.ts');

export interface RegisteredFlow {
  id: string;
  slug: string;
  repoPath: string;
}

export interface KitchenSinkStudio {
  studio: StudioHandle;
  flow: RegisteredFlow;
}

interface RegisterResponse {
  id: string;
  slug: string;
  sdk: { outcome: string; filePath: string | null };
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
  const seeflowDir = join(repoPath, '.seeflow');
  mkdirSync(seeflowDir, { recursive: true });

  // The fixture file is a ResolvedFlow (has positions). The on-disk shape
  // expected by registerFlowImpl is FlowSchema (strict, no positions); use
  // splitFlow to produce the canonical disk pair.
  const raw = JSON.parse(readFileSync(FIXTURE_FLOW_PATH, 'utf8'));
  const resolved = ResolvedFlowSchema.parse(raw);
  const { flow, style } = splitFlow(resolved);

  writeFileSync(join(seeflowDir, 'flow.json'), `${JSON.stringify(flow, null, 2)}\n`);
  writeFileSync(join(seeflowDir, 'style.json'), `${JSON.stringify(style, null, 2)}\n`);

  // playNode's playAction.scriptPath is relative to `<repoPath>/.seeflow/nodes/<id>/`.
  // resolveScript realpaths the target, so the script file MUST exist before
  // any /play call. The fixture pins the playNode id to `n1`.
  const noopDest = join(seeflowDir, 'nodes', 'n1', 'scripts', 'noop.ts');
  mkdirSync(dirname(noopDest), { recursive: true });
  copyFileSync(FIXTURE_NOOP_PATH, noopDest);

  const res = await fetch(`${studio.baseURL}/api/flows/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Kitchen Sink',
      repoPath,
      flowPath: '.seeflow/flow.json',
    }),
  });
  if (res.status !== 200) {
    const detail = await res.text();
    await studio.stop();
    throw new Error(`Failed to register kitchen-sink fixture: ${res.status} ${detail}`);
  }
  const { id, slug: registeredSlug } = (await res.json()) as RegisterResponse;

  return {
    studio,
    flow: { id, slug: registeredSlug, repoPath },
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
});

export { expect } from '@playwright/test';
