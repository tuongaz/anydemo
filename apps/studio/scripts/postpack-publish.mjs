#!/usr/bin/env bun
// Restores apps/studio after `npm pack` / `npm publish`.
// Pair to scripts/prepack-publish.mjs — idempotent.
//
// IMPORTANT: we deliberately do NOT restore `package.json` here. npm publish
// reads the manifest from disk AFTER postpack runs to derive the metadata it
// uploads to the registry (separate from the tarball). If we restored
// `package.json` here, the registry would see the unmutated manifest
// (with `@seeflow/canvas: workspace:*`) and `npm install` would fail with
// EUNSUPPORTEDPROTOCOL — even though the tarball itself is correct.
//
// The CI checkout is ephemeral so leaving `package.json` stripped is fine.
// For local `npm pack` testing, `git checkout apps/studio/package.json`
// after the run; the backup files are also left in place for inspection.

import { existsSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const studioRoot = join(here, '..');
const srcDir = join(studioRoot, 'src');
const vendoredCatalog = join(srcDir, 'vendored-canvas-catalog.ts');

const BACKUP_SUFFIX = '.publish-backup';
for (const file of readdirSync(studioRoot)) {
  if (!file.endsWith(BACKUP_SUFFIX)) continue;
  const original = file.slice(0, -BACKUP_SUFFIX.length);
  renameSync(join(studioRoot, file), join(srcDir, original));
}

if (existsSync(vendoredCatalog)) unlinkSync(vendoredCatalog);

console.error(
  'postpack-publish: restored rewritten src files; removed vendored catalog. NOTE: package.json left in stripped state so the publish manifest matches the tarball.',
);
