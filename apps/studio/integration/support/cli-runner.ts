import { join, resolve } from 'node:path';

// Resolve relative to apps/studio/ so tests can be run from any cwd.
const STUDIO_DIR = resolve(import.meta.dir, '../..');
const CLI_ENTRY = join(STUDIO_DIR, 'src/cli.ts');

const DEFAULT_TIMEOUT_MS = 30_000;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface RunCliOptions {
  env?: Record<string, string>;
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
}

export async function runCli(args: string[], opts: RunCliOptions = {}): Promise<CliResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  for (const [k, v] of Object.entries(opts.env ?? {})) env[k] = v;
  const startedAt = performance.now();

  const proc = Bun.spawn({
    cmd: ['bun', CLI_ENTRY, ...args],
    cwd: opts.cwd ?? STUDIO_DIR,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: opts.stdin === undefined ? 'ignore' : 'pipe',
  });

  if (opts.stdin !== undefined && proc.stdin) {
    const writer = proc.stdin as
      | WritableStream<Uint8Array>
      | { write: (b: Uint8Array) => unknown; end?: () => unknown };
    if (typeof (writer as WritableStream<Uint8Array>).getWriter === 'function') {
      const w = (writer as WritableStream<Uint8Array>).getWriter();
      await w.write(new TextEncoder().encode(opts.stdin));
      await w.close();
    } else if (typeof (writer as { write: (b: Uint8Array) => unknown }).write === 'function') {
      (writer as { write: (b: Uint8Array) => unknown }).write(new TextEncoder().encode(opts.stdin));
      (writer as { end?: () => unknown }).end?.();
    }
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already exited */
    }
  }, timeoutMs);

  const [stdoutBuf, stderrBuf, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  const durationMs = performance.now() - startedAt;

  if (timedOut) {
    throw new Error(
      `runCli timed out after ${timeoutMs}ms (args: ${JSON.stringify(args)})\nstdout: ${stdoutBuf.slice(-500)}\nstderr: ${stderrBuf.slice(-500)}`,
    );
  }

  return { code: code ?? -1, stdout: stdoutBuf, stderr: stderrBuf, durationMs };
}
