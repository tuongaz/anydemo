#!/usr/bin/env bun
// Prepares apps/studio for `npm pack` / `npm publish`.
//
// Why: the published manifest declares `@seeflow/canvas: workspace:*`, which
// npm cannot resolve (EUNSUPPORTEDPROTOCOL). At runtime several files under
// `apps/studio/src/` import from `@seeflow/canvas/catalog`, so we vendor that
// one file in and rewrite the import everywhere it appears.
//
// postpack-publish.mjs restores the rewritten sources and removes the vendored
// file but DOES NOT restore `package.json` — npm reads the manifest from disk
// to build the registry metadata AFTER postpack runs, so restoring there would
// re-introduce the broken `workspace:*` dep into what `npm install` sees.
// CI checkouts are ephemeral; for local pack runs, restore via
// `git checkout apps/studio/package.json`.

import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const studioRoot = join(here, '..');
const repoRoot = join(studioRoot, '..', '..');

const pkgPath = join(studioRoot, 'package.json');
const srcDir = join(studioRoot, 'src');
const canvasCatalogSrc = join(
  repoRoot,
  'packages',
  'canvas',
  'src',
  'catalog',
  'component-catalog.ts',
);
const vendoredCatalog = join(srcDir, 'vendored-canvas-catalog.ts');

const SOURCE_IMPORT = "from '@seeflow/canvas/catalog'";
const VENDORED_IMPORT = "from './vendored-canvas-catalog.ts'";
// Backups live OUTSIDE src/ so npm pack (which globs src/) doesn't ship them.
const backupFor = (file) => join(studioRoot, `${file}.publish-backup`);

const pkgRaw = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(pkgRaw);
if (!pkg.dependencies?.['@seeflow/canvas']) {
  console.error(
    "prepack-publish: expected @seeflow/canvas in dependencies — manifest doesn't match the assumption this script was written for.",
  );
  process.exit(1);
}
const { '@seeflow/canvas': _stripped, ...remainingDeps } = pkg.dependencies;
pkg.dependencies = remainingDeps;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, '\t')}\n`);

const rewritten = [];
for (const file of readdirSync(srcDir)) {
  if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
  const filePath = join(srcDir, file);
  const raw = readFileSync(filePath, 'utf8');
  if (!raw.includes(SOURCE_IMPORT)) continue;
  writeFileSync(backupFor(file), raw);
  writeFileSync(filePath, raw.replaceAll(SOURCE_IMPORT, VENDORED_IMPORT));
  rewritten.push(file);
}

if (rewritten.length === 0) {
  console.error(
    `prepack-publish: found no src file importing ${SOURCE_IMPORT} — aborting (nothing to vendor).`,
  );
  process.exit(1);
}

copyFileSync(canvasCatalogSrc, vendoredCatalog);

console.error(
  `prepack-publish: vendored canvas catalog + rewrote import in ${rewritten.join(', ')}; stripped @seeflow/canvas from manifest.`,
);
