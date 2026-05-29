import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from '../atomic-write.ts';
import type { IconVendor } from './paths.ts';

export interface InstalledPack {
  vendor: IconVendor;
  version: string;
  installedAt: number;
  sizeBytes: number;
  /** Map of canonical icon name → cache-root-relative SVG path. */
  icons: Record<string, string>;
}

export interface IconIndex {
  version: 1;
  packs: Partial<Record<IconVendor, InstalledPack>>;
}

const EMPTY: IconIndex = { version: 1, packs: {} };

export function readIndex(cacheRoot: string): IconIndex {
  const file = join(cacheRoot, 'index.json');
  if (!existsSync(file)) return { ...EMPTY };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as IconIndex;
    if (parsed?.version !== 1 || typeof parsed.packs !== 'object') return { ...EMPTY };
    return parsed;
  } catch {
    return { ...EMPTY };
  }
}

export function writeIndex(cacheRoot: string, idx: IconIndex): void {
  writeFileAtomic(join(cacheRoot, 'index.json'), JSON.stringify(idx, null, 2));
}

export function upsertPack(idx: IconIndex, pack: InstalledPack): IconIndex {
  return { version: 1, packs: { ...idx.packs, [pack.vendor]: pack } };
}

export function removePack(idx: IconIndex, vendor: IconVendor): IconIndex {
  const { [vendor]: _omit, ...rest } = idx.packs;
  return { version: 1, packs: rest };
}
