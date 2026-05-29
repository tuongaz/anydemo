import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { seeflowHome } from '../paths.ts';
import { iconCacheRoot, iconIndexPath, iconLockPath, iconVendorRoot } from './paths.ts';

describe('icon paths', () => {
  it('roots the cache at ~/.seeflow/icons', () => {
    expect(iconCacheRoot()).toBe(join(seeflowHome(), 'icons'));
  });

  it('namespaces the vendor directory and the version tag', () => {
    expect(iconVendorRoot('aws', '2026-05-30')).toBe(
      join(seeflowHome(), 'icons', 'aws', '2026-05-30'),
    );
  });

  it('keeps locks separate from data', () => {
    expect(iconLockPath('aws')).toBe(join(seeflowHome(), 'icons', '.locks', 'aws.lock'));
  });

  it('places the index at the cache root', () => {
    expect(iconIndexPath()).toBe(join(seeflowHome(), 'icons', 'index.json'));
  });
});
