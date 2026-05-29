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
});
