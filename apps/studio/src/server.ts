import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { type ProxyFacade, createApi } from './api.ts';
import { createDemoRouter } from './demo.ts';
import { type EventBus, createEventBus } from './events.ts';
import { createMcpServer } from './mcp.ts';
import { type ProcessSpawner, defaultProcessSpawner } from './process-spawner.ts';
import { type Registry, createRegistry } from './registry.ts';
import type { Spawner } from './shellout.ts';
import { type StatusRunner, createStatusRunner } from './status-runner.ts';
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
  /** Skip starting fs.watch on registered demos. Useful for tests. */
  watchAllOnBoot?: boolean;
  /** Disable file watching entirely (no fs handles leaked). Useful for tests. */
  disableWatcher?: boolean;
  /** Inject a shellout spawner; tests use this to avoid launching $EDITOR/Finder. */
  spawner?: Spawner;
  /** Override the host platform for tests covering darwin/win32/linux branches. */
  platform?: NodeJS.Platform;
  /** Inject a StatusRunner; defaults to one wired to the registry + event bus. */
  statusRunner?: StatusRunner;
  /** Inject a ProcessSpawner for the play-action script; defaults to letting
   *  proxy.ts pick `defaultProcessSpawner`. Tests use this to drive runPlay
   *  with an in-memory fake spawner. */
  processSpawner?: ProcessSpawner;
  /** Inject a ProxyFacade — tests use this to short-circuit runPlay /
   *  runReset / stopAllPlays and assert call order. */
  proxy?: ProxyFacade;
  /** Override base directory for new projects. Defaults to ~/.seeflow. Tests inject a tmp dir. */
  projectBaseDir?: string;
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
  const registry = options.registry ?? createRegistry();
  const events = options.events ?? createEventBus();
  const watcher = options.disableWatcher
    ? undefined
    : (options.watcher ?? createWatcher({ registry, events }));
  const statusRunner =
    options.statusRunner ??
    createStatusRunner({ registry, events, spawner: defaultProcessSpawner });

  if (watcher && (options.watchAllOnBoot ?? true)) {
    watcher.watchAll();
  }

  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  // `/healthz` is the readiness probe used by the Docker entrypoint and any
  // external orchestrator (Kubernetes-style). Kept separate from `/health`
  // (legacy `{ ok: true }` shape) so existing CLI / smoke-test consumers
  // don't churn. Route is unauthenticated and stateless.
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  // Vendored runtime assets (e.g. Tailwind Play CDN for htmlNode). Served
  // identically in dev and prod so they don't depend on the web bundle.
  // The `{[A-Za-z0-9._-]+}` regex constrains :file to a single safe segment,
  // making traversal (`..`, `/`) impossible by construction.
  app.get('/runtime/:file{[A-Za-z0-9._-]+}', async (c) => {
    const file = c.req.param('file');
    const abs = resolvePath(RUNTIME_ASSETS_DIR, file);
    const f = Bun.file(abs);
    if (!(await f.exists())) return c.notFound();
    return new Response(f.stream(), {
      headers: {
        'content-type': f.type || 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  });

  app.route('/demo', createDemoRouter(events));

  app.route(
    '/api',
    createApi({
      registry,
      events,
      watcher,
      spawner: options.spawner,
      platform: options.platform,
      statusRunner,
      processSpawner: options.processSpawner,
      proxy: options.proxy,
      projectBaseDir: options.projectBaseDir,
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
      projectBaseDir: options.projectBaseDir,
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
  hostname?: string;
}

export function serve(options: ServeOptions = {}) {
  const port = options.port ?? 4321;
  const hostname = options.hostname ?? '0.0.0.0';
  const app = createApp(options);
  return Bun.serve({ port, hostname, fetch: app.fetch });
}

if (import.meta.main) {
  const registry = createRegistry();
  const events = createEventBus();
  const statusRunner = createStatusRunner({ registry, events, spawner: defaultProcessSpawner });
  const server = serve({ registry, events, statusRunner });
  const shutdown = async () => {
    try {
      await statusRunner.stopAll();
    } catch (err) {
      console.warn(
        `[server] statusRunner.stopAll() failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  console.log(`SeeFlow Studio listening on http://${server.hostname}:${server.port}`);
}
