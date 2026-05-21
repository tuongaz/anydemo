import { expect, test } from './support/studio-fixture.ts';

// The six node types and four connector kinds present in the kitchen-sink
// fixture (apps/studio/integration/fixtures/kitchen-sink.flow.json).
const NODE_TYPES = [
  'playNode',
  'stateNode',
  'shapeNode',
  'imageNode',
  'htmlNode',
  'iconNode',
] as const;

const EDGE_KINDS = ['http', 'event', 'queue', 'default'] as const;

// imageNode renders just an <img> tag with no visible text content, so the
// "non-empty text" smoke check is skipped for it. Every other node type
// renders its `name` (or html) as descendant text.
const TEXTLESS_NODE_TYPES = new Set<string>(['imageNode']);

// Inline CSS that disables every transition and animation so screenshots stay
// stable across runs. Injected via page.addStyleTag inside beforeEach.
const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

test.describe('canvas — kitchen-sink fixture', () => {
  test.beforeEach(async ({ page, studio }) => {
    // SPA routes to /d/<slug>; the PRD's `?flow=<slug>` URL is from an older
    // routing draft. See apps/web/src/App.tsx:matchDemoSlug.
    await page.goto(`${studio.studio.baseURL}/d/${studio.flow.slug}`);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    // Give React Flow's auto-fit + layout settle pass one paint cycle so node
    // bounding boxes are stable before any assertion runs.
    await page.waitForLoadState('networkidle');
  });

  test('every node type renders', async ({ page }) => {
    await expect(page.locator('.react-flow__node')).toHaveCount(6);
    await expect(page.locator('.react-flow__edge')).toHaveCount(4);

    for (const type of NODE_TYPES) {
      const locator = page.locator(`[data-node-type="${type}"]`);
      await expect(locator).toHaveCount(1);
      await expect(locator).toBeVisible();
      if (!TEXTLESS_NODE_TYPES.has(type)) {
        await expect(locator).not.toHaveText('');
      }
    }
  });

  test('per-node visual baseline', async ({ page }) => {
    for (const type of NODE_TYPES) {
      const locator = page.locator(`[data-node-type="${type}"]`);
      await expect(locator).toBeVisible();
      await expect(locator).toHaveScreenshot(`${type}.png`, { maxDiffPixelRatio: 0.02 });
    }
  });

  test('connector kinds render distinctly', async ({ page }) => {
    for (const kind of EDGE_KINDS) {
      await expect(page.locator(`[data-edge-kind="${kind}"]`)).toHaveCount(1);
    }
  });

  test('mouse glow overlay activates on hover and deactivates on leave', async ({ page }) => {
    const overlay = page.locator('[data-testid="canvas-glow-overlay"]');
    await expect(overlay).toHaveAttribute('data-active', 'false');

    // Hovering the pane fires mousemove on .react-flow__pane, which the
    // overlay subscribes to. DISABLE_MOTION_CSS in beforeEach strips the
    // opacity transition, so the change is immediate — no polling delay
    // needed beyond toHaveCSS's built-in retry.
    await page.locator('.react-flow__pane').first().hover();
    await expect(overlay).toHaveAttribute('data-active', 'true');
    await expect(overlay).toHaveCSS('opacity', '1');

    // Move the cursor to the top-left of the page, which is outside the
    // React Flow pane (header chrome occupies that area), to trigger
    // mouseleave on the pane.
    await page.mouse.move(0, 0);
    await expect(overlay).toHaveAttribute('data-active', 'false');
    await expect(overlay).toHaveCSS('opacity', '0');
  });
});
