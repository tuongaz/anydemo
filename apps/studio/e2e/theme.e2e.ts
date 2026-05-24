import { expect, setStudioTheme, test } from './support/studio-fixture.ts';

// US-008: end-to-end coverage for the Cog → Theme menu (added in US-006)
// and the new light visual baseline. The shared studio fixture's default
// `dark` seed (US-007) is overridden per test via `setStudioTheme(page, ...)`
// so the first paint and the first localStorage read both match the test's
// intent; without that override the FOUC script would briefly apply dark
// before React boots and the hook re-applies the toggled value.
//
// `page.emulateMedia({ colorScheme: 'light' })` pins the OS-level preference
// so the 'System' option deterministically resolves to 'light' in this spec,
// independent of the host machine and CI defaults.

const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

test.describe('canvas — theme toggle (US-008)', () => {
  test('cog menu cycles Light / Dark / System and flips the <html> class', async ({
    page,
    studio,
  }) => {
    await setStudioTheme(page, 'light');
    await page.emulateMedia({ colorScheme: 'light' });

    await page.goto(`${studio.studio.baseURL}/d/${studio.flow.slug}`);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await page.waitForLoadState('networkidle');

    // Initial paint reflects the seeded 'light' preference. The FOUC script
    // in apps/web/index.html adds the 'light' class on first paint; the
    // useTheme hook re-applies the same class on mount.
    await expect(page.locator('html')).toHaveClass(/(^|\s)light(\s|$)/);
    await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);

    // Helper: open the menu, click a radio, and assert the resulting class.
    // The menu portals to document.body, so the radio item testids resolve
    // against the page root rather than the trigger's subtree.
    const select = async (
      themeTestId: 'theme-light' | 'theme-dark' | 'theme-system',
      expectedClass: 'light' | 'dark',
    ) => {
      await page.locator('[data-testid="settings-trigger"]').click();
      const item = page.locator(`[data-testid="${themeTestId}"]`);
      await item.waitFor({ state: 'visible' });
      await item.click();
      // Clicking a DropdownMenuRadioItem closes the menu. Wait for the
      // settings-menu portal to detach so the next iteration's click on the
      // trigger isn't shadowed by a closing-animation overlay.
      await page.locator('[data-testid="settings-menu"]').waitFor({ state: 'detached' });

      const other = expectedClass === 'light' ? 'dark' : 'light';
      await expect(page.locator('html')).toHaveClass(new RegExp(`(^|\\s)${expectedClass}(\\s|$)`));
      await expect(page.locator('html')).not.toHaveClass(new RegExp(`(^|\\s)${other}(\\s|$)`));
    };

    await select('theme-dark', 'dark');
    await select('theme-light', 'light');
    // colorScheme: 'light' was emulated above, so System resolves to light.
    await select('theme-system', 'light');
  });

  test('light-mode kitchen-sink visual baseline', async ({ page, studio }) => {
    await setStudioTheme(page, 'light');
    await page.emulateMedia({ colorScheme: 'light' });

    await page.goto(`${studio.studio.baseURL}/d/${studio.flow.slug}`);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await page.waitForLoadState('networkidle');

    await expect(page.locator('html')).toHaveClass(/(^|\s)light(\s|$)/);

    // Snapshot the canvas root rather than the whole page so header chrome
    // and viewport-scoped cursor effects don't churn the baseline.
    const root = page.locator('.seeflow-canvas-root').first();
    await expect(root).toBeVisible();
    await expect(root).toHaveScreenshot('kitchen-sink-light.png', { maxDiffPixelRatio: 0.02 });
  });
});
