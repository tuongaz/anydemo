/**
 * US-074 — end-to-end Playwright e2e for the live-share SSE bridge.
 *
 * Opens two browser contexts:
 *   - Host: the studio SPA (apps/web) against a freshly spawned `seeflow start`.
 *   - Peer: the seeflow-viewer SPA served from its built `dist/`. Reaches the
 *     host through a fake in-process relay (`Bun.serve` HTTP + WS) that mimics
 *     the production AWS relay's `/api/share/sessions`, `/api/share/join` and
 *     WebSocket routing surface enough for the SSE bridge to function.
 *
 * The viewer SPA lives in a sibling repo (`seeflow-viewer/`). Resolution
 * mirrors `apps/studio/integration/share-rpc-schema-sync.it.ts`: try
 * SEEFLOW_VIEWER_DIST → sibling `seeflow-viewer/dist` → maintainer dev path.
 * If none resolve the test SOFT-SKIPS so the suite still passes inside the
 * Docker harness (which only mounts the studio repo) and in CI without the
 * viewer checkout. The maintainer can run this natively (`apps/studio/
 * node_modules/.bin/playwright test --config=apps/studio/e2e/playwright.
 * config.ts apps/studio/e2e/share-sse-live.e2e.ts`) with the viewer built
 * locally to exercise the full path.
 *
 * Why DOM assertions (no screenshots): visual baselines for the
 * StatusIconPill animation would tighten the test to a single pixel diff;
 * the AC asks for behavior-level verification (active ring → success
 * check) which is best expressed via `[data-status="…"]` on the
 * PlayButton, owned by `packages/canvas/src/nodes/lib/play-button.tsx`.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import type { ServerWebSocket } from 'bun';
import { type StudioHandle, spawnStudio } from '../integration/support/studio-harness.ts';
import { ENVELOPE_TYPES, type Envelope, parseEnvelope } from '../src/share-envelope.ts';

const STUDIO_DIR = resolve(import.meta.dir, '..');

// Resolve viewer dist by env var / sibling / maintainer dev path. Same fallback
// order as share-rpc-schema-sync.it.ts so behavior is predictable.
function resolveViewerDist(): string | null {
  const envPath = process.env.SEEFLOW_VIEWER_DIST;
  if (envPath && existsSync(join(envPath, 'index.html'))) return envPath;
  const sibling = resolve(STUDIO_DIR, '..', '..', '..', 'seeflow-viewer', 'dist');
  if (existsSync(join(sibling, 'index.html'))) return sibling;
  const dev = '/Users/tuongaz/dev/seeflow-viewer/dist';
  if (existsSync(join(dev, 'index.html'))) return dev;
  return null;
}

interface IssuedSession {
  sessionId: string;
  token: string;
  hostKey: string;
}

interface RelayConnData {
  connId: string;
  sessionId: string | null;
  role: 'pending' | 'host' | 'peer';
  peerId: string | null;
}

interface FakeRelay {
  baseURL: string;
  wsUrl: string;
  stop: () => Promise<void>;
}

// Minimal relay: enough surface for the studio's ShareController and the
// viewer's ShareClient to complete the handshake and exchange envelopes.
function startFakeRelay(): FakeRelay {
  let connSeq = 0;
  let peerSeq = 0;
  const sessions = new Map<string, IssuedSession>();
  const conns = new Map<string, ServerWebSocket<RelayConnData>>();
  const sessionHost = new Map<string, string>();
  const sessionPeers = new Map<string, Set<string>>();
  // peerJwt → sessionId. Issued in /api/share/join; consumed by `auth-peer`.
  const peerJwts = new Map<string, { sessionId: string; peerId: string }>();

  const removeFromSession = (data: RelayConnData) => {
    if (!data.sessionId) return;
    if (sessionHost.get(data.sessionId) === data.connId) {
      sessionHost.delete(data.sessionId);
    }
    sessionPeers.get(data.sessionId)?.delete(data.connId);
  };

  const route = (env: Envelope, fromConnId: string, sessionId: string) => {
    const hostConn = sessionHost.get(sessionId);
    const peers = sessionPeers.get(sessionId) ?? new Set<string>();
    const rewritten: Envelope = { ...env, from: fromConnId };
    const targets: string[] = [];
    if (env.to === undefined || env.to === 'all') {
      if (hostConn && hostConn !== fromConnId) targets.push(hostConn);
      for (const p of peers) if (p !== fromConnId) targets.push(p);
    } else if (env.to === 'host') {
      if (hostConn && hostConn !== fromConnId) targets.push(hostConn);
    } else if (env.to !== fromConnId) {
      targets.push(env.to);
    }
    const payload = JSON.stringify(rewritten);
    for (const t of targets) {
      const sock = conns.get(t);
      if (sock) sock.send(payload);
    }
  };

  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST,OPTIONS',
  };

  const server = Bun.serve<RelayConnData>({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      if (req.method === 'POST' && url.pathname === '/api/share/sessions') {
        const sessionId = `sess-${++connSeq}`;
        const token = `tok-${sessionId}`;
        const hostKey = `hk-${sessionId}`;
        sessions.set(sessionId, { sessionId, token, hostKey });
        return Response.json(
          { sessionId, token, hostKey, wsUrl: `ws://127.0.0.1:${srv.port}/` },
          { headers: corsHeaders },
        );
      }
      if (req.method === 'POST' && url.pathname === '/api/share/join') {
        let body: { token?: string; displayName?: string };
        try {
          body = (await req.json()) as { token?: string; displayName?: string };
        } catch {
          return new Response(JSON.stringify({ error: 'invalid-json' }), {
            status: 400,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          });
        }
        const token = body.token ?? '';
        const displayName = (body.displayName ?? '').trim().slice(0, 40);
        if (!token || !displayName) {
          return new Response(JSON.stringify({ error: 'missing-fields' }), {
            status: 400,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          });
        }
        let issued: IssuedSession | undefined;
        for (const s of sessions.values()) {
          if (s.token === token) {
            issued = s;
            break;
          }
        }
        if (!issued) {
          return new Response(JSON.stringify({ error: 'unknown-token' }), {
            status: 404,
            headers: { ...corsHeaders, 'content-type': 'application/json' },
          });
        }
        const peerId = `peer-${++peerSeq}`;
        const peerJwt = `pj-${peerId}-${issued.sessionId}`;
        peerJwts.set(peerJwt, { sessionId: issued.sessionId, peerId });
        return Response.json(
          {
            sessionId: issued.sessionId,
            peerId,
            displayName,
            wsUrl: `ws://127.0.0.1:${srv.port}/`,
            peerJwt,
            hostOnline: sessionHost.has(issued.sessionId),
            flowList: [],
          },
          { headers: corsHeaders },
        );
      }
      if (req.method === 'GET') {
        const data: RelayConnData = {
          connId: `conn-${++connSeq}`,
          sessionId: null,
          role: 'pending',
          peerId: null,
        };
        if (srv.upgrade(req, { data })) return undefined;
        return new Response('upgrade failed', { status: 400 });
      }
      return new Response('not found', { status: 404 });
    },
    websocket: {
      open(ws) {
        conns.set(ws.data.connId, ws);
      },
      message(ws, raw) {
        if (typeof raw !== 'string') return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        const result = parseEnvelope(parsed);
        if (!result.ok) return;
        const env = result.envelope;
        if (env.type === 'auth-host') {
          const payload = env.payload as { sessionId?: string; hostKey?: string } | null;
          const issued = payload?.sessionId ? sessions.get(payload.sessionId) : undefined;
          if (!issued || issued.hostKey !== payload?.hostKey) {
            ws.close(1008, 'unauthorized');
            return;
          }
          ws.data.sessionId = issued.sessionId;
          ws.data.role = 'host';
          sessionHost.set(issued.sessionId, ws.data.connId);
          return;
        }
        if (env.type === 'auth-peer') {
          // Accept BOTH the legacy `{ token }` shape (used by the in-process
          // share-host-peer.it.ts harness) and the production `{ peerJwt }`
          // shape (used by the real viewer). Either resolves to a session.
          const payload = env.payload as {
            token?: string;
            peerJwt?: string;
            displayName?: string;
          } | null;
          let session: IssuedSession | undefined;
          let peerId: string | null = null;
          if (payload?.peerJwt) {
            const claim = peerJwts.get(payload.peerJwt);
            if (claim) {
              session = sessions.get(claim.sessionId);
              peerId = claim.peerId;
            }
          } else if (payload?.token) {
            for (const s of sessions.values()) {
              if (s.token === payload.token) {
                session = s;
                break;
              }
            }
          }
          if (!session) {
            ws.close(1008, 'unauthorized');
            return;
          }
          ws.data.sessionId = session.sessionId;
          ws.data.role = 'peer';
          ws.data.peerId = peerId;
          let set = sessionPeers.get(session.sessionId);
          if (!set) {
            set = new Set();
            sessionPeers.set(session.sessionId, set);
          }
          set.add(ws.data.connId);
          return;
        }
        if (!ws.data.sessionId) {
          ws.close(1008, 'not-authed');
          return;
        }
        route(env, ws.data.connId, ws.data.sessionId);
      },
      close(ws) {
        conns.delete(ws.data.connId);
        removeFromSession(ws.data);
      },
    },
  });

  // Touch ENVELOPE_TYPES so the import is exercised — defensive against
  // tree-shaking drift in future tsconfig changes.
  if (!ENVELOPE_TYPES.includes('sse')) {
    throw new Error('relay startup: missing sse envelope type');
  }

  return {
    baseURL: `http://127.0.0.1:${server.port}`,
    wsUrl: `ws://127.0.0.1:${server.port}/`,
    stop: async () => {
      server.stop(true);
    },
  };
}

interface PeerSpaServer {
  baseURL: string;
  stop: () => Promise<void>;
}

// Static server for the viewer SPA dist with SPA fallback (index.html for
// unknown paths). Mirrors a minimal production CDN: GET /assets/* serves the
// bundled file, anything else falls back to index.html so React Router can
// pick up `/share/:token`.
function startPeerSpaServer(distDir: string): PeerSpaServer {
  const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      const candidate = join(distDir, url.pathname === '/' ? 'index.html' : url.pathname);
      // Prevent path traversal.
      if (!candidate.startsWith(distDir)) {
        return new Response('forbidden', { status: 403 });
      }
      if (existsSync(candidate) && !candidate.endsWith('/')) {
        const data = readFileSync(candidate);
        const ext = candidate.slice(candidate.lastIndexOf('.'));
        return new Response(data, {
          headers: { 'content-type': contentTypes[ext] ?? 'application/octet-stream' },
        });
      }
      // SPA fallback.
      const indexPath = join(distDir, 'index.html');
      if (existsSync(indexPath)) {
        return new Response(readFileSync(indexPath), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  return {
    baseURL: `http://127.0.0.1:${server.port}`,
    stop: async () => {
      server.stop(true);
    },
  };
}

interface FlowFixture {
  projectSlug: string;
  flowSlug: string;
}

// Register a flow whose node IDs match the demo router's hard-coded emit
// IDs (`post-orders`, `inventory-service`, `payment-service`,
// `fulfillment-service`). This is the smallest change that lets the live
// `/demo/orders` runner produce `node:running`/`node:done` events the
// canvas can match to actual nodes — the canonical order-pipeline example
// uses opaque `node-XKIyds0TDg`-style ids that the demo router can't know.
async function registerOrderPipelineFlow(studio: StudioHandle): Promise<FlowFixture> {
  const repoPath = join(studio.home, 'order-pipeline-e2e');
  mkdirSync(repoPath, { recursive: true });
  const flow = {
    version: 2 as const,
    name: 'Order Pipeline E2E',
    nodes: [
      {
        id: 'post-orders',
        type: 'rectangle' as const,
        data: {
          name: 'POST /orders',
          playAction: {
            kind: 'script' as const,
            interpreter: 'bun',
            scriptPath: 'scripts/play.ts',
          },
        },
      },
      {
        id: 'inventory-service',
        type: 'rectangle' as const,
        data: { name: 'Inventory' },
      },
      {
        id: 'payment-service',
        type: 'rectangle' as const,
        data: { name: 'Payment' },
      },
      {
        id: 'fulfillment-service',
        type: 'rectangle' as const,
        data: { name: 'Fulfillment' },
      },
    ],
    connectors: [],
  };
  const style = {
    nodes: {
      'post-orders': { position: { x: 100, y: 100 } },
      'inventory-service': { position: { x: 320, y: 100 } },
      'payment-service': { position: { x: 540, y: 100 } },
      'fulfillment-service': { position: { x: 760, y: 100 } },
    },
  };
  writeFileSync(join(repoPath, 'flow.json'), `${JSON.stringify(flow, null, 2)}\n`);
  writeFileSync(join(repoPath, 'style.json'), `${JSON.stringify(style, null, 2)}\n`);

  // Copy the order-pipeline play.ts so the PlayButton runs an actual script
  // that pokes /demo/orders. resolveScript realpaths the target, so the file
  // MUST exist before any /play call lands.
  const src = join(STUDIO_DIR, 'examples/order-pipeline/flows/main/scripts/play.ts');
  const dest = join(repoPath, 'nodes', 'post-orders', 'scripts', 'play.ts');
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);

  const res = await fetch(`${studio.baseURL}/api/flows/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Order Pipeline E2E', repoPath, flowPath: 'flow.json' }),
  });
  if (res.status !== 200) {
    throw new Error(`flow register failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { slug: string };
  const slash = body.slug.indexOf('/');
  return {
    projectSlug: body.slug.slice(0, slash),
    flowSlug: body.slug.slice(slash + 1),
  };
}

// Intercept the viewer SPA's calls to https://seeflow.dev/api/share/* and
// forward them to the local fake relay. The viewer hardcodes that origin in
// `src/lib/share-api.ts`; rewriting at the Playwright route layer is the
// cleanest way to redirect without forking the viewer build.
async function installViewerApiRedirect(
  context: BrowserContext,
  fakeRelayBaseURL: string,
): Promise<void> {
  await context.route('**/seeflow.dev/api/share/**', async (route) => {
    const original = new URL(route.request().url());
    const target = `${fakeRelayBaseURL}${original.pathname}${original.search}`;
    const method = route.request().method();
    const headers = await route.request().allHeaders();
    const body = route.request().postData();
    try {
      const res = await fetch(target, {
        method,
        headers: { 'content-type': headers['content-type'] ?? 'application/json' },
        body,
      });
      const text = await res.text();
      await route.fulfill({
        status: res.status,
        contentType: res.headers.get('content-type') ?? 'application/json',
        body: text,
      });
    } catch (err) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'relay-proxy-failed', detail: String(err) }),
      });
    }
  });
}

async function waitForCanvasReady(page: Page, timeout = 15_000): Promise<void> {
  await page.locator('[data-canvas-ready="true"]').waitFor({ state: 'attached', timeout });
}

const viewerDist = resolveViewerDist();
// The studio SPA bundle ships at `apps/studio/dist/web/index.html` and is
// served as the host canvas. The integration orchestrator
// (`apps/studio/scripts/test-integration.ts`) rebuilds it when stale before
// dispatching the e2e tier, so under the canonical entry point
// `bun run test:it:e2e` this path is always present. Running playwright
// directly skips that step — in which case we soft-skip rather than fail.
const STUDIO_WEB_INDEX = resolve(STUDIO_DIR, 'dist/web/index.html');

test.describe('US-074: live SSE bridge — host play, peer renders', () => {
  // Single suite-level skip. Playwright treats `test.skip(condition, reason)`
  // inside `beforeAll` as a soft skip for every test in the describe block,
  // which is exactly what we want for the maintainer-local viewer setup.
  test.beforeAll(() => {
    test.skip(
      viewerDist === null,
      'seeflow-viewer dist not found. Set SEEFLOW_VIEWER_DIST, check out ' +
        'seeflow-viewer as a sibling, or build it at /Users/tuongaz/dev/seeflow-viewer/dist.',
    );
    test.skip(
      !existsSync(STUDIO_WEB_INDEX),
      'apps/studio/dist/web/index.html missing — build the SPA first ' +
        '(`bun run --filter @seeflow/web build`) or run via `bun run test:it:e2e` ' +
        'which rebuilds it automatically.',
    );
  });

  let relay: FakeRelay;
  let peerSpa: PeerSpaServer;
  let studio: StudioHandle;
  let flow: FlowFixture;
  let studioCanvasUrl: string;
  let shareToken: string;
  let shareSessionId: string;

  test.beforeAll(async () => {
    relay = startFakeRelay();
    if (viewerDist === null) throw new Error('unreachable: viewerDist null after skip-gate');
    peerSpa = startPeerSpaServer(viewerDist);

    // SEEFLOW_SHARE_URL_BASE lets `${shareUrlBase}/${token}` resolve to a
    // local peer SPA URL whose `/share/:token` route is the viewer's entry.
    studio = await spawnStudio({
      env: {
        SEEFLOW_SHARE_RELAY_URL: relay.baseURL,
        SEEFLOW_SHARE_URL_BASE: `${peerSpa.baseURL}/share`,
      },
    });

    flow = await registerOrderPipelineFlow(studio);
    studioCanvasUrl = `${studio.baseURL}/projects/${flow.projectSlug}/flows/${flow.flowSlug}`;

    const startRes = await fetch(`${studio.baseURL}/api/share/start`, { method: 'POST' });
    if (startRes.status !== 200) {
      throw new Error(`share/start failed: ${startRes.status} ${await startRes.text()}`);
    }
    const startBody = (await startRes.json()) as { url: string; sessionId: string };
    shareSessionId = startBody.sessionId;
    shareToken = startBody.url.split('/').pop() ?? '';
    if (!shareToken) throw new Error(`share/start returned no token: ${startBody.url}`);
  });

  test.afterAll(async () => {
    if (studio) await studio.stop();
    if (peerSpa) await peerSpa.stop();
    if (relay) await relay.stop();
  });

  test('host PlayButton click flips peer node `post-orders` from active → success', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const peerContext = await browser.newContext();
    await installViewerApiRedirect(peerContext, relay.baseURL);

    const hostPage = await hostContext.newPage();
    const peerPage = await peerContext.newPage();

    try {
      await hostPage.goto(studioCanvasUrl);
      await waitForCanvasReady(hostPage);

      // Drive the peer through the viewer's join handshake by supplying a
      // display name up front. The viewer auto-prompts via a modal otherwise;
      // seeding localStorage skips the modal so the SPA can join directly.
      await peerContext.addInitScript(
        `try { window.localStorage.setItem('seeflow.share.displayName', 'E2E Peer'); } catch (_e) {}`,
      );
      await peerPage.goto(`${peerSpa.baseURL}/share/${shareToken}`);
      await waitForCanvasReady(peerPage);

      // Sanity: both ends show the same flow node.
      const hostPlay = hostPage
        .locator('[data-node-type="rectangle"]')
        .filter({ has: hostPage.locator('text=POST /orders') })
        .locator('[data-testid="play-button"]');
      const peerPlay = peerPage
        .locator('[data-node-type="rectangle"]')
        .filter({ has: peerPage.locator('text=POST /orders') })
        .locator('[data-testid="play-button"]');
      await expect(hostPlay).toBeVisible({ timeout: 10_000 });
      await expect(peerPlay).toBeVisible({ timeout: 10_000 });

      // Click the host's PlayButton. The studio's play runner spawns the
      // node's script, which POSTs /demo/orders; the demo router emits
      // node:running → node:done with nodeId='post-orders', the share
      // bridge wraps them as `sse` envelopes, the relay fans out to the
      // peer, and the peer's canvas IoAdapter dispatches them.
      await hostPlay.click();

      // Active ring within 500ms of click (AC: peer mirrors host state
      // promptly). Give a small headroom for cold-start jitter.
      await expect(peerPlay).toHaveAttribute('data-status', 'active', { timeout: 1_500 });

      // Success check within another ~2s (the demo emits node:done after a
      // 200–400ms delay, then the next 3 nodes run sequentially; we only
      // need post-orders' terminal).
      await expect(peerPlay).toHaveAttribute('data-status', 'success', { timeout: 3_000 });
    } finally {
      await peerContext.close();
      await hostContext.close();
    }
  });

  test('late-joining peer sees `post-orders` already in success via sse-snapshot', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    await hostPage.goto(studioCanvasUrl);
    await waitForCanvasReady(hostPage);

    try {
      // Fire the play action and wait for completion on the HOST side, so
      // the SseTap has a terminal `node:done` for post-orders in its
      // latest-per-node map BEFORE the late peer joins.
      const hostPlay = hostPage
        .locator('[data-node-type="rectangle"]')
        .filter({ has: hostPage.locator('text=POST /orders') })
        .locator('[data-testid="play-button"]');
      await hostPlay.click();
      await expect(hostPlay).toHaveAttribute('data-status', 'success', { timeout: 5_000 });

      const peerContext = await browser.newContext();
      await installViewerApiRedirect(peerContext, relay.baseURL);
      await peerContext.addInitScript(
        `try { window.localStorage.setItem('seeflow.share.displayName', 'Late Peer'); } catch (_e) {}`,
      );
      const peerPage = await peerContext.newPage();
      try {
        await peerPage.goto(`${peerSpa.baseURL}/share/${shareToken}`);
        await waitForCanvasReady(peerPage);
        const peerPlay = peerPage
          .locator('[data-node-type="rectangle"]')
          .filter({ has: peerPage.locator('text=POST /orders') })
          .locator('[data-testid="play-button"]');
        // First-render success without ever observing 'active' — the
        // snapshot replays the terminal state directly.
        await expect(peerPlay).toHaveAttribute('data-status', 'success', { timeout: 5_000 });
      } finally {
        await peerContext.close();
      }
    } finally {
      await hostContext.close();
    }

    // Touch shareSessionId so it isn't reported as unused by tsc/biome; the
    // value isn't asserted here (the FakeRelay routes by token + connId, not
    // sessionId) but tests in this file may evolve to read it.
    expect(shareSessionId).toMatch(/^sess-/);
  });
});
