import type { IconIndex } from './index-store.ts';
import type { IconVendor } from './paths.ts';

const ALL: IconVendor[] = ['aws', 'gcp', 'azure'];

export type PackSummary =
  | {
      vendor: IconVendor;
      installed: true;
      version: string;
      iconCount: number;
      sizeBytes: number;
      /**
       * Canonical icon names (kebab-case) installed in this pack, sorted
       * alphabetically. Mirrors the canvas-side PackSummary so apps/web can
       * pass the wire JSON straight through to the picker's vendor grids.
       */
      iconNames: string[];
    }
  | { vendor: IconVendor; installed: false };

export function summarizePacks(idx: IconIndex): PackSummary[] {
  return ALL.map((vendor) => {
    const p = idx.packs[vendor];
    if (!p) return { vendor, installed: false };
    const names = Object.keys(p.icons).sort();
    return {
      vendor,
      installed: true,
      version: p.version,
      iconCount: names.length,
      sizeBytes: p.sizeBytes,
      iconNames: names,
    };
  });
}
