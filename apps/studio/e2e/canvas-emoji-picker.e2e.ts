// Emoji tab in the Insert-Icon picker.
//
// The picker grows a fifth always-on tab — "Emoji" — that lazy-loads a Twemoji
// catalog and renders it through the existing virtualized grid as ordinary
// `iconify:twemoji:<slug>` tiles. This e2e is DELIBERATELY NON-VISUAL: emoji
// glyphs paint via the public iconify CDN, which the Docker test runner can't
// reach, so we assert on DOM presence (tab + grid + tile buttons + keyword
// search) rather than pixels. The tile <button>s exist regardless of whether
// their SVGs load.
//
// Filename ends in `.e2e.ts` so bun test's default discovery skips it.

import { expect, projectFlowPath, test, waitForCanvasSettled } from './support/studio-fixture.ts';

const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

test.describe('insert-icon picker — Emoji tab', () => {
  test.beforeEach(async ({ page, studio }) => {
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(studio.flow.projectSlug, studio.flow.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);
    // Open the Insert-Icon popover from the toolbar.
    await page.locator('[data-testid="toolbar-insert-icon"]').click();
    await expect(page.locator('[data-testid="icon-picker-popover"]')).toBeVisible();
  });

  test('Emoji tab loads the catalog into the grid as iconify:twemoji tiles', async ({ page }) => {
    const emojiTab = page.locator('[data-testid="icon-picker-tab-emoji"]');
    await expect(emojiTab).toBeVisible();
    await emojiTab.click();

    // The catalog lazy-loads via dynamic import; once resolved the grid renders.
    await expect(page.locator('[data-testid="icon-picker-all"]')).toBeVisible();
    const emojiTiles = page.locator('[data-testid^="icon-picker-tile-iconify-twemoji-"]');
    await expect(emojiTiles.first()).toBeVisible();
    expect(await emojiTiles.count()).toBeGreaterThan(0);
  });

  test('keyword search surfaces an emoji whose slug does not contain the query', async ({
    page,
  }) => {
    await page.locator('[data-testid="icon-picker-tab-emoji"]').click();
    await expect(page.locator('[data-testid="icon-picker-all"]')).toBeVisible();

    const search = page.locator('[data-testid="icon-picker-search"]');
    await expect(search).toHaveAttribute('placeholder', 'Search emojis…');
    // "happy" appears only in the grinning-face entry's keywords, never its slug.
    await search.fill('happy');

    const grinning = page.locator('[data-testid="icon-picker-tile-iconify-twemoji-grinning-face"]');
    await expect(grinning).toBeVisible();
    await expect(grinning).toHaveAttribute('data-icon-name', 'iconify:twemoji:grinning-face');
  });
});
