import {
  expect,
  projectFlowPath,
  registerFlow,
  setStudioTheme,
  test,
  waitForCanvasSettled,
} from './support/studio-fixture.ts';

// Canvas grouping M9 — end-to-end coverage for the full grouping journey and a
// visual baseline of a rendered group (design §10 e2e bullet). Runs against the
// studio canvas page in edit mode (where the overlay ＋/⊟ icon + ⌘G chord + the
// double-click enter/exit interactions are wired).
//
// IMPORTANT (project_e2e_bundle_build_gotcha): test:it:update-snapshots /
// test:it:e2e do NOT build the web+mcp bundles. Build them first (or use the
// full `test:it`) or every spec fails with "dev proxy could not reach Vite".
// Visual baselines are pinned to chromium-linux — regenerate via
// `bun run test:it:update-snapshots` and commit ONLY `*-chromium-linux.png`.
//
// String-form `page.evaluate` is used for any DOM-touching snippet because the
// studio tsconfig omits the DOM lib (it's a Bun backend) — see the same pattern
// in clipboard.e2e.ts / studio-fixture.ts.

// A flow with two loose rectangles, far enough apart that the create-group box
// is comfortably larger than either member.
function buildLooseFlow(name: string) {
  return {
    version: 2 as const,
    name,
    nodes: [
      {
        id: 'alpha',
        type: 'rectangle' as const,
        position: { x: 120, y: 140 },
        data: { name: 'Alpha', width: 160, height: 80 },
      },
      {
        id: 'beta',
        type: 'rectangle' as const,
        position: { x: 420, y: 140 },
        data: { name: 'Beta', width: 160, height: 80 },
      },
    ],
    connectors: [],
  };
}

// A flow that already contains a group + its two members — deterministic input
// for the visual baseline (no gesture timing involved).
function buildGroupedFlow(name: string) {
  return {
    version: 2 as const,
    name,
    nodes: [
      {
        id: 'grp',
        type: 'group' as const,
        position: { x: 80, y: 80 },
        data: { name: 'My Group', width: 540, height: 220, childIds: ['alpha', 'beta'] },
      },
      {
        id: 'alpha',
        type: 'rectangle' as const,
        position: { x: 120, y: 160 },
        data: { name: 'Alpha', width: 160, height: 80 },
      },
      {
        id: 'beta',
        type: 'rectangle' as const,
        position: { x: 420, y: 160 },
        data: { name: 'Beta', width: 160, height: 80 },
      },
    ],
    connectors: [],
  };
}

test.describe('canvas — grouping (M9)', () => {
  test('renders a group (stylable border, no fill/title) with its members (visual baseline)', async ({
    page,
    studio,
  }) => {
    const source = await registerFlow(
      studio.studio,
      'grouping-render',
      buildGroupedFlow('Grouping Render'),
      { name: 'Grouping Render' },
    );
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await waitForCanvasSettled(page);

    // The group node + both members are present.
    await expect(page.locator('[data-testid="group-node"]')).toHaveCount(1);
    await expect(page.locator('[data-node-type="rectangle"]')).toHaveCount(2);
    // The group has no header band (no fill/title — just a stylable border); the
    // marquee + corner handles only appear on selection, via the overlay — not in
    // this static render. Members render as ordinary cards on top of the group.
    await expect(page.locator('[data-testid="group-node-header"]')).toHaveCount(0);

    // Visual baseline of the whole canvas: an UNSELECTED group shows its (default
    // gray) border around the two members — no fill, no title.
    const root = page.locator('.seeflow-canvas-root');
    await expect(root).toHaveScreenshot('group-rendered.png', { maxDiffPixelRatio: 0.02 });
  });

  test('a SELECTED group shows ONLY the marquee — no xyflow box-shadow ring (light theme)', async ({
    page,
    studio,
  }) => {
    // Regression: a chrome-less group must show ONLY the dashed marquee (drawn by
    // <SelectionResizeOverlay>) when selected. xyflow's bundled base CSS applies
    // `box-shadow: 0 0 0 0.5px #1a192b` (near-black) to
    // `.react-flow__node-group.selectable.selected` — a higher-specificity (0,3,0)
    // rule than the seeflow reset — which rendered as a SOLID BLACK BORDER around a
    // selected group in the LIGHT theme (the dark pane merely hid it in dark theme).
    // The index.css reset now neutralizes it with `box-shadow: none !important`.
    // Light theme is set explicitly because that's where the leak is visible.
    await setStudioTheme(page, 'light');
    const source = await registerFlow(
      studio.studio,
      'grouping-selected-no-ring',
      buildGroupedFlow('Grouping Selected No Ring'),
      { name: 'Grouping Selected No Ring' },
    );
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await waitForCanvasSettled(page);

    // Select the group (its empty interior band — between the two members — is the
    // group's own hit-area, so a center click selects the group as a unit).
    await page.locator('[data-testid="group-node"]').click();
    await page.locator('.react-flow__node-group.selected').waitFor({
      state: 'attached',
      timeout: 5_000,
    });

    // The selected group WRAPPER must compute no box-shadow ring — only the marquee
    // (a separate overlay element) is the visible selection treatment.
    const boxShadow = await page.evaluate(
      `(() => {
        const el = document.querySelector('.react-flow__node-group.selected');
        if (!el) return 'MISSING';
        return window.getComputedStyle(el).boxShadow;
      })()`,
    );
    expect(boxShadow).toBe('none');

    // Visual baseline (light theme) of the SELECTED group: the only chrome is the
    // dashed marquee + 4 corner handles + the overlay ＋/⊟ action — NO solid black
    // border from ANY source (box-shadow / border / outline). A pixel baseline
    // catches the leak even if it returns via a mechanism the computed-style probe
    // above doesn't cover. Wait for the overlay so the marquee has painted.
    await page
      .locator('[data-testid="selection-overlay-group-action"]')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 });
    const root = page.locator('.seeflow-canvas-root');
    await expect(root).toHaveScreenshot('group-selected-light.png', { maxDiffPixelRatio: 0.02 });
  });

  test('full journey: select → group → enter → ungroup', async ({ page, studio }) => {
    const source = await registerFlow(
      studio.studio,
      'grouping-journey',
      buildLooseFlow('Grouping Journey'),
      { name: 'Grouping Journey' },
    );
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await waitForCanvasSettled(page);

    // Two loose rectangles, no group yet.
    await expect(page.locator('[data-node-type="rectangle"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="group-node"]')).toHaveCount(0);

    // Select both via the canvas select-all chord (deterministic vs a marquee
    // drag). The multi-select overlay + its ＋ create-group action appear.
    await page.locator('.react-flow__pane').click();
    await page.keyboard.press('ControlOrMeta+a');
    const createAction = page.locator(
      '[data-testid="selection-overlay-group-action"][data-action="create"]',
    );
    await expect(createAction).toBeVisible({ timeout: 5_000 });

    // Create the group.
    await createAction.click();
    await expect(page.locator('[data-testid="group-node"]')).toHaveCount(1, { timeout: 5_000 });
    // Members survive as ordinary nodes inside the group.
    await expect(page.locator('[data-node-type="rectangle"]')).toHaveCount(2);

    // Double-click the group to ENTER isolation (edit-only affordance). The
    // entered group exposes data-active="true" on its node body.
    await page.locator('[data-testid="group-node"]').dblclick();
    await expect(page.locator('[data-testid="group-node"][data-active="true"]')).toHaveCount(1, {
      timeout: 5_000,
    });

    // Escape exits isolation (first Esc exits, design §5.3 exit path a).
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="group-node"][data-active="true"]')).toHaveCount(0);

    // Re-select the group, then UNGROUP via the overlay ⊟ action.
    await page.locator('[data-testid="group-node"]').click();
    const ungroupAction = page.locator(
      '[data-testid="selection-overlay-group-action"][data-action="ungroup"]',
    );
    await expect(ungroupAction).toBeVisible({ timeout: 5_000 });
    await ungroupAction.click();

    // The group container is gone; the two members remain as loose nodes.
    await expect(page.locator('[data-testid="group-node"]')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('[data-node-type="rectangle"]')).toHaveCount(2);
  });

  test('copy/paste a group duplicates it with its OWN members', async ({ page, studio }) => {
    const source = await registerFlow(
      studio.studio,
      'grouping-copy-paste',
      buildGroupedFlow('Grouping Copy Paste'),
      { name: 'Grouping Copy Paste' },
    );
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(source.projectSlug, source.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await waitForCanvasSettled(page);

    await expect(page.locator('[data-testid="group-node"]')).toHaveCount(1);
    await expect(page.locator('[data-node-type="rectangle"]')).toHaveCount(2);

    // Select the group, copy, paste. The copy expands to include the group's
    // members (design §9.4); the paste remaps the duplicate group's childIds to
    // the pasted members. Result: a SECOND group + two MORE members.
    await page.locator('[data-testid="group-node"]').click();
    // Native OS-clipboard copy/paste own Cmd+C/V in edit mode (see clipboard.e2e.ts).
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');

    await expect(page.locator('[data-testid="group-node"]')).toHaveCount(2, { timeout: 5_000 });
    // Two original members + two pasted members.
    await expect(page.locator('[data-node-type="rectangle"]')).toHaveCount(4);
  });
});
