import {
  expect,
  projectFlowPath,
  registerFlow,
  test,
  waitForCanvasSettled,
} from './support/studio-fixture.ts';

// Toolbar-driven linkflow creation. The Link node tile in the secondary
// primary group arms draw mode for `type: 'linkflow'`; a drag (or tap) on the
// canvas commits a freshly-dropped node and auto-opens the picker dialog so
// the user lands directly in target selection. This spec exercises both the
// drag and tap paths and confirms the post-pick state flip.
//
// Filename ends in `.e2e.ts` so bun's default `*.spec.ts` matcher skips it
// (Playwright loads it from playwright.config.ts).

const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

// Source flow is intentionally empty — the user creates the linkflow via the
// toolbar, not via fixture seeding. Avoids overlap with linkflow.e2e.ts
// (which seeds via `registerFlow` to cover the post-create-and-pick paths).
function buildEmptyFlow(name: string) {
  return {
    version: 2 as const,
    name,
    nodes: [],
    connectors: [],
  };
}

function buildTargetFlow(name: string) {
  return {
    version: 2 as const,
    name,
    nodes: [
      {
        id: 'tgt1',
        type: 'rectangle' as const,
        position: { x: 100, y: 100 },
        data: { name: 'Target' },
      },
    ],
    connectors: [],
  };
}

test.describe('canvas — linkflow toolbar tile', () => {
  test('drag commits a linkflow node, auto-opens picker, pick flips to linked-healthy', async ({
    page,
    studio,
  }) => {
    const target = await registerFlow(
      studio.studio,
      'lf-toolbar-target',
      buildTargetFlow('LF Toolbar Target'),
      { name: 'LF Toolbar Target' },
    );
    const source = await registerFlow(
      studio.studio,
      'lf-toolbar-source',
      buildEmptyFlow('LF Toolbar Source'),
      { name: 'LF Toolbar Source' },
    );

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    // Arm the toolbar's Link node tile.
    await page.locator('[data-testid="toolbar-shape-linkflow"]').click();
    await expect(page.locator('[data-testid="seeflow-canvas"]')).toHaveAttribute(
      'data-canvas-mode',
      'draw',
    );

    // Drag a rectangle on the pane that's already past LINKFLOW_MIN_SIZE.
    const pane = page.locator('.react-flow__pane').first();
    const box = await pane.boundingBox();
    if (!box) throw new Error('react-flow pane has no bounding box');
    const startX = box.x + 220;
    const startY = box.y + 180;
    const endX = startX + 220;
    const endY = startY + 120;
    const dispatch = async (
      type: 'pointerdown' | 'pointermove' | 'pointerup',
      x: number,
      y: number,
    ) => {
      await pane.dispatchEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
      });
    };
    await dispatch('pointerdown', startX, startY);
    await dispatch('pointermove', startX + 80, startY + 40);
    await dispatch('pointermove', endX, endY);
    await dispatch('pointerup', endX, endY);

    // The unlinked linkflow node mounts on the canvas.
    const linkflowNode = page.locator('[data-testid="linkflow-node"]');
    await expect(linkflowNode).toHaveCount(1, { timeout: 5_000 });
    await expect(linkflowNode).toHaveAttribute('data-linkflow-state', 'unlinked');

    // The picker dialog auto-opens because the optimistic data carries the
    // `_autoOpenPickerOnMount` runtime flag.
    const dialog = page.locator('[data-testid="linkflow-picker-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Pick the target, commit — state flips to linked-healthy, dialog closes.
    await page.locator(`[data-testid="linkflow-picker-row-${target.slug}"]`).click();
    await page.locator('[data-testid="linkflow-picker-commit"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(linkflowNode).toHaveAttribute('data-linkflow-state', 'linked-healthy');
    await expect(page.locator('[data-testid="linkflow-flow-name"]')).toHaveText(
      'LF Toolbar Target',
    );
  });

  test('tap (near-zero drag) commits at LINKFLOW_DEFAULT_SIZE 240x100', async ({
    page,
    studio,
  }) => {
    const source = await registerFlow(
      studio.studio,
      'lf-toolbar-tap',
      buildEmptyFlow('LF Toolbar Tap'),
      { name: 'LF Toolbar Tap' },
    );

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    await page.locator('[data-testid="toolbar-shape-linkflow"]').click();

    const pane = page.locator('.react-flow__pane').first();
    const box = await pane.boundingBox();
    if (!box) throw new Error('react-flow pane has no bounding box');
    const x = box.x + 300;
    const y = box.y + 240;
    const dispatch = async (type: 'pointerdown' | 'pointerup') => {
      await pane.dispatchEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
      });
    };
    // Down + up at the same point → near-zero branch → default-size fallback.
    await dispatch('pointerdown');
    await dispatch('pointerup');

    const linkflowNode = page.locator('[data-testid="linkflow-node"]');
    await expect(linkflowNode).toHaveCount(1, { timeout: 5_000 });
    await expect(linkflowNode).toHaveAttribute('data-linkflow-state', 'unlinked');

    // The picker still auto-opens on a tap commit — auto-open is independent
    // of the drag's geometry; close it so the linkflow-node bounding box can
    // be measured without the dialog backdrop intervening.
    const dialog = page.locator('[data-testid="linkflow-picker-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // React Flow renders the node at `width × zoom` client px. Auto-fit-view
    // applies on mount, so we read the rendered size via React Flow's
    // computed style on the node wrapper rather than via the unlinked pill's
    // visible bounding box (the inner button shrinks to its content). The
    // .react-flow__node wrapper carries the persisted width/height as inline
    // style at default zoom (no fit-view runs when the flow has a single
    // node and no fitView signal bumps).
    const wrapper = page.locator('.react-flow__node').first();
    const style = await wrapper.getAttribute('style');
    expect(style).toContain('width: 240px');
    expect(style).toContain('height: 100px');
  });
});
