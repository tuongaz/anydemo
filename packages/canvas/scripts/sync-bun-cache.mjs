#!/usr/bin/env node
// Bun's workspace resolution snapshots `packages/canvas/dist/` into
// `node_modules/.bun/@seeflow+canvas@file+.../node_modules/@seeflow/canvas/dist/`
// as PHYSICAL FILES (not symlinks). The snapshot is taken at install time
// and is NOT refreshed when `packages/canvas/dist/` rebuilds — so the web
// app's Vite build (which resolves through that snapshot) keeps consuming
// stale `index.js` / `style.css` until the next `bun install`.
//
// This script copies the freshly-built `dist/` files into the Bun cache
// snapshot so a `bun run --filter @seeflow/canvas build` actually reaches
// the consuming app. Idempotent and silent on the no-cache path so the
// canvas package still builds standalone (e.g. outside the monorepo).
//
// Note: the snapshot's `node_modules/@seeflow/canvas/dist` directory may
// not exist on a fresh CI checkout (packages/canvas/dist/ is gitignored,
// so bun install creates the snapshot without it). cpSync with
// `recursive: true` creates the target dir, so we do not guard on it.

import { cpSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const distSrc = join(repoRoot, 'packages/canvas/dist');
const cacheRoot = join(repoRoot, 'node_modules/.bun');

if (!existsSync(distSrc) || !existsSync(cacheRoot)) {
  // Not in the monorepo, or canvas hasn't built — nothing to do.
  process.exit(0);
}

const matches = readdirSync(cacheRoot).filter((name) =>
  name.startsWith('@seeflow+canvas@file+packages+canvas'),
);

for (const dir of matches) {
  const target = join(cacheRoot, dir, 'node_modules/@seeflow/canvas/dist');
  cpSync(distSrc, target, { recursive: true, force: true });
  console.log(`[sync-bun-cache] refreshed ${dir}`);
}
