#!/usr/bin/env bun
// Dispatcher for the Playwright e2e tier.
//
// On Linux (CI + matching dev hosts): exec playwright directly so the run
// stays fast and uses the host's already-installed browsers.
//
// On non-Linux hosts (macOS/Windows dev): re-exec inside the official
// Playwright Docker image. Visual baselines (apps/studio/e2e/canvas.e2e.ts)
// are pinned to chromium-linux pixels — running through Docker guarantees
// devs and CI compare against the same baselines.
//
// CLI args are forwarded verbatim so `--update-snapshots`, file filters, etc.
// work in both modes.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STUDIO_DIR = resolve(import.meta.dir, '..');
const REPO_ROOT = resolve(STUDIO_DIR, '../..');
const PLAYWRIGHT_BIN = join(STUDIO_DIR, 'node_modules/.bin/playwright');
const PLAYWRIGHT_CONFIG = join(STUDIO_DIR, 'e2e/playwright.config.ts');
const DOCKERFILE = join(STUDIO_DIR, 'scripts/e2e.Dockerfile');
const IMAGE_TAG = 'seeflow-e2e:latest';

const FORWARDED_ARGS = process.argv.slice(2);

async function runNative(): Promise<number> {
  if (!existsSync(PLAYWRIGHT_BIN)) {
    console.error(`[run-e2e] missing ${PLAYWRIGHT_BIN}; run \`bun install\` first.`);
    return 1;
  }
  const proc = Bun.spawn({
    cmd: ['bun', PLAYWRIGHT_BIN, 'test', `--config=${PLAYWRIGHT_CONFIG}`, ...FORWARDED_ARGS],
    cwd: REPO_ROOT,
    env: process.env as Record<string, string>,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exited;
}

async function dockerAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: ['docker', 'version', '--format', '{{.Server.Version}}'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

async function buildImage(): Promise<number> {
  console.log(`[run-e2e] Building ${IMAGE_TAG} from ${DOCKERFILE}`);
  const proc = Bun.spawn({
    cmd: ['docker', 'build', '-t', IMAGE_TAG, '-f', DOCKERFILE, STUDIO_DIR],
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exited;
}

async function runDocker(): Promise<number> {
  if (!(await dockerAvailable())) {
    console.error(
      '[run-e2e] Docker is required on non-Linux hosts so visual baselines\n' +
        'match CI. Install Docker Desktop and ensure it is running, then retry.',
    );
    return 1;
  }
  const buildCode = await buildImage();
  if (buildCode !== 0) return buildCode;

  // Named volumes keep node_modules off the bind mount — host node_modules
  // contain darwin/arm64 binaries that crash inside the linux container.
  // Each workspace package gets its own volume so bun's symlink layout works.
  const nodeModulesMounts = [
    'node_modules:/work/node_modules',
    'apps-studio-node_modules:/work/apps/studio/node_modules',
    'apps-web-node_modules:/work/apps/web/node_modules',
    'packages-canvas-node_modules:/work/packages/canvas/node_modules',
  ].flatMap((spec) => ['-v', `seeflow-e2e-${spec}`]);

  // Container command:
  // 1. `bun install --frozen-lockfile` populates the named-volume node_modules
  //    on first run (and re-syncs when bun.lock changes).
  // 2. `playwright install chromium` is a no-op when the image already has
  //    browsers cached; needed only if the Playwright version diverges.
  // 3. Forward `$@` to the playwright CLI.
  const script = [
    'set -euo pipefail',
    'bun install --frozen-lockfile',
    'bun apps/studio/node_modules/.bin/playwright install chromium >/dev/null',
    'exec bun apps/studio/node_modules/.bin/playwright test --config=apps/studio/e2e/playwright.config.ts "$@"',
  ].join(' && ');

  const proc = Bun.spawn({
    cmd: [
      'docker',
      'run',
      '--rm',
      '-i',
      '-v',
      `${REPO_ROOT}:/work`,
      ...nodeModulesMounts,
      '-w',
      '/work',
      '-e',
      'CI=true',
      '--ipc=host',
      IMAGE_TAG,
      'bash',
      '-lc',
      script,
      '--',
      ...FORWARDED_ARGS,
    ],
    env: process.env as Record<string, string>,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exited;
}

const code = process.platform === 'linux' ? await runNative() : await runDocker();
process.exit(code);
