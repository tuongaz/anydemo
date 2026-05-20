#!/usr/bin/env bun
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createEventBus } from './events.ts';
import { seeflowHome } from './paths.ts';
import { defaultProcessSpawner } from './process-spawner.ts';
import { type Registry, createRegistry } from './registry.ts';
import {
  DEFAULT_CONFIG,
  clearPid,
  defaultPidPath,
  isPidAlive,
  readConfig,
  readPid,
  studioUrl,
  writeConfig,
  writePid,
} from './runtime.ts';
import { FlowSchema } from './schema.ts';
import { serve } from './server.ts';
import { createStatusRunner } from './status-runner.ts';

const DEFAULT_FLOW_PATH = '.seeflow/flow.json';
const HEALTH_TIMEOUT_MS = 10_000;
const HEALTH_POLL_INTERVAL_MS = 150;
const STOP_TIMEOUT_MS = 5_000;
const STOP_POLL_INTERVAL_MS = 100;

const argv = process.argv.slice(2);
const sub = argv[0];

const flagValue = (name: string): string | undefined => {
  const flag = `--${name}`;
  const eqArg = argv.find((a) => a.startsWith(`${flag}=`));
  if (eqArg) return eqArg.slice(`${flag}=`.length);
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  return undefined;
};

const hasFlag = (name: string): boolean => argv.includes(`--${name}`);

const DEBUG = hasFlag('debug') || process.env.SEEFLOW_DEBUG === '1';
const dbg = (msg: string) => {
  if (DEBUG) console.error(`[debug] ${msg}`);
};
const daemonLogPath = () => join(seeflowHome(), 'seeflow.log');

if (argv.includes('--version') || argv.includes('-v')) {
  await printVersion();
} else if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
  printHelp();
} else if (sub === 'version') {
  await printVersion();
} else if (sub === 'start') {
  await runStart();
} else if (sub === 'stop') {
  await runStop();
} else if (sub === 'register') {
  await runRegister();
} else if (['unregister', 'list'].includes(sub)) {
  console.log(`seeflow ${sub}: not implemented (M1.B)`);
  process.exit(0);
} else {
  console.error(`Unknown subcommand: ${sub}`);
  printHelp();
  process.exit(1);
}

function printHelp() {
  console.log(
    `
seeflow — local studio for file-defined interactive demos

Usage:
  npx tuongaz/seeflow <command> [options]

Commands:
  start             Start the SeeFlow Studio server (default port 4321)
  stop              Stop a background studio instance
  register          Register a demo repo with the running studio
  version           Print the CLI version
  help              Show this help message

Global options:
  --version, -v     Print the CLI version and exit

Options (start):
  --port <n>        Listen on port n (default: 4321)
  --foreground      Run attached to the terminal (default: background)
  --daemon          Deprecated alias — background is already the default
  --debug           Verbose logs + pipe daemon output to ~/.seeflow/seeflow.log

Options (register):
  --path <dir>      Path to repo root (default: current directory)
  --flow <file>     Path to flow JSON, relative to repo root
                    (default: .seeflow/flow.json)
  --no-start        Fail if studio is not already running

Examples:
  npx tuongaz/seeflow start
  npx tuongaz/seeflow start --port 8080
  npx tuongaz/seeflow start --foreground
  npx tuongaz/seeflow register --path ./my-app
  npx tuongaz/seeflow stop
`.trim(),
  );
}

async function runStart() {
  const config = readConfig();
  const portArg = flagValue('port');
  // --port wins; otherwise always fall back to the schema default (not the
  // last persisted value) so a previous run's port doesn't silently stick.
  const port = portArg ? Number(portArg) : DEFAULT_CONFIG.port;
  if (!Number.isFinite(port) || port <= 0) {
    console.error(`Invalid --port: ${portArg}`);
    process.exit(1);
  }

  // Default to background. `--foreground` (or `--no-daemon`) keeps us attached
  // to the terminal; `--daemon` is a no-op alias kept for backwards compat. The
  // SEEFLOW_DAEMON env var marks the spawned child, so it must always run in
  // the foreground to avoid infinite re-spawning.
  const isDaemonChild = process.env.SEEFLOW_DAEMON === '1';
  const wantsForeground = hasFlag('foreground') || hasFlag('no-daemon');
  dbg(
    `runStart port=${port} host=${config.host} mode=${
      isDaemonChild ? 'daemon-child' : wantsForeground ? 'foreground' : 'background'
    }`,
  );
  if (!isDaemonChild && !wantsForeground) {
    await spawnDaemon(port, config.host);
    return;
  }

  // persist the chosen address so other subcommands can find us
  writeConfig({ port, host: config.host });

  const registry = createRegistry();
  const events = createEventBus();
  const statusRunner = createStatusRunner({ registry, events, spawner: defaultProcessSpawner });
  const server = serve({ port, hostname: config.host, registry, events, statusRunner });
  writePid(process.pid);

  const cleanup = () => {
    if (readPid() === process.pid) clearPid();
  };
  const shutdown = async () => {
    cleanup();
    try {
      await statusRunner.stopAll();
    } catch (err) {
      console.warn(
        `[cli] statusRunner.stopAll() failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  process.on('exit', cleanup);

  console.log(`SeeFlow Studio listening on http://${server.hostname}:${server.port}`);

  await seedExamples(registry);
}

async function seedExamples(registry: Registry) {
  await seedExample(registry, 'order-pipeline');
  await seedExample(registry, 'ecommerce-platform');
}

async function seedExample(registry: Registry, exampleName: string) {
  const destDir = join(seeflowHome(), exampleName);
  const flowPath = '.seeflow/flow.json';

  // Always sync from source so that schema changes and example updates are
  // reflected on every startup, even when the dest directory already exists.
  const srcDir = join(import.meta.dir, `../examples/${exampleName}`);
  if (!existsSync(srcDir)) return;
  cpSync(srcDir, destDir, { recursive: true });

  if (registry.getByRepoPathAndFlowPath(destDir, flowPath)) return;

  const flowFile = join(destDir, flowPath);
  if (!existsSync(flowFile)) return;

  let demo: unknown;
  try {
    demo = await Bun.file(flowFile).json();
  } catch {
    return;
  }

  const parsed = FlowSchema.safeParse(demo);
  if (!parsed.success) return;

  registry.upsert({ name: parsed.data.name, repoPath: destDir, flowPath });
  console.log(`Seeded example: ${parsed.data.name} → ${destDir}`);
}

async function spawnDaemon(port: number, host: string) {
  const url = `http://${host}:${port}`;
  dbg(`probing existing studio at ${url}/health`);
  if (await healthOk(url)) {
    console.log(`Studio already running at ${url}`);
    return;
  }

  const proc = spawnDetachedStudio(port);
  writePid(proc.pid);
  writeConfig({ port, host });
  dbg(`spawned daemon pid=${proc.pid}${proc.logPath ? ` log=${proc.logPath}` : ''}`);

  if (!(await waitForHealth(url, HEALTH_TIMEOUT_MS))) {
    console.error(`Timed out waiting for studio at ${url}/health`);
    reportDaemonFailure(proc.logPath);
    process.exit(1);
  }
  console.log(`SeeFlow Studio started in background on ${url} (pid ${proc.pid})`);
  if (proc.logPath) console.log(`Daemon log: ${proc.logPath}`);
}

function spawnDetachedStudio(port: number): { pid: number; logPath?: string } {
  let stdout: 'ignore' | number = 'ignore';
  let stderr: 'ignore' | number = 'ignore';
  let logPath: string | undefined;
  if (DEBUG) {
    logPath = daemonLogPath();
    mkdirSync(dirname(logPath), { recursive: true });
    const fd = openSync(logPath, 'a');
    // Bun owns the fd once spawn runs; we close our handle after spawn returns.
    stdout = fd;
    stderr = fd;
  }
  const cmd = [process.execPath, import.meta.path, 'start', `--port=${port}`];
  if (DEBUG) cmd.push('--debug');
  const proc = Bun.spawn({
    cmd,
    stdio: ['ignore', stdout, stderr],
    env: {
      ...process.env,
      SEEFLOW_DAEMON: '1',
      ...(DEBUG ? { SEEFLOW_DEBUG: '1' } : {}),
    },
  });
  proc.unref();
  if (typeof stdout === 'number') closeSync(stdout);
  return { pid: proc.pid, logPath };
}

function reportDaemonFailure(logPath: string | undefined) {
  if (!logPath) {
    console.error('Hint: rerun with --debug to capture the daemon output.');
    return;
  }
  let log: string;
  try {
    log = readFileSync(logPath, 'utf8');
  } catch (err) {
    console.error(`(could not read ${logPath}: ${err instanceof Error ? err.message : err})`);
    return;
  }
  const tail = log.split('\n').slice(-50).join('\n');
  console.error(`\nLast lines of ${logPath}:`);
  console.error(tail || '(log is empty — daemon exited before writing anything)');
}

async function printVersion() {
  const pkgPath = join(import.meta.dir, '../package.json');
  const pkg = (await Bun.file(pkgPath).json()) as { version?: string };
  console.log(pkg.version ?? 'unknown');
}

async function runStop() {
  const pid = readPid();
  if (!pid) {
    console.log(`No studio running (no pid file at ${defaultPidPath()}).`);
    return;
  }
  if (!isPidAlive(pid)) {
    console.log(`Stale pid file (pid ${pid} not running); cleaning up.`);
    clearPid();
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (isEsrch(err)) {
      console.log(`Studio (pid ${pid}) was already gone.`);
      clearPid();
      return;
    }
    console.error(`Failed to signal pid ${pid}: ${String(err)}`);
    process.exit(1);
  }

  if (await waitForExit(pid, STOP_TIMEOUT_MS)) {
    console.log(`Stopped studio (pid ${pid}).`);
    clearPid();
    return;
  }

  // Still alive after timeout — escalate.
  try {
    process.kill(pid, 'SIGKILL');
  } catch (err) {
    if (isEsrch(err)) {
      console.log(`Stopped studio (pid ${pid}).`);
      clearPid();
      return;
    }
    console.error(`Failed to force-kill pid ${pid}: ${String(err)}`);
    process.exit(1);
  }
  console.warn(`Force-killed studio (pid ${pid}) after ${STOP_TIMEOUT_MS}ms.`);
  clearPid();
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await Bun.sleep(STOP_POLL_INTERVAL_MS);
  }
  return !isPidAlive(pid);
}

function isEsrch(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ESRCH';
}

async function runRegister() {
  const repoPath = resolve(flagValue('path') ?? '.');
  const demoPathArg = flagValue('flow') ?? DEFAULT_FLOW_PATH;
  const noStart = hasFlag('no-start');
  const config = readConfig();
  const overrideUrl = process.env.SEEFLOW_STUDIO_URL?.replace(/\/+$/, '');
  const url = overrideUrl ?? studioUrl(config);

  const fullPath = isAbsolute(demoPathArg) ? demoPathArg : join(repoPath, demoPathArg);
  if (!existsSync(fullPath)) {
    console.error(`No demo file at ${fullPath}`);
    console.error(`Create ${DEFAULT_FLOW_PATH} in your repo, or pass --flow <path>.`);
    process.exit(1);
  }

  let demo: unknown;
  try {
    demo = await Bun.file(fullPath).json();
  } catch (err) {
    console.error(`Failed to parse ${fullPath}: ${String(err)}`);
    process.exit(1);
  }

  const parsed = FlowSchema.safeParse(demo);
  if (!parsed.success) {
    console.error(`${fullPath} failed schema validation:`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.') || '<root>'}: ${issue.message}`);
    }
    process.exit(1);
  }

  await ensureStudioRunning(url, config.port, noStart);

  let res: Response;
  try {
    res = await fetch(`${url}/api/flows/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: parsed.data.name,
        repoPath,
        flowPath: demoPathArg,
      }),
    });
  } catch (err) {
    console.error(`Could not reach studio at ${url}: ${String(err)}`);
    console.error('Start it first: seeflow start');
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(`Studio returned ${res.status}: ${text}`);
    process.exit(1);
  }

  const body = (await res.json()) as {
    id: string;
    slug: string;
    sdk?: { outcome: 'written' | 'present' | 'skipped'; filePath: string | null };
  };
  console.log(`Registered "${parsed.data.name}" → ${url}/d/${body.slug}`);

  if (body.sdk?.outcome === 'written') {
    console.log(`Wrote ${body.sdk.filePath} (event-bound state node detected)`);
  } else if (body.sdk?.outcome === 'present') {
    console.log(`SDK helper already present at ${body.sdk.filePath} (skipped)`);
  }
}

async function ensureStudioRunning(url: string, port: number, noStart: boolean) {
  if (await healthOk(url)) return;

  // Health failed — maybe the recorded pid is alive and still booting.
  const pid = readPid();
  if (pid && isPidAlive(pid) && (await waitForHealth(url, HEALTH_TIMEOUT_MS))) return;

  if (noStart) {
    console.error(`Studio is not running at ${url}.`);
    console.error('Start it first: seeflow start');
    process.exit(1);
  }

  console.log(`Studio not running at ${url}; starting in background...`);
  const proc = spawnDetachedStudio(port);
  writePid(proc.pid);

  if (!(await waitForHealth(url, HEALTH_TIMEOUT_MS))) {
    console.error(`Studio did not respond at ${url}/health within ${HEALTH_TIMEOUT_MS}ms`);
    process.exit(1);
  }
  console.log(`Studio started (pid ${proc.pid}).`);
}

async function healthOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let probe = 0;
  while (Date.now() < deadline) {
    probe++;
    const ok = await healthOk(url);
    dbg(`health probe #${probe} → ${ok ? 'ok' : 'no'} (${url}/health)`);
    if (ok) return true;
    await Bun.sleep(HEALTH_POLL_INTERVAL_MS);
  }
  return false;
}
