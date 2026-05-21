import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from './registry.ts';
import { createApp } from './server.ts';

const SHIM_PATH = join(dirname(fileURLToPath(import.meta.url)), 'mcp-shim.ts');

const EXPECTED_TOOL_NAMES = [
  'seeflow_add_connector',
  'seeflow_add_connectors',
  'seeflow_add_node',
  'seeflow_add_nodes',
  'seeflow_create_project',
  'seeflow_delete_connector',
  'seeflow_delete_flow',
  'seeflow_delete_node',
  'seeflow_get_flow',
  'seeflow_list_flows',
  'seeflow_move_node',
  'seeflow_patch_connector',
  'seeflow_patch_node',
  'seeflow_register_flow',
  'seeflow_reorder_node',
  'validate_seeflow',
] as const;

const tmpRegistry = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seeflow-shim-reg-'));
  return join(dir, 'registry.json');
};

const startTestStudio = () => {
  const registry = createRegistry({ path: tmpRegistry() });
  const app = createApp({ mode: 'prod', staticRoot: './dist/web', registry, disableWatcher: true });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  return {
    url: `http://${server.hostname}:${server.port}/mcp`,
    stop: () => server.stop(true),
  };
};

// Read newline-delimited JSON-RPC frames from the shim's stdout. The first
// frame whose id matches the request resolves; otherwise the read hangs
// until the test timeout fires (which is the signal we want — a missing
// response is a bug, not a silent pass).
const readOneResponse = async (
  stdout: ReadableStream<Uint8Array>,
  id: number,
): Promise<{ result?: { tools?: Array<{ name: string }> }; error?: { message: string } }> => {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`shim stdout closed before responding to id ${id}`);
      buffer += decoder.decode(value, { stream: true });
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) continue;
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (parsed.id === id) return parsed;
    }
  } finally {
    reader.releaseLock();
  }
};

describe('seeflow-mcp stdio shim', () => {
  it('forwards tools/list over stdio to the studio /mcp endpoint', async () => {
    const studio = startTestStudio();
    let proc: ReturnType<typeof Bun.spawn> | undefined;
    try {
      proc = Bun.spawn(['bun', SHIM_PATH], {
        env: { ...process.env, SEEFLOW_STUDIO_URL: studio.url },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const stdin = proc.stdin as import('bun').FileSink;
      const stdout = proc.stdout as ReadableStream<Uint8Array>;

      const request = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`;
      stdin.write(request);
      await stdin.flush();

      const response = await readOneResponse(stdout, 1);
      expect(response.error).toBeUndefined();
      const names = (response.result?.tools ?? []).map((t) => t.name).sort();
      expect(names).toEqual([...EXPECTED_TOOL_NAMES]);
    } finally {
      proc?.kill();
      await proc?.exited;
      studio.stop();
    }
  });
});
