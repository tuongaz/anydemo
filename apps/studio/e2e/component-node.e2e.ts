import { cpSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type RegisteredFlow, expect, test } from './support/studio-fixture.ts';

// US-015: end-to-end coverage for the component node — proves both dispatch
// kinds light up against a real studio. (a) clicking a Button with a
// `set`-kind action mutates the canvas runtime's state synchronously;
// (b) clicking a Button with a `script`-kind action POSTs to the studio's
// /api/flows/:id/nodes/:nodeId/actions/:name endpoint, the runner spawns
// `bun nodes/c1/actions/inc.ts`, and the JSON stdout patch merges back
// into state via the runtime's `merge` reducer.

const E2E_DIR = resolve(import.meta.dir);
const FIXTURE_DIR = join(E2E_DIR, 'fixtures/component-demo');

// Disable transitions/animations so the visual baseline snapshot stays stable.
const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

interface SeedOptions {
  slug: string;
  name?: string;
}

// Component nodes can't go through the shared registerFlow helper because
// ResolvedFlowSchema requires data.spec inline AND the studio reads the spec
// from a sidecar at nodes/<id>/spec.json. The cleanest path is to copy the
// on-disk fixture tree as-is into the worker-scoped studio's home and POST
// /api/flows/register against the resulting flow.json.
async function seedComponentDemo(
  studio: { baseURL: string; home: string },
  opts: SeedOptions,
): Promise<RegisteredFlow> {
  const repoPath = join(studio.home, opts.slug);
  mkdirSync(repoPath, { recursive: true });
  // recursive: true on cpSync copies the entire fixture tree including
  // nodes/c1/spec.json and nodes/c1/actions/inc.ts. The studio's resolver
  // chain (FlowSchema -> mergeFlowAndStyle -> inlineComponentSpecs ->
  // ResolvedFlowSchema) inlines spec.json on read, and the component-action
  // runner realpath-roots scriptPath under nodes/c1/.
  cpSync(FIXTURE_DIR, repoPath, { recursive: true });

  const res = await fetch(`${studio.baseURL}/api/flows/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: opts.name ?? 'Component Demo',
      repoPath,
      flowPath: 'flow.json',
    }),
  });
  if (res.status !== 200) {
    const detail = await res.text();
    throw new Error(`Failed to register component-demo fixture: ${res.status} ${detail}`);
  }
  const { id, slug: registeredSlug } = (await res.json()) as { id: string; slug: string };
  return { id, slug: registeredSlug, repoPath };
}

test.describe('canvas — component node (US-015)', () => {
  test('Reset button mutates state via set action', async ({ page, studio }) => {
    const registered = await seedComponentDemo(studio.studio, { slug: 'component-demo-reset' });

    await page.goto(`${studio.studio.baseURL}/d/${registered.slug}`);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await page.waitForLoadState('networkidle');

    const node = page.locator('[data-node-type="component"]');
    await expect(node).toHaveCount(1);
    const body = node.locator('[data-testid="component-node-body"]');

    // The Metric impl renders its value inside the only `sf:tabular-nums`
    // span in the registry — no other catalog component uses that class.
    // The spec seeds /count = 5 so the initial paint shows "5".
    const value = body.locator('span.sf\\:tabular-nums');
    await expect(value).toHaveText('5');

    // Set-kind actions land synchronously: dispatchState({kind:'set'}) is
    // inside the same React event tick as onClick, so the next render sees
    // /count = 0 with no network round trip.
    await body.getByRole('button', { name: 'Reset' }).click();
    await expect(value).toHaveText('0');
    await expect(node).toHaveScreenshot('component-node-after-reset.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('Fetch button POSTs to the action endpoint and merges the response into state', async ({
    page,
    studio,
  }) => {
    const registered = await seedComponentDemo(studio.studio, { slug: 'component-demo-fetch' });

    await page.goto(`${studio.studio.baseURL}/d/${registered.slug}`);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await page.waitForLoadState('networkidle');

    const node = page.locator('[data-node-type="component"]');
    await expect(node).toHaveCount(1);
    const body = node.locator('[data-testid="component-node-body"]');
    const value = body.locator('span.sf\\:tabular-nums');
    await expect(value).toHaveText('5');

    // Race-safe wait: arm the response promise BEFORE clicking. The Button
    // impl invokes onClick with no payload, so the runtime POSTs `{}`. The
    // script falls back to from=0 and writes `{"/count": 1}` to stdout,
    // which the runtime merges into state via dispatchState({kind:'merge'}).
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith(`/api/flows/${registered.id}/nodes/c1/actions/inc`) &&
        res.status() === 200,
    );
    await body.getByRole('button', { name: 'Fetch' }).click();
    await responsePromise;
    await expect(value).toHaveText('1');
    await expect(node).toHaveScreenshot('component-node-after-fetch.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
