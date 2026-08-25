import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANVAS_RESOURCE_MIME, CANVAS_RESOURCE_URI } from '../src/mcp-ui.ts';
import { type McpClient, spawnMcpClient } from './support/mcp-client.ts';

// US-010 — drives the real seeflow-mcp stdio binary via the in-repo MCP client
// harness and verifies the full MCP-Apps contract: the canvas HTML resource is
// listed + readable, canvas-bearing tool results carry the `_meta` payload
// with a reachable `backendUrl`, the per-process `X-Seeflow-Token` gates
// `Origin: null` requests, and the ephemeral port is released within 2s of
// killing the subprocess.

const STUDIO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANVAS_BUNDLE_PATH = resolve(STUDIO_DIR, '../mcp-app/dist/index.html');

const PORT_RELEASE_TIMEOUT_MS = 2_000;
const PORT_POLL_INTERVAL_MS = 50;

// Minimal-but-valid flow matching the fixtures used in mcp-parity.test.ts. The
// shape mirrors VALID_FLOW_TWO_NODES (two rectangles) so `seeflow_register_flow`
// accepts it through the same Flow schema the rest of the studio uses.
const VALID_FLOW_TWO_NODES = {
  version: 2,
  name: 'Integration Two Nodes',
  nodes: [
    {
      id: 'a',
      type: 'rectangle',
      data: {
        name: 'A',
      },
    },
    {
      id: 'b',
      type: 'rectangle',
      data: {
        name: 'B',
      },
    },
  ],
  connectors: [],
};

// Try to bind a TCP server to 127.0.0.1:port; resolve true if the bind
// succeeds (port is free), false if the bind fails (port is still held by
// a lingering process). The server is closed immediately after a successful
// bind so the test doesn't accumulate sockets across iterations.
const isPortFree = (port: number): Promise<boolean> =>
  new Promise((resolveResult) => {
    const probe = createServer();
    probe.once('error', () => resolveResult(false));
    probe.once('listening', () => {
      probe.close(() => resolveResult(true));
    });
    try {
      probe.listen(port, '127.0.0.1');
    } catch {
      resolveResult(false);
    }
  });

const waitForPortRelease = async (port: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true;
    await Bun.sleep(PORT_POLL_INTERVAL_MS);
  }
  return false;
};

const isProcessAlive = (pid: number): boolean => {
  try {
    // Signal 0 doesn't deliver — just checks for permission to signal. Throws
    // ESRCH when the pid is gone (the process exited).
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitForExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await Bun.sleep(PORT_POLL_INTERVAL_MS);
  }
  return false;
};

describe('MCP Apps integration (US-010)', () => {
  // The shim reads `apps/mcp-app/dist/index.html` when serving the canvas
  // resource. The integration test depends on it being built — fail loudly
  // up front instead of letting the resources/read assertion blow up with a
  // confusing ENOENT trace from the subprocess.
  if (!existsSync(CANVAS_BUNDLE_PATH)) {
    it.skip(`requires apps/mcp-app/dist/index.html — run 'bun run --filter @seeflow/mcp-app build' first`, () =>
      undefined);
    return;
  }

  describe('resource + tool contract (live)', () => {
    let workspaceRoot: string;
    let repoPath: string;
    let client: McpClient;
    let backendUrl: string;
    let backendToken: string;

    beforeAll(async () => {
      workspaceRoot = mkdtempSync(join(tmpdir(), 'seeflow-mcp-apps-ws-'));
      repoPath = mkdtempSync(join(tmpdir(), 'seeflow-mcp-apps-repo-'));
      writeFileSync(
        join(repoPath, 'flow.json'),
        `${JSON.stringify(VALID_FLOW_TWO_NODES, null, 2)}\n`,
      );

      client = await spawnMcpClient({
        SEEFLOW_WORKSPACE: workspaceRoot,
        // Empty string → mcp-shim.ts treats it the same as unset, so the
        // embedded boot path kicks in and a per-process token is generated.
        SEEFLOW_STUDIO_URL: '',
        // Pin the in-process Hono app to prod mode so the dev fallback (which
        // tries to proxy to a Vite server on :5173) doesn't activate.
        NODE_ENV: 'production',
      });

      const listening = await client.awaitListeningUrl();
      backendUrl = listening.baseUrl;
    });

    afterAll(async () => {
      if (client) await client.close();
      if (workspaceRoot) {
        try {
          rmSync(workspaceRoot, { recursive: true, force: true });
        } catch {
          /* nothing to clean */
        }
      }
      if (repoPath) {
        try {
          rmSync(repoPath, { recursive: true, force: true });
        } catch {
          /* nothing to clean */
        }
      }
    });

    it('exposes the canvas UI resource via resources/list', async () => {
      const result = await client.listResources();
      expect(Array.isArray(result.resources)).toBe(true);
      const canvas = result.resources.find((r) => r.uri === CANVAS_RESOURCE_URI);
      expect(canvas).toBeDefined();
      expect(canvas?.mimeType).toBe(CANVAS_RESOURCE_MIME);
    });

    it('returns the inlined HTML bundle via resources/read', async () => {
      const result = await client.readResource(CANVAS_RESOURCE_URI);
      expect(Array.isArray(result.contents)).toBe(true);
      expect(result.contents.length).toBeGreaterThan(0);
      const [first] = result.contents as Array<Record<string, unknown>>;
      expect(first?.uri).toBe(CANVAS_RESOURCE_URI);
      expect(first?.mimeType).toBe(CANVAS_RESOURCE_MIME);
      // The SDK types resource content as a union of `{ text }` and `{ blob }`;
      // narrow at runtime since the studio always returns the text variant.
      const text = first?.text;
      expect(typeof text).toBe('string');
      // The single-file Vite output is ~15MB; any non-trivial threshold is
      // enough to assert "not the empty string and not a stub error page".
      expect((text as string).length).toBeGreaterThan(1024);
    });

    it('attaches canvas _meta to seeflow_create_project with a reachable backendUrl', async () => {
      // Manifest-only registry (post-US-018) rejects pre-manifest entries on
      // reload, so the legacy `seeflow_register_flow` path no longer survives
      // a round-trip through `/api/flows`. seeflow_create_project is the
      // manifest-driven equivalent: it scaffolds <path>/seeflow.json +
      // <path>/flows/main/flow.json and returns the same canvas _meta shape.
      const projectPath = join(workspaceRoot, 'integration-flow');
      const result = await client.callTool('seeflow_create_project', {
        path: projectPath,
        name: 'Integration Flow',
      });
      expect(result.isError).toBeFalsy();

      const data = (() => {
        const content = (result.content as Array<{ type: string; text: string }> | undefined)?.[0];
        return JSON.parse(content?.text ?? '{}') as { id: string; slug: string };
      })();
      expect(typeof data.slug).toBe('string');

      const meta = result._meta as Record<string, unknown> | undefined;
      expect(meta).toBeDefined();
      expect(meta?.['openai/outputTemplate']).toBe(CANVAS_RESOURCE_URI);
      expect(meta?.['openai/widgetAccessible']).toBe(true);

      const widgetState = meta?.['openai/widgetState'] as Record<string, unknown> | undefined;
      expect(widgetState).toBeDefined();
      expect(widgetState?.kind).toBe('create');
      // create-project widget state carries `projectSlug` (the manifest's
      // project slug) — `flowSlug` is optional and not emitted for fresh
      // scaffolds. The downstream listing check uses the tool result's
      // `slug` instead so we still verify the flow registered.
      expect(typeof widgetState?.projectSlug).toBe('string');
      expect(widgetState?.backendUrl).toBe(backendUrl);
      expect(typeof widgetState?.backendToken).toBe('string');
      backendToken = widgetState?.backendToken as string;
      expect(backendToken.length).toBeGreaterThan(0);

      // GET /api/flows from a sandboxed-style Origin: null carrying the
      // token must succeed. This is exactly what the MCP App iframe does
      // after the host injects widgetState.
      const okRes = await fetch(`${backendUrl}/api/flows`, {
        headers: {
          origin: 'null',
          'x-seeflow-token': backendToken,
        },
      });
      expect(okRes.status).toBe(200);
      const flows = (await okRes.json()) as Array<{ slug: string }>;
      expect(Array.isArray(flows)).toBe(true);
      expect(flows.some((f) => f.slug === data.slug)).toBe(true);
    });

    it('rejects Origin: null requests to /api/flows without the X-Seeflow-Token header', async () => {
      const res = await fetch(`${backendUrl}/api/flows`, {
        headers: { origin: 'null' },
      });
      expect(res.status).toBe(403);
      // The token must never appear in the rejection body — CORS pattern
      // from US-006 is "deny without leaking which token would've worked".
      const body = await res.text();
      if (backendToken) {
        expect(body.includes(backendToken)).toBe(false);
      }
    });
  });

  describe('lifecycle', () => {
    it('releases the ephemeral port within 2s of killing the subprocess', async () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'seeflow-mcp-apps-life-'));
      const client = await spawnMcpClient({
        SEEFLOW_WORKSPACE: workspaceRoot,
        SEEFLOW_STUDIO_URL: '',
        NODE_ENV: 'production',
      });

      try {
        const { port } = await client.awaitListeningUrl();
        expect(port).toBeGreaterThan(0);
        expect(client.pid).not.toBeNull();

        // The studio is genuinely listening before the kill — proves the
        // port-release assertion below is meaningful (not a no-op against an
        // already-free port).
        expect(await isPortFree(port)).toBe(false);

        if (client.pid !== null) {
          try {
            process.kill(client.pid, 'SIGTERM');
          } catch {
            /* already exited */
          }
        }

        // Give the subprocess a chance to exit before probing the port; the
        // mcp-shim's SIGTERM handler closes stdio + calls server.stop(true)
        // synchronously.
        if (client.pid !== null) {
          await waitForExit(client.pid, PORT_RELEASE_TIMEOUT_MS);
        }

        const released = await waitForPortRelease(port, PORT_RELEASE_TIMEOUT_MS);
        expect(released).toBe(true);
      } finally {
        await client.close();
        try {
          rmSync(workspaceRoot, { recursive: true, force: true });
        } catch {
          /* nothing to clean */
        }
      }
    });
  });
});
