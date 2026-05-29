import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { readIndex } from './index-store.ts';
import type { InstallEvent } from './installer-types.ts';
import { installIconPack } from './installer.ts';

let cache: string;
beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'sf-installer-'));
});
afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
});

function makeAwsZipBuffer(): Buffer {
  const zip = zipSync({
    'Arch_AWS-Lambda_64.svg': strToU8('<svg>lambda</svg>'),
    'Arch_Amazon-S3_64.svg': strToU8('<svg>s3</svg>'),
  });
  return Buffer.from(zip);
}

describe('installIconPack', () => {
  it('emits the full event sequence and writes the index', async () => {
    const events: InstallEvent[] = [];
    for await (const ev of installIconPack(
      { vendor: 'aws', acceptTerms: true },
      {
        cacheRoot: cache,
        now: () => 1000,
        version: () => '2026-05-30',
        fetcher: async () => makeAwsZipBuffer(),
      },
    )) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toEqual([
      'download-started',
      'extracting',
      'indexing',
      'done',
    ]);
    const idx = readIndex(cache);
    expect(idx.packs.aws?.icons).toEqual({
      lambda: 'aws/2026-05-30/Arch_AWS-Lambda_64.svg',
      s3: 'aws/2026-05-30/Arch_Amazon-S3_64.svg',
    });
    expect(existsSync(join(cache, 'aws', '2026-05-30', 'Arch_AWS-Lambda_64.svg'))).toBe(true);
    expect(readFileSync(join(cache, 'aws', '2026-05-30', 'Arch_Amazon-S3_64.svg'), 'utf8')).toBe(
      '<svg>s3</svg>',
    );
  });

  it('emits an error event when the fetcher throws', async () => {
    const events: InstallEvent[] = [];
    for await (const ev of installIconPack(
      { vendor: 'aws' },
      {
        cacheRoot: cache,
        now: () => 1,
        version: () => '1',
        fetcher: async () => {
          throw new Error('network down');
        },
      },
    )) {
      events.push(ev);
    }
    expect(events.at(-1)?.type).toBe('error');
  });
});
