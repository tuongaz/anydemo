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
// after the run; the backup file is also left in place for inspection.

import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const studioRoot = join(here, '..');

const schemaPath = join(studioRoot, 'src', 'schema.ts');
const schemaBackup = join(studioRoot, 'schema.ts.publish-backup');
const vendoredCatalog = join(studioRoot, 'src', 'vendored-canvas-catalog.ts');

if (existsSync(schemaBackup)) renameSync(schemaBackup, schemaPath);
if (existsSync(vendoredCatalog)) unlinkSync(vendoredCatalog);

console.error(
  'postpack-publish: restored schema.ts; removed vendored catalog. NOTE: package.json left in stripped state so the publish manifest matches the tarball.',
);
