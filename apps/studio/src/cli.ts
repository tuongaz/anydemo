#!/usr/bin/env bun
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  drainStdin,
  loadBody,
  parseProjectFlow,
  printError,
  printOk,
  printOutcome,
} from './cli-helpers.ts';
import { COMMAND_MANIFEST, renderCommandHelp, renderCommandList } from './cli-manifest.ts';
import { createCliOperations, registerProject } from './cli-ops.ts';
import { createEventBus } from './events.ts';
import { JqError, applyJq } from './jq-filter.ts';
import type { LayoutOptions } from './layout.ts';
import {
  ConnectorPatchBodySchema,
  FlowBulkBodySchema,
  NodePatchBodySchema,
  ReorderBodySchema,
} from './operations.ts';
import { PROJECT_FLOW_FILENAME, seeflowHome } from './paths.ts';
import { type Registry, createRegistry, manifestOnlyEntryFilter } from './registry.ts';
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

/**
 * Walk argv (after the subcommand at argv[0]) and return non-flag positionals
 * in order. Skips `--name value` and `--name=value` pairs so callers can mix
 * positional arguments freely with --project/--flow (US-020). Boolean-style
 * `--name` flags (e.g. `--no-start`, `--stdin`) are detected because the next
 * argv entry either starts with `--` or is out of bounds.
 */
const positionalArgs = (): string[] => {
  const out: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith('--')) {
      // `--name=value` is self-contained; `--name value` consumes the next slot
      // only when that slot is not itself another flag (boolean flag otherwise).
      if (!arg.includes('=')) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) i++;
      }
      continue;
    }
    out.push(arg);
  }
  return out;
};

const requirePositional = (idx: number, name: string): string => {
  const v = positionalArgs()[idx];
  if (!v) printError(`Missing required positional argument: ${name}`);
  return v as string;
};

/**
 * Resolve the (project, flow) pair every flow-scoped CLI verb expects (US-020).
 * Surfaces clear `Missing required flag: --project|--flow` errors through
 * `printError` instead of throwing — matches the rest of the CLI's exit
 * behaviour. The returned `slug` (`${project}/${flow}`) is what the in-process
 * `ops.*` calls accept via `registry.resolve(idOrSlug)`.
 */
const requireProjectFlow = (): { project: string; flow: string; slug: string } => {
  try {
    const { project, flow } = parseProjectFlow(argv);
    return { project, flow, slug: `${project}/${flow}` };
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
  }
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
} else if (sub === 'projects:list') {
  await runProjectsList();
} else if (sub === 'flows:list') {
  await runFlowsList();
} else if (sub === 'flows:summary') {
  await runFlowsSummary();
} else if (sub === 'flows:get') {
  await runFlowsGet();
} else if (sub === 'flows:graph') {
  await runFlowsGraph();
} else if (sub === 'flows:create') {
  await runFlowsCreate();
} else if (sub === 'flows:rename') {
  await runFlowsRename();
} else if (sub === 'flows:delete') {
  await runFlowsDelete();
} else if (sub === 'flows:layout') {
  await runFlowsLayout();
} else if (sub === 'icons') {
  await runIcons();
} else if (sub === 'flow:add-bulk') {
  await runFlowAddBulk();
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
  register             Register a demo repo. Manifest-aware: when <repoPath>/seeflow.json exists, re-scans every declared flow; otherwise reads <repoPath>/<flow> (defaults to flow.json) as a single-flow project (alias of flows:register)
  flows:register       Register a demo repo (manifest-aware — same behaviour as register)
  projects:create      Scaffold a new project (writes <path>/seeflow.json + <path>/flows/main/flow.json) — (--path <dir> --name <name> [--description <text>])
  projects:list        List every registered project with projectSlug, name, defaultFlow, flowCount
  flows:list           List registered flows. With --project <p>, filters to one project (returns flowSlug, name, icon?, isDefault per flow)
  flows:summary        List registered flows (id + name + description only)
  flows:get            Get flow details (--project <p> --flow <f>)
  flows:graph          List nodes + connectors without inlined file content (--project <p> --flow <f>)
  flows:create         Create a new flow within a project (--project <p> --flow <id> --name <n> [--icon <i>])
  flows:rename         Rename a flow id/name/icon (--project <p> --flow <id> [--new-id <x>] [--name <n>] [--icon <i>])
  flows:delete         Delete a flow (--project <p> --flow <f> [--new-default <other>])
  flows:layout         Apply ELK layout, writing style.json (--project <p> --flow <f>) [--json/--file/--stdin]
  flow:add-bulk        Add many nodes + connectors atomically (--project <p> --flow <f>) [--json/--file/--stdin; body { nodes?, connectors? }]
  nodes:add            Add a node (--project <p> --flow <f>) [--json/--file/--stdin]
  nodes:get <n>        Get a node with detail / html content inlined (--project <p> --flow <f>)
  nodes:patch <n>      Patch a node (--project <p> --flow <f>) [--json/--file/--stdin]
  nodes:move <n>       Move a node (--project <p> --flow <f> --x N --y N)
  nodes:reorder <n>    Reorder a node (--project <p> --flow <f> --op forward|backward|toFront|toBack|toIndex [--index N])
  nodes:delete <n>     Delete a node (--project <p> --flow <f>)
  connectors:add       Add a connector (--project <p> --flow <f>) [--json/--file/--stdin]
  connectors:patch <connId>  Patch a connector (--project <p> --flow <f>) [--json/--file/--stdin]
  connectors:delete <connId> Delete a connector (--project <p> --flow <f>)
  validate             Schema-validate a flow.json (--file <file> [--style <file>])
  schema [<category> [<subname>]] [--jq <path>]
                       Get the flow.json schema. Run this before designing /
                       authoring nodes. No arg → category index with subnames
                       inlined; category arg → full JSON Schema(s) + jqHints;
                       subname arg → one variant + jqHints.dataFields listing
                       every data.<field> available. The 'componentCatalog'
                       category lists every legal componentSpec.elements[].type
                       and its props (drill: 'schema componentCatalog <Name>').
                       Every response carries jqHints.rootPath (the jq prefix
                       for that level). Pair with --jq to slice (e.g. 'schema
                       node rectangle --jq
                       .schemas.rectangle.properties.data.properties.name').
  ids <type> <count>   Print <count> short ids of the given <type>, one per
                       line. <type> is 'node' (-> 'node-...') or 'connector'
                       (-> 'conn-...'). <count> is 1..100. Call once per type
                       when seeding a flow.json (e.g. 'ids node 10', then
                       'ids connector 12').

Icons (local cache):
  icons list           List installed and available vendor packs (aws, azure)
  icons add <v>        Install a vendor pack (v: aws|azure) [--accept-terms] [--pack-url <url>]
  icons update <v>     Re-install a vendor pack — same flags as add
  icons remove <v>     Remove an installed vendor pack (idempotent)

Meta:
  version              Print the CLI version
  help                 Show this help message

Global options:
  --version, -v        Print the CLI version and exit

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

  const registry = createRegistry({ isLoadableEntry: manifestOnlyEntryFilter });
  const events = createEventBus();
  const server = serve({ port, hostname: config.host, registry, events });
  writePid(process.pid);

  const cleanup = () => {
    if (readPid() === process.pid) clearPid();
  };
  const shutdown = () => {
    cleanup();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown());
  process.on('SIGINT', () => shutdown());
  process.on('exit', cleanup);

  console.log(`SeeFlow Studio listening on http://${server.hostname}:${server.port}`);

  await seedExamples(registry);
}

async function seedExamples(registry: Registry) {
  await seedExample(registry, 'order-pipeline');
  await seedExample(registry, 'ecommerce-platform');
  await seedExample(registry, 'component-showcase');
}

async function seedExample(registry: Registry, exampleName: string) {
  const destDir = join(seeflowHome(), exampleName);

  // Always sync from source so that schema changes and example updates are
  // reflected on every startup, even when the dest directory already exists.
  const srcDir = join(import.meta.dir, `../examples/${exampleName}`);
  if (!existsSync(srcDir)) return;
  cpSync(srcDir, destDir, { recursive: true });

  const outcome = registerProject({ repoPath: destDir, registry });
  if (outcome.kind !== 'ok') {
    console.warn(`Skipped example ${exampleName}: ${JSON.stringify(outcome)}`);
    return;
  }
  for (const entry of outcome.entries) {
    console.log(`Seeded example: ${entry.name} → ${destDir} (${entry.slug})`);
  }
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

  // Manifest-aware path: if <repoPath>/seeflow.json is on disk, scan and
  // upsert every declared flow in one shot.
  if (existsSync(join(repoPath, 'seeflow.json'))) {
    await runRegisterManifest(repoPath);
    return;
  }

  // Legacy single-flow path: pre-manifest projects (and skill tests that
  // exercise registerFlow directly) still pass a bare flow.json at the
  // root. Read it, schema-validate, upsert one entry.
  const demoPathArg = flagValue('flow') ?? DEFAULT_FLOW_PATH;
  const fullPath = isAbsolute(demoPathArg) ? demoPathArg : join(repoPath, demoPathArg);
  if (!existsSync(fullPath)) {
    console.error(`No demo file at ${fullPath}`);
    console.error(
      `Create ${DEFAULT_FLOW_PATH} in your repo, or pass --flow <path>. For manifest-driven projects, place a seeflow.json at the repo root.`,
    );
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

async function runRegisterManifest(repoPath: string) {
  const outcome = registerProject({ repoPath });
  if (outcome.kind !== 'ok') {
    switch (outcome.kind) {
      case 'manifest-invalid':
        console.error(`${join(repoPath, 'seeflow.json')} is invalid: ${outcome.message}`);
        process.exit(2);
        break;
      case 'manifest-missing':
        // Defensive — runRegister gated on existsSync, so this should not fire.
        console.error(`No seeflow.json at ${repoPath}`);
        process.exit(3);
        break;
      case 'legacy-root-flow':
        console.error(
          `${repoPath} has a legacy root flow.json but no seeflow.json. Migrate it into the new flows/<id>/ layout before re-registering.`,
        );
        process.exit(3);
        break;
      case 'flow-json-missing':
        console.error(
          `Manifest declares flow "${outcome.flowId}" but ${outcome.flowPath} is missing.`,
        );
        process.exit(3);
        break;
    }
    process.exit(1);
  }

  const pid = readPid();
  const live = pid !== undefined && isPidAlive(pid);
  const overrideUrl = process.env.SEEFLOW_STUDIO_URL?.replace(/\/+$/, '');
  const baseUrl = live ? (overrideUrl ?? studioUrl(readConfig())) : null;

  for (const entry of outcome.entries) {
    const tail = baseUrl
      ? ` → ${baseUrl}/projects/${outcome.projectSlug}/flows/${entry.flowSlug}`
      : ` (slug: ${entry.slug})`;
    console.log(`Registered "${entry.name}"${tail}`);
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
  const project = flagValue('project');
  if (project) {
    const result = ops.listFlowsByProject(project);
    if (result.kind !== 'ok') printOutcome(result);
    printOk({ projectSlug: result.data.projectSlug, flows: result.data.flows });
    return;
  }
  const result = ops.listFlows();
  printOk({ flows: result.data });
}

function runProjectsList() {
  const ops = createCliOperations();
  const result = ops.listProjects();
  printOk({ projects: result.data });
}

async function runFlowsSummary() {
  const ops = createCliOperations();
  const result = ops.listFlowsSummary();
  printOk({ flows: result.data });
}

async function runFlowsGet() {
  const { slug } = requireProjectFlow();
  const ops = createCliOperations();
  const result = await ops.getFlow(slug);
  printOutcome(result);
}

async function runFlowsGraph() {
  const { slug } = requireProjectFlow();
  const ops = createCliOperations();
  const result = await ops.getFlowGraph(slug);
  printOutcome(result);
}

async function runFlowsDelete() {
  await runFlowsDeleteManifest();
}

async function runFlowsCreate() {
  const project = flagValue('project');
  if (!project) printError('Missing required flag: --project');
  const flow = flagValue('flow');
  if (!flow) printError('Missing required flag: --flow');
  const name = flagValue('name');
  if (!name) printError('Missing required flag: --name');
  const icon = flagValue('icon');

  const body: { id: string; name: string; icon?: string } = {
    id: flow as string,
    name: name as string,
  };
  if (icon !== undefined) body.icon = icon;

  const { url } = await studioUrlOrDie(hasFlag('no-start'));
  const res = await postJson(
    `${url}/api/projects/${encodeURIComponent(project as string)}/flows`,
    body,
  );
  const out = (await handleResponse(res)) as object;
  printOk(out);
}

async function runFlowsRename() {
  const project = flagValue('project');
  if (!project) printError('Missing required flag: --project');
  const flow = flagValue('flow');
  if (!flow) printError('Missing required flag: --flow');
  const newId = flagValue('new-id');
  const name = flagValue('name');
  const icon = flagValue('icon');
  if (newId === undefined && name === undefined && icon === undefined) {
    printError('flows:rename requires at least one of --new-id, --name, --icon');
  }

  const body: { id?: string; name?: string; icon?: string } = {};
  if (newId !== undefined) body.id = newId;
  if (name !== undefined) body.name = name;
  if (icon !== undefined) body.icon = icon;

  const { url } = await studioUrlOrDie(hasFlag('no-start'));
  const res = await fetch(
    `${url}/api/projects/${encodeURIComponent(project as string)}/flows/${encodeURIComponent(flow as string)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const out = (await handleResponse(res)) as object;
  printOk(out);
}

async function runFlowsDeleteManifest() {
  const project = flagValue('project');
  if (!project) printError('Missing required flag: --project');
  const flow = flagValue('flow');
  if (!flow) printError('Missing required flag: --flow');
  const newDefault = flagValue('new-default');

  const query = newDefault !== undefined ? `?newDefault=${encodeURIComponent(newDefault)}` : '';
  const { url } = await studioUrlOrDie(hasFlag('no-start'));
  const res = await fetch(
    `${url}/api/projects/${encodeURIComponent(project as string)}/flows/${encodeURIComponent(flow as string)}${query}`,
    { method: 'DELETE' },
  );
  const out = (await handleResponse(res)) as object;
  printOk(out);
}

async function runFlowsLayout() {
  const { slug } = requireProjectFlow();
  // Body is optional — `{ options? }` shape if provided. Empty when omitted.
  let options: LayoutOptions | undefined;
  if (hasFlag('json') || hasFlag('file') || hasFlag('stdin')) {
    const body = (await bodyFromFlags()) as { options?: LayoutOptions } | undefined;
    options = body?.options;
  }
  const ops = createCliOperations();
  const result = await ops.applyLayout(slug, options);
  printOutcome(result);
}

async function runNodesAdd() {
  const { slug } = requireProjectFlow();
  const body = await bodyFromFlags();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    printError('Body must be an object');
  }
  const ops = createCliOperations();
  const result = await ops.addNode(slug, body as Record<string, unknown>);
  printOutcome(result);
}

async function runFlowAddBulk() {
  const { slug } = requireProjectFlow();
  const body = await bodyFromFlags();
  const parsed = FlowBulkBodySchema.safeParse(body);
  if (!parsed.success) {
    printError(`Invalid flow:add-bulk body: ${JSON.stringify(parsed.error.issues)}`);
  }
  const ops = createCliOperations();
  const result = await ops.addBulk(slug, parsed.data);
  printOutcome(result);
}

async function runNodesGet() {
  const { slug } = requireProjectFlow();
  const nodeId = requirePositional(0, '<nodeId>');
  const ops = createCliOperations();
  const result = await ops.getNode(slug, nodeId);
  printOutcome(result);
}

async function runNodesPatch() {
  const { slug } = requireProjectFlow();
  const nodeId = requirePositional(0, '<nodeId>');
  const body = await bodyFromFlags();
  const parsed = NodePatchBodySchema.safeParse(body);
  if (!parsed.success) {
    printError(`Invalid nodes:patch body: ${JSON.stringify(parsed.error.issues)}`);
  }
  const ops = createCliOperations();
  const result = await ops.patchNode(slug, nodeId, parsed.data);
  printOutcome(result);
}

async function runNodesMove() {
  const { slug } = requireProjectFlow();
  const nodeId = requirePositional(0, '<nodeId>');
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
  const result = await ops.moveNode(slug, nodeId, { x, y });
  printOutcome(result);
}

async function runNodesReorder() {
  const { slug } = requireProjectFlow();
  const nodeId = requirePositional(0, '<nodeId>');
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
  const result = await ops.reorderNode(slug, nodeId, parsed.data);
  printOutcome(result);
}

async function runNodesDelete() {
  const { slug } = requireProjectFlow();
  const nodeId = requirePositional(0, '<nodeId>');
  const ops = createCliOperations();
  const result = await ops.deleteNode(slug, nodeId);
  printOutcome(result);
}

async function runConnectorsAdd() {
  const { slug } = requireProjectFlow();
  const body = await bodyFromFlags();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    printError('Body must be an object');
  }
  const ops = createCliOperations();
  const result = await ops.addConnector(slug, body as Record<string, unknown>);
  printOutcome(result);
}

async function runConnectorsPatch() {
  const { slug } = requireProjectFlow();
  const connId = requirePositional(0, '<connectorId>');
  const body = await bodyFromFlags();
  const parsed = ConnectorPatchBodySchema.safeParse(body);
  if (!parsed.success) {
    printError(`Invalid connectors:patch body: ${JSON.stringify(parsed.error.issues)}`);
  }
  const ops = createCliOperations();
  const result = await ops.patchConnector(slug, connId, parsed.data);
  printOutcome(result);
}

async function runConnectorsDelete() {
  const { slug } = requireProjectFlow();
  const connId = requirePositional(0, '<connectorId>');
  const ops = createCliOperations();
  const result = await ops.deleteConnector(slug, connId);
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
  const subname = argv[2] && !argv[2].startsWith('--') ? argv[2] : undefined;
  const jqFilter = flagValue('jq');
  const {
    listSchemaCategories,
    getSchemaCategory,
    getCategorySubschema,
    listCategorySubnames,
    buildJqHints,
    buildIndexJqHints,
    SCHEMA_INDEX_USAGE,
  } = await import('./schema-catalog.ts');
  if (!category) {
    const base = {
      categories: listSchemaCategories(),
      usage: SCHEMA_INDEX_USAGE,
      jqHints: buildIndexJqHints(),
    };
    if (jqFilter !== undefined) {
      printOk({ result: applyJqOrDie(base, jqFilter) });
    }
    printOk(base);
  }
  // Drill into a single named schema within the category — e.g.
  // `seeflow schema node component`. Notes ride along unchanged because the
  // cross-variant invariants (image path prefix, etc.) are still relevant when
  // you're looking at one variant.
  if (subname) {
    const single = getCategorySubschema(category as string, subname);
    if (!single) {
      const availableSubs = listCategorySubnames(category as string);
      if (availableSubs === null) {
        const available = listSchemaCategories().map((c) => c.name);
        const message = `unknown schema category: ${category}`;
        process.stderr.write(
          `${JSON.stringify({ error: message, code: 'notFound', available })}\n`,
        );
        process.exit(3);
      }
      const message = `unknown schema subname: ${subname}`;
      process.stderr.write(
        `${JSON.stringify({
          error: message,
          code: 'notFound',
          category,
          available: availableSubs,
        })}\n`,
      );
      process.exit(3);
    }
    const base = {
      name: category,
      subname,
      schemas: single.schemas,
      notes: single.notes,
      jqHints: buildJqHints(category as string, subname),
    };
    if (jqFilter !== undefined) {
      printOk({ name: category, subname, result: applyJqOrDie(base, jqFilter) });
    }
    printOk(base);
  }
  const payload = getSchemaCategory(category as string);
  if (!payload) {
    const available = listSchemaCategories().map((c) => c.name);
    const message = `unknown schema category: ${category}`;
    process.stderr.write(`${JSON.stringify({ error: message, code: 'notFound', available })}\n`);
    process.exit(3);
  }
  const base = {
    name: category,
    schemas: payload.schemas,
    notes: payload.notes,
    subnames: listCategorySubnames(category as string) ?? [],
    jqHints: buildJqHints(category as string),
  };
  if (jqFilter !== undefined) {
    printOk({ name: category, result: applyJqOrDie(base, jqFilter) });
  }
  printOk(base);
}

// Apply a --jq filter and unwrap a single-result stream into the value
// itself; multi-output streams (from `[]` or `|`) come through as arrays
// so downstream consumers can tell `.foo[]` (multiple) apart from `.foo`
// (single value that happens to be an array). On parse / type errors exits
// with code 2 (badJq).
function applyJqOrDie(input: unknown, filterStr: string): unknown {
  try {
    const stream = applyJq(input, filterStr);
    if (stream.length === 1) return stream[0];
    return stream;
  } catch (err) {
    if (err instanceof JqError) {
      process.stderr.write(`${JSON.stringify({ error: err.message, code: 'badJq' })}\n`);
      process.exit(2);
    }
    throw err;
  }
}

async function runIcons() {
  const action = argv[1];
  switch (action) {
    case undefined:
    case 'list':
      await runIconsList();
      break;
    case 'add':
      await runIconsAdd();
      break;
    case 'update':
      await runIconsUpdate();
      break;
    case 'remove':
      await runIconsRemove();
      break;
    default:
      console.error(`Unknown icons action: ${action}`);
      console.error('Usage: seeflow icons {list|add|update|remove} ...');
      process.exit(1);
  }
}

async function runIconsList() {
  const { iconCacheRoot } = await import('./icons/paths.ts');
  const { readIndex } = await import('./icons/index-store.ts');
  const { summarizePacks } = await import('./icons/list-helper.ts');
  const idx = readIndex(iconCacheRoot());
  printOk({ packs: summarizePacks(idx) });
}

type IconVendorSlug = 'aws' | 'azure';

function parseIconVendor(action: 'add' | 'remove'): IconVendorSlug {
  const vendors: readonly IconVendorSlug[] = ['aws', 'azure'];
  const raw = argv[2];
  if (!raw || raw.startsWith('--')) {
    const suffix = action === 'add' ? ' [--accept-terms] [--pack-url <url>]' : '';
    console.error(`Usage: seeflow icons ${action} <vendor>${suffix}`);
    process.exit(1);
  }
  if (!(vendors as readonly string[]).includes(raw)) {
    console.error(`Unknown vendor: ${raw}. Expected one of: ${vendors.join(', ')}.`);
    process.exit(1);
  }
  return raw as IconVendorSlug;
}

async function runIconsAdd() {
  const vendor = parseIconVendor('add');
  const acceptTerms = hasFlag('accept-terms');
  const packUrl = flagValue('pack-url');

  const { installIconPack } = await import('./icons/installer.ts');
  const { fetchWithProgress } = await import('./icons/fetcher.ts');
  const { iconCacheRoot } = await import('./icons/paths.ts');

  const gen = installIconPack(
    { vendor, acceptTerms, packUrl },
    {
      cacheRoot: iconCacheRoot(),
      now: () => Date.now(),
      version: () => new Date().toISOString().slice(0, 10),
      fetcher: (url: string) =>
        fetchWithProgress(url, {
          onProgress: (bytes) => process.stderr.write(`download-progress ${vendor} ${bytes}\n`),
        }),
    },
  );

  for await (const ev of gen) {
    if (ev.type === 'download-started') {
      process.stderr.write(`download-started ${ev.vendor}\n`);
    } else if (ev.type === 'download-progress') {
      process.stderr.write(`download-progress ${ev.vendor} ${ev.receivedBytes}\n`);
    } else if (ev.type === 'extracting') {
      process.stderr.write(`extracting ${ev.vendor}\n`);
    } else if (ev.type === 'indexing') {
      process.stderr.write(`indexing ${ev.vendor} (${ev.iconCount} icons)\n`);
    } else if (ev.type === 'terms-required') {
      printError(
        `Vendor '${ev.vendor}' requires accepting the license at ${ev.licenseUrl}. Re-run with --accept-terms.`,
      );
    } else if (ev.type === 'error') {
      printError(`Install failed: ${ev.message}`);
    } else if (ev.type === 'done') {
      printOk({ installed: ev.vendor, version: ev.version, iconCount: ev.iconCount });
    }
  }
  printError('Install ended without a terminal event.');
}

async function runIconsUpdate() {
  // Installer's rmSync-then-extract handles wipe; behaviour matches add.
  await runIconsAdd();
}

async function runIconsRemove() {
  const vendor = parseIconVendor('remove');
  const { removeIconPack } = await import('./icons/remove.ts');
  const { iconCacheRoot } = await import('./icons/paths.ts');
  removeIconPack(vendor, { cacheRoot: iconCacheRoot() });
  printOk({ removed: vendor });
}
