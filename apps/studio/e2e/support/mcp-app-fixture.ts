// US-011: Playwright fixture that boots a studio + a tiny static server for
// the built MCP App bundle (apps/mcp-app/dist/index.html), then registers a
// 2-node flow used by every test in the suite. The fixture is worker-scoped
// so all tests share one studio + one bundle server. Each test gets a clean
// `window.openai` mock via `installOpenAiShim` because mock state (sendMessage
// / updateModelContext call buffers, widgetState shape) is per-test.
//
// Why a separate static server rather than serving from the studio: the studio
// hosts the apps/web SPA at `/`; the MCP App is a separate single-file bundle
// (registered as the `ui://seeflow/canvas` MCP resource, not exposed over
// HTTP in production). Production Claude Desktop loads it inside a sandboxed
// `Origin: null` iframe; here we host it on a separate `http://127.0.0.1:N`
// origin which the studio's CORS middleware allows as a localhost any-port
// origin without requiring the token. That's intentional — the null-origin /
// token gate is exhaustively covered by mcp-apps.it.ts (US-010) and
// cors.test.ts (US-006). This suite focuses on the in-iframe bridge contract.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Page, test as base } from '@playwright/test';
import type { Server } from 'bun';
import {
  type StudioHandle,
  getFreePort,
  spawnStudio,
} from '../../integration/support/studio-harness.ts';
import { splitFlow } from '../../src/merge.ts';
import { ResolvedFlowSchema } from '../../src/schema.ts';

// Bun's Server generic requires a websocket-data type argument; using the
// bare `Server` type breaks typecheck. We don't attach a websocket handler,
// so the data shape is `unknown`.
type BundleServer = Server<unknown>;

const STUDIO_DIR = resolve(import.meta.dir, '../..');
const MCP_APP_DIST = resolve(STUDIO_DIR, '../mcp-app/dist/index.html');

export interface RegisteredFlow {
  id: string;
  slug: string;
  projectSlug: string;
  flowSlug: string;
  repoPath: string;
}

export interface McpAppEnv {
  studio: StudioHandle;
  /** http://127.0.0.1:<port> serving the built dist/index.html at GET /. */
  bundleUrl: string;
  /** Per-process token the iframe forwards as X-Seeflow-Token. The studio is
   *  spawned without a token (allows localhost any-port without it), so this
   *  value is effectively cosmetic — kept on widgetState so the iframe code
   *  paths that conditionally attach the header are still exercised. */
  token: string;
  /** Pre-registered demo flow with 2 nodes used by every test. */
  flow: RegisteredFlow;
  /** Stable id of the first node — used by navigate-mode nodeId focus. */
  primaryNodeId: string;
  /** Display name of the first node — asserted on the detail-panel title. */
  primaryNodeName: string;
}

const TEST_TOKEN = 'test-token-for-e2e';

/** Returns true if the MCP App bundle has been built. Tests skip themselves
 *  with a clear message when this is false rather than failing with an opaque
 *  "Bun.serve handler returned undefined" error inside the harness. */
export function isMcpAppBundleBuilt(): boolean {
  return existsSync(MCP_APP_DIST);
}

function bootBundleServer(port: number): BundleServer {
  // Bun.serve's request handler returns the same prebuilt HTML for every
  // request to GET / (and for the few favicon/manifest probes Chromium issues
  // on a fresh origin). The file is read once and cached — it's ~15MB, so
  // re-reading per request would be wasteful.
  const html = readFileSync(MCP_APP_DIST, 'utf8');
  return Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      // 404 for any other path — keeps the test deterministic against
      // accidental missing-asset requests (everything is inlined, so any
      // sub-request indicates a bug).
      return new Response('Not Found', { status: 404 });
    },
  });
}

const FLOW_FIXTURE = {
  version: 2 as const,
  name: 'MCP App Demo',
  nodes: [
    {
      id: 'mcp-demo-source',
      type: 'rectangle' as const,
      position: { x: 80, y: 120 },
      data: { name: 'Source' },
    },
    {
      id: 'mcp-demo-sink',
      type: 'rectangle' as const,
      position: { x: 360, y: 120 },
      data: { name: 'Sink' },
    },
  ],
  connectors: [],
};

async function registerDemoFlow(studio: StudioHandle): Promise<RegisteredFlow> {
  const slug = 'mcp-app-demo';
  const repoPath = join(studio.home, slug);
  mkdirSync(repoPath, { recursive: true });
  const resolved = ResolvedFlowSchema.parse(FLOW_FIXTURE);
  const { flow, style } = splitFlow(resolved);
  writeFileSync(join(repoPath, 'flow.json'), `${JSON.stringify(flow, null, 2)}\n`);
  writeFileSync(join(repoPath, 'style.json'), `${JSON.stringify(style, null, 2)}\n`);

  const res = await fetch(`${studio.baseURL}/api/flows/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: FLOW_FIXTURE.name, repoPath, flowPath: 'flow.json' }),
  });
  if (res.status !== 200) {
    const detail = await res.text();
    throw new Error(`Failed to register mcp-app demo: ${res.status} ${detail}`);
  }
  const { id, slug: registeredSlug } = (await res.json()) as { id: string; slug: string };
  // Legacy /api/flows/register always produces `${projectSlug}/${flowSlug}`
  // (see operations.registerFlowImpl) where the studio synthesises
  // projectSlug = slugify(name) and flowSlug = 'main'.
  const sepIdx = registeredSlug.indexOf('/');
  if (sepIdx < 0) throw new Error(`Registry slug missing '/': ${registeredSlug}`);
  const projectSlug = registeredSlug.slice(0, sepIdx);
  const flowSlug = registeredSlug.slice(sepIdx + 1);
  return { id, slug: registeredSlug, projectSlug, flowSlug, repoPath };
}

type EmptyTestArgs = Record<never, never>;
type WorkerFixtures = { mcpEnv: McpAppEnv };

export const test = base.extend<EmptyTestArgs, WorkerFixtures>({
  mcpEnv: [
    // biome-ignore lint/correctness/noEmptyPattern: required by Playwright fixture API
    async ({}, use) => {
      const studio = await spawnStudio();
      const bundlePort = await getFreePort();
      const server = bootBundleServer(bundlePort);
      try {
        const flow = await registerDemoFlow(studio);
        const [first] = FLOW_FIXTURE.nodes;
        if (!first)
          throw new Error('FLOW_FIXTURE.nodes is empty — fixture must seed at least one node');
        await use({
          studio,
          bundleUrl: `http://127.0.0.1:${bundlePort}`,
          token: TEST_TOKEN,
          flow,
          primaryNodeId: first.id,
          primaryNodeName: first.data.name,
        });
      } finally {
        server.stop(true);
        await studio.stop();
      }
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';

export type WidgetStateFixture = {
  kind: 'create' | 'navigate';
  flowSlug?: string;
  projectSlug?: string;
  nodeId?: string;
  backendUrl: string;
  backendToken: string;
  justCreated?: boolean;
};

/**
 * Install a fresh `window.openai` mock before any document script runs. The
 * mock records every sendMessage / updateModelContext invocation into arrays
 * exposed as `window.__seeflowOpenAiCalls` so tests can assert on them.
 *
 * The init script is built as a STRING — Playwright's function-form
 * addInitScript would require the script source to typecheck against
 * `apps/studio/tsconfig.json`, which omits the DOM lib (it's a Bun backend).
 * Same pattern as `studio-fixture.ts:installThemeInitScript`.
 *
 * Must be called BEFORE `page.goto(...)`; `addInitScript` only takes effect
 * for documents loaded after registration.
 */
export async function installOpenAiShim(
  page: Page,
  widgetState: WidgetStateFixture,
): Promise<void> {
  const serialized = JSON.stringify(widgetState);
  const script = `(() => {
    const calls = { sendMessage: [], updateModelContext: [] };
    window.__seeflowOpenAiCalls = calls;
    window.openai = {
      widgetState: ${serialized},
      sendMessage: (payload) => { calls.sendMessage.push(payload); },
      updateModelContext: (patch) => { calls.updateModelContext.push(patch); },
    };
  })();`;
  await page.addInitScript(script);
}

/**
 * Snapshot of recorded host calls. Both arrays are ordered by the call site —
 * sendMessage payloads are the outer envelope (the bridge coalesces multiple
 * events into one host invocation's `events: [...]` array), and patches are
 * the literal arg each updateModelContext call received.
 */
export interface OpenAiCallsSnapshot {
  sendMessage: {
    events: { event: string; projectSlug?: string; flowSlug?: string; payload?: unknown }[];
  }[];
  updateModelContext: Record<string, unknown>[];
}

// The studio's tsconfig omits the DOM lib (it's a Bun backend), so function-
// form `page.evaluate(() => window....)` references would fail typecheck.
// Use the string-form which is interpreted as JS source inside the browser
// context — same pattern as `studio-fixture.ts:installThemeInitScript`.
export async function getOpenAiCalls(page: Page): Promise<OpenAiCallsSnapshot> {
  const result = await page.evaluate('window.__seeflowOpenAiCalls');
  return result as OpenAiCallsSnapshot;
}

export async function resetOpenAiCalls(page: Page): Promise<void> {
  await page.evaluate(
    'window.__seeflowOpenAiCalls.sendMessage = []; window.__seeflowOpenAiCalls.updateModelContext = [];',
  );
}
