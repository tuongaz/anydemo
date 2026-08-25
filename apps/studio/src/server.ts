import { existsSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { createApi } from './api.ts';
import { createCorsMiddleware } from './cors.ts';
import { type EventBus, createEventBus } from './events.ts';
import { type JobRegistry, createJobRegistry } from './icons/jobs.ts';
import type { IconFetcher } from './icons/router.ts';
import { createMcpServer } from './mcp.ts';
import { seeflowHome } from './paths.ts';
import { type RegistryWatcher, createRegistryWatcher } from './registry-watcher.ts';
import { type Registry, createRegistry, manifestOnlyEntryFilter } from './registry.ts';
import type { Spawner } from './shellout.ts';
import { type FlowWatcher, createWatcher } from './watcher.ts';

/** Absolute path to the vendored runtime asset directory. Resolved relative
 *  to this source file so the path is stable whether the studio runs from
 *  `apps/studio/` in dev or from `node_modules/@tuongaz/seeflow/` when the
 *  package is installed as a dependency. */
export const RUNTIME_ASSETS_DIR = resolvePath(import.meta.dir, '../public/runtime');

export type AppMode = 'dev' | 'prod';

export interface CreateAppOptions {
  mode?: AppMode;
  /** Where the Vite dev server is reachable in dev mode. */
  viteDevUrl?: string;
  /** Filesystem root for the built web bundle in prod mode. */
  staticRoot?: string;
  /** Inject a registry; defaults to one persisted at ~/.seeflow/registry.json. */
  registry?: Registry;
  /** Inject an event bus; defaults to a fresh in-memory bus. */
  events?: EventBus;
  /** Inject a watcher; defaults to one wired to the registry + event bus. */
  watcher?: FlowWatcher;
  /** Inject a registry-watcher; defaults to one wired to the registry + event bus. */
  registryWatcher?: RegistryWatcher;
  /** Skip starting fs.watch on registered flows. Useful for tests. */
  watchAllOnBoot?: boolean;
  /** Disable file watching entirely (no fs handles leaked). Useful for tests. */
  disableWatcher?: boolean;
  /** Inject a shellout spawner; tests use this to avoid launching $EDITOR/Finder. */
  spawner?: Spawner;
  /** Override the host platform for tests covering darwin/win32/linux branches. */
  platform?: NodeJS.Platform;
  /** Per-process token gating `Origin: null` requests (sandboxed MCP App
   *  iframe). Generated at studio boot; delivered to the iframe via
   *  `widgetState.backendToken`. Undefined disables the null-origin path —
   *  null-origin requests are then always rejected. */
  token?: string;
  /** Reachable loopback URL of this Hono server, e.g.
   *  `http://127.0.0.1:54321`. Forwarded to canvas-bearing MCP tool
   *  handlers (via `createMcpServer`) so they can attach it to the
   *  iframe's widgetState as `backendUrl`. Read by closure inside
   *  `app.all('/mcp', ...)` so callers can mutate the options after
   *  `Bun.serve` binds — useful for the ephemeral-port boot in
   *  `mcp-shim.ts` where the URL isn't known until the server is up. */
  httpUrl?: string;
  /** Shared icon-install job registry. Defaults to a per-app registry created
   *  in createApp so SSE replays survive across requests within the same
   *  studio process. Integration tests inject their own to assert state. */
  iconJobs?: JobRegistry;
  /** Override the icon-cache root. Production resolves it from `seeflowHome()`
   *  inside the router; tests pass an isolated tmpdir. */
  iconCacheRoot?: string;
  /** Override the icon installer's fetcher. Production uses fetchWithProgress
   *  (real network); integration tests inject a fixture-returning closure. */
  iconFetcher?: IconFetcher;
}

const DEFAULT_VITE_DEV_URL = 'http://localhost:5173';
const DEFAULT_STATIC_ROOT = resolvePath(import.meta.dir, '../dist/web');

const inferMode = (): AppMode => {
  if (process.env.NODE_ENV === 'production') return 'prod';
  if (process.env.NODE_ENV === 'development') return 'dev';
  // No NODE_ENV: use prod if the built web bundle exists, dev otherwise.
  const distIndex = resolvePath(import.meta.dir, '../dist/web/index.html');
  return existsSync(distIndex) ? 'prod' : 'dev';
};

export function createApp(options: CreateAppOptions = {}): Hono {
  const mode = options.mode ?? inferMode();
  const viteDevUrl = options.viteDevUrl ?? DEFAULT_VITE_DEV_URL;
  const staticRoot = options.staticRoot ?? DEFAULT_STATIC_ROOT;
  const registry = options.registry ?? createRegistry({ isLoadableEntry: manifestOnlyEntryFilter });
  const events = options.events ?? createEventBus();
  const watcher = options.disableWatcher
    ? undefined
    : (options.watcher ?? createWatcher({ registry, events }));
  const registryWatcher = options.disableWatcher
    ? undefined
    : (options.registryWatcher ?? createRegistryWatcher({ registry, events }));
  const iconJobs = options.iconJobs ?? createJobRegistry();

  if (watcher && (options.watchAllOnBoot ?? true)) {
    watcher.watchAll();
  }
  if (registryWatcher && (options.watchAllOnBoot ?? true)) {
    registryWatcher.start();
  }

  const app = new Hono();

  // CORS + token gate runs first so every downstream route inherits the
  // null-origin rule. No-ops on requests without an Origin header (CLI
  // calls, integration tests, top-level navigation).
  app.use('*', createCorsMiddleware(options.token));

  app.get('/health', (c) => c.json({ ok: true }));

  // `/healthz` is the readiness probe used by the Docker entrypoint and any
  // external orchestrator (Kubernetes-style). Kept separate from `/health`
  // (legacy `{ ok: true }` shape) so existing CLI / smoke-test consumers
  // don't churn. Route is unauthenticated and stateless.
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  // Vendored runtime assets (e.g. @tailwindcss/browser@4 for type:'html').
  // Served identically in dev and prod so they don't depend on the web
  // bundle. The `{[A-Za-z0-9._-]+}` regex constrains :file to a single safe
  // segment, making traversal (`..`, `/`) impossible by construction.
  //
  // Cache policy:
  //   prod → year-long immutable (filename is stable, content swap requires
  //          a redeploy → fingerprinting would just churn the URL)
  //   dev  → no-store so a vendored swap (`bun run vendor:tailwind-runtime`)
  //          is picked up on next reload without a hard-reload dance
  const runtimeCacheControl = mode === 'prod' ? 'public, max-age=31536000, immutable' : 'no-store';
  app.get('/runtime/:file{[A-Za-z0-9._-]+}', async (c) => {
    const file = c.req.param('file');
    const abs = resolvePath(RUNTIME_ASSETS_DIR, file);
    const f = Bun.file(abs);
    if (!(await f.exists())) return c.notFound();
    return new Response(f.stream(), {
      headers: {
        'content-type': f.type || 'application/octet-stream',
        'cache-control': runtimeCacheControl,
      },
    });
  });

  app.route(
    '/api',
    createApi({
      registry,
      events,
      watcher,
      spawner: options.spawner,
      platform: options.platform,
      iconJobs,
      iconCacheRoot: options.iconCacheRoot,
      iconFetcher: options.iconFetcher,
    }),
  );

  // Per-request stateless MCP transport: every /mcp call builds a fresh
  // Server + Streamable HTTP transport pair. The transport's stateless mode
  // forbids reuse across requests (it would collide JSON-RPC ids between
  // clients), and a per-request server is cheap since registry/watcher are
  // injected references. `enableJsonResponse: true` keeps responses as plain
  // JSON instead of SSE — simpler for non-streaming clients and what the
  // stdio shim forwards from the MCP Client.
  app.all('/mcp', async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const mcpServer = createMcpServer({
      registry,
      watcher,
      token: options.token,
      httpUrl: options.httpUrl,
    });
    await mcpServer.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await mcpServer.close().catch(() => undefined);
    }
  });

  if (mode === 'dev') {
    app.all('*', async (c) => {
      const url = new URL(c.req.url);
      if (url.pathname.startsWith('/api/') || url.pathname === '/mcp') return c.notFound();

      const target = `${viteDevUrl}${url.pathname}${url.search}`;
      try {
        const upstream = await fetch(target, {
          method: c.req.method,
          headers: c.req.raw.headers,
          body: c.req.method === 'GET' || c.req.method === 'HEAD' ? undefined : c.req.raw.body,
          redirect: 'manual',
        });
        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: upstream.headers,
        });
      } catch (_err) {
        return c.text(
          `SeeFlow dev proxy could not reach Vite at ${viteDevUrl}.\nMake sure \`bun run dev\` is running so Vite is up.\n`,
          502,
        );
      }
    });
  } else {
    app.use('/*', serveStatic({ root: staticRoot }));
    app.get('*', serveStatic({ root: staticRoot, path: 'index.html' }));
  }

  return app;
}

export interface ServeOptions extends CreateAppOptions {
  port?: number;
  /** Bind address. Defaults to loopback — see DEFAULT_CONFIG in runtime.ts. */
  hostname?: string;
}

export function serve(options: ServeOptions = {}) {
  const port = options.port ?? 4321;
  const hostname = options.hostname ?? '127.0.0.1';
  mkdirSync(seeflowHome(), { recursive: true });
  const app = createApp(options);
  // Bun's default per-connection idle timeout (~10s) reaps long-lived SSE
  // streams between heartbeats, forcing the browser's EventSource to reconnect
  // (each reconnect re-fires `hello` → a client refetch). Raise it well above
  // the SSE heartbeat cadence so the keep-alive lands first and the stream
  // stays warm. Max accepted by Bun is 255s.
  return Bun.serve({ port, hostname, idleTimeout: 120, fetch: app.fetch });
}

if (import.meta.main) {
  const registry = createRegistry({ isLoadableEntry: manifestOnlyEntryFilter });
  const events = createEventBus();
  const server = serve({ registry, events });
  console.log(`SeeFlow Studio listening on http://${server.hostname}:${server.port}`);
}
