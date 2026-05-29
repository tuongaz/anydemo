import { join } from 'node:path';
import { seeflowHome } from '../paths.ts';

export type IconVendor = 'aws' | 'gcp' | 'azure';

export const iconCacheRoot = (): string => join(seeflowHome(), 'icons');

export const iconVendorRoot = (vendor: IconVendor, version: string): string =>
  join(iconCacheRoot(), vendor, version);

export const iconLockPath = (vendor: IconVendor): string =>
  join(iconCacheRoot(), '.locks', `${vendor}.lock`);

export const iconIndexPath = (): string => join(iconCacheRoot(), 'index.json');
