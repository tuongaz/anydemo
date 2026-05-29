import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { extractZipToDir } from './extract-zip.ts';
import { readIndex, upsertPack, writeIndex } from './index-store.ts';
import type { InstallEvent, InstallOptions } from './installer-types.ts';
import { withVendorLock } from './lock.ts';
import type { IconVendor } from './paths.ts';
import { vendorDescriptor } from './vendors.ts';

export interface InstallerDeps {
  cacheRoot: string;
  now: () => number;
  version: () => string;
  fetcher: (url: string) => Promise<Buffer>;
}

export async function* installIconPack(
  args: { vendor: IconVendor } & InstallOptions,
  deps: InstallerDeps,
): AsyncGenerator<InstallEvent> {
  const desc = vendorDescriptor(args.vendor);
  if (desc.requiresAcceptance && !args.acceptTerms) {
    yield { type: 'terms-required', vendor: args.vendor, licenseUrl: desc.licenseUrl };
    return;
  }

  const events: InstallEvent[] = [];
  const lockPath = join(deps.cacheRoot, '.locks', `${args.vendor}.lock`);
  await withVendorLock(lockPath, async () => {
    try {
      events.push({ type: 'download-started', vendor: args.vendor, expectedBytes: null });
      const buffer = await deps.fetcher(args.packUrl ?? desc.defaultPackUrl);

      events.push({ type: 'extracting', vendor: args.vendor });
      const version = deps.version();
      const destDir = join(deps.cacheRoot, args.vendor, version);
      rmSync(destDir, { recursive: true, force: true });
      mkdirSync(destDir, { recursive: true });
      const writtenFilenames = await extractZipToDir(buffer, destDir);

      const icons: Record<string, string> = {};
      for (const filename of writtenFilenames) {
        const canonical = desc.canonicalName(filename);
        if (!canonical) continue;
        icons[canonical] = `${args.vendor}/${version}/${filename}`;
      }
      events.push({ type: 'indexing', vendor: args.vendor, iconCount: Object.keys(icons).length });

      const sizeBytes = Object.values(icons).length;
      const idx = readIndex(deps.cacheRoot);
      const next = upsertPack(idx, {
        vendor: args.vendor,
        version,
        installedAt: deps.now(),
        sizeBytes,
        icons,
      });
      writeIndex(deps.cacheRoot, next);

      events.push({
        type: 'done',
        vendor: args.vendor,
        version,
        iconCount: Object.keys(icons).length,
      });
    } catch (err) {
      events.push({
        type: 'error',
        vendor: args.vendor,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  for (const ev of events) yield ev;
}
