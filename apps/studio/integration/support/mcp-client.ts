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

type ListToolsResult = Awaited<ReturnType<Client['listTools']>>;

export interface McpClient {
  listTools: () => Promise<ListToolsResult>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}

/**
 * Spawn an MCP stdio client connected to the seeflow shim. The shim proxies
 * to a running studio's HTTP `/mcp` endpoint, so callers must spawn a studio
 * first and pass `SEEFLOW_STUDIO_URL=<studio.baseURL>/mcp` via `env`.
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

  const client = new Client({ name: 'seeflow-it', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);

  // Capture the pid before close() clears it on the transport — used as a
  // last-resort SIGKILL if graceful shutdown overshoots the 2s ceiling.
  const childPid = transport.pid;

  return {
    listTools: () => client.listTools(),
    callTool: async (name, args) => {
      const result = await client.callTool({ name, arguments: args ?? {} });
      return result as CallToolResult;
    },
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
