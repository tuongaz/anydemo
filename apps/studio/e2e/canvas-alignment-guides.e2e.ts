// US-006: e2e happy-path for the Miro/Figma-style alignment guides + snap.
//
// Exercises the full drag → guide → snap → release flow in a real browser so
// the subsystem (geometry → useAlignmentGuides → AlignmentOverlay, wired into
// SeeflowCanvas's drag path in US-004) is regression-covered end to end.
//
// Scenario: two identical nodes sit on the same Y, 240 world-px apart on X
// (no overlap, so grabbing the right node is unambiguous). Because they share
// Y, the alignment overlay shows a guide throughout any drag. We drag the right
// node leftward and assert three things:
//   1. an SVG guide line is visible mid-drag;
//   2. SNAP PROOF — while the pointer sits a few SCREEN px short of exact
//      alignment (inside the ~6px band but off-target by > 1 world px), the
//      node is held at the left node's X, i.e. the live snap pulled it in; and
//   3. the dropped position equals the aligned coordinate within 1px.
// The drag-STOP change is intentionally not snapped (only `dragging === true`
// changes are), so the release happens dead-on alignment to land the node on
// the aligned X — step 2 is what proves the snap itself engaged.
//
// Filename ends in `.e2e.ts` (not `.spec.ts`) so bun's default test discovery
// can't pick it up — same convention as the other studio e2e suites.

import {
  expect,
  projectFlowPath,
  registerFlow,
  test,
  waitForCanvasSettled,
} from './support/studio-fixture.ts';

// Disable transitions/animations so node bounding boxes are stable the instant
// the canvas settles — same guard the other canvas specs use.
const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

// The two nodes are identical (same name → same rendered width) and share Y so
// every Y anchor aligns with delta 0 — a guide is present from the first drag
// frame. They sit 240 world-px apart on X (wider than any rectangle node) so
// the right node never overlaps the left one at grab time.
const ALIGNMENT_FLOW = {
  version: 2 as const,
  name: 'Alignment Guides',
  nodes: [
    { id: 'left', type: 'rectangle' as const, position: { x: 0, y: 0 }, data: { name: 'Box' } },
    { id: 'right', type: 'rectangle' as const, position: { x: 240, y: 0 }, data: { name: 'Box' } },
  ],
  connectors: [],
};

// SVG guide lines drawn by AlignmentOverlay (US-003): every <line> carries
// vector-effect="non-scaling-stroke" and lives inside the overlay's
// aria-hidden SVG root. No other canvas surface renders that combination.
const GUIDE_LINE_SELECTOR = '[aria-hidden="true"] line[vector-effect="non-scaling-stroke"]';

test.describe('canvas — alignment guides (US-006)', () => {
  test('dragging a node into alignment shows a guide and snaps on release', async ({
    page,
    studio,
  }) => {
    const flow = await registerFlow(studio.studio, 'alignment-guides', ALIGNMENT_FLOW, {
      name: 'Alignment Guides',
    });

    await page.goto(`${studio.studio.baseURL}${projectFlowPath(flow.projectSlug, flow.flowSlug)}`);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    const leftNode = page.locator('.react-flow__node[data-id="left"]');
    const rightNode = page.locator('.react-flow__node[data-id="right"]');
    await expect(leftNode).toBeVisible();
    await expect(rightNode).toBeVisible();

    const leftBox = await leftNode.boundingBox();
    const rightBox = await rightNode.boundingBox();
    if (!leftBox || !rightBox) throw new Error('alignment nodes have no bounding box');

    // A node's `.react-flow__node` wrapper carries `transform: translate(Xpx,
    // Ypx)` where X/Y are WORLD coords (the flow position) — independent of pan
    // and zoom. Read it via string-form evaluate so the studio tsconfig (no DOM
    // lib) still type-checks. Returns NaN if the node or transform is missing.
    const worldX = async (id: string): Promise<number> => {
      const transform = (await page.evaluate(
        `(() => { const el = document.querySelector('.react-flow__node[data-id="${id}"]'); return el && el.style ? el.style.transform : ''; })()`,
      )) as string;
      const match = /translate(?:3d)?\(\s*(-?[\d.]+)px/.exec(transform);
      return match?.[1] ? Number.parseFloat(match[1]) : Number.NaN;
    };

    // Screen distance between the two left edges == WORLD_GAP * zoom, so the
    // zoom factor falls out as span / WORLD_GAP — we never assume the auto-fit
    // zoom.
    const WORLD_GAP = 240; // the right node's flow X (left node sits at 0)
    const span = rightBox.x - leftBox.x;
    const zoom = span / WORLD_GAP;

    // React Flow consumes the FIRST pointer move after mousedown as its
    // drag-start threshold (that delta is not applied to the node position).
    // So we spend a deliberately tiny first move on the threshold, then every
    // later move tracks the node 1:1, mapping pointer→world at 1/zoom.
    const FIRST_MOVE = 2;
    const startX = rightBox.x + rightBox.width / 2;
    const startY = rightBox.y + rightBox.height / 2;
    const afterThresholdX = startX - FIRST_MOVE;

    // Two pointer targets, both reached during one continuous drag:
    //  - probeX: 4 SCREEN px short of exact alignment. Inside the ~6px snap
    //    band but off-target by 4/zoom (> 1) world px — so the live snap, not
    //    pointer accuracy, is what must pull the node onto the left node's X.
    //  - exactX: dead-on alignment. The drag-STOP change is not snapped (only
    //    `dragging === true` changes are, by design), so the node persists at
    //    the pointer's world position on release; dropping here makes the
    //    committed position the aligned coordinate.
    // The absorbed first move is added back into each displacement.
    const PROBE_OFFSET_SCREEN = 4;
    const probeX = startX - (span - PROBE_OFFSET_SCREEN + FIRST_MOVE);
    const exactX = startX - (span + FIRST_MOVE);

    const stepTo = async (fromX: number, toX: number, steps: number): Promise<void> => {
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(fromX + ((toX - fromX) * i) / steps, startY);
      }
    };

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // First move: consume React Flow's drag-start threshold (≈ this delta).
    await page.mouse.move(afterThresholdX, startY);
    await stepTo(afterThresholdX, probeX, 24);

    // Mid-drag (mouse still held): the overlay must be showing at least one
    // guide line. Shared Y guarantees a horizontal guide from the first frame;
    // crossing into X alignment adds a vertical one.
    await expect.poll(async () => page.locator(GUIDE_LINE_SELECTOR).count()).toBeGreaterThan(0);

    // Snap proof: the pointer is PROBE_OFFSET_SCREEN px short of exact, so
    // without snapping the right node's world X would be PROBE_OFFSET_SCREEN /
    // zoom (> 1) px. Assert it is instead held at the left node's X (0) within
    // 1px — the live snap pulled it into alignment despite the offset pointer.
    const offsetWorldPx = PROBE_OFFSET_SCREEN / zoom;
    expect(offsetWorldPx).toBeGreaterThan(1);
    await expect.poll(async () => Math.abs(await worldX('right'))).toBeLessThanOrEqual(1);

    // Finish onto exact alignment and release.
    await stepTo(probeX, exactX, 6);
    await page.mouse.up();

    // The committed position lives on the server-resolved flow (the drag PATCH
    // round-trips through the adapter). Assert the dropped right node landed on
    // the left node's X within 1px — the aligned coordinate.
    const flowApi = `${studio.studio.baseURL}/api/projects/${flow.projectSlug}/flows/${flow.flowSlug}`;
    const nodeX = async (id: string): Promise<number> => {
      const res = await page.request.get(flowApi);
      const detail = (await res.json()) as {
        flow?: { nodes?: Array<{ id: string; position?: { x?: number } }> };
      };
      const found = detail.flow?.nodes?.find((n) => n.id === id);
      return found?.position?.x ?? Number.NaN;
    };

    await expect
      .poll(
        async () => {
          const [lx, rx] = await Promise.all([nodeX('left'), nodeX('right')]);
          if (Number.isNaN(lx) || Number.isNaN(rx)) return Number.NaN;
          return Math.abs(rx - lx);
        },
        { timeout: 10_000 },
      )
      .toBeLessThanOrEqual(1);
  });
});
