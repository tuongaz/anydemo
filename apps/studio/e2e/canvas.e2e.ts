import {
  expect,
  projectFlowPath,
  registerFlow,
  test,
  waitForCanvasSettled,
} from './support/studio-fixture.ts';

// The six flat node types present in the kitchen-sink fixture
// (apps/studio/integration/fixtures/kitchen-sink.flow.json). One node per
// discriminator boundary the flat schema introduces: rectangle (the sole
// renderer that draws capability chrome), one non-rectangle geometric tag,
// one plain geometric tag with no capability, plus image / html / icon.
const NODE_TYPES = ['rectangle', 'database', 'ellipse', 'image', 'html', 'icon'] as const;

// type:'image' renders just an <img> tag with no visible text content, so
// the "non-empty text" smoke check is skipped for it. Every other node type
// renders its `name` (or html) as descendant text.
const TEXTLESS_NODE_TYPES = new Set<string>(['image']);

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
    // US-010: SPA canvas page lives at `/projects/:project/flows/:flow`.
    // The legacy `/d/<slug>` route was removed; older bookmarks land on
    // StudioHome. See apps/web/src/App.tsx and src/lib/router.ts.
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(studio.flow.projectSlug, studio.flow.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    // Give React Flow's auto-fit + layout settle pass one paint cycle so node
    // bounding boxes are stable before any assertion runs.
    await waitForCanvasSettled(page);
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

// US-009: flat-node-types e2e coverage. Three contracts, each registers a
// dedicated flow on top of the shared worker-scoped studio so the kitchen-
// sink fixture stays untouched.
//   1. 12-tag render-matrix snapshot — the visual regression spine for the
//      flat schema (one node per type laid out in a grid).
//   2. Capability-chrome-rectangle-only invariant end-to-end — a database
//      carrying playAction renders no play button (the renderer phasing
//      rule from the design doc, fenced from the user's perspective).
//   3. Draw-mode draws the chosen geometric tag — clicking a non-rectangle
//      toolbar shape button and drag-drawing on the pane creates a node
//      whose type matches the chosen variant.
test.describe('canvas — flat node types (US-009)', () => {
  test('12-tag render matrix snapshot', async ({ page, studio }) => {
    // Lay out 12 nodes in a 4-column × 3-row grid so the snapshot stays
    // compact enough to fit in one viewport. The image fixture references
    // a path that won't exist on disk — the renderer falls back to a broken-
    // image placeholder, which is fine for the matrix's "every renderer
    // mounts" contract (US-009 doesn't require image asset wiring).
    const positions = [
      { x: 0, y: 0 },
      { x: 280, y: 0 },
      { x: 560, y: 0 },
      { x: 840, y: 0 },
      { x: 0, y: 220 },
      { x: 280, y: 220 },
      { x: 560, y: 220 },
      { x: 840, y: 220 },
      { x: 0, y: 440 },
      { x: 280, y: 440 },
      { x: 560, y: 440 },
      { x: 840, y: 440 },
    ];
    const TYPES = [
      'rectangle',
      'ellipse',
      'sticky',
      'text',
      'database',
      'server',
      'user',
      'queue',
      'cloud',
      'image',
      'html',
      'icon',
    ] as const;
    const dataFor = (type: (typeof TYPES)[number], id: string): Record<string, unknown> => {
      if (type === 'image') return { path: `nodes/${id}/cover.png`, alt: type, name: type };
      if (type === 'icon') return { icon: 'box', name: type };
      if (type === 'html') return { html: `<p>${type}</p>`, name: type };
      return { name: type };
    };
    const resolvedFlow = {
      version: 2 as const,
      name: 'Render Matrix',
      nodes: TYPES.map((type, i) => ({
        id: `m-${type}`,
        type,
        position: positions[i] ?? { x: 0, y: 0 },
        data: dataFor(type, `m-${type}`),
      })),
      connectors: [],
    };
    const registered = await registerFlow(studio.studio, 'render-matrix', resolvedFlow, {
      name: 'Render Matrix',
    });
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(registered.projectSlug, registered.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);
    // Confirm every node mounted before snapshotting.
    await expect(page.locator('.react-flow__node')).toHaveCount(12);
    for (const type of TYPES) {
      await expect(page.locator(`[data-node-type="${type}"]`)).toHaveCount(1);
    }
    const root = page.locator('.seeflow-canvas-root').first();
    await expect(root).toHaveScreenshot('render-matrix.png', { maxDiffPixelRatio: 0.02 });
  });

  test('database with playAction renders the inline skirt PlayButton', async ({ page, studio }) => {
    const resolvedFlow = {
      version: 2 as const,
      name: 'Database Capability Skirt',
      nodes: [
        {
          id: 'db1',
          type: 'database' as const,
          position: { x: 100, y: 100 },
          data: {
            name: 'Orders',
            playAction: {
              kind: 'script' as const,
              interpreter: 'bun',
              scriptPath: 'scripts/play.ts',
            },
          },
        },
      ],
      connectors: [],
    };
    const registered = await registerFlow(studio.studio, 'capability-skirt', resolvedFlow, {
      name: 'Capability Skirt',
    });
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(registered.projectSlug, registered.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    // The database node mounts and renders the capability-chrome skirt with
    // an inline PlayButton — this is the visual end of the data path the
    // schema has been threading since the flat-node-types refactor.
    await expect(page.locator('[data-node-type="database"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="geometric-node-skirt"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="play-button"]')).toHaveCount(1);
    // The rectangle-only status-badge testid still must not appear — the
    // illustrative skirt uses geometric-node-status-badge, distinct from
    // rectangle-node-status-badge.
    await expect(page.locator('[data-testid="rectangle-node-status-badge"]')).toHaveCount(0);
  });

  test('database with playAction visual snapshot', async ({ page, studio }) => {
    const resolvedFlow = {
      version: 2 as const,
      name: 'DB With Play',
      nodes: [
        {
          id: 'db1',
          type: 'database' as const,
          position: { x: 100, y: 100 },
          data: {
            name: 'Orders',
            playAction: {
              kind: 'script' as const,
              interpreter: 'bun',
              scriptPath: 'scripts/play.ts',
            },
          },
        },
      ],
      connectors: [],
    };
    const registered = await registerFlow(studio.studio, 'db-with-play', resolvedFlow, {
      name: 'DB With Play',
    });
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(registered.projectSlug, registered.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    const node = page.locator('[data-node-type="database"]');
    await expect(node).toBeVisible();
    await expect(node).toHaveScreenshot('database-with-play.png', { maxDiffPixelRatio: 0.02 });
  });

  // Connector head shapes: arrow (native ArrowClosed marker) + the five custom
  // glyphs drawn by EditableEdge — the ER crow's-foot marks (one / many /
  // optional-many) plus diamond / circle. Each pair stacks source-above-target
  // so every head points downward and reads clearly. Locks both the glyph
  // geometry AND the stroke-derived coloring (the connectors carry a non-default
  // color so a regression to a wrong fill surfaces in the diff).
  test('connector head shapes visual snapshot', async ({ page, studio }) => {
    const SHAPES = ['arrow', 'one', 'many', 'optional-many', 'diamond', 'circle'] as const;
    // 3-column × 2-band grid: each pair stacks source-above-target with a tall
    // gap so the downward head sits clearly on the line. Narrow overall width
    // keeps fitView zoomed in enough that the stroke-only marks (the hollow
    // circle especially) read as hollow rather than as solid dots.
    const nodes = SHAPES.flatMap((shape, i) => {
      const x = (i % 3) * 280;
      const srcY = Math.floor(i / 3) * 560;
      return [
        {
          id: `${shape}-src`,
          type: 'rectangle' as const,
          position: { x, y: srcY },
          data: { name: shape },
        },
        {
          id: `${shape}-dst`,
          type: 'rectangle' as const,
          position: { x, y: srcY + 280 },
          data: { name: shape },
        },
      ];
    });
    const connectors = SHAPES.map((shape) => ({
      id: `c-${shape}`,
      source: `${shape}-src`,
      target: `${shape}-dst`,
      direction: 'forward' as const,
      headShape: shape,
      color: 'blue' as const,
    }));
    const resolvedFlow = { version: 2 as const, name: 'Head Shapes', nodes, connectors };
    const registered = await registerFlow(studio.studio, 'head-shapes', resolvedFlow, {
      name: 'Head Shapes',
    });
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(registered.projectSlug, registered.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    // All six edges mounted. The five custom-head edges each draw a
    // <g data-testid="connector-head-glyph"> inside their edge group; the
    // arrow edge uses a native marker (no glyph), so expect exactly five.
    await expect(page.locator('.react-flow__edge')).toHaveCount(6);
    await expect(page.locator('[data-testid="connector-head-glyph"]')).toHaveCount(5);

    const root = page.locator('.seeflow-canvas-root').first();
    await expect(root).toHaveScreenshot('connector-head-shapes.png', { maxDiffPixelRatio: 0.02 });
  });

  // Regression: a new-connection drag-preview must render the SAME geometry the
  // committed connector lands on — the source floats to the smart face (not the
  // grabbed handle) and the target lands at the cursor projection — so the
  // connector doesn't visibly jump/re-render on release. Asserts the in-flight
  // `.react-flow__connection-path` `d` equals the committed `.react-flow__edge-path` `d`.
  test('new-connection preview matches the committed connector (no jump)', async ({
    page,
    studio,
  }) => {
    // B sits up-and-right of A, so the smart source face (top/right) differs
    // from the grabbed right handle — exercising the source-float fix.
    const resolvedFlow = {
      version: 2 as const,
      name: 'Connect Preview',
      nodes: [
        { id: 'A', type: 'rectangle' as const, position: { x: 120, y: 360 }, data: { name: 'A' } },
        { id: 'B', type: 'rectangle' as const, position: { x: 520, y: 60 }, data: { name: 'B' } },
      ],
      connectors: [],
    };
    const registered = await registerFlow(studio.studio, 'connect-preview', resolvedFlow, {
      name: 'Connect Preview',
    });
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(registered.projectSlug, registered.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await waitForCanvasSettled(page);

    // Select A so its source handles render, then drag from A's right handle to B.
    const aBox = await page.locator('.react-flow__node[data-id="A"]').boundingBox();
    const bBox = await page.locator('.react-flow__node[data-id="B"]').boundingBox();
    if (!aBox || !bBox) throw new Error('node boxes missing');
    await page.mouse.click(aBox.x + 40, aBox.y + aBox.height / 2);
    await page.waitForTimeout(150);
    const handleBox = await page
      .locator('.react-flow__node[data-id="A"] .react-flow__handle.source.react-flow__handle-right')
      .boundingBox();
    if (!handleBox) throw new Error('source handle missing');
    const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
    const drop = { x: bBox.x + 30, y: bBox.y + bBox.height / 2 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 14, start.y - 8, { steps: 4 });
    await page.mouse.move(drop.x, drop.y, { steps: 16 });
    await page.waitForTimeout(120);
    // String-form eval: the studio e2e tsconfig omits the DOM lib, so a
    // function callback referencing `document` would fail typecheck (same
    // reason waitForCanvasSettled uses a string).
    const dMid = (await page.evaluate(
      "document.querySelector('.react-flow__connection-path')?.getAttribute('d') ?? null",
    )) as string | null;
    await page.mouse.up();
    await waitForCanvasSettled(page);
    await page.waitForTimeout(150);
    const dFinal = (await page.evaluate(
      "document.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? null",
    )) as string | null;

    expect(dMid).not.toBeNull();
    expect(dFinal).not.toBeNull();
    // The preview path and the committed path are byte-identical — no re-render
    // jump. (Before the fix the preview started at the grabbed right handle
    // while the committed source floated to A's top face.)
    expect(dMid).toBe(dFinal);
    // The committed connector exists.
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });

  // Regression: a new-connection drag-preview must render the SAME PATH TYPE the
  // committed connector inherits from the host's last-used connector style.
  // The committed connector spreads `getLastUsedStyle(...).connector` (so a
  // last-used `path: 'step'` makes the new connector a zigzag), but the preview
  // used to hardcode a bezier curve — the connector visibly "re-rendered" from a
  // smooth curve to a step zigzag the instant the mouse was released. Asserts the
  // in-flight preview is a step path AND byte-identical to the committed edge.
  test('new-connection preview matches a step-path connector (no curve→zigzag jump)', async ({
    page,
    studio,
  }) => {
    const resolvedFlow = {
      version: 2 as const,
      name: 'Connect Preview Step',
      nodes: [
        { id: 'A', type: 'rectangle' as const, position: { x: 120, y: 360 }, data: { name: 'A' } },
        { id: 'B', type: 'rectangle' as const, position: { x: 520, y: 60 }, data: { name: 'B' } },
      ],
      connectors: [],
    };
    const registered = await registerFlow(studio.studio, 'connect-preview-step', resolvedFlow, {
      name: 'Connect Preview Step',
    });
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(registered.projectSlug, registered.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await waitForCanvasSettled(page);
    // Remember a step-path connector style so the next created connector commits
    // as a zigzag. String-form eval: the e2e tsconfig omits the DOM lib, so a
    // function callback referencing `localStorage` would fail typecheck.
    await page.evaluate(
      "localStorage.setItem('seeflow:last-used-style:v1', JSON.stringify({ node: {}, connector: { path: 'step' } }))",
    );

    const aBox = await page.locator('.react-flow__node[data-id="A"]').boundingBox();
    const bBox = await page.locator('.react-flow__node[data-id="B"]').boundingBox();
    if (!aBox || !bBox) throw new Error('node boxes missing');
    await page.mouse.click(aBox.x + 40, aBox.y + aBox.height / 2);
    await page.waitForTimeout(150);
    const handleBox = await page
      .locator('.react-flow__node[data-id="A"] .react-flow__handle.source.react-flow__handle-right')
      .boundingBox();
    if (!handleBox) throw new Error('source handle missing');
    const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
    const drop = { x: bBox.x + 30, y: bBox.y + bBox.height / 2 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 14, start.y - 8, { steps: 4 });
    await page.mouse.move(drop.x, drop.y, { steps: 16 });
    await page.waitForTimeout(120);
    const dMid = (await page.evaluate(
      "document.querySelector('.react-flow__connection-path')?.getAttribute('d') ?? null",
    )) as string | null;
    await page.mouse.up();
    await waitForCanvasSettled(page);
    await page.waitForTimeout(150);
    const dFinal = (await page.evaluate(
      "document.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? null",
    )) as string | null;

    expect(dMid).not.toBeNull();
    expect(dFinal).not.toBeNull();
    // Step (smoothstep) paths use L/Q commands and never a cubic-bezier `C`.
    // Before the fix the preview was a bezier (`C`) while the commit was a step.
    expect(dMid).not.toContain('C');
    expect(dFinal).not.toContain('C');
    // Byte-identical — the preview is already the committed zigzag.
    expect(dMid).toBe(dFinal);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });

  // Regression: moving (reconnecting) an endpoint to a different face of the
  // SAME node must preview the exact face the commit pins. The preview used to
  // exclude the moving end's own node from its snap scan, so the projection was
  // skipped and the in-flight endpoint stuck on xyflow's snapped handle (e.g.
  // the LEFT face) while onReconnectEndCb's 'pin-own' path projected the raw
  // cursor (e.g. the BOTTOM face) — the connector jumped on release. Asserts the
  // in-flight preview is byte-identical to the committed edge after a same-node
  // target re-pin.
  test('endpoint re-pin preview matches the committed connector (same-node move)', async ({
    page,
    studio,
  }) => {
    const resolvedFlow = {
      version: 2 as const,
      name: 'Repin Preview',
      nodes: [
        { id: 'A', type: 'rectangle' as const, position: { x: 120, y: 340 }, data: { name: 'A' } },
        { id: 'B', type: 'rectangle' as const, position: { x: 620, y: 340 }, data: { name: 'B' } },
      ],
      connectors: [
        {
          id: 'c1',
          source: 'A',
          target: 'B',
          path: 'step' as const,
          targetPin: { side: 'left' as const, t: 0.5 },
        },
      ],
    };
    const registered = await registerFlow(studio.studio, 'repin-preview', resolvedFlow, {
      name: 'Repin Preview',
    });
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(registered.projectSlug, registered.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await waitForCanvasSettled(page);

    // Select the edge so its endpoint reconnect dots render.
    await page.locator('.react-flow__edge').first().click({ force: true });
    await page.waitForTimeout(200);
    const dotBox = await page.locator('[data-testid="edge-endpoint-target-c1"]').boundingBox();
    const bBox = await page.locator('.react-flow__node[data-id="B"]').boundingBox();
    if (!dotBox || !bBox) throw new Error('endpoint dot or node box missing');
    const grab = { x: dotBox.x + dotBox.width / 2, y: dotBox.y + dotBox.height / 2 };
    // Drag the target endpoint from B's left face down to B's bottom face.
    const drop = { x: bBox.x + bBox.width / 2, y: bBox.y + bBox.height - 6 };

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 4, grab.y + 12, { steps: 4 });
    await page.mouse.move(drop.x, drop.y, { steps: 20 });
    await page.waitForTimeout(120);
    const dMid = (await page.evaluate(
      "document.querySelector('.react-flow__connection-path')?.getAttribute('d') ?? null",
    )) as string | null;
    await page.mouse.up();
    await waitForCanvasSettled(page);
    await page.waitForTimeout(150);
    const dFinal = (await page.evaluate(
      "document.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? null",
    )) as string | null;

    expect(dMid).not.toBeNull();
    expect(dFinal).not.toBeNull();
    // Byte-identical — the previewed re-pin face equals the committed face.
    expect(dMid).toBe(dFinal);
    // Still exactly one connector (re-pin, not a new/duplicate edge).
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });

  test('draw-mode database creates a node with type:database', async ({ page, studio }) => {
    const resolvedFlow = {
      version: 2 as const,
      name: 'Draw Mode',
      nodes: [],
      connectors: [],
    };
    const registered = await registerFlow(studio.studio, 'draw-mode', resolvedFlow, {
      name: 'Draw Mode',
    });
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(registered.projectSlug, registered.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    // Empty flow — no nodes yet.
    await expect(page.locator('.react-flow__node')).toHaveCount(0);

    // Arm draw-mode for type:'database' via the shape-picker popover. Under
    // the flat schema, only rectangle + ellipse sit as top-level toolbar
    // buttons; the other geometric tags (database/server/user/queue/cloud)
    // live behind the Shape picker.
    await page.locator('[data-testid="toolbar-shape-picker"]').click();
    await page.locator('[data-testid="shape-picker-database"]').click();
    // The canvas wrapper reflects the armed mode via data-canvas-mode="draw".
    await expect(page.locator('[data-testid="seeflow-canvas"]')).toHaveAttribute(
      'data-canvas-mode',
      'draw',
    );

    // Dispatch pointer events directly on the .react-flow__pane element so
    // the canvas's `target.classList.contains('react-flow__pane')` gate
    // accepts the gesture regardless of any DOM overlays. The pointer coords
    // are absolute client-px and the canvas projects them through
    // screenToFlowPosition on mouseup — so any pair within the pane creates
    // a node of the armed shape.
    const pane = page.locator('.react-flow__pane').first();
    const box = await pane.boundingBox();
    if (!box) throw new Error('react-flow pane has no bounding box');
    const startX = box.x + 200;
    const startY = box.y + 200;
    const endX = startX + 160;
    const endY = startY + 100;
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
    await dispatch('pointermove', startX + 80, startY + 50);
    await dispatch('pointermove', endX, endY);
    await dispatch('pointerup', endX, endY);

    // The new node mounts with data-node-type="database".
    const created = page.locator('[data-node-type="database"]');
    await expect(created).toHaveCount(1, { timeout: 5_000 });
  });
});

// Regression: editing a connector label must NOT lose focus when the SSE
// `flow:reload` echo (which every debounced label commit triggers) lands
// mid-typing. The echo makes React Flow transiently re-resolve edge positions;
// for one frame the edge's positions read null, so xyflow's EdgeWrapper renders
// null and tears down + remounts the EditableEdge. The inline-edit session used
// to live in EditableEdge's local state, so the remount collapsed the editor
// and stole focus ("focus moved somewhere else, can't keep typing"). The fix
// lifts the session onto the canvas so the rebuilt edge re-enters edit mode.
test.describe('canvas — connector label edit survives SSE echo', () => {
  test('inline editor keeps focus through the commit + flow:reload echo', async ({
    page,
    studio,
  }) => {
    const resolvedFlow = {
      version: 2 as const,
      name: 'Label Edit Focus',
      nodes: [
        { id: 'A', type: 'rectangle' as const, position: { x: 120, y: 340 }, data: { name: 'A' } },
        { id: 'B', type: 'rectangle' as const, position: { x: 620, y: 340 }, data: { name: 'B' } },
      ],
      connectors: [{ id: 'c1', source: 'A', target: 'B', label: 'order.created' }],
    };
    const registered = await registerFlow(studio.studio, 'label-edit-focus', resolvedFlow, {
      name: 'Label Edit Focus',
    });
    await page.goto(
      `${studio.studio.baseURL}${projectFlowPath(registered.projectSlug, registered.flowSlug)}`,
    );
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await waitForCanvasSettled(page);

    // Enter inline edit by dispatching a bubbling dblclick straight on the label
    // button (React's delegated handler catches it). A real pointer dblclick is
    // swallowed by the edge's invisible interaction stroke that overlaps the
    // label — see editable-edge.tsx — which is orthogonal to this regression.
    const labelButton = page
      .locator('.react-flow__edgelabel-renderer button', { hasText: 'order.created' })
      .first();
    await labelButton.waitFor({ state: 'visible' });
    // Dispatch the dblclick via Playwright's native dispatchEvent (bubbles to
    // React's delegated onDoubleClick). A real pointer dblclick is swallowed by
    // the edge's invisible interaction stroke overlapping the label. (Page
    // evals below use string form: the studio tsconfig omits the DOM lib so a
    // callback referencing `document` would fail typecheck; the string runs in
    // the browser where the global exists.)
    await labelButton.dispatchEvent('dblclick');

    const editor = page.locator('[data-testid="inline-edit-input"][data-field="connector-label"]');
    await expect(editor).toBeVisible();
    const focusedOnOpen = await page.evaluate(
      "document.activeElement?.getAttribute('data-testid') === 'inline-edit-input'",
    );
    expect(focusedOnOpen).toBe(true);

    // Type, then wait for the debounced commit's PATCH to fire (proves the
    // server round-trip + watcher flow:reload echo that used to kill the editor
    // is actually exercised here, so the test fails loudly on a regression).
    const patch = page.waitForResponse(
      (r) => r.url().includes('/connectors/') && r.request().method() === 'PATCH',
      { timeout: 10_000 },
    );
    await page.keyboard.press('End');
    await page.keyboard.type(' XYZ', { delay: 40 });
    await patch;
    // Give the watcher → SSE flow:reload echo → re-render (the remount) a beat.
    await page.waitForTimeout(800);

    // The editor must still be mounted AND still hold focus.
    await expect(editor).toBeVisible();
    const stillFocused = await page.evaluate(
      "document.activeElement?.getAttribute('data-testid') === 'inline-edit-input' && !!document.activeElement?.isContentEditable",
    );
    expect(stillFocused).toBe(true);

    // Resumed typing must append (caret restored to the end), not replace.
    await page.keyboard.type('END', { delay: 40 });
    await expect(editor).toHaveText(/order\.created XYZEND/);
  });
});
