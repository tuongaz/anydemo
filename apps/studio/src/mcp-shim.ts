#!/usr/bin/env bun
// SeeFlow MCP stdio shim.
//
// Bridges an MCP stdio client (e.g. Claude Code via .mcp.json) to a studio
// backend. Two modes:
//   1. Embedded (default): boots an in-process Hono studio on an ephemeral
//      loopback port and proxies stdio JSON-RPC to its /mcp endpoint. The
//      iframe canvas rendered by MCP-Apps-capable hosts also connects to
//      this same port. One process, one install.
//   2. Proxy (when SEEFLOW_STUDIO_URL is set): forwards stdio JSON-RPC to
//      an externally-running studio. Backward-compatible with the existing
//      shim tests and dev workflows where `seeflow studio` already runs.
//
// In embedded mode the port is bound BEFORE the stdio transport starts so
// downstream tool handlers (US-008) can attach the backendUrl to _meta. If
// port binding fails, the shim emits an MCP `notifications/message` over
// stdout and falls back to the default proxy URL — the canvas won't render
// but tool calls still flow (degraded, not crashed).
//
// Lifecycle: SIGINT, SIGTERM, beforeExit, and the stdio transport's
// onclose all release the ephemeral port via server.stop(true). Integration
// coverage lives in apps/studio/integration/mcp-shim-lifecycle.it.ts.

import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type JSONRPCMessage, isJSONRPCRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Server as BunHttpServer } from 'bun';
import { type CreateAppOptions, createApp } from './server.ts';

// Bun's generic Server requires a websocket-data type argument at the type
// level; we don't attach a websocket handler so `unknown` is the right slot.
type EphemeralServer = BunHttpServer<unknown>;

const DEFAULT_URL = 'http://127.0.0.1:4321/mcp';
const STUDIO_NOT_RUNNING_MSG = 'SeeFlow studio is not running. Start it with `bun run dev` first.';
const STUDIO_WITHOUT_MCP_MSG = 'This studio version does not expose MCP. Upgrade required.';

// Treat empty string the same as unset. Spawning subprocesses with an
// explicit `SEEFLOW_STUDIO_URL: ''` is the cleanest way to clear an
// inherited value from the parent env without `delete` semantics, so the
// shim has to handle that path the same as truly absent.
const explicitStudioUrl = process.env.SEEFLOW_STUDIO_URL?.trim() || undefined;

// Emit an MCP `notifications/message` over stdout. JSON-RPC notifications
// have no id; clients route them to a logging sink. Used by the bind-
// failure path so the host surfaces a real error instead of silently
// proxying to a dead address.
const emitMcpNotification = (level: 'error' | 'warning' | 'info', data: string): void => {
  const notification = {
    jsonrpc: '2.0',
    method: 'notifications/message',
    params: { level, logger: 'seeflow-mcp', data },
  };
  process.stdout.write(`${JSON.stringify(notification)}\n`);
};

// Embedded studio handle. Undefined in proxy mode (SEEFLOW_STUDIO_URL set)
// and when port binding fails. Lifecycle hooks below null-check before
// calling .stop().
let embeddedServer: EphemeralServer | undefined;
let embeddedUrl: string | undefined;

if (!explicitStudioUrl) {
  try {
    // Per-process token: generated once at shim boot, held in memory,
    // never persisted, never logged. The MCP App iframe receives it via
    // `_meta['openai/widgetState'].backendToken` (US-008) and replays it
    // on every cross-origin request as `X-Seeflow-Token`. Anything else
    // hitting the ephemeral port from `Origin: null` (other localhost
    // software, drive-by tabs) gets 403'd by the CORS middleware.
    const token = crypto.randomUUID();
    // Hold a mutable options reference so we can fill in `httpUrl` AFTER
    // `Bun.serve` binds — the per-request `/mcp` handler captures
    // `options` by closure, so the canvas-bearing tools (US-008) read
    // the live URL when building their `_meta.backendUrl`. Without this
    // back-fill the closure would observe `httpUrl: undefined` and skip
    // `_meta` entirely.
    const appOptions: CreateAppOptions = { token };
    const app = createApp(appOptions);
    embeddedServer = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch });
    embeddedUrl = `http://${embeddedServer.hostname}:${embeddedServer.port}`;
    appOptions.httpUrl = embeddedUrl;
    // Log the bound URL to stderr so the integration test (and humans
    // debugging) can discover the port without interleaving with the
    // JSON-RPC stdout stream. Intentionally omits the token — it MUST
    // stay in-memory only; printing it to stderr would leak it into any
    // log scrape that captures the subprocess's stderr.
    process.stderr.write(`[seeflow-mcp] studio listening on ${embeddedUrl}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitMcpNotification(
      'error',
      `Failed to bind ephemeral HTTP port for studio: ${msg}. Falling back to ${DEFAULT_URL} (canvas widgets will not render).`,
    );
    embeddedServer = undefined;
    embeddedUrl = undefined;
  }
}

const targetUrl = explicitStudioUrl ?? (embeddedUrl ? `${embeddedUrl}/mcp` : DEFAULT_URL);
const url = new URL(targetUrl);

const stdio = new StdioServerTransport();
const http = new StreamableHTTPClientTransport(url);

// Walk the error and its `cause` chain looking for the signatures Bun and
// Node use for refused TCP connects. Bun's fetch surfaces this as a
// TypeError whose cause carries `code: 'ConnectionRefused'`; Node's undici
// uses `code: 'ECONNREFUSED'` on the cause. Match either pattern, plus the
// human-readable variants seen in the wild.
const isConnectionRefused = (err: unknown): boolean => {
  const seen = new Set<unknown>();
  const visit = (e: unknown): boolean => {
    if (!e || typeof e !== 'object' || seen.has(e)) return false;
    seen.add(e);
    const obj = e as Record<string, unknown>;
    const code = typeof obj.code === 'string' ? obj.code : '';
    if (code === 'ECONNREFUSED' || code === 'ConnectionRefused') return true;
    const message = typeof obj.message === 'string' ? obj.message : '';
    if (/econnrefused|connection refused|unable to connect/i.test(message)) return true;
    return visit(obj.cause);
  };
  return visit(err);
};

const isMcpNotMounted = (err: unknown): boolean =>
  err instanceof StreamableHTTPError && err.code === 404;

const errorMessageFor = (err: unknown): string => {
  if (isConnectionRefused(err)) return STUDIO_NOT_RUNNING_MSG;
  if (isMcpNotMounted(err)) return STUDIO_WITHOUT_MCP_MSG;
  return err instanceof Error ? err.message : String(err);
};

// Forward studio responses → stdout.
http.onmessage = (msg) => {
  void stdio.send(msg);
};
http.onerror = () => {
  // Errors are surfaced as JSON-RPC error responses by the stdio.onmessage
  // catch block below. Silence the transport's own onerror so a single fetch
  // failure doesn't double-log to stderr.
};

// Forward stdin requests → studio. On transport failure, synthesize a
// JSON-RPC error response so the upstream client sees a graceful error
// instead of a hang.
stdio.onmessage = async (msg) => {
  try {
    await http.send(msg);
  } catch (err) {
    if (!isJSONRPCRequest(msg)) return;
    const errorResponse: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32000, message: errorMessageFor(err) },
    };
    await stdio.send(errorResponse).catch(() => undefined);
  }
};

// Tear-down: release the ephemeral port on every exit path so the loopback
// slot doesn't stay claimed after the parent host kills the subprocess.
// Bun.Server.stop(true) is synchronous + idempotent — safe to call from
// multiple lifecycle hooks.
let serverStopped = false;
const stopEmbeddedServer = (): void => {
  if (serverStopped || !embeddedServer) return;
  serverStopped = true;
  try {
    embeddedServer.stop(true);
  } catch {
    /* already stopped */
  }
};

await http.start();
await stdio.start();

// The stdio transport sets `onclose` to undefined by default; chain our
// teardown so a parent killing the pipe still frees the port.
const stdioOnClose = stdio.onclose;
stdio.onclose = () => {
  stopEmbeddedServer();
  stdioOnClose?.();
};

const shutdown = async () => {
  await stdio.close().catch(() => undefined);
  await http.close().catch(() => undefined);
  stopEmbeddedServer();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('beforeExit', () => stopEmbeddedServer());
