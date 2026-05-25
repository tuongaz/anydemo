#!/usr/bin/env bun
// Prepares apps/studio for `npm pack` / `npm publish`.
//
// Why: the published manifest declares `@seeflow/canvas: workspace:*`, which
// npm cannot resolve. At runtime only `apps/studio/src/schema.ts` imports
// from `@seeflow/canvas/catalog`, so we vendor that single file in and
// rewrite the import. postpack-publish.mjs restores the tree.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const studioRoot = join(here, '..');
const repoRoot = join(studioRoot, '..', '..');

const pkgPath = join(studioRoot, 'package.json');
const pkgBackup = `${pkgPath}.publish-backup`;
const schemaPath = join(studioRoot, 'src', 'schema.ts');
// Backups live OUTSIDE src/ so npm pack (which globs everything in src/) doesn't
// ship them inside the tarball.
const schemaBackup = join(studioRoot, 'schema.ts.publish-backup');
const canvasCatalogSrc = join(
  repoRoot,
  'packages',
  'canvas',
  'src',
  'catalog',
  'component-catalog.ts',
);
const vendoredCatalog = join(studioRoot, 'src', 'vendored-canvas-catalog.ts');

if (existsSync(pkgBackup) || existsSync(schemaBackup)) {
  console.error(
    'prepack-publish: backup files already exist — run scripts/postpack-publish.mjs to clean up, then retry.',
  );
  process.exit(1);
}

const pkgRaw = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(pkgRaw);
if (!pkg.dependencies?.['@seeflow/canvas']) {
  console.error(
    "prepack-publish: expected @seeflow/canvas in dependencies — manifest doesn't match the assumption this script was written for.",
  );
  process.exit(1);
}
writeFileSync(pkgBackup, pkgRaw);
const { '@seeflow/canvas': _stripped, ...remainingDeps } = pkg.dependencies;
pkg.dependencies = remainingDeps;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, '\t')}\n`);

const schemaRaw = readFileSync(schemaPath, 'utf8');
const SOURCE_IMPORT = "from '@seeflow/canvas/catalog'";
const VENDORED_IMPORT = "from './vendored-canvas-catalog.ts'";
if (!schemaRaw.includes(SOURCE_IMPORT)) {
  writeFileSync(pkgPath, pkgRaw);
  console.error(
    `prepack-publish: could not find ${SOURCE_IMPORT} in src/schema.ts — restore + abort.`,
  );
  process.exit(1);
}
writeFileSync(schemaBackup, schemaRaw);
writeFileSync(schemaPath, schemaRaw.replace(SOURCE_IMPORT, VENDORED_IMPORT));

copyFileSync(canvasCatalogSrc, vendoredCatalog);

console.error('prepack-publish: vendored canvas catalog + stripped @seeflow/canvas from manifest.');
