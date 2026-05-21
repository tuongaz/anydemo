import {
  type WriteStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';

// Resolve to apps/studio/ so the harness picks the right cli.ts regardless of
// the test's cwd (bun test resolves test files relative to the repo root).
const STUDIO_DIR = resolve(import.meta.dir, '../..');
const CLI_ENTRY = join(STUDIO_DIR, 'src/cli.ts');
const ARTIFACT_ROOT = join(STUDIO_DIR, 'integration/.artifacts');

const HEALTH_POLL_INTERVAL_MS = 150;
const HEALTH_DEFAULT_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 5_000;

export interface StudioHandle {
  port: number;
  baseURL: string;
  /** Tmp dir injected as SEEFLOW_WORKSPACE; the studio writes its state to
   *  `${home}/.seeflow` (registry.json, pid file, project dirs). */
  home: string;
  /** Convenience pointer to `${home}/.seeflow`, the dir studio actually writes. */
  workspace: string;
  pid: number;
  logs: { stdout: string[]; stderr: string[] };
  stop: () => Promise<void>;
}

export interface SpawnStudioOptions {
  /** Extra env vars merged into the spawn. */
  env?: Record<string, string>;
  /** Override the free-port pick with a specific port (for double-start tests). */
  port?: number;
  /** Override health probe ceiling. Defaults to 10s. */
  healthTimeoutMs?: number;
  /** Override the SEEFLOW_WORKSPACE path. Defaults to a fresh mkdtempSync. */
  home?: string;
  /** Override the runId used for artifact dir. Defaults to date+rand. */
  runId?: string;
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.on('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        rejectPort(new Error('Failed to acquire ephemeral port'));
        return;
      }
      const { port } = addr;
      server.close(() => resolvePort(port));
    });
  });
}

export async function waitForHealthz(
  baseURL: string,
  timeoutMs: number = HEALTH_DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/healthz`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body?.status === 'ok') return;
      }
    } catch (err) {
      lastError = err;
    }
    await Bun.sleep(HEALTH_POLL_INTERVAL_MS);
  }
  const detail =
    lastError instanceof Error ? lastError.message : String(lastError ?? 'no response');
  throw new Error(`Studio at ${baseURL} did not become healthy within ${timeoutMs}ms (${detail})`);
}

// Track every live handle so a SIGINT / runner crash kills the orphans rather
// than leaking bun processes that hold ports + tmp dirs.
const liveHandles = new Set<StudioHandle>();
let exitGuardRegistered = false;

function registerExitGuard(): void {
  if (exitGuardRegistered) return;
  exitGuardRegistered = true;
  const killAll = () => {
    for (const h of liveHandles) {
      try {
        process.kill(h.pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
      try {
        rmSync(h.home, { recursive: true, force: true });
      } catch {
        /* nothing to clean */
      }
    }
    liveHandles.clear();
  };
  process.on('exit', killAll);
  process.on('SIGINT', killAll);
  process.on('SIGTERM', killAll);
}

function newRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function spawnStudio(opts: SpawnStudioOptions = {}): Promise<StudioHandle> {
  registerExitGuard();

  const port = opts.port ?? (await getFreePort());
  const home = opts.home ?? mkdtempSync(join(tmpdir(), 'seeflow-it-'));
  const workspace = join(home, '.seeflow');
  const baseURL = `http://127.0.0.1:${port}`;
  const runId = opts.runId ?? newRunId();
  const logDir = join(ARTIFACT_ROOT, runId);
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const stdoutLogPath = join(logDir, `studio-${port}.stdout.log`);
  const stderrLogPath = join(logDir, `studio-${port}.stderr.log`);
  const stdoutFile = createWriteStream(stdoutLogPath, { flags: 'a' });
  const stderrFile = createWriteStream(stderrLogPath, { flags: 'a' });

  const env: Record<string, string> = {
    ...process.env,
    ...(opts.env ?? {}),
    SEEFLOW_WORKSPACE: home,
    // The foreground flag keeps the child attached so we can capture stdio
    // directly and so SIGTERM/SIGKILL hits the actual server (not a forked
    // daemon child we no longer have a handle to).
    NODE_ENV: 'test',
  };

  const proc = Bun.spawn({
    cmd: ['bun', CLI_ENTRY, 'start', '--port', String(port), '--host', '127.0.0.1', '--foreground'],
    cwd: STUDIO_DIR,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  void pumpStream(proc.stdout, stdoutLines, stdoutFile);
  void pumpStream(proc.stderr, stderrLines, stderrFile);

  const handle: StudioHandle = {
    port,
    baseURL,
    home,
    workspace,
    pid: proc.pid ?? -1,
    logs: { stdout: stdoutLines, stderr: stderrLines },
    stop: () => stopProcess(proc, home, stdoutFile, stderrFile),
  };

  liveHandles.add(handle);
  const origStop = handle.stop;
  handle.stop = async () => {
    liveHandles.delete(handle);
    await origStop();
  };

  try {
    await waitForHealthz(baseURL, opts.healthTimeoutMs);
  } catch (err) {
    // Surface logs so the failure is debuggable, then clean up.
    const tail = (lines: string[]) => lines.slice(-20).join('').slice(-2000);
    const ctx = `\n--- studio stdout (tail) ---\n${tail(stdoutLines)}\n--- studio stderr (tail) ---\n${tail(stderrLines)}`;
    await handle.stop();
    throw new Error(`${err instanceof Error ? err.message : String(err)}${ctx}`);
  }

  return handle;
}

async function pumpStream(
  stream: ReadableStream<Uint8Array> | undefined,
  sink: string[],
  file: WriteStream,
): Promise<void> {
  if (!stream) {
    file.end();
    return;
  }
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      sink.push(chunk);
      file.write(chunk);
    }
  } catch {
    /* stream torn down during stop() — ignore */
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
    file.end();
  }
}

async function stopProcess(
  proc: Subprocess,
  home: string,
  stdoutFile: WriteStream,
  stderrFile: WriteStream,
): Promise<void> {
  if (proc.exitCode === null && !proc.killed) {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* already exiting */
    }
    const exited = await Promise.race([
      proc.exited.then(() => true),
      Bun.sleep(STOP_GRACE_MS).then(() => false),
    ]);
    if (!exited) {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already dead */
      }
      await proc.exited;
    }
  }
  try {
    stdoutFile.end();
  } catch {
    /* already closed */
  }
  try {
    stderrFile.end();
  } catch {
    /* already closed */
  }
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    /* nothing to clean */
  }
}
