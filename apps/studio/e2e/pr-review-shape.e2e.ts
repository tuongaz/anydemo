// PR-review flows: the *shape* the `/seeflow pr review` skill produces is what
// this pins. The skill itself can't run in CI (it needs `gh`, a live PR and
// sub-agents), but every canvas behaviour it depends on can be seeded as a
// fixture and asserted:
//   1. A manifest project of several linked flows (`main` + one view flow).
//   2. A group node used as a lane band, behind cards with authored geometry —
//      no auto-layout anywhere, so every position is the one written here.
//   3. Delta-coloured connectors, one of them `animated: true`. That key only
//      survives `splitFlow` → `style.json` because of the schema + merge work
//      in Part A; a `badSchema` failure at registration time means one of
//      those landed wrong.
//   4. A linkflow hop from `main` to the view flow, and Back returning.
//
// Filename ends in `.e2e.ts` (not `.spec.ts`) so bun test's default matcher
// can't pick up a Playwright spec — same convention as the rest of the suite.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StudioHandle } from '../integration/support/studio-harness.ts';
import { splitFlow } from '../src/merge.ts';
import { ResolvedFlowSchema } from '../src/schema.ts';
import {
  expect,
  projectFlowPath,
  splitRegistrySlug,
  test,
  waitForCanvasSettled,
} from './support/studio-fixture.ts';

const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

// Slug is unique across the e2e suite — the studio is shared per worker, and
// registration synthesises the project slug from the manifest name.
const PROJECT_DIR = 'pr-review-shape-fixture';
const PROJECT_NAME = 'PR Review Shape Fixture';
const PROJECT_SLUG = 'pr-review-shape-fixture';

// `main` — one lane band (group), a text header, two cards inside the band,
// one delta-coloured animated connector between them, and a linkflow into the
// view flow. Geometry is authored, exactly as a flow writer authors it.
function buildMainFlow() {
  return {
    version: 2 as const,
    name: 'Map',
    nodes: [
      {
        id: 'header',
        type: 'text' as const,
        position: { x: 80, y: 108 },
        data: {
          name: 'API · what the change touches',
          width: 520,
          height: 32,
          fontSize: 18,
          textAlign: 'left' as const,
        },
      },
      {
        id: 'lane-api-band',
        type: 'group' as const,
        position: { x: 40, y: 96 },
        // Geometry lives in `data` (width/height/childIds) — the same place a
        // flow writer authors it per references/pr/flow-mapping.md §5.
        data: {
          name: 'API',
          width: 640,
          height: 260,
          childIds: ['el-router', 'el-handler'],
          borderColor: 'gray' as const,
          borderSize: 1,
        },
      },
      {
        id: 'el-router',
        type: 'rectangle' as const,
        position: { x: 80, y: 180 },
        data: {
          name: 'router.ts',
          width: 200,
          height: 96,
          borderColor: 'green' as const,
          borderSize: 2,
        },
      },
      {
        id: 'el-handler',
        type: 'rectangle' as const,
        position: { x: 400, y: 180 },
        data: {
          name: 'handler.ts',
          width: 200,
          height: 96,
          borderColor: 'amber' as const,
          borderSize: 2,
        },
      },
      {
        id: 'lf-impact',
        type: 'linkflow' as const,
        position: { x: 40, y: 400 },
        data: {
          name: 'Impact',
          width: 300,
          height: 132,
          target: { project: PROJECT_SLUG, flow: 'impact' },
        },
      },
    ],
    connectors: [
      {
        id: 'rel-router-handler',
        source: 'el-router',
        target: 'el-handler',
        label: 'dispatches',
        color: 'green' as const,
        animated: true,
      },
    ],
  };
}

// The view flow the linkflow hops into — one card is enough to prove the hop.
function buildViewFlow() {
  return {
    version: 2 as const,
    name: 'Impact',
    nodes: [
      {
        id: 'el-handler',
        type: 'rectangle' as const,
        position: { x: 120, y: 120 },
        data: {
          name: 'handler.ts',
          width: 200,
          height: 96,
          borderColor: 'amber' as const,
          borderSize: 2,
        },
      },
    ],
    connectors: [],
  };
}

// registerManifestProject seeds EMPTY envelopes, so this fixture writes its
// own manifest + split flow/style pairs and registers the project directly.
// Splitting through `splitFlow` is the point: it routes `animated` and every
// authored position/size into style.json exactly as the CLI does.
async function registerPrReviewProject(studio: StudioHandle) {
  const repoPath = join(studio.home, PROJECT_DIR);
  mkdirSync(repoPath, { recursive: true });

  const manifest = {
    version: 1 as const,
    name: PROJECT_NAME,
    defaultFlow: 'main',
    flows: [
      { id: 'main', name: 'Map' },
      { id: 'impact', name: 'Impact' },
    ],
  };
  writeFileSync(join(repoPath, 'seeflow.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  for (const [id, resolvedFlow] of [
    ['main', buildMainFlow()],
    ['impact', buildViewFlow()],
  ] as const) {
    const flowDir = join(repoPath, 'flows', id);
    mkdirSync(flowDir, { recursive: true });
    const { flow, style } = splitFlow(ResolvedFlowSchema.parse(resolvedFlow));
    writeFileSync(join(flowDir, 'flow.json'), `${JSON.stringify(flow, null, 2)}\n`);
    writeFileSync(join(flowDir, 'style.json'), `${JSON.stringify(style, null, 2)}\n`);
  }

  const res = await fetch(`${studio.baseURL}/api/projects/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoPath }),
  });
  if (res.status !== 200) {
    throw new Error(`Failed to register PR-review fixture: ${res.status} ${await res.text()}`);
  }
  const payload = (await res.json()) as {
    entries: ReadonlyArray<{ slug: string; projectSlug: string; flowSlug: string }>;
  };
  const main = payload.entries.find((e) => e.flowSlug === 'main');
  const view = payload.entries.find((e) => e.flowSlug === 'impact');
  if (!main || !view) throw new Error('PR-review fixture registered without both flows');
  return { main, view };
}

test.describe('pr-review flow shape', () => {
  test('lane band, animated connector, and a linkflow hop that returns', async ({
    page,
    studio,
  }) => {
    const { main, view } = await registerPrReviewProject(studio.studio);
    expect(splitRegistrySlug(main.slug).projectSlug).toBe(PROJECT_SLUG);

    await page.goto(`${studio.studio.baseURL}${projectFlowPath(main.projectSlug, main.flowSlug)}`);
    await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
    await page.addStyleTag({ content: DISABLE_MOTION_CSS });
    await waitForCanvasSettled(page);

    // The lane band renders as a group node at its authored position — there
    // is no auto-placement, so a missing style entry would pin it at 0,0.
    const band = page.locator('.react-flow__node[data-id="lane-api-band"]');
    await expect(band).toBeVisible();
    const bandBox = await band.boundingBox();
    if (!bandBox) throw new Error('lane band has no bounding box');

    // Both cards sit inside the band's rectangle. This is the geometry
    // invariant every flow writer self-checks (`cardsOutsideBand`).
    for (const cardId of ['el-router', 'el-handler']) {
      const card = page.locator(`.react-flow__node[data-id="${cardId}"]`);
      await expect(card).toBeVisible();
      const box = await card.boundingBox();
      if (!box) throw new Error(`card ${cardId} has no bounding box`);
      expect(box.x).toBeGreaterThanOrEqual(bandBox.x - 1);
      expect(box.y).toBeGreaterThanOrEqual(bandBox.y - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(bandBox.x + bandBox.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(bandBox.y + bandBox.height + 1);
    }

    // The authored `animated: true` survives the style split and reaches
    // xyflow, which marks the edge with its own `animated` class.
    const edge = page.locator('.react-flow__edge[data-testid="rf__edge-rel-router-handler"]');
    await expect(edge).toHaveClass(/animated/);

    // The linkflow resolves against a sibling flow in the same manifest.
    const linkflowNode = page.locator('[data-testid="linkflow-node"]');
    await expect(linkflowNode).toBeVisible();
    await expect(linkflowNode).toHaveAttribute('data-linkflow-state', 'linked-healthy');

    // Follow it, then come back.
    await page.locator('[data-testid="linkflow-follow-button"]').click();
    await page.waitForURL(`**${projectFlowPath(view.projectSlug, view.flowSlug)}`, {
      timeout: 10_000,
    });
    const backButton = page.locator('[data-testid="flow-back-button"]');
    await expect(backButton).toBeVisible();
    await page.locator('[data-canvas-ready="true"]').first().waitFor({ state: 'attached' });

    await backButton.click();
    await page.waitForURL(`**${projectFlowPath(main.projectSlug, main.flowSlug)}`, {
      timeout: 10_000,
    });
    await expect(backButton).toHaveCount(0);
    await expect(band).toBeVisible();
  });
});
