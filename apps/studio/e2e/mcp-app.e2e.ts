// US-011: Playwright e2e for the MCP App bundle (apps/mcp-app/dist/index.html).
//
// The PRD lists the filename as `mcp-app.spec.ts`, but the existing
// `playwright.config.ts` deliberately matches `**/*.e2e.ts` to keep
// `bun test`'s default `*.spec.ts` discovery from picking up Playwright specs
// and crashing on the missing `test`/`expect` globals. We follow the
// established convention (see playwright.config.ts comment block).
//
// The fixture (support/mcp-app-fixture.ts) spawns a studio + a tiny bundle
// server + registers a 2-node demo flow once per worker. Each test installs a
// fresh `window.openai` shim and navigates the bundle URL with a per-test
// widgetState. The shim captures every sendMessage / updateModelContext call
// into `window.__seeflowOpenAiCalls` for assertion.

import {
  expect,
  getOpenAiCalls,
  installOpenAiShim,
  isMcpAppBundleBuilt,
  resetOpenAiCalls,
  test,
} from './support/mcp-app-fixture.ts';

const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

// Wait window for the initial autoFitView's updateModelContext fire to drain
// AND for the bridge's 1s throttle window to expire — so any subsequent fire
// after a test-driven gesture is purely the gesture's, not a leaked baseline.
// 250ms debounce + 1000ms throttle + 250ms margin = 1500ms.
const INITIAL_DRAIN_MS = 1500;

// 250ms debounce + safety margin. Any fewer and the trailing-edge fire after
// the last gesture event hasn't landed yet, so the test races the timer.
const DEBOUNCE_WAIT_MS = 400;

// 200ms coalesce + safety margin for the sendMessage burst-collapse window.
const COALESCE_WAIT_MS = 350;

test.describe('mcp app — iframe bundle (US-011)', () => {
  test.beforeAll(() => {
    if (!isMcpAppBundleBuilt()) {
      throw new Error(
        "MCP App bundle missing at apps/mcp-app/dist/index.html. Run 'bun run --filter @seeflow/mcp-app build' before this suite.",
      );
    }
  });

  test('create-mode renders edit affordances and the Just created banner fades within 3s', async ({
    page,
    mcpEnv,
  }) => {
    await installOpenAiShim(page, {
      kind: 'create',
      flowSlug: mcpEnv.flow.slug,
      backendUrl: mcpEnv.studio.baseURL,
      backendToken: mcpEnv.token,
      justCreated: true,
    });
    await page.goto(mcpEnv.bundleUrl);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });

    // Edit affordances: the canvas toolbar (which only renders in edit mode)
    // is visible to the user.
    await expect(page.locator('[data-testid="canvas-toolbar"]')).toBeVisible();
    await expect(page.locator('[data-testid="toolbar-mode-select"]')).toBeVisible();

    // The Just created banner is visible at mount. Snapshot it before its
    // CSS-only fade and React-state unmount finish.
    const banner = page.locator('.mcp-app-just-created');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Just created');
    await expect(banner).toHaveScreenshot('just-created-banner.png', {
      maxDiffPixelRatio: 0.02,
    });

    // React unmounts the wrapper at HIGHLIGHT_FADE_MS=3000ms. Allow generous
    // slack on top so a slow tick doesn't flake the assertion.
    await expect(banner).toHaveCount(0, { timeout: 4500 });
  });

  test('navigate-mode with nodeId opens the detail panel for that node', async ({
    page,
    mcpEnv,
  }) => {
    await installOpenAiShim(page, {
      kind: 'navigate',
      flowSlug: mcpEnv.flow.slug,
      nodeId: mcpEnv.primaryNodeId,
      backendUrl: mcpEnv.studio.baseURL,
      backendToken: mcpEnv.token,
    });
    await page.goto(mcpEnv.bundleUrl);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });

    // The detail panel is rendered by the canvas's built-in DetailPanel when
    // `selectedNodeIds[0]` is set. The App seeds it from widgetState.nodeId.
    const detailPanel = page.locator('[data-testid="detail-panel"]');
    await expect(detailPanel).toBeVisible();
    // The title field shows the selected node's name; for the registered
    // fixture's first node this is "Source".
    await expect(detailPanel.locator('[data-testid="detail-panel-title"]').first()).toContainText(
      mcpEnv.primaryNodeName,
    );
    // The selected node also carries the React Flow selected-state attribute.
    const selectedNode = page.locator(`.react-flow__node[data-id="${mcpEnv.primaryNodeId}"]`);
    await expect(selectedNode).toHaveClass(/selected/);
  });

  test('dragging a node fires exactly one debounced updateModelContext after 250ms idle', async ({
    page,
    mcpEnv,
  }) => {
    // Start in create-mode WITHOUT justCreated so the banner doesn't visually
    // overlap the drag gesture, and the test isn't racing the banner unmount.
    await installOpenAiShim(page, {
      kind: 'navigate',
      flowSlug: mcpEnv.flow.slug,
      backendUrl: mcpEnv.studio.baseURL,
      backendToken: mcpEnv.token,
    });
    await page.goto(mcpEnv.bundleUrl);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });

    // Let the autoFitView's viewport-change updateModelContext fire and the
    // bridge's 1-sec throttle window expire — anything from this point
    // onwards is unambiguously test-driven.
    await page.waitForTimeout(INITIAL_DRAIN_MS);
    await resetOpenAiCalls(page);

    // Drag the source node by a small offset. Use the React Flow node
    // wrapper as the source so the canvas's drag-handle hits cleanly.
    const node = page.locator(`.react-flow__node[data-id="${mcpEnv.primaryNodeId}"]`);
    await expect(node).toBeVisible();
    const box = await node.boundingBox();
    if (!box) throw new Error('source node has no bounding box');
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Use the high-level Page mouse API so React Flow's drag detection
    // (multiple intermediate moves above its drag threshold) fires
    // onNodeDragStart / onNodeDragStop.
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 20, startY + 10);
    await page.mouse.move(startX + 40, startY + 20);
    await page.mouse.move(startX + 60, startY + 30);
    await page.mouse.move(startX + 80, startY + 40);
    await page.mouse.up();

    // Wait for the bridge's 250ms debounce to flush the single coalesced fire.
    await page.waitForTimeout(DEBOUNCE_WAIT_MS);

    const calls = await getOpenAiCalls(page);
    // The exact-1 invariant is the headline assertion: a real per-pixel fire
    // would balloon this to 5+ even for this short drag.
    expect(calls.updateModelContext).toHaveLength(1);
    // The trailing-edge fire reflects the settled state — drag-stop wrote
    // `dragging: false` last, so the merged patch should match.
    expect(calls.updateModelContext[0]).toMatchObject({ dragging: false });
  });

  test('adding a node fires one sendMessage with event "node-added"', async ({ page, mcpEnv }) => {
    await installOpenAiShim(page, {
      kind: 'navigate',
      flowSlug: mcpEnv.flow.slug,
      backendUrl: mcpEnv.studio.baseURL,
      backendToken: mcpEnv.token,
    });
    await page.goto(mcpEnv.bundleUrl);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });

    await page.waitForTimeout(INITIAL_DRAIN_MS);
    await resetOpenAiCalls(page);

    // Arm draw-mode for type:'rectangle' — the top-level toolbar shape button.
    await page.locator('[data-testid="toolbar-shape-rectangle"]').click();
    await expect(page.locator('[data-testid="seeflow-canvas"]')).toHaveAttribute(
      'data-canvas-mode',
      'draw',
    );

    // Dispatch pointer events on .react-flow__pane to draw a new rectangle.
    // The canvas's screenToFlowPosition + buildNewShapeData picks up the
    // gesture even with a zero-net drag, but a small drag is more realistic
    // and exercises React Flow's drag-detection threshold.
    const pane = page.locator('.react-flow__pane').first();
    const paneBox = await pane.boundingBox();
    if (!paneBox) throw new Error('react-flow pane has no bounding box');
    // Pick a region clearly below the registered fixture nodes (y >= 300)
    // so the new shape doesn't overlap them visually.
    const startX = paneBox.x + 600;
    const startY = paneBox.y + 400;
    const endX = startX + 140;
    const endY = startY + 80;
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
    await dispatch('pointermove', startX + 60, startY + 30);
    await dispatch('pointermove', endX, endY);
    await dispatch('pointerup', endX, endY);

    // Wait for the host.sendMessage to land. The chain is: adapter.createNode
    // POST → resolved promise → wrapAdapter emit('node-added') → 200ms
    // coalesce timer → host.sendMessage call. The MCP App doesn't subscribe
    // to studio SSE (relies on host rehydration in production), so the new
    // node won't visually appear here — we assert on the bridge contract,
    // not on the canvas's node count.
    await expect
      .poll(async () => (await getOpenAiCalls(page)).sendMessage.length, { timeout: 5_000 })
      .toBeGreaterThan(0);
    // Additional grace so a delayed flush from the same gesture doesn't
    // squeeze in after the poll resolves.
    await page.waitForTimeout(COALESCE_WAIT_MS);

    const calls = await getOpenAiCalls(page);
    expect(calls.sendMessage).toHaveLength(1);
    const firstCall = calls.sendMessage[0];
    if (!firstCall) throw new Error('sendMessage call envelope missing after length assertion');
    const events = firstCall.events;
    // The single host call carries the coalesced events list. At minimum
    // the node-added event is present; assert on its shape, not on the
    // exhaustive equality of `events` (a hypothetical extra emit later in
    // the gesture shouldn't fail this contract).
    const nodeAdded = events.find((e) => e.event === 'node-added');
    expect(nodeAdded).toBeDefined();
    expect(nodeAdded).toMatchObject({
      event: 'node-added',
      flowSlug: mcpEnv.flow.slug,
    });
    expect((nodeAdded?.payload as { type?: string } | undefined)?.type).toBe('rectangle');
  });
});
