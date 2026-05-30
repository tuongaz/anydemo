import { join } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { fetchWithProgress } from './fetcher.ts';
import { readIndex } from './index-store.ts';
import type { InstallEvent } from './installer-types.ts';
import { type InstallerDeps, installIconPack as defaultInstallIconPack } from './installer.ts';
import type { JobRegistry } from './jobs.ts';
import { summarizePacks } from './list-helper.ts';
import { iconCacheRoot } from './paths.ts';
import { removeIconPack } from './remove.ts';
import { vendorDescriptor } from './vendors.ts';

export type IconFetcher = (url: string) => Promise<Buffer>;
export type IconInstaller = typeof defaultInstallIconPack;

export interface IconsRouterDeps {
  jobs: JobRegistry;
  /** Defaults to seeflowHome()/icons. Tests inject a tmpdir. */
  cacheRoot?: string;
  /** Defaults to fetchWithProgress (real network). Tests inject a fixture. */
  fetcher?: IconFetcher;
  /** Defaults to installIconPack. Tests can swap. */
  installer?: IconInstaller;
}

const VendorSchema = z.enum(['aws', 'azure']);
const InstallBodySchema = z.object({
  vendor: VendorSchema,
  acceptTerms: z.boolean().optional(),
  packUrl: z.string().optional(),
});

export function createIconsRouter(deps: IconsRouterDeps): Hono {
  const app = new Hono();
  const installer = deps.installer ?? defaultInstallIconPack;
  const getCacheRoot = () => deps.cacheRoot ?? iconCacheRoot();
  const getFetcher = (): IconFetcher => deps.fetcher ?? ((url) => fetchWithProgress(url));

  app.get('/packs', (c) => {
    const idx = readIndex(getCacheRoot());
    return c.json({ packs: summarizePacks(idx) });
  });

  app.get('/licenses/:vendor', (c) => {
    const parsed = VendorSchema.safeParse(c.req.param('vendor'));
    if (!parsed.success) return c.json({ error: 'unknown vendor' }, 404);
    const desc = vendorDescriptor(parsed.data);
    return c.json({
      vendor: desc.vendor,
      label: desc.label,
      summary: desc.licenseSummary,
      url: desc.licenseUrl,
      requiresAcceptance: desc.requiresAcceptance,
    });
  });

  // Constrain `:filename` to `<name>.svg` so this route doesn't shadow
  // /licenses/:vendor, /packs/:vendor, or /jobs/:id at the two-segment level.
  app.get('/:vendor/:filename{[^/]+\\.svg}', async (c) => {
    const vendorParsed = VendorSchema.safeParse(c.req.param('vendor'));
    if (!vendorParsed.success) return c.json({ error: 'unknown vendor' }, 404);
    const vendor = vendorParsed.data;
    const filename = c.req.param('filename');
    const name = filename.slice(0, -4);

    const idx = readIndex(getCacheRoot());
    const pack = idx.packs[vendor];
    const hint = `POST /api/icons/install { "vendor": "${vendor}" }`;
    if (!pack) {
      return c.json({ error: `vendor ${vendor} is not installed`, install: hint }, 404);
    }
    const rel = pack.icons[name];
    if (!rel) {
      return c.json({ error: `icon ${vendor}:${name} not found`, install: hint }, 404);
    }
    const abs = join(getCacheRoot(), rel);
    const file = Bun.file(abs);
    if (!(await file.exists())) {
      return c.json({ error: `icon file missing on disk: ${rel}` }, 404);
    }
    return new Response(file.stream(), {
      headers: {
        'content-type': 'image/svg+xml',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  });

  app.post('/install', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = InstallBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid install body', issues: parsed.error.issues }, 400);
    }
    const { vendor, acceptTerms, packUrl } = parsed.data;

    const existing = deps.jobs.inFlightFor(vendor);
    if (existing !== undefined) {
      return c.json({ error: `install for ${vendor} already in flight`, jobId: existing }, 409);
    }

    let jobId: string;
    try {
      jobId = deps.jobs.create(vendor);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 409);
    }

    const installerDeps: InstallerDeps = {
      cacheRoot: getCacheRoot(),
      now: Date.now,
      version: () => new Date().toISOString().slice(0, 10),
      fetcher: getFetcher(),
    };

    // Fire-and-forget: pump installer events into the job registry. The SSE
    // route below replays buffered events on subscribe and races live ones, so
    // the response can return jobId immediately and the client can subscribe
    // whenever it likes.
    (async () => {
      try {
        for await (const ev of installer({ vendor, acceptTerms, packUrl }, installerDeps)) {
          deps.jobs.append(jobId, ev);
        }
      } catch (err) {
        deps.jobs.append(jobId, {
          type: 'error',
          vendor,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        deps.jobs.markComplete(jobId);
      }
    })();

    return c.json({ jobId });
  });

  app.get('/jobs/:id/events', (c) => {
    const id = c.req.param('id');
    return streamSSE(c, async (stream) => {
      let active = true;
      let ended = false;
      const queue: InstallEvent[] = [];
      let resume: (() => void) | null = null;

      const wake = () => {
        if (resume) {
          const r = resume;
          resume = null;
          r();
        }
      };

      const unsubscribe = deps.jobs.subscribe(
        id,
        (ev) => {
          queue.push(ev);
          wake();
        },
        () => {
          ended = true;
          wake();
        },
      );

      stream.onAbort(() => {
        active = false;
        unsubscribe();
        wake();
      });

      try {
        while (active) {
          while (queue.length > 0) {
            const next = queue.shift();
            if (!next) break;
            await stream.writeSSE({ data: JSON.stringify(next) });
          }
          if (ended || !active) break;
          await new Promise<void>((r) => {
            resume = r;
          });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.delete('/packs/:vendor', (c) => {
    const parsed = VendorSchema.safeParse(c.req.param('vendor'));
    if (!parsed.success) return c.json({ error: 'unknown vendor' }, 404);
    removeIconPack(parsed.data, { cacheRoot: getCacheRoot() });
    return c.json({ removed: parsed.data });
  });

  return app;
}
