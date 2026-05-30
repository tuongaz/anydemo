import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { extractZipToDir } from './extract-zip.ts';

describe('extractZipToDir', () => {
  let dest: string;
  beforeEach(() => {
    dest = mkdtempSync(join(tmpdir(), 'sf-extract-'));
  });
  afterEach(() => rmSync(dest, { recursive: true, force: true }));

  it('extracts every .svg from a ZIP, ignoring other entries', async () => {
    const zip = zipSync({
      'Arch_AWS-Lambda_64.svg': strToU8('<svg>lambda</svg>'),
      'README.txt': strToU8('skip me'),
      'subdir/Arch_Amazon-S3_64.svg': strToU8('<svg>s3</svg>'),
    });
    const written = await extractZipToDir(Buffer.from(zip), dest);
    expect(written.sort()).toEqual(['Arch_AWS-Lambda_64.svg', 'Arch_Amazon-S3_64.svg'].sort());
    expect(readFileSync(join(dest, 'Arch_AWS-Lambda_64.svg'), 'utf8')).toBe('<svg>lambda</svg>');
  });

  it('rejects paths that escape the dest dir', async () => {
    const zip = zipSync({ '../escape.svg': strToU8('<svg/>') });
    await expect(extractZipToDir(Buffer.from(zip), dest)).rejects.toThrow(/escape/);
  });

  // The real AWS zip ships macOS AppleDouble metadata that looks like SVGs to
  // a naive extension check; the extractor must drop them so they don't end
  // up in the on-disk pack OR the index as arch-amazon-* duplicates.
  it('skips macOS AppleDouble metadata (__MACOSX/ + ._-prefixed files)', async () => {
    const zip = zipSync({
      'Arch_Amazon-API-Gateway_64.svg': strToU8('<svg>api</svg>'),
      '._Arch_Amazon-API-Gateway_64.svg': strToU8('\x00binary'),
      '__MACOSX/._Arch_Amazon-API-Gateway_64.svg': strToU8('\x00binary'),
    });
    const written = await extractZipToDir(Buffer.from(zip), dest);
    expect(written).toEqual(['Arch_Amazon-API-Gateway_64.svg']);
  });
});
