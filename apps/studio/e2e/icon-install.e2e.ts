import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { splitFlow } from '../src/merge.ts';
import { ResolvedFlowSchema } from '../src/schema.ts';
import { createApp } from '../src/server.ts';

// US-022 — Playwright E2E for the Browse Packs install flow.
//
// Boots an in-process studio (createApp + Bun.serve) with an injected
// iconFetcher returning a fixture ZIP and an isolated iconCacheRoot, so the
// install pipeline never touches the network. Drives the picker UI: open
// toolbar Insert-icon → Browse packs → Install AWS → Confirm → wait for
// "Done" → Back to icons → AWS tab → assert the Lambda tile is present.
//
// Visual baselines (modal / in-progress toast / post-install picker) are
// pinned to chromium-linux to match CI. Regenerate via
// `bun run test:it:update-snapshots` (Playwright runs in the official Docker
// image on darwin per the project CLAUDE.md).

const STUDIO_DIR = resolve(import.meta.dir, '..');
const DEFAULT_STATIC_ROOT = resolve(STUDIO_DIR, 'dist/web');

// Strip every animation + transition so the in-progress spinner snapshot is
// stable across runs (Loader2 in install-progress-toast is otherwise infinitely
// rotating). Same pattern as canvas.e2e.ts beforeEach.
const DISABLE_MOTION_CSS = `
*,*::before,*::after {
  transition: none !important;
  animation: none !important;
}
`;

function makeAwsZipBuffer(): Buffer {
  // Two SVGs so the post-install picker grid has > 1 tile, exercising the
  // ICON_NAMES_BY_VENDOR sort + the IconRenderer fetch path for both.
  const zip = zipSync({
    'Arch_AWS-Lambda_64.svg': strToU8('<svg>lambda</svg>'),
    'Arch_AWS-S3_64.svg': strToU8('<svg>s3</svg>'),
  });
  return Buffer.from(zip);
}

interface IconStudio {
  baseURL: string;
  home: string;
  cacheRoot: string;
  releaseDownload: () => void;
  stop: () => Promise<void>;
}

/**
 * Boot the studio in-process with the SPA static root + an injected icon
 * fetcher that holds until `releaseDownload()` is called. The hold lets the
 * test reliably snapshot the in-progress toast state before the install
 * completes — without it the install resolves faster than the screenshot.
 */
function startIconStudio(): IconStudio {
  const home = mkdtempSync(join(tmpdir(), 'sf-icon-e2e-'));
  const cacheRoot = mkdtempSync(join(tmpdir(), 'sf-icon-cache-e2e-'));
  // The studio reads the registry / icon cache from seeflowHome() which honours
  // SEEFLOW_WORKSPACE. Set it before createApp so registry.json lands inside
  // the per-test tmpdir.
  process.env.SEEFLOW_WORKSPACE = home;

  let release: () => void = () => undefined;
  const downloadGate = new Promise<void>((r) => {
    release = r;
  });

  const app = createApp({
    mode: 'prod',
    staticRoot: DEFAULT_STATIC_ROOT,
    disableWatcher: true,
    iconCacheRoot: cacheRoot,
    iconFetcher: async () => {
      await downloadGate;
      return makeAwsZipBuffer();
    },
  });
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: app.fetch,
  });
  const baseURL = `http://127.0.0.1:${server.port}`;

  return {
    baseURL,
    home,
    cacheRoot,
    releaseDownload: () => release(),
    stop: async () => {
      release();
      server.stop(true);
      for (const dir of [home, cacheRoot]) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* nothing to clean */
        }
      }
    },
  };
}

interface RegisteredFlow {
  projectSlug: string;
  flowSlug: string;
}

// Register a one-rectangle flow so the canvas page mounts with at least one
// node. The toolbar's Insert-icon button is gated on the canvas being in edit
// mode with a host-supplied onCreateShapeNode — both are wired by the standard
// apps/web demo-view path.
async function registerIconFlow(studio: IconStudio): Promise<RegisteredFlow> {
  const slug = 'icon-install-e2e';
  const repoPath = join(studio.home, slug);
  mkdirSync(repoPath, { recursive: true });
  const resolved = ResolvedFlowSchema.parse({
    version: 2 as const,
    name: 'Icon Install E2E',
    nodes: [
      {
        id: 'r1',
        type: 'rectangle' as const,
        position: { x: 100, y: 100 },
        data: { name: 'Anchor' },
      },
    ],
    connectors: [],
  });
  const { flow, style } = splitFlow(resolved);
  writeFileSync(join(repoPath, 'flow.json'), `${JSON.stringify(flow, null, 2)}\n`);
  writeFileSync(join(repoPath, 'style.json'), `${JSON.stringify(style, null, 2)}\n`);

  const res = await fetch(`${studio.baseURL}/api/flows/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Icon Install E2E', repoPath, flowPath: 'flow.json' }),
  });
  if (res.status !== 200) {
    throw new Error(`Failed to register flow: ${res.status} ${await res.text()}`);
  }
  const { slug: registeredSlug } = (await res.json()) as { slug: string };
  const idx = registeredSlug.indexOf('/');
  if (idx < 0) throw new Error(`Registry slug missing '/': ${registeredSlug}`);
  return {
    projectSlug: registeredSlug.slice(0, idx),
    flowSlug: registeredSlug.slice(idx + 1),
  };
}

async function openCanvas(page: Page, studio: IconStudio, flow: RegisteredFlow): Promise<void> {
  const url = `${studio.baseURL}/projects/${encodeURIComponent(flow.projectSlug)}/flows/${encodeURIComponent(flow.flowSlug)}`;
  await page.goto(url);
  await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached' });
  await page.addStyleTag({ content: DISABLE_MOTION_CSS });
  // Two animation frames + fonts settle so layouts stabilize before snapshots.
  await page.evaluate(
    'document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))',
  );
}

test.describe('icon-install — Browse Packs install flow', () => {
  let studio: IconStudio;
  let flow: RegisteredFlow;

  test.beforeAll(async () => {
    studio = startIconStudio();
    flow = await registerIconFlow(studio);
  });

  test.afterAll(async () => {
    await studio.stop();
  });

  test('install AWS pack end-to-end and pick the Lambda tile', async ({ page }) => {
    await openCanvas(page, studio, flow);

    // 1) Open the picker via the toolbar's Insert-icon button.
    await page.locator('[data-testid="toolbar-insert-icon"]').click();
    await expect(page.locator('[data-testid="icon-picker-popover"]')).toBeVisible();

    // 2) Click the Browse packs footer (only rendered when iconsAdapter is
    //    wired through — US-022 plumbs adapter.icons into CanvasToolbar).
    await page.locator('[data-testid="icon-picker-browse-footer"]').click();
    const panel = page.locator('[data-testid="browse-packs-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-testid="browse-packs-row-aws"]')).toHaveAttribute(
      'data-installed',
      'false',
    );

    // 3) Click Install on the AWS row — modal opens.
    await page.locator('[data-testid="browse-packs-install-aws"]').click();
    const modal = page.locator('[data-testid="install-pack-modal"]');
    await expect(modal).toBeVisible();
    // AWS does not require ToS acceptance — the checkbox must not render.
    await expect(modal.locator('[data-testid="install-pack-modal-accept"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="install-pack-modal-license"]')).toBeVisible();

    // Snapshot: install modal.
    await expect(modal).toHaveScreenshot('install-modal-aws.png', { maxDiffPixelRatio: 0.02 });

    // 4) Confirm — the picker subscribes to the job. The fetcher is gated, so
    //    the toast stays in its initial / download state until releaseDownload().
    await page.locator('[data-testid="install-pack-modal-confirm"]').click();
    const toast = page.locator('[data-testid="install-progress-toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('data-variant', 'progress');

    // Snapshot: in-progress toast.
    await expect(toast).toHaveScreenshot('install-toast-in-progress.png', {
      maxDiffPixelRatio: 0.02,
    });

    // 5) Release the held download — installer runs through extract → indexing → done.
    studio.releaseDownload();
    await expect(toast).toHaveAttribute('data-variant', 'done', { timeout: 10_000 });

    // 6) Re-open the picker fresh and switch to the AWS tab. Radix Dialog's
    //    focus + pointer-events lockdown may have closed the parent Popover
    //    when the modal opened, so don't assume `view === 'browse'`. The
    //    popover's open-effect resets `view` back to 'picker' on close, so a
    //    fresh open lands on the tabs grid (lucide active by default). The
    //    `done` handler already re-fetched listPacks + applyPackSummaries,
    //    so ICON_NAMES_BY_VENDOR['aws'] is populated by the time we click
    //    the AWS tab. Press Escape first to dismiss any latent popover so
    //    a re-click on the trigger toggles state cleanly.
    await page.keyboard.press('Escape');
    const popover = page.locator('[data-testid="icon-picker-popover"]');
    await expect(popover).toHaveCount(0);
    await page.locator('[data-testid="toolbar-insert-icon"]').click();
    await expect(popover).toBeVisible();
    await expect(page.locator('[data-testid="icon-picker-tabs"]')).toBeVisible();
    const awsTab = page.locator('[data-testid="icon-picker-tab-aws"]');
    await expect(awsTab).toHaveAttribute('data-installed', 'true');
    await awsTab.click();

    const lambdaTile = page.locator('[data-testid="icon-picker-tile-aws-lambda"]');
    await expect(lambdaTile).toBeVisible();
    await expect(lambdaTile).toHaveAttribute('data-icon-name', 'aws:lambda');

    // Snapshot: post-install picker with AWS tab active.
    await expect(popover).toHaveScreenshot('picker-aws-tab-post-install.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
