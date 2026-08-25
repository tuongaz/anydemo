import {
  expect,
  projectFlowPath,
  registerFlow,
  test,
  waitForCanvasSettled,
} from './support/studio-fixture.ts';

// US-009: end-to-end coverage for the linkflow node. Exercises the four
// primary user paths plus pins a visual baseline for each of the three
// render states.
//   1. Drop → open picker → link → navigate → back → viewport preserved.
//      The "drop" step seeds an unlinked linkflow on the source flow via
//      registerFlow because the current toolbar has no linkflow tile (a
//      future tile would still ride the same picker → commit path).
//   2. Delete key removes the selected linkflow node.
//   3. Broken state when the target flow does not resolve in the flows
//      cache (seeded with a target pointing at a non-existent slug).
//   4. Three visual baselines — linkflow-unlinked / linkflow-linked /
//      linkflow-broken — pinned to chromium-linux pixels.
//
// Filename ends in `.e2e.ts` (not `.spec.ts` as the PRD literal suggests)
// to dodge bun's default `*.spec.ts` matcher — same convention as the rest
// of the suite (see playwright.config.ts).

const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

// The source flow carries one linkflow node (id `lf1`) plus one marker
// rectangle (id `marker`) used to measure viewport preservation across the
// pushLink → popBack round trip.
interface SourceFlowOpts {
  linkflowTarget?: { project: string; flow: string };
}
function buildSourceFlow(name: string, opts: SourceFlowOpts = {}) {
  const lfData: Record<string, unknown> = { name: 'Pick a flow' };
  if (opts.linkflowTarget) lfData.target = opts.linkflowTarget;
  return {
    version: 2 as const,
    name,
    nodes: [
      {
        id: 'lf1',
        type: 'linkflow' as const,
        position: { x: 80, y: 80 },
        data: lfData,
      },
      {
        id: 'marker',
        type: 'rectangle' as const,
        position: { x: 400, y: 320 },
        data: { name: 'Marker' },
      },
    ],
    connectors: [],
  };
}

function buildTargetFlow() {
  return {
    version: 2 as const,
    name: 'Linkflow Target',
    nodes: [
      {
        id: 'tgt1',
        type: 'rectangle' as const,
        position: { x: 100, y: 100 },
        data: { name: 'Target Node' },
      },
    ],
    connectors: [],
  };
}

test.describe('canvas — linkflow (US-009)', () => {
  test('drop, link, navigate, and back preserves viewport', async ({ page, studio }) => {
    const target = await registerFlow(studio.studio, 'lf-target-nav', buildTargetFlow(), {
      name: 'LF Target Nav',
    });
    const source = await registerFlow(
      studio.studio,
      'lf-source-nav',
      buildSourceFlow('LF Source Nav'),
      {
        name: 'LF Source Nav',
      },
    );

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    // Unlinked state renders.
    const linkflowNode = page.locator('[data-testid="linkflow-node"]');
    await expect(linkflowNode).toBeVisible();
    await expect(linkflowNode).toHaveAttribute('data-linkflow-state', 'unlinked');

    // Open the picker, pick the target, commit.
    await page.locator('[data-testid="linkflow-link-button"]').click();
    const dialog = page.locator('[data-testid="linkflow-picker-dialog"]');
    await expect(dialog).toBeVisible();
    await page.locator(`[data-testid="linkflow-picker-row-${target.slug}"]`).click();
    await page.locator('[data-testid="linkflow-picker-commit"]').click();
    await expect(dialog).toHaveCount(0);

    // Renderer flips to linked-healthy after the patch + flows resolution.
    // The visible flow name comes from FlowSummary.name (the registration's
    // `name` field on /api/flows/register) — NOT the inline `name` field of
    // the resolved flow envelope. registerFlow above passes 'LF Target Nav'.
    await expect(linkflowNode).toHaveAttribute('data-linkflow-state', 'linked-healthy');
    await expect(page.locator('[data-testid="linkflow-flow-name"]')).toHaveText('LF Target Nav');

    // Measure marker BEFORE navigating — the source's FlowView will be
    // hidden under display:none after pushLink but stays mounted so its
    // canvas viewport survives. We compare against the post-back rect.
    const marker = page.locator('.react-flow__node[data-id="marker"]');
    await expect(marker).toBeVisible();
    const before = await marker.boundingBox();
    if (!before) throw new Error('marker has no bounding box before navigation');

    // Body click on linked-healthy pushes the target onto the stack.
    await page.locator('[data-testid="linkflow-follow-button"]').click();
    await page.waitForURL(`**${projectFlowPath(target.projectSlug, target.flowSlug)}`, {
      timeout: 10_000,
    });
    // Target's FlowView mounts. The back-arrow appears once a previous
    // entry exists on the stack — its absence on the source page is the
    // depth-1 invariant; presence here is the depth-2 invariant.
    const backButton = page.locator('[data-testid="flow-back-button"]');
    await expect(backButton).toBeVisible();
    await page.locator('[data-canvas-ready="true"]').first().waitFor({ state: 'attached' });

    // Back arrow → popBack via history.back() → popstate handler truncates
    // the stack → source becomes the top entry → URL reverts.
    await backButton.click();
    await page.waitForURL(`**${projectFlowPath(source.projectSlug, source.flowSlug)}`, {
      timeout: 10_000,
    });
    // The back arrow disappears once the stack is back to depth 1.
    await expect(backButton).toHaveCount(0);

    // Marker is visible again and at the SAME position (the source's
    // FlowView never unmounted; xyflow's viewport state survived).
    await expect(marker).toBeVisible();
    const after = await marker.boundingBox();
    if (!after) throw new Error('marker has no bounding box after navigation');
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
  });

  test('delete key removes the linkflow node', async ({ page, studio }) => {
    const source = await registerFlow(
      studio.studio,
      'lf-source-delete',
      buildSourceFlow('LF Source Delete'),
      { name: 'LF Source Delete' },
    );

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    await expect(page.locator('[data-testid="linkflow-node"]')).toHaveCount(1);

    // Select-all + Delete. The linkflow node's inner button stopPropagation
    // suppresses a direct click selection, so the canvas-level select-all
    // chord (Cmd+A) is the cleanest route — it also exercises the same
    // delete-key path a regular keyboard user would invoke.
    await page
      .locator('.react-flow__pane')
      .first()
      .click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');

    // The marker rectangle was also selected by Cmd+A and would be deleted
    // too, so the AC is checked against the linkflow-node count specifically.
    await expect(page.locator('[data-testid="linkflow-node"]')).toHaveCount(0, { timeout: 5_000 });
  });

  test('renders broken state when target does not resolve', async ({ page, studio }) => {
    const source = await registerFlow(
      studio.studio,
      'lf-source-broken',
      buildSourceFlow('LF Source Broken', {
        linkflowTarget: { project: 'does-not-exist', flow: 'gone' },
      }),
      { name: 'LF Source Broken' },
    );

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    const linkflowNode = page.locator('[data-testid="linkflow-node"]');
    await expect(linkflowNode).toBeVisible();
    await expect(linkflowNode).toHaveAttribute('data-linkflow-state', 'broken');
    // Last-known label surfaces the slug pair from data.target.
    await expect(page.locator('[data-testid="linkflow-broken-label"]')).toHaveText(
      'does-not-exist · gone',
    );
  });

  test('visual baseline: unlinked', async ({ page, studio }) => {
    const source = await registerFlow(
      studio.studio,
      'lf-visual-unlinked',
      buildSourceFlow('LF Visual Unlinked'),
      { name: 'LF Visual Unlinked' },
    );

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    const linkflowNode = page.locator('[data-testid="linkflow-node"]');
    await expect(linkflowNode).toBeVisible();
    await expect(linkflowNode).toHaveAttribute('data-linkflow-state', 'unlinked');
    await expect(linkflowNode).toHaveScreenshot('linkflow-unlinked.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('visual baseline: linked', async ({ page, studio }) => {
    // Register the target first so the source's pre-set target resolves on
    // first render — the visual snapshot needs the linked-healthy chrome
    // without a picker round trip.
    const target = await registerFlow(studio.studio, 'lf-visual-target', buildTargetFlow(), {
      name: 'LF Visual Target',
    });
    const source = await registerFlow(
      studio.studio,
      'lf-visual-linked',
      buildSourceFlow('LF Visual Linked', {
        linkflowTarget: { project: target.projectSlug, flow: target.flowSlug },
      }),
      { name: 'LF Visual Linked' },
    );

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    const linkflowNode = page.locator('[data-testid="linkflow-node"]');
    await expect(linkflowNode).toBeVisible();
    await expect(linkflowNode).toHaveAttribute('data-linkflow-state', 'linked-healthy');
    await expect(linkflowNode).toHaveScreenshot('linkflow-linked.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('visual baseline: broken', async ({ page, studio }) => {
    const source = await registerFlow(
      studio.studio,
      'lf-visual-broken',
      buildSourceFlow('LF Visual Broken', {
        linkflowTarget: { project: 'missing-project', flow: 'missing-flow' },
      }),
      { name: 'LF Visual Broken' },
    );

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    const linkflowNode = page.locator('[data-testid="linkflow-node"]');
    await expect(linkflowNode).toBeVisible();
    await expect(linkflowNode).toHaveAttribute('data-linkflow-state', 'broken');
    await expect(linkflowNode).toHaveScreenshot('linkflow-broken.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
