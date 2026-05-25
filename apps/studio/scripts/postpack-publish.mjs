#!/usr/bin/env bun
// Restores apps/studio after `npm pack` / `npm publish`.
// Pair to scripts/prepack-publish.mjs — idempotent.

import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const studioRoot = join(here, '..');

const pkgPath = join(studioRoot, 'package.json');
const pkgBackup = `${pkgPath}.publish-backup`;
const schemaPath = join(studioRoot, 'src', 'schema.ts');
const schemaBackup = join(studioRoot, 'schema.ts.publish-backup');
const vendoredCatalog = join(studioRoot, 'src', 'vendored-canvas-catalog.ts');

if (existsSync(pkgBackup)) renameSync(pkgBackup, pkgPath);
if (existsSync(schemaBackup)) renameSync(schemaBackup, schemaPath);
if (existsSync(vendoredCatalog)) unlinkSync(vendoredCatalog);

console.error('postpack-publish: restored manifest + schema.ts; removed vendored catalog.');
