import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Covers US-005 acceptance criteria: the seeflow-mcp shim boots an
// ephemeral Hono studio alongside its stdio handler, the bound port serves
// /healthz, and killing the subprocess releases the port within 2 seconds.

const SHIM_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp-shim.ts');

const LISTENING_RE = /\[seeflow-mcp\] studio listening on (http:\/\/127\.0\.0\.1:(\d+))/;
const STARTUP_TIMEOUT_MS = 5_000;
const PORT_RELEASE_TIMEOUT_MS = 2_000;
const PORT_POLL_INTERVAL_MS = 50;

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

// Read stderr until the listening line appears (or the timeout fires).
// Returns the parsed URL+port. Lines after the match keep streaming into
// the buffer for later debugging but the resolve happens at first hit.
const readUntilListening = async (
  stderr: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<{ baseUrl: string; port: number; buffer: string }> => {
  const reader = stderr.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const readPromise = reader.read();
      const next = await Promise.race([
        readPromise,
        Bun.sleep(remaining).then(() => 'timeout' as const),
      ]);
      if (next === 'timeout') break;
      const { value, done } = next;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(LISTENING_RE);
      if (match?.[1] && match[2]) {
        return { baseUrl: match[1], port: Number(match[2]), buffer };
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error(
    `mcp-shim did not log a listening URL within ${timeoutMs}ms. stderr so far:\n${buffer}`,
  );
};

describe('seeflow-mcp ephemeral HTTP lifecycle', () => {
  it('boots an ephemeral studio, serves /healthz, and releases the port on SIGTERM', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'seeflow-mcp-shim-'));
    const proc = Bun.spawn(['bun', SHIM_ENTRY], {
      env: {
        ...process.env,
        SEEFLOW_WORKSPACE: workspaceRoot,
        // Force prod-mode app inference so the dev proxy to Vite doesn't
        // try to spin up. /healthz works the same in both modes.
        NODE_ENV: 'production',
        // Don't inherit any external studio URL — we want embedded mode.
        SEEFLOW_STUDIO_URL: '',
      },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    try {
      const { port, baseUrl } = await readUntilListening(
        proc.stderr as ReadableStream<Uint8Array>,
        STARTUP_TIMEOUT_MS,
      );

      expect(port).toBeGreaterThan(0);
      expect(baseUrl).toBe(`http://127.0.0.1:${port}`);

      // Ephemeral port is reachable while the subprocess is alive.
      const healthRes = await fetch(`${baseUrl}/healthz`);
      expect(healthRes.status).toBe(200);
      expect(await healthRes.json()).toEqual({ status: 'ok' });

      proc.kill('SIGTERM');
      await proc.exited;

      const released = await waitForPortRelease(port, PORT_RELEASE_TIMEOUT_MS);
      expect(released).toBe(true);
    } finally {
      if (proc.exitCode === null) {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already dead */
        }
        await proc.exited;
      }
      try {
        rmSync(workspaceRoot, { recursive: true, force: true });
      } catch {
        /* nothing to clean */
      }
    }
  });

  it('skips embedded boot when SEEFLOW_STUDIO_URL is set (proxy mode)', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'seeflow-mcp-shim-proxy-'));
    const proc = Bun.spawn(['bun', SHIM_ENTRY], {
      env: {
        ...process.env,
        SEEFLOW_WORKSPACE: workspaceRoot,
        // A bogus URL — the shim should NOT bind a port; it just sets up
        // the HTTP transport pointing at this address. We never actually
        // send a request, so the connection-refused path won't fire.
        SEEFLOW_STUDIO_URL: 'http://127.0.0.1:1/mcp',
      },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    try {
      // Give the shim a moment to print anything it's going to print.
      await Bun.sleep(300);
      const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
      let buffer = '';
      const decoder = new TextDecoder();
      try {
        const next = await Promise.race([
          reader.read(),
          Bun.sleep(150).then(() => 'idle' as const),
        ]);
        if (next !== 'idle') {
          const { value, done } = next;
          if (!done && value) buffer += decoder.decode(value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }

      expect(buffer).not.toMatch(LISTENING_RE);
    } finally {
      if (proc.exitCode === null) {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already dead */
        }
        await proc.exited;
      }
      try {
        rmSync(workspaceRoot, { recursive: true, force: true });
      } catch {
        /* nothing to clean */
      }
    }
  });
});
