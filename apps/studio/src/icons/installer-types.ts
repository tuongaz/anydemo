import type { IconVendor } from './paths.ts';

export type InstallEvent =
  | { type: 'terms-required'; vendor: IconVendor; licenseUrl: string }
  | { type: 'download-started'; vendor: IconVendor; expectedBytes: number | null }
  | { type: 'download-progress'; vendor: IconVendor; receivedBytes: number }
  | { type: 'extracting'; vendor: IconVendor }
  | { type: 'indexing'; vendor: IconVendor; iconCount: number }
  | { type: 'done'; vendor: IconVendor; version: string; iconCount: number }
  | { type: 'error'; vendor: IconVendor; message: string };

export interface InstallOptions {
  acceptTerms?: boolean;
  /** Optional URL override for tests; production picks the vendor default. */
  packUrl?: string;
}
