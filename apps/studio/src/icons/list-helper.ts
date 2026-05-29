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
    }
  | { vendor: IconVendor; installed: false };

export function summarizePacks(idx: IconIndex): PackSummary[] {
  return ALL.map((vendor) => {
    const p = idx.packs[vendor];
    if (!p) return { vendor, installed: false };
    return {
      vendor,
      installed: true,
      version: p.version,
      iconCount: Object.keys(p.icons).length,
      sizeBytes: p.sizeBytes,
    };
  });
}
