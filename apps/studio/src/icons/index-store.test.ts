import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type IconIndex, readIndex, upsertPack, writeIndex } from './index-store.ts';

let cacheRoot: string;
beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'sf-icons-'));
});
afterEach(() => rmSync(cacheRoot, { recursive: true, force: true }));

describe('readIndex', () => {
  it('returns an empty index when the file is missing', () => {
    const idx = readIndex(cacheRoot);
    expect(idx).toEqual({ version: 1, packs: {} });
  });
});

describe('writeIndex / upsertPack', () => {
  it('round-trips an installed pack', () => {
    const idx: IconIndex = { version: 1, packs: {} };
    const next = upsertPack(idx, {
      vendor: 'aws',
      version: '2026-05-30',
      installedAt: 1000,
      sizeBytes: 12345,
      icons: { lambda: 'aws/2026-05-30/lambda.svg' },
    });
    writeIndex(cacheRoot, next);
    expect(readIndex(cacheRoot)).toEqual(next);
  });

  it('replaces an existing vendor entry on re-install', () => {
    const first: IconIndex = {
      version: 1,
      packs: { aws: { vendor: 'aws', version: '1', installedAt: 1, sizeBytes: 1, icons: {} } },
    };
    writeIndex(cacheRoot, first);
    const next = upsertPack(first, {
      vendor: 'aws',
      version: '2',
      installedAt: 2,
      sizeBytes: 2,
      icons: { lambda: 'aws/2/lambda.svg' },
    });
    expect(next.packs.aws?.version).toBe('2');
  });
});
