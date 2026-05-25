import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Launch the source mcp-shim.ts directly. The PRD lists `apps/studio/src/mcp.ts`
// as a candidate, but that file is a server factory module — not a standalone
// process. The real stdio entry point is `apps/studio/src/mcp-shim.ts` (which
// `apps/studio/bin/seeflow-mcp` wraps with an extra spawnSync layer). Calling
// the shim directly skips that node→bun bootstrap and yields one child pid.
const STUDIO_DIR = resolve(import.meta.dir, '../..');
const MCP_SHIM_ENTRY = join(STUDIO_DIR, 'src/mcp-shim.ts');

const CLOSE_TIMEOUT_MS = 2_000;
const DEFAULT_LISTENING_TIMEOUT_MS = 5_000;
const LISTENING_POLL_INTERVAL_MS = 25;

// Matches the stderr banner printed by `mcp-shim.ts` when embedded mode boots
// the ephemeral Hono studio. Both the URL and port subgroups are captured so
// callers can probe the port for release after killing the subprocess.
const LISTENING_RE = /\[seeflow-mcp\] studio listening on (http:\/\/127\.0\.0\.1:(\d+))/;

type ListToolsResult = Awaited<ReturnType<Client['listTools']>>;
type ListResourcesResult = Awaited<ReturnType<Client['listResources']>>;
type ReadResourceResult = Awaited<ReturnType<Client['readResource']>>;

export interface ListeningUrl {
  baseUrl: string;
  port: number;
}

export interface McpClient {
  /** PID of the spawned `seeflow-mcp` subprocess, or null if the SDK transport
   *  hasn't captured it yet. Use to send signals from lifecycle tests. */
  pid: number | null;
  listTools: () => Promise<ListToolsResult>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>;
  listResources: () => Promise<ListResourcesResult>;
  readResource: (uri: string) => Promise<ReadResourceResult>;
  /** Wait until the shim prints `[seeflow-mcp] studio listening on <url>` to
   *  stderr. Only meaningful when the shim was spawned in embedded mode
   *  (i.e. with `SEEFLOW_STUDIO_URL` unset or empty). */
  awaitListeningUrl: (timeoutMs?: number) => Promise<ListeningUrl>;
  /** Snapshot of stderr accumulated so far — newlines preserved. Useful for
   *  debugging when an `awaitListeningUrl` call times out. */
  getStderr: () => string;
  close: () => Promise<void>;
}

/**
 * Spawn an MCP stdio client connected to the seeflow shim. With no env, the
 * shim boots an in-process Hono studio on an ephemeral loopback port
 * (embedded mode — added in US-005). Callers can still flip back to proxy
 * mode by passing `SEEFLOW_STUDIO_URL=<studio.baseURL>/mcp` (the original
 * pattern used by `mcp-client.it.ts`). Pass `SEEFLOW_STUDIO_URL: ''`
 * explicitly to clear an inherited value from the parent env.
 */
export async function spawnMcpClient(env?: Record<string, string>): Promise<McpClient> {
  const baseEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') baseEnv[k] = v;
  }

  const transport = new StdioClientTransport({
    command: 'bun',
    args: [MCP_SHIM_ENTRY],
    env: { ...baseEnv, ...(env ?? {}) },
    stderr: 'pipe',
  });

  // The SDK exposes the child's stderr as a PassThrough stream — attach a
  // `data` listener BEFORE `client.connect(transport)` so the startup banner
  // can't be missed if the shim boots faster than the connect resolves.
  let stderrBuf = '';
  const stderrStream = transport.stderr;
  if (stderrStream) {
    stderrStream.on('data', (chunk: Buffer | string) => {
      stderrBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
  }

  const client = new Client({ name: 'seeflow-it', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);

  // Capture the pid before close() clears it on the transport — used as a
  // last-resort SIGKILL if graceful shutdown overshoots the 2s ceiling.
  const childPid = transport.pid;

  return {
    pid: childPid ?? null,
    listTools: () => client.listTools(),
    callTool: async (name, args) => {
      const result = await client.callTool({ name, arguments: args ?? {} });
      return result as CallToolResult;
    },
    listResources: () => client.listResources(),
    readResource: (uri) => client.readResource({ uri }),
    awaitListeningUrl: async (timeoutMs = DEFAULT_LISTENING_TIMEOUT_MS) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = stderrBuf.match(LISTENING_RE);
        if (match?.[1] && match[2]) {
          return { baseUrl: match[1], port: Number(match[2]) };
        }
        await Bun.sleep(LISTENING_POLL_INTERVAL_MS);
      }
      throw new Error(
        `seeflow-mcp did not log a listening URL within ${timeoutMs}ms.\nstderr so far:\n${stderrBuf}`,
      );
    },
    getStderr: () => stderrBuf,
    close: async () => {
      const closed = client.close().catch(() => undefined);
      const finished = await Promise.race([
        closed.then(() => true),
        Bun.sleep(CLOSE_TIMEOUT_MS).then(() => false),
      ]);
      if (!finished && childPid !== null && childPid !== undefined) {
        try {
          process.kill(childPid, 'SIGKILL');
        } catch {
          /* already dead */
        }
      }
    },
  };
}
