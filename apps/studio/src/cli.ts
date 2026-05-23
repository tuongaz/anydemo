#!/usr/bin/env bun
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { drainStdin, loadBody, printError, printOk, printOutcome } from './cli-helpers.ts';
import { COMMAND_MANIFEST, renderCommandHelp, renderCommandList } from './cli-manifest.ts';
import { createCliOperations } from './cli-ops.ts';
import { createEventBus } from './events.ts';
import type { LayoutOptions } from './layout.ts';
import {
  ConnectorPatchBodySchema,
  FlowBulkBodySchema,
  NodePatchBodySchema,
  ReorderBodySchema,
} from './operations.ts';
import { PROJECT_FLOW_FILENAME, seeflowHome } from './paths.ts';
import { defaultProcessSpawner } from './process-spawner.ts';
import { type Registry, createRegistry } from './registry.ts';
import {
  DEFAULT_CONFIG,
  clearPid,
  defaultPidPath,
  isPidAlive,
  portInUse,
  readConfig,
  readPid,
  studioUrl,
  writeConfig,
  writePid,
} from './runtime.ts';
import { FlowSchema } from './schema.ts';
import { serve } from './server.ts';
import { MAX_ID_COUNT, generateIds, isIdType } from './short-id.ts';
import { createStatusRunner } from './status-runner.ts';

const DEFAULT_FLOW_PATH = PROJECT_FLOW_FILENAME;
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

const requireArg = (idx: number, name: string): string => {
  const v = argv[idx];
  if (!v || v.startsWith('--')) {
    printError(`Missing required positional argument: ${name}`);
  }
  return v as string;
};

async function studioUrlOrDie(noStart: boolean): Promise<{ url: string; port: number }> {
  const config = readConfig();
  const overrideUrl = process.env.SEEFLOW_STUDIO_URL?.replace(/\/+$/, '');
  const url = overrideUrl ?? studioUrl(config);
  await ensureStudioRunning(url, config.port, noStart);
  return { url, port: config.port };
}

async function bodyFromFlags(): Promise<unknown> {
  return loadBody(
    { json: flagValue('json'), file: flagValue('file'), stdin: hasFlag('stdin') },
    drainStdin,
  );
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function handleResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  if (!res.ok) {
    const detail =
      typeof parsed === 'object' && parsed !== null
        ? JSON.stringify(parsed)
        : String(parsed).slice(0, 500);
    printError(`Studio returned ${res.status}: ${detail}`);
  }
  return parsed;
}

const DEBUG = hasFlag('debug') || process.env.SEEFLOW_DEBUG === '1';
const dbg = (msg: string) => {
  if (DEBUG) console.error(`[debug] ${msg}`);
};
const daemonLogPath = () => join(seeflowHome(), 'seeflow.log');

if (argv.includes('--version') || argv.includes('-v')) {
  await printVersion();
} else if (sub === 'help' || sub === '--help' || sub === '-h') {
  await runHelp();
} else if (sub === 'version') {
  await printVersion();
} else if (!sub || sub === 'start' || sub.startsWith('-')) {
  await runStart();
} else if (sub === 'stop') {
  await runStop();
} else if (sub === 'register') {
  await runRegister();
} else if (sub === 'flows:register') {
  await runRegister();
} else if (sub === 'projects:create') {
  await runProjectsCreate();
} else if (sub === 'flows:list') {
  await runFlowsList();
} else if (sub === 'flows:summary') {
  await runFlowsSummary();
} else if (sub === 'flows:get') {
  await runFlowsGet();
} else if (sub === 'flows:graph') {
  await runFlowsGraph();
} else if (sub === 'flows:delete') {
  await runFlowsDelete();
} else if (sub === 'flows:layout') {
  await runFlowsLayout();
} else if (sub === 'flow:add-bulk') {
  await runFlowAddBulk();
} else if (sub === 'flows:play') {
  await runFlowsPlay();
} else if (sub === 'nodes:add') {
  await runNodesAdd();
} else if (sub === 'nodes:get') {
  await runNodesGet();
} else if (sub === 'nodes:patch') {
  await runNodesPatch();
} else if (sub === 'nodes:move') {
  await runNodesMove();
} else if (sub === 'nodes:reorder') {
  await runNodesReorder();
} else if (sub === 'nodes:delete') {
  await runNodesDelete();
} else if (sub === 'connectors:add') {
  await runConnectorsAdd();
} else if (sub === 'connectors:patch') {
  await runConnectorsPatch();
} else if (sub === 'connectors:delete') {
  await runConnectorsDelete();
} else if (sub === 'validate') {
  await runValidate();
} else if (sub === 'schema') {
  await runSchema();
} else if (sub === 'ids') {
  await runIds();
} else if (sub === 'e2e') {
  await runE2e();
} else if (sub === 'emit') {
  await runEmit();
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
  npx -y @tuongaz/seeflow@latest [command] [options]

Commands (work without a running studio):
  start                Start the SeeFlow Studio server (default port 4321) — default when no command is given
  stop                 Stop a background studio instance
  register             Register a demo repo, writing to ~/.seeflow/registry.json (alias of flows:register)
  flows:register       Register a demo repo
  projects:create      Create a new project (--path <dir> --name <name> [--description <text>])
  flows:list           List registered flows
  flows:summary        List registered flows (id + name + description only)
  flows:get <id>       Get flow details
  flows:graph <id>     List nodes + connectors without inlined file content
  flows:delete <id>    Unregister a flow
  flows:layout <id>    Apply ELK layout, writing style.json (--json/--file/--stdin optional)
  flow:add-bulk <id>   Add many nodes + connectors atomically (--json/--file/--stdin; body { nodes?, connectors? })
  nodes:add <id>       Add a node (--json/--file/--stdin)
  nodes:get <id> <n>   Get a node with detail / html content inlined
  nodes:patch <id> <n> Patch a node (--json/--file/--stdin)
  nodes:move <id> <n>  Move a node (--x N --y N)
  nodes:reorder <id> <n> Reorder a node (--op forward|backward|toFront|toBack|toIndex [--index N])
  nodes:delete <id> <n> Delete a node
  connectors:add <id>  Add a connector (--json/--file/--stdin)
  connectors:patch <id> <connId>  Patch a connector (--json/--file/--stdin)
  connectors:delete <id> <connId> Delete a connector
  validate             Schema-validate a flow.json (--file <file> [--style <file>])
  schema [<category>]  Get the flow.json schema. No arg → category index;
                       category arg → full JSON Schema(s) for that category
  ids <type> <count>   Print <count> short ids of the given <type>, one per
                       line. <type> is 'node' (-> 'node-...') or 'connector'
                       (-> 'conn-...'). <count> is 1..100. Call once per type
                       when seeding a flow.json (e.g. 'ids node 10', then
                       'ids connector 12').

Commands (require a running studio):
  flows:play <id> <n>  Trigger a play on node <n>
  emit <id> <n> <st>   Broadcast a status event for node <n> (st: running|done|error)
                       [--run-id <id>] [--payload <json>] [--studio-url <url>]
  e2e <id>             End-to-end validate a registered flow (--skip-nodes a,b)

Meta:
  version              Print the CLI version
  help                 Show this help message

Global options:
  --version, -v        Print the CLI version and exit
  --no-start           For flows:play / e2e: fail instead of auto-starting the studio

Body source flags (where applicable):
  --json '<JSON>'      Inline JSON body
  --file <path>        Read JSON body from file
  --stdin              Read JSON body from stdin

Options (start):
  --port <n>           Listen on port n (default: 4321)
  --foreground         Run attached to the terminal (default: background)
  --daemon             Deprecated alias — background is already the default
  --debug              Verbose logs + pipe daemon output to ~/.seeflow/seeflow.log

Options (register):
  --path <dir>         Path to repo root (default: current directory)
  --flow <file>        Path to flow JSON, relative to repo root
                       (default: flow.json)

Examples:
  npx -y @tuongaz/seeflow@latest
  npx -y @tuongaz/seeflow@latest --port 8080
  npx -y @tuongaz/seeflow@latest start --foreground
  npx -y @tuongaz/seeflow@latest register --path ./my-app
  npx -y @tuongaz/seeflow@latest projects:create --path ./checkout --name "Checkout"
  npx -y @tuongaz/seeflow@latest flows:list
  npx -y @tuongaz/seeflow@latest stop
`.trim(),
  );
}

async function runHelp() {
  const target = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
  if (target) {
    try {
      console.log(renderCommandHelp(target));
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
    return;
  }
  console.log(renderCommandList());
}

// Pre-flight: refuse to start if the studio port already has a TCP listener.
// We deliberately do NOT probe Vite's port (5173) here — `bun run dev` spawns
// Vite alongside the studio, so Vite legitimately owns 5173 in dev mode and a
// probe can't distinguish "our Vite" from a stranger. If Vite's port is taken
// by something else, Vite itself surfaces the conflict.
async function assertPortFree(studioPort: number, host: string): Promise<void> {
  if (!(await portInUse(host, studioPort))) return;
  console.error(
    `Cannot start SeeFlow: port ${studioPort} already in use.\n` +
      `Stop the running server on ${studioPort} first, then retry.`,
  );
  process.exit(1);
}

async function runStart() {
  mkdirSync(seeflowHome(), { recursive: true });
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

  // Defense-in-depth: parent already checked in spawnDaemon, but a race
  // between parent-check and child-bind can still let another process grab
  // the port. Re-check here so the child fails fast with a clear error
  // instead of EADDRINUSE at bind time.
  await assertPortFree(port, config.host);

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
  const flowPath = PROJECT_FLOW_FILENAME;

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

  // Studio port must be free before we fork a detached child — otherwise the
  // user waits HEALTH_TIMEOUT_MS for a doomed health probe before seeing a
  // generic timeout error.
  await assertPortFree(port, host);

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

async function runIds() {
  const typeArg = argv[1];
  if (!typeArg || typeArg.startsWith('--')) {
    printError("Missing required positional argument: type (expected 'node' or 'connector')");
  }
  if (!isIdType(typeArg)) {
    printError(`Invalid type: ${typeArg} (expected 'node' or 'connector')`);
  }
  const rawCount = argv[2];
  if (!rawCount || rawCount.startsWith('--')) {
    printError(`Missing required positional argument: count (integer 1..${MAX_ID_COUNT})`);
  }
  const count = Number.parseInt(rawCount as string, 10);
  if (!Number.isFinite(count) || count < 1 || count > MAX_ID_COUNT) {
    printError(`Invalid count: ${rawCount} (expected an integer in [1, ${MAX_ID_COUNT}])`);
  }
  for (const id of generateIds(typeArg, count)) process.stdout.write(`${id}\n`);
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

  const ops = createCliOperations();
  const result = await ops.registerFlow({
    name: parsed.data.name,
    repoPath,
    flowPath: demoPathArg,
  });
  if (result.kind !== 'ok') {
    printOutcome(result);
  }
  const body = result.data;

  // Show the studio URL only when a daemon is actually running.
  const pid = readPid();
  if (pid && isPidAlive(pid)) {
    const config = readConfig();
    const overrideUrl = process.env.SEEFLOW_STUDIO_URL?.replace(/\/+$/, '');
    const url = overrideUrl ?? studioUrl(config);
    console.log(`Registered "${parsed.data.name}" → ${url}/d/${body.slug}`);
  } else {
    console.log(`Registered "${parsed.data.name}" (slug: ${body.slug})`);
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

// ---- HTTP-passthrough subcommands ----------------------------------------

async function runProjectsCreate() {
  const rawPath = flagValue('path');
  if (!rawPath) printError('Missing required flag: --path');
  const name = flagValue('name');
  if (!name) printError('Missing required flag: --name');
  const description = flagValue('description');

  const ops = createCliOperations();
  const result = await ops.createProject({
    path: resolve(rawPath as string),
    name: name as string,
    ...(description !== undefined ? { description } : {}),
  });
  printOutcome(result);
}

async function runFlowsList() {
  const ops = createCliOperations();
  const result = ops.listFlows();
  printOk({ flows: result.data });
}

async function runFlowsSummary() {
  const ops = createCliOperations();
  const result = ops.listFlowsSummary();
  printOk({ flows: result.data });
}

async function runFlowsGet() {
  const flowId = requireArg(1, '<flowId>');
  const ops = createCliOperations();
  const result = await ops.getFlow(flowId);
  printOutcome(result);
}

async function runFlowsGraph() {
  const flowId = requireArg(1, '<flowId>');
  const ops = createCliOperations();
  const result = await ops.getFlowGraph(flowId);
  printOutcome(result);
}

async function runFlowsDelete() {
  const flowId = requireArg(1, '<flowId>');
  const ops = createCliOperations();
  const result = ops.deleteFlow(flowId);
  printOutcome(result);
}

async function runFlowsLayout() {
  const flowId = requireArg(1, '<flowId>');
  // Body is optional — `{ options? }` shape if provided. Empty when omitted.
  let options: LayoutOptions | undefined;
  if (hasFlag('json') || hasFlag('file') || hasFlag('stdin')) {
    const body = (await bodyFromFlags()) as { options?: LayoutOptions } | undefined;
    options = body?.options;
  }
  const ops = createCliOperations();
  const result = await ops.applyLayout(flowId, options);
  printOutcome(result);
}

async function runFlowsPlay() {
  const flowId = requireArg(1, '<flowId>');
  const nodeId = requireArg(2, '<nodeId>');
  const { url } = await studioUrlOrDie(hasFlag('no-start'));
  const res = await postJson(
    `${url}/api/flows/${encodeURIComponent(flowId)}/play/${encodeURIComponent(nodeId)}`,
    {},
  );
  const out = (await handleResponse(res)) as object;
  printOk(out);
}

async function runEmit() {
  const flowId = requireArg(1, '<flowId>');
  const nodeId = requireArg(2, '<nodeId>');
  const status = requireArg(3, '<status>');
  if (status !== 'running' && status !== 'done' && status !== 'error') {
    printError(`Invalid status: ${status} (expected running | done | error)`);
  }

  const runId = flagValue('run-id');
  const rawPayload = flagValue('payload');
  let payload: unknown;
  if (rawPayload !== undefined) {
    try {
      payload = JSON.parse(rawPayload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printError(`--payload must be valid JSON: ${message}`);
    }
  }

  // Explicit --studio-url targets a specific instance; skip auto-start since
  // the caller is asserting where the studio lives.
  const studioUrlFlag = flagValue('studio-url');
  let url: string;
  if (studioUrlFlag) {
    url = studioUrlFlag.replace(/\/+$/, '');
  } else {
    ({ url } = await studioUrlOrDie(hasFlag('no-start')));
  }

  const body: Record<string, unknown> = { flowId, nodeId, status };
  if (runId !== undefined) body.runId = runId;
  if (payload !== undefined) body.payload = payload;

  const res = await postJson(`${url}/api/emit`, body);
  const out = (await handleResponse(res)) as object;
  printOk(out);
}

async function runNodesAdd() {
  const flowId = requireArg(1, '<flowId>');
  const body = await bodyFromFlags();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    printError('Body must be an object');
  }
  const ops = createCliOperations();
  const result = await ops.addNode(flowId, body as Record<string, unknown>);
  printOutcome(result);
}

async function runFlowAddBulk() {
  const flowId = requireArg(1, '<flowId>');
  const body = await bodyFromFlags();
  const parsed = FlowBulkBodySchema.safeParse(body);
  if (!parsed.success) {
    printError(`Invalid flow:add-bulk body: ${JSON.stringify(parsed.error.issues)}`);
  }
  const ops = createCliOperations();
  const result = await ops.addBulk(flowId, parsed.data);
  printOutcome(result);
}

async function runNodesGet() {
  const flowId = requireArg(1, '<flowId>');
  const nodeId = requireArg(2, '<nodeId>');
  const ops = createCliOperations();
  const result = await ops.getNode(flowId, nodeId);
  printOutcome(result);
}

async function runNodesPatch() {
  const flowId = requireArg(1, '<flowId>');
  const nodeId = requireArg(2, '<nodeId>');
  const body = await bodyFromFlags();
  const parsed = NodePatchBodySchema.safeParse(body);
  if (!parsed.success) {
    printError(`Invalid nodes:patch body: ${JSON.stringify(parsed.error.issues)}`);
  }
  const ops = createCliOperations();
  const result = await ops.patchNode(flowId, nodeId, parsed.data);
  printOutcome(result);
}

async function runNodesMove() {
  const flowId = requireArg(1, '<flowId>');
  const nodeId = requireArg(2, '<nodeId>');
  const xRaw = flagValue('x');
  const yRaw = flagValue('y');
  if (xRaw === undefined || yRaw === undefined) {
    printError('nodes:move requires --x <n> --y <n>');
  }
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    printError('--x and --y must be finite numbers');
  }
  const ops = createCliOperations();
  const result = await ops.moveNode(flowId, nodeId, { x, y });
  printOutcome(result);
}

async function runNodesReorder() {
  const flowId = requireArg(1, '<flowId>');
  const nodeId = requireArg(2, '<nodeId>');
  const op = flagValue('op');
  if (!op) printError('nodes:reorder requires --op forward|backward|toFront|toBack|toIndex');
  let raw: Record<string, unknown> = { op };
  if (op === 'toIndex') {
    const idxRaw = flagValue('index');
    if (idxRaw === undefined) printError('nodes:reorder --op toIndex requires --index <n>');
    const index = Number(idxRaw);
    if (!Number.isInteger(index) || index < 0) {
      printError('--index must be a non-negative integer');
    }
    raw = { op, index };
  }
  const parsed = ReorderBodySchema.safeParse(raw);
  if (!parsed.success) {
    printError(`Invalid nodes:reorder body: ${JSON.stringify(parsed.error.issues)}`);
  }
  const ops = createCliOperations();
  const result = await ops.reorderNode(flowId, nodeId, parsed.data);
  printOutcome(result);
}

async function runNodesDelete() {
  const flowId = requireArg(1, '<flowId>');
  const nodeId = requireArg(2, '<nodeId>');
  const ops = createCliOperations();
  const result = await ops.deleteNode(flowId, nodeId);
  printOutcome(result);
}

async function runConnectorsAdd() {
  const flowId = requireArg(1, '<flowId>');
  const body = await bodyFromFlags();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    printError('Body must be an object');
  }
  const ops = createCliOperations();
  const result = await ops.addConnector(flowId, body as Record<string, unknown>);
  printOutcome(result);
}

async function runConnectorsPatch() {
  const flowId = requireArg(1, '<flowId>');
  const connId = requireArg(2, '<connectorId>');
  const body = await bodyFromFlags();
  const parsed = ConnectorPatchBodySchema.safeParse(body);
  if (!parsed.success) {
    printError(`Invalid connectors:patch body: ${JSON.stringify(parsed.error.issues)}`);
  }
  const ops = createCliOperations();
  const result = await ops.patchConnector(flowId, connId, parsed.data);
  printOutcome(result);
}

async function runConnectorsDelete() {
  const flowId = requireArg(1, '<flowId>');
  const connId = requireArg(2, '<connectorId>');
  const ops = createCliOperations();
  const result = await ops.deleteConnector(flowId, connId);
  printOutcome(result);
}

async function runValidate() {
  const file = flagValue('file');
  const styleFile = flagValue('style');
  if (!file) printError('Missing required flag: --file <flow.json>');
  let flow: unknown;
  try {
    flow = JSON.parse(readFileSync(file as string, 'utf8'));
  } catch (err) {
    printError(`Failed to read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let style: unknown;
  if (styleFile) {
    try {
      style = JSON.parse(readFileSync(styleFile, 'utf8'));
    } catch (err) {
      printError(
        `Failed to read ${styleFile}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const ops = createCliOperations();
  const body = ops.validate({ flow, style });
  if (body.ok === false) {
    printError(`Schema validation failed: ${JSON.stringify(body.issues ?? [])}`);
  }
  printOk(body);
}

async function runSchema() {
  const category = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
  const { listSchemaCategories, getSchemaCategory } = await import('./schema-catalog.ts');
  if (!category) {
    printOk({ categories: listSchemaCategories() });
  }
  const payload = getSchemaCategory(category as string);
  if (!payload) {
    const available = listSchemaCategories().map((c) => c.name);
    const message = `unknown schema category: ${category}`;
    process.stderr.write(`${JSON.stringify({ error: message, code: 'notFound', available })}\n`);
    process.exit(3);
  }
  printOk({ name: category, schemas: payload.schemas, notes: payload.notes });
}

async function runE2e() {
  const flowId = requireArg(1, '<flowId>');
  const skipNodesRaw = flagValue('skip-nodes');
  const skipNodes = skipNodesRaw ? skipNodesRaw.split(',').filter(Boolean) : [];
  const { url } = await studioUrlOrDie(hasFlag('no-start'));
  const { validateEndToEnd } = await import('./cli-e2e.ts');
  const report = await validateEndToEnd({ flowId, url, skipNodes });
  if (!report.ok) {
    process.stderr.write(`${JSON.stringify(report)}\n`);
    process.exit(1);
  }
  printOk(report);
}
