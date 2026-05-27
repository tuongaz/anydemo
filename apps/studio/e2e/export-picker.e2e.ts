// End-to-end coverage for the export-dialog flow picker.
//
// Unit tests in apps/web/src/components/export-dialog.test.tsx cover the
// picker rendering, checkbox toggling, "Select all/Clear" behavior, default
// flow star marker, and the disabled-when-zero-selected gate against a
// hook-shim render tree. This e2e file proves the picker still wires through
// the share menu, cloud POST, and bundle layout against a real browser.

import { unzipSync } from 'fflate';
import {
  expect,
  projectFlowPath,
  registerManifestProject,
  test,
} from './support/studio-fixture.ts';

test.describe('export dialog flow picker', () => {
  test('picks a subset of flows and posts only those in the bundle', async ({ page, studio }) => {
    const project = await registerManifestProject(studio.studio, {
      projectDirName: 'export-picker-demo',
      name: 'Export Picker Demo',
      defaultFlow: 'main',
      flows: [
        { id: 'main', name: 'Main' },
        { id: 'retry', name: 'Retry' },
        { id: 'audit', name: 'Audit' },
      ],
    });

    // Intercept the cloud POST so the test stays hermetic — capture the zipped
    // body so we can assert the manifest reflects the user's picks.
    let capturedBody: Uint8Array | null = null;
    await page.route('https://seeflow.dev/api/projects*', async (route) => {
      const buf = route.request().postDataBuffer();
      capturedBody = buf ? new Uint8Array(buf) : null;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://seeflow.dev/project/test-uuid' }),
      });
    });

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(project.projectSlug, project.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.waitForLoadState('networkidle');

    // Open the share menu, then the export-to-cloud item.
    await page.locator('[data-testid="share-menu-trigger"]').click();
    await page.locator('[data-testid="share-menu-export-cloud"]').click();

    const dialog = page.locator('[data-testid="export-dialog"]');
    await expect(dialog).toBeVisible();

    // Three checkboxes, all checked by default.
    const mainCheckbox = dialog.locator('[data-testid="export-flow-checkbox-main"]');
    const retryCheckbox = dialog.locator('[data-testid="export-flow-checkbox-retry"]');
    const auditCheckbox = dialog.locator('[data-testid="export-flow-checkbox-audit"]');
    await expect(mainCheckbox).toBeChecked();
    await expect(retryCheckbox).toBeChecked();
    await expect(auditCheckbox).toBeChecked();

    // Default flow gets the star marker.
    await expect(dialog.locator('[data-testid="export-flow-default-main"]')).toHaveCount(1);
    await expect(dialog.locator('[data-testid="export-flow-default-retry"]')).toHaveCount(0);

    // Uncheck `audit`; submit.
    await auditCheckbox.uncheck();
    await dialog.locator('[data-testid="export-email-input"]').fill('e2e@example.com');
    await dialog.locator('[data-testid="export-name-input"]').fill('Export Picker Demo');
    await dialog.locator('[data-testid="export-submit"]').click();

    // The captured zip should contain only `main` and `retry`.
    await expect.poll(() => capturedBody !== null).toBe(true);
    if (!capturedBody) throw new Error('cloud body not captured');
    const entries = unzipSync(capturedBody);
    const keys = Object.keys(entries).sort();
    expect(keys).toContain('flows/main/flow.json');
    expect(keys).toContain('flows/retry/flow.json');
    expect(keys).not.toContain('flows/audit/flow.json');

    const seeflowJson = entries['seeflow.json'];
    if (!seeflowJson) throw new Error('seeflow.json missing from bundle');
    const manifest = JSON.parse(new TextDecoder().decode(seeflowJson));
    expect(manifest.defaultFlow).toBe('main');
    expect(manifest.flows.map((f: { id: string }) => f.id).sort()).toEqual(['main', 'retry']);
  });
});
