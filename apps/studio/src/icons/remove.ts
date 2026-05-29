import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readIndex, removePack, writeIndex } from './index-store.ts';
import type { IconVendor } from './paths.ts';

export interface RemoveIconPackDeps {
  cacheRoot: string;
}

export function removeIconPack(vendor: IconVendor, deps: RemoveIconPackDeps): void {
  rmSync(join(deps.cacheRoot, vendor), { recursive: true, force: true });
  const idx = readIndex(deps.cacheRoot);
  if (!idx.packs[vendor]) return;
  mkdirSync(deps.cacheRoot, { recursive: true });
  writeIndex(deps.cacheRoot, removePack(idx, vendor));
}
