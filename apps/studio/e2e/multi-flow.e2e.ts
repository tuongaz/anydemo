// US-027: end-to-end coverage for the multi-flow page switcher (US-023..US-026).
// Exercises the full CRUD lifecycle in the browser:
//   1. Project boots with a single flow (`main`).
//   2. Operator opens the switcher and creates a new `retry` flow via the
//      dialog. URL transitions to `/projects/component-flow/flows/retry`.
//   3. Operator renames `retry`'s display name via the per-row pencil button.
//      The slimmed rename dialog locks the flow id, so the URL stays at
//      `/flows/retry`; only the trigger label changes.
//   4. Operator deletes `retry`. Active-flow guard sends the user back to
//      the project default (`main`), and the popover no longer lists it.
//
// Filename ends in `.e2e.ts` (not `.spec.ts` as the PRD literal suggests)
// because the Playwright config matches `**/*.e2e.ts` so bun test's default
// `*.spec.ts` discovery can't accidentally pick up Playwright specs and crash
// on missing globals — same convention as mcp-app.e2e.ts.

import {
  expect,
  projectFlowPath,
  registerManifestProject,
  test,
  waitForCanvasSettled,
} from './support/studio-fixture.ts';

// Match the canvas/theme e2e suites — stripping transitions/animations keeps
// dialog open/close cycles deterministic across hosts.
const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

test.describe('flow switcher CRUD (US-027)', () => {
  test('create, rename, and delete flows from the popover', async ({ page, studio }) => {
    // The worker-scoped studio is shared with component-node.e2e.ts, whose
    // seedComponentFlow registers a flow named 'Component Flow' via the legacy
    // /api/flows/register endpoint. That endpoint synthesises projectSlug from
    // slugify(name) → `component-flow` and pins flowSlug=`main` — colliding
    // with anything we'd register here under the same name. Pick a name whose
    // slug is unique so /api/projects/:project/flows returns only OUR flow.
    const project = await registerManifestProject(studio.studio, {
      projectDirName: 'multi-flow-fixture',
      name: 'Multi Flow Fixture',
      defaultFlow: 'main',
      flows: [{ id: 'main', name: 'Main' }],
    });

    // Sanity check: registerManifestProject synthesises projectSlug via
    // slugify(name). 'Multi Flow Fixture' → 'multi-flow-fixture' — the AC pins this.
    expect(project.projectSlug).toBe('multi-flow-fixture');
    expect(project.flowSlug).toBe('main');

    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(project.projectSlug, project.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    // The switcher trigger shows the active flow's display name — confirms
    // useProjectFlows resolved against the manifest before the popover opens.
    const trigger = page.locator('[data-testid="flow-switcher-trigger"]');
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText('Main');

    // ── 1. Create the `retry` flow ────────────────────────────────────────
    await trigger.click();
    await page.locator('[data-testid="flow-switcher-popover"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="flow-switcher-create"]').click();

    const createDialog = page.locator('[data-testid="flow-create-dialog"]');
    await expect(createDialog).toBeVisible();
    await page.locator('[data-testid="flow-create-id-input"]').fill('retry');
    await page.locator('[data-testid="flow-create-name-input"]').fill('Retry');
    await page.locator('[data-testid="flow-create-submit"]').click();

    // flow-view.tsx navigates to the just-created flow on success.
    await page.waitForURL(`**${projectFlowPath(project.projectSlug, 'retry')}`, {
      timeout: 10_000,
    });
    await expect(createDialog).toHaveCount(0);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await expect(trigger).toContainText('Retry');

    // ── 2. Rename `retry`'s display name (id stays `retry`) ──────────────
    await trigger.click();
    await page.locator('[data-testid="flow-switcher-popover"]').waitFor({ state: 'visible' });
    // The per-row rename button is data-testid="flow-switcher-rename-<slug>".
    // It's hidden by default (opacity-0) and reveals on group-hover; clicking
    // the row's hover area surfaces it. Force the click so we don't rely on
    // mouse pointer position to drive CSS state.
    await page.locator('[data-testid="flow-switcher-rename-retry"]').click({ force: true });

    const renameDialog = page.locator('[data-testid="flow-rename-dialog"]');
    await expect(renameDialog).toBeVisible();
    // The slimmed rename dialog disables the flow-id input (id is fixed once
    // created) — we can only change the display name. Confirm the lock, then
    // edit the name field.
    await expect(page.locator('[data-testid="flow-rename-id-input"]')).toBeDisabled();
    await page.locator('[data-testid="flow-rename-name-input"]').fill('Retry V2');
    await page.locator('[data-testid="flow-rename-submit"]').click();

    // URL must NOT change — only the display name was edited. Assert the
    // trigger picks up the new name while the path remains /flows/retry.
    await expect(renameDialog).toHaveCount(0);
    await expect(trigger).toContainText('Retry V2');
    expect(new URL(page.url()).pathname).toBe(projectFlowPath(project.projectSlug, 'retry'));

    // ── 3. Delete `retry` ────────────────────────────────────────────────
    await trigger.click();
    await page.locator('[data-testid="flow-switcher-popover"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="flow-switcher-delete-retry"]').click({ force: true });

    const deleteDialog = page.locator('[data-testid="flow-delete-dialog"]');
    await expect(deleteDialog).toBeVisible();
    // `retry` is NOT the project default — the new-default picker stays hidden.
    await expect(page.locator('[data-testid="flow-delete-new-default-select"]')).toHaveCount(0);
    await page.locator('[data-testid="flow-delete-submit"]').click();

    // flow-view.tsx navigates away from a deleted active flow to the project
    // default. The manifest default is `main`, so that's where we land.
    await page.waitForURL(`**${projectFlowPath(project.projectSlug, 'main')}`, { timeout: 10_000 });
    await expect(deleteDialog).toHaveCount(0);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await expect(trigger).toContainText('Main');

    // ── 4. Popover no longer lists `retry` ───────────────────────────────
    await trigger.click();
    await page.locator('[data-testid="flow-switcher-popover"]').waitFor({ state: 'visible' });
    await expect(page.locator('[data-testid="flow-switcher-row-main"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="flow-switcher-row-retry"]')).toHaveCount(0);
  });
});
