import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { unzipSync } from 'fflate';

export async function extractZipToDir(buffer: Buffer, destDir: string): Promise<string[]> {
  const entries = unzipSync(new Uint8Array(buffer));
  const written: string[] = [];
  const root = normalize(destDir) + sep;
  for (const [entryPath, data] of Object.entries(entries)) {
    if (!entryPath.toLowerCase().endsWith('.svg')) continue;
    const segments = entryPath.split(/[\\/]/);
    if (segments.some((s) => s === '..')) {
      throw new Error(`Zip entry escapes destination: ${entryPath}`);
    }
    // Skip macOS AppleDouble metadata. The AWS zip ships these alongside the
    // real SVGs (in __MACOSX/ and as ._-prefixed siblings); they have an .svg
    // extension but the contents are binary, which renders as broken icons
    // and pollutes the index with arch-amazon-* duplicate entries.
    if (segments.includes('__MACOSX')) continue;
    const flatName = segments.pop();
    if (!flatName || flatName.startsWith('._')) continue;
    const target = normalize(join(destDir, flatName));
    if (!target.startsWith(root)) {
      throw new Error(`Zip entry escapes destination: ${entryPath}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    written.push(flatName);
  }
  return written;
}
