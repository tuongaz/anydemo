// US-004: Playwright e2e coverage for the decoupled inspector sidebar.
//
// After US-003, the right-hand DetailPanel no longer auto-opens on node
// selection — it opens only when the user clicks the
// `[data-testid="inspector-toggle"]` button in the top-right chrome row.
// Empty-pane clicks deselect any active node but leave the panel open;
// closing is only via the toggle or the panel's own close affordance.
// Connectors never drive the panel.
//
// The panel is ALWAYS mounted while the sidebar feature is enabled — it
// animates `width: 0 ↔ W` to push / yield canvas space, so visibility
// (not presence) is the assertion to make.
//
// Filename ends in `.e2e.ts` (not `.spec.ts`) so bun test's default
// discovery can't pick it up — same convention as the other studio e2e
// suites.

import { expect, projectFlowPath, test, waitForCanvasSettled } from './support/studio-fixture.ts';

const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

test.describe('inspector toggle — sidebar decoupled from selection', () => {
  test.beforeEach(async ({ page, studio }) => {
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(studio.flow.projectSlug, studio.flow.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);
    // Sanity: the toggle is mounted in edit mode (the studio's default).
    await expect(page.locator('[data-testid="inspector-toggle"]')).toBeVisible();
  });

  test('clicking a node does NOT open the DetailPanel by default', async ({ page }) => {
    const detailPanel = page.locator('[data-testid="detail-panel"]');
    // Panel is always in the DOM (for the slide-out animation) but starts
    // with width: 0, so toBeVisible reports false.
    await expect(detailPanel).not.toBeVisible();

    await page.locator('.react-flow__node[data-id="n1"]').click();
    // Selection lands on the clicked node…
    await expect(page.locator('.react-flow__node[data-id="n1"]')).toHaveClass(/selected/);
    // …but the inspector stays closed (width: 0).
    await expect(detailPanel).not.toBeVisible();
  });

  test('clicking the inspector toggle while a node is selected opens the panel', async ({
    page,
  }) => {
    const detailPanel = page.locator('[data-testid="detail-panel"]');

    await page.locator('.react-flow__node[data-id="n1"]').click();
    await expect(detailPanel).not.toBeVisible();

    await page.locator('[data-testid="inspector-toggle"]').click();
    await expect(detailPanel).toBeVisible();
  });

  test('clicking the empty pane keeps the inspector open', async ({ page }) => {
    const detailPanel = page.locator('[data-testid="detail-panel"]');

    // Open the inspector first (no selection needed — the empty-state branch
    // from US-002 mounts the placeholder, the panel container is still
    // [data-testid="detail-panel"]).
    await page.locator('[data-testid="inspector-toggle"]').click();
    await expect(detailPanel).toBeVisible();

    // Click an empty area of the pane. React Flow's `.react-flow__pane`
    // covers the full canvas; pick a coordinate at the top-left corner of
    // the canvas root, well away from the kitchen-sink fixture nodes (which
    // sit in the central region after auto-fit).
    const pane = page.locator('.react-flow__pane').first();
    const box = await pane.boundingBox();
    if (!box) throw new Error('react-flow pane has no bounding box');
    await page.mouse.click(box.x + 20, box.y + 20);

    // Pane click deselects any selected nodes but MUST NOT close the panel.
    // The panel falls back to the US-002 empty-state placeholder while
    // selection is empty; close is only via the toggle / panel close button.
    await expect(detailPanel).toBeVisible();
  });
});
