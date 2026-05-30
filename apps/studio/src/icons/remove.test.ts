import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readIndex, upsertPack, writeIndex } from './index-store.ts';
import { removeIconPack } from './remove.ts';

let cache: string;
beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'sf-remove-'));
});
afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
});

describe('removeIconPack', () => {
  it('rms the vendor directory and clears the pack from the index', () => {
    const vendorDir = join(cache, 'aws', '2026-05-30');
    mkdirSync(vendorDir, { recursive: true });
    writeFileSync(join(vendorDir, 'Arch_AWS-Lambda_64.svg'), '<svg>lambda</svg>', 'utf8');

    const idx = upsertPack(readIndex(cache), {
      vendor: 'aws',
      version: '2026-05-30',
      installedAt: 1000,
      sizeBytes: 1,
      icons: { lambda: 'aws/2026-05-30/Arch_AWS-Lambda_64.svg' },
    });
    writeIndex(cache, idx);

    removeIconPack('aws', { cacheRoot: cache });

    expect(existsSync(join(cache, 'aws'))).toBe(false);
    expect(readIndex(cache).packs.aws).toBeUndefined();
  });

  it('is idempotent — removing an uninstalled vendor is a no-op success', () => {
    expect(() => removeIconPack('azure', { cacheRoot: cache })).not.toThrow();
    expect(readIndex(cache).packs.azure).toBeUndefined();
  });
});
