import { cpSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Locator } from '@playwright/test';
import {
  type RegisteredFlow,
  expect,
  projectFlowPath,
  test,
  waitForCanvasSettled,
} from './support/studio-fixture.ts';

// AutoSizeObserver in packages/canvas/src/nodes/component-node.tsx debounces
// the ResizeObserver by 150ms before calling useUpdateNodeInternals. Without
// an explicit wait, toHaveScreenshot races the auto-fit cycle — CI captures
// the 208×452 shrink-wrapped node while a slower host captures the pre-fit
// 640×480 default. Wait for the bounding box to stabilize at <320 (smaller
// than React Flow's default node width) before taking the visual baseline.
async function waitForAutoFit(node: Locator): Promise<void> {
  await expect
    .poll(async () => (await node.boundingBox())?.width ?? 0, { timeout: 5000 })
    .toBeLessThan(320);
}

// US-015: end-to-end coverage for the component node — proves the `set`-kind
// dispatch lights up against a real studio: clicking a Button with a `set`-kind
// action mutates the canvas runtime's state synchronously.

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
  // nodes/c1/spec.json. The studio's resolver chain (FlowSchema ->
  // mergeFlowAndStyle -> inlineComponentSpecs -> ResolvedFlowSchema) inlines
  // spec.json on read.
  cpSync(FIXTURE_DIR, repoPath, { recursive: true });

  // US-005 migrated the on-disk fixture to the manifest layout — the flow
  // and per-node files now live under `flows/main/`. The legacy register
  // endpoint still works for single-flow registration; the projectSlug
  // synthesised by ops.registerFlowImpl pulls from slugify(name).
  const res = await fetch(`${studio.baseURL}/api/flows/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: opts.name ?? 'Component Demo',
      repoPath,
      flowPath: 'flows/main/flow.json',
    }),
  });
  if (res.status !== 200) {
    const detail = await res.text();
    throw new Error(`Failed to register component-demo fixture: ${res.status} ${detail}`);
  }
  const { id, slug: registeredSlug } = (await res.json()) as { id: string; slug: string };
  const idx = registeredSlug.indexOf('/');
  if (idx < 0) throw new Error(`Registry slug missing '/': ${registeredSlug}`);
  const projectSlug = registeredSlug.slice(0, idx);
  const flowSlug = registeredSlug.slice(idx + 1);
  return { id, slug: registeredSlug, projectSlug, flowSlug, repoPath };
}

test.describe('canvas — component node (US-015)', () => {
  test('Reset button mutates state via set action', async ({ page, studio }) => {
    const registered = await seedComponentDemo(studio.studio, { slug: 'component-demo-reset' });

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(registered.projectSlug, registered.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    const node = page.locator('[data-node-type="component"]');
    await expect(node).toHaveCount(1);
    const body = node.locator('[data-testid="component-node-body"]');

    // The Metric impl renders its value inside the only `sf:tabular-nums`
    // span in the registry — no other catalog component uses that class.
    // The spec seeds /count = 5 so the initial paint shows "5".
    const value = body.locator('span.sf\\:tabular-nums');
    await expect(value).toHaveText('5');
    await waitForAutoFit(node);

    // Set-kind actions land synchronously: dispatchState({kind:'set'}) is
    // inside the same React event tick as onClick, so the next render sees
    // /count = 0 with no network round trip.
    await body.getByRole('button', { name: 'Reset' }).click();
    await expect(value).toHaveText('0');
    await expect(node).toHaveScreenshot('component-node-after-reset.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
