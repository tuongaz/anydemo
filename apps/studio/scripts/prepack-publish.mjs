#!/usr/bin/env bun
// Prepares apps/studio for `npm pack` / `npm publish`.
//
// Why: the published manifest declares `@seeflow/canvas: workspace:*`, which
// npm cannot resolve (EUNSUPPORTEDPROTOCOL). At runtime only
// `apps/studio/src/schema.ts` imports from `@seeflow/canvas/catalog`, so we
// vendor that one file in and rewrite the import.
//
// postpack-publish.mjs restores `src/schema.ts` and removes the vendored file
// but DOES NOT restore `package.json` — npm reads the manifest from disk to
// build the registry metadata AFTER postpack runs, so restoring there would
// re-introduce the broken `workspace:*` dep into what `npm install` sees.
// CI checkouts are ephemeral; for local pack runs, restore via
// `git checkout apps/studio/package.json`.

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const studioRoot = join(here, '..');
const repoRoot = join(studioRoot, '..', '..');

const pkgPath = join(studioRoot, 'package.json');
const schemaPath = join(studioRoot, 'src', 'schema.ts');
// Backup lives OUTSIDE src/ so npm pack (which globs src/) doesn't ship it.
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

const schemaRaw = readFileSync(schemaPath, 'utf8');
const SOURCE_IMPORT = "from '@seeflow/canvas/catalog'";
const VENDORED_IMPORT = "from './vendored-canvas-catalog.ts'";
if (!schemaRaw.includes(SOURCE_IMPORT)) {
  console.error(`prepack-publish: could not find ${SOURCE_IMPORT} in src/schema.ts — aborting.`);
  process.exit(1);
}
writeFileSync(schemaBackup, schemaRaw);
writeFileSync(schemaPath, schemaRaw.replace(SOURCE_IMPORT, VENDORED_IMPORT));

copyFileSync(canvasCatalogSrc, vendoredCatalog);

console.error('prepack-publish: vendored canvas catalog + stripped @seeflow/canvas from manifest.');
