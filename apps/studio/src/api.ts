import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  AssembleRequestSchema,
  ProposeScopeRequestSchema,
  ValidateRequestSchema,
  assembleDemo,
  proposeScope,
  validateDemo,
} from './diagram.ts';
import type { EventBus } from './events.ts';
import { type LayoutOptions, computeLayout } from './layout.ts';
import {
  ConnectorPatchBodySchema,
  ConnectorsBulkBodySchema,
  CreateProjectBodySchema,
  NodePatchBodySchema,
  NodesBulkBodySchema,
  PositionBodySchema,
  RegisterBodySchema,
  ReorderBodySchema,
  type ValidateBody,
  createOperations,
  resolveFilePath,
  writeFileAtomic,
} from './operations.ts';
import type { ProcessSpawner } from './process-spawner.ts';
import {
  type PlayResult,
  type ResetResult,
  type RunPlayOptions,
  type RunResetOptions,
  runPlay as defaultRunPlay,
  runReset as defaultRunReset,
  stopAllPlays as defaultStopAllPlays,
} from './proxy.ts';
import type { Registry } from './registry.ts';
import { FlowSchema, ResolvedFlowSchema } from './schema.ts';
import { type Spawner, defaultSpawner } from './shellout.ts';
import type { StatusRunner } from './status-runner.ts';
import { readMergedFlow } from './watcher.ts';
import type { FlowWatcher } from './watcher.ts';

const EmitBodySchema = z.object({
  flowId: z.string().min(1),
  nodeId: z.string().min(1),
  status: z.enum(['running', 'done', 'error']),
  runId: z.string().optional(),
  payload: z.unknown().optional(),
});

type RelativePathCheck = { kind: 'ok' } | { kind: 'invalid'; reason: string };

// Reject absolute paths and `..` traversal before any filesystem touch.
// Realpath verification is layered on top by the caller for symlink defense.
const validateRelativePath = (path: string): RelativePathCheck => {
  if (path.length === 0) return { kind: 'invalid', reason: 'path is empty' };
  if (isAbsolute(path) || path.startsWith('/') || path.startsWith('\\')) {
    return { kind: 'invalid', reason: 'absolute paths are not allowed' };
  }
  const segments = path.split(/[\\/]/);
  if (segments.some((s) => s === '..')) {
    return { kind: 'invalid', reason: 'path traversal is not allowed' };
  }
  return { kind: 'ok' };
};

const EMIT_STATUS_TO_EVENT = {
  running: 'node:running',
  done: 'node:done',
  error: 'node:error',
} as const;

const FilePathBodySchema = z.object({ path: z.string() });

type ResolvedProjectFile =
  | { kind: 'ok'; absPath: string; seeflowRoot: string }
  | { kind: 'unknownProject' }
  | { kind: 'invalidPath'; reason: string }
  | { kind: 'fileMissing'; absPath: string };

// Shared path-safety + filesystem resolution for project-scoped file routes.
// Performs textual rejection of absolute paths / `..` traversal, then layered
// realpath verification that the resolved file stays inside `<project>/.seeflow/`
// (defense against symlink escapes). Returns the realpath of an existing file
// on success, or `fileMissing` with the would-be absolute path so callers can
// soft-fail with that path included for clipboard fallback.
function resolveProjectFile(
  registry: Registry,
  projectId: string,
  relPath: string,
): ResolvedProjectFile {
  const entry = registry.getById(projectId);
  if (!entry) return { kind: 'unknownProject' };

  const guard = validateRelativePath(relPath);
  if (guard.kind === 'invalid') return { kind: 'invalidPath', reason: guard.reason };

  const seeflowRoot = join(entry.repoPath, '.seeflow');
  let realRoot: string;
  try {
    realRoot = realpathSync(seeflowRoot);
  } catch {
    return { kind: 'fileMissing', absPath: resolve(seeflowRoot, relPath) };
  }

  const target = resolve(seeflowRoot, relPath);
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    return { kind: 'fileMissing', absPath: target };
  }

  const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realTarget !== realRoot && !realTarget.startsWith(rootWithSep)) {
    return { kind: 'invalidPath', reason: 'path escapes project root' };
  }

  return { kind: 'ok', absPath: realTarget, seeflowRoot: realRoot };
}

// Allowed extensions for /nodes/:nodeId/files/upload. Lowercased; matched after dropping the
// leading `.`. Stored as a Set so future expansion (PDF, video) is one-edit.
const UPLOAD_ALLOWED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

// Turn a user-supplied filename into a `<slug>.<ext>` pair. Returns null when
// the extension isn't on the allowlist or the slug is empty after sanitization.
function sanitizeUploadFilename(name: string): { base: string; ext: string } | null {
  const last = name.split(/[\\/]/).pop() ?? name;
  const dotIdx = last.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === last.length - 1) return null;
  const ext = last.slice(dotIdx).toLowerCase();
  if (!UPLOAD_ALLOWED_EXTS.has(ext)) return null;
  const slug = last
    .slice(0, dotIdx)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length === 0) return null;
  return { base: slug, ext };
}

// Find the first unused `<base>.<ext>` (then `<base>-2.<ext>`, `<base>-3.<ext>`,
// …) inside `assetsDir`. Caps at 999 attempts to avoid an unbounded loop on a
// pathologically full directory.
function pickUploadFilename(assetsDir: string, base: string, ext: string): string {
  const first = `${base}${ext}`;
  if (!existsSync(join(assetsDir, first))) return first;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!existsSync(join(assetsDir, candidate))) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

export interface ApiOptions {
  registry: Registry;
  events?: EventBus;
  watcher?: FlowWatcher;
  /** Injectable shellout for tests; defaults to Bun.spawn fire-and-forget. */
  spawner?: Spawner;
  /** Override `process.platform` for tests covering darwin/win32/linux branches. */
  platform?: NodeJS.Platform;
  /** Long-running statusAction runner; fanned out on each /play click. */
  statusRunner?: StatusRunner;
  /** Injectable ProcessSpawner threaded into runPlay; tests use this to avoid
   *  launching real child processes for the play-action script. */
  processSpawner?: ProcessSpawner;
  /** Injectable proxy facade — defaults wrap the proxy.ts module exports.
   *  Tests use this to record call order across runPlay / runReset /
   *  stopAllPlays and to drive each in isolation. */
  proxy?: ProxyFacade;
  /** Override base directory for new projects. Defaults to ~/.seeflow. Tests inject a tmp dir. */
  projectBaseDir?: string;
}

/**
 * Thin call-through wrapper around the proxy.ts module exports. Lets tests
 * inject a recording fake to assert call order across runPlay, runReset, and
 * stopAllPlays — none of which can be observed via the underlying
 * ProcessSpawner alone because the play-run map and event broadcasts are
 * encapsulated inside proxy.ts.
 */
export interface ProxyFacade {
  runPlay(options: RunPlayOptions): Promise<PlayResult>;
  runReset(options: RunResetOptions): Promise<ResetResult>;
  stopAllPlays(flowId: string): Promise<void>;
}

export const defaultProxyFacade: ProxyFacade = {
  runPlay: defaultRunPlay,
  runReset: defaultRunReset,
  stopAllPlays: defaultStopAllPlays,
};

export function createApi(options: ApiOptions): Hono {
  const { registry, events, watcher, statusRunner } = options;
  const spawner = options.spawner ?? defaultSpawner;
  const platform = options.platform ?? process.platform;
  const processSpawner = options.processSpawner;
  const proxy = options.proxy ?? defaultProxyFacade;
  const projectBaseDir = options.projectBaseDir;
  const ops = createOperations({ registry, watcher, projectBaseDir });
  const api = new Hono();

  api.post('/flows/register', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }

    const parsed = RegisterBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid register body', issues: parsed.error.issues }, 400);
    }

    const result = await ops.registerFlow(parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json(result.data);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 400);
      case 'badJson':
        return c.json({ error: 'Flow file is not valid JSON', detail: result.detail }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow file failed schema validation', issues: result.issues }, 400);
      case 'sdkWriteFailed':
        return c.json(
          {
            error: `Failed to write SDK helper: ${result.message}`,
            id: result.id,
            slug: result.slug,
          },
          500,
        );
    }
  });

  // POST /api/flows/validate — dry-run validation. The skill's diagram
  // pipeline calls this between assemble and register to decide whether to
  // rewire. Runs the Zod schema, the soft node cap, and the tier playability
  // check. Filesystem-bound checks (harness coverage, event emitter index)
  // stay in the skill since the studio doesn't see the user's $TARGET.
  api.post('/flows/validate', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = ValidateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid validate body', issues: parsed.error.issues }, 400);
    }
    return c.json(validateDemo(parsed.data));
  });

  // POST /api/validate — stateless schema validator for the flow + optional
  // style files. No flow id, no registry side-effects, no file:// resolution
  // (validation is structural only). Returns 200 even on validation failure —
  // the result is the validation report itself.
  api.post('/validate', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    if (!body || typeof body !== 'object' || !('flow' in body)) {
      return c.json({ error: 'Body must be { flow, style? }' }, 400);
    }
    return c.json(ops.validate(body as ValidateBody));
  });

  // POST /api/diagram/propose-scope — Phase 2 helper. The skill POSTs the
  // scan-result.json shape and gets back ranked entry-point candidates.
  // Pure compute; skill writes the response to intermediate/entry-candidates.json.
  api.post('/diagram/propose-scope', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = ProposeScopeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid propose-scope body', issues: parsed.error.issues }, 400);
    }
    return c.json(proposeScope(parsed.data));
  });

  // POST /api/diagram/assemble — Phase 7a. The skill POSTs wiring + layout
  // and gets back the assembled demo (IDs normalized, dupes dropped, dangling
  // connectors removed, positions snapped to a 24px grid). Pure compute; the
  // skill writes the response to $TARGET/.seeflow/flow.json. No schema
  // validation here — call /demos/validate for that.
  api.post('/diagram/assemble', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = AssembleRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid assemble body', issues: parsed.error.issues }, 400);
    }
    return c.json(await assembleDemo(parsed.data));
  });

  // POST /api/layout — stateless ELK layout. Two request shapes:
  //   1. `{ flow, options? }` — skill (Phase 3 + Phase 5). Flow is validated
  //      through FlowSchema; failure returns `{ ok: false, issues }` matching
  //      /api/validate's shape.
  //   2. `{ nodes, edges, options? }` — canvas Tidy button. Loose structural
  //      input (id + type + measured width/height per node, id + source +
  //      target per edge). Skips FlowSchema validation since Tidy has DOM
  //      sizes but not full node data payloads.
  // Both return `{ ok: true, nodes, connectors }` — positions keyed by node
  // id, handle assignments keyed by connector id. Pure compute; no
  // persistence.
  api.post('/layout', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    if (!body || typeof body !== 'object') {
      return c.json(
        { error: 'Body must be { flow, options? } or { nodes, edges, options? }' },
        400,
      );
    }
    const options = (body as { options?: LayoutOptions }).options;

    if ('flow' in body) {
      const flowParse = FlowSchema.safeParse((body as { flow: unknown }).flow);
      if (!flowParse.success) {
        return c.json({
          ok: false as const,
          issues: flowParse.error.issues.map((i) => ({
            scope: 'flow' as const,
            path: [...i.path],
            message: i.message,
            code: i.code,
          })),
        });
      }
      const flow = flowParse.data;
      const result = await computeLayout(
        flow.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          // Only `shape` matters for layout (floating-annotation detection +
          // shape-specific sizing). Other Flow data fields are irrelevant.
          data:
            n.type === 'shapeNode' ? { shape: (n.data as { shape?: string }).shape } : undefined,
        })),
        flow.connectors.map((c) => ({ id: c.id, source: c.source, target: c.target })),
        options,
      );
      return c.json({ ok: true as const, nodes: result.nodes, connectors: result.connectors });
    }

    if ('nodes' in body && 'edges' in body) {
      const { nodes, edges } = body as { nodes: unknown; edges: unknown };
      if (!Array.isArray(nodes) || !Array.isArray(edges)) {
        return c.json({ error: '`nodes` and `edges` must be arrays' }, 400);
      }
      // Trust the caller-supplied structural input — Tidy already measures
      // DOM dimensions, so we use them verbatim. Any malformed entry is
      // dropped silently rather than failing the whole layout.
      const layoutNodes = nodes
        .filter(
          (n): n is { id: string; type: string; width?: number; height?: number } =>
            n && typeof n === 'object' && typeof (n as { id?: unknown }).id === 'string',
        )
        .map((n) => ({
          id: n.id,
          type: n.type as
            | 'playNode'
            | 'stateNode'
            | 'shapeNode'
            | 'imageNode'
            | 'iconNode'
            | 'htmlNode',
          data:
            typeof n.width === 'number' && typeof n.height === 'number'
              ? { width: n.width, height: n.height }
              : undefined,
        }));
      const layoutEdges = edges
        .filter(
          (e): e is { id: string; source: string; target: string } =>
            e &&
            typeof e === 'object' &&
            typeof (e as { id?: unknown }).id === 'string' &&
            typeof (e as { source?: unknown }).source === 'string' &&
            typeof (e as { target?: unknown }).target === 'string',
        )
        .map((e) => ({ id: e.id, source: e.source, target: e.target }));
      const result = await computeLayout(layoutNodes, layoutEdges, options);
      return c.json({ ok: true as const, nodes: result.nodes, connectors: result.connectors });
    }

    return c.json({ error: 'Body must be { flow, options? } or { nodes, edges, options? }' }, 400);
  });

  // POST /api/projects — UI-driven "Create new project" flow (US-020). Two
  // branches based on whether the target folder already has a SeeFlow
  // project set up at `<folderPath>/.seeflow/flow.json`:
  //   1. Existing setup: read + validate the on-disk demo and register it
  //      as-is (no overwrite, no scaffolding). The user-supplied `name`
  //      becomes the registry display name; the on-disk demo's `name` is
  //      preserved on disk.
  //   2. Fresh scaffold: mkdir -p the folder + .seeflow/, write a default
  //      scaffold flow.json keyed off `name`, and run the same SDK-emit
  //      helper write the CLI register flow uses (a no-op for an empty
  //      scaffold, but kept for parity).
  api.post('/projects', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }

    const parsed = CreateProjectBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid create project body', issues: parsed.error.issues }, 400);
    }

    const result = await ops.createProject(parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json(result.data);
      case 'badJson':
        return c.json({ error: `Existing demo file is not valid JSON: ${result.detail}` }, 400);
      case 'badSchema':
        return c.json(
          { error: 'Existing demo file failed schema validation', issues: result.issues },
          400,
        );
      case 'scaffoldFailed':
        return c.json({ error: `Failed to scaffold project: ${result.message}` }, 500);
      case 'sdkWriteFailed':
        return c.json({ error: `Failed to write SDK helper: ${result.message}` }, 500);
    }
  });

  api.get('/flows', (c) => {
    const result = ops.listFlows();
    return c.json(result.data);
  });

  // Lightweight projection: id, name, description only. Reads from the
  // watcher snapshot when available so author edits to flow.json show up
  // immediately; falls back to the registry copy persisted at register time.
  api.get('/flows/summary', (c) => {
    const result = ops.listFlowsSummary();
    return c.json(result.data);
  });

  api.get('/flows/:id', async (c) => {
    const result = await ops.getFlow(c.req.param('id'));
    switch (result.kind) {
      case 'ok':
        return c.json(result.data);
      case 'notFound':
        return c.json({ error: 'not found' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
    }
  });

  // Flow skeleton without per-node file content (detail.md / view.html).
  // Pairs with GET /flows/:id/nodes/:nodeId for full per-node detail.
  api.get('/flows/:id/graph', async (c) => {
    const result = await ops.getFlowGraph(c.req.param('id'));
    switch (result.kind) {
      case 'ok':
        return c.json(result.data);
      case 'notFound':
        return c.json({ error: 'not found' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: 'Flow file is not valid JSON', detail: result.detail }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow file failed schema validation', issues: result.issues }, 400);
    }
  });

  api.get('/flows/:id/nodes/:nodeId', async (c) => {
    const result = await ops.getNode(c.req.param('id'), c.req.param('nodeId'));
    switch (result.kind) {
      case 'ok':
        return c.json(result.data);
      case 'notFound':
        return c.json({ error: 'not found' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'unknownNode':
        return c.json({ error: `Unknown nodeId: ${c.req.param('nodeId')}` }, 404);
      case 'badJson':
        return c.json({ error: 'Flow file is not valid JSON', detail: result.detail }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow file failed schema validation', issues: result.issues }, 400);
    }
  });

  // GET /api/projects/:id/files/<path> — stream a project-scoped file from
  // <repoPath>/.seeflow/<path>. Path safety is layered: textual rejection
  // (absolute / traversal), then realpath check that the resolved file stays
  // inside the project's .seeflow root (defends against symlink escapes).
  api.get('/projects/:id/files/:path{.+}', async (c) => {
    const rawPath = c.req.param('path');
    let relPath: string;
    try {
      relPath = decodeURIComponent(rawPath);
    } catch {
      return c.json({ error: 'invalid path encoding' }, 400);
    }

    const resolved = resolveProjectFile(registry, c.req.param('id'), relPath);
    switch (resolved.kind) {
      case 'unknownProject':
        return c.json({ error: 'unknown project' }, 404);
      case 'invalidPath':
        return c.json({ error: resolved.reason }, 400);
      case 'fileMissing':
        return c.json({ error: 'file not found' }, 404);
    }

    const file = Bun.file(resolved.absPath);
    if (!(await file.exists())) {
      return c.json({ error: 'file not found' }, 404);
    }

    return new Response(file.stream(), {
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'content-length': String(file.size),
      },
    });
  });

  // POST /api/projects/:id/files/open — shell out to `$EDITOR <abs>` so the
  // user can edit a project-scoped file (htmlNode block, image asset) in
  // their IDE. The endpoint always returns the resolved absolute path in
  // the response body so the frontend can copy-to-clipboard when $EDITOR
  // isn't set or the spawn fails. Path safety mirrors the GET route.
  api.post('/projects/:id/files/open', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = FilePathBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid open body', issues: parsed.error.issues }, 400);
    }

    const resolved = resolveProjectFile(registry, c.req.param('id'), parsed.data.path);
    switch (resolved.kind) {
      case 'unknownProject':
        return c.json({ error: 'unknown project' }, 404);
      case 'invalidPath':
        return c.json({ error: resolved.reason }, 400);
      case 'fileMissing':
        return c.json({ error: 'file not found', absPath: resolved.absPath }, 404);
    }

    const editor = process.env.EDITOR;
    if (!editor || editor.trim().length === 0) {
      return c.json({ ok: false, absPath: resolved.absPath, error: 'EDITOR not set' });
    }

    const run = await spawner(editor, [resolved.absPath]);
    if (!run.ok) {
      return c.json({ ok: false, absPath: resolved.absPath, error: run.error ?? 'spawn failed' });
    }
    return c.json({ ok: true, absPath: resolved.absPath });
  });

  // POST /api/projects/:id/files/reveal — open the OS file manager with the
  // target file selected. Platform commands: `open -R <abs>` (macOS),
  // `explorer /select,<abs>` (Windows), `xdg-open <dir>` (Linux — selects the
  // containing directory; xdg has no portable "select-this-file" verb). Same
  // fallback shape as /open: response always includes `absPath` for clipboard.
  api.post('/projects/:id/files/reveal', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = FilePathBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid reveal body', issues: parsed.error.issues }, 400);
    }

    const resolved = resolveProjectFile(registry, c.req.param('id'), parsed.data.path);
    switch (resolved.kind) {
      case 'unknownProject':
        return c.json({ error: 'unknown project' }, 404);
      case 'invalidPath':
        return c.json({ error: resolved.reason }, 400);
      case 'fileMissing':
        return c.json({ error: 'file not found', absPath: resolved.absPath }, 404);
    }

    let cmd: string;
    let args: string[];
    switch (platform) {
      case 'darwin':
        cmd = 'open';
        args = ['-R', resolved.absPath];
        break;
      case 'win32':
        cmd = 'explorer';
        args = [`/select,${resolved.absPath}`];
        break;
      default:
        cmd = 'xdg-open';
        args = [dirname(resolved.absPath)];
        break;
    }

    const run = await spawner(cmd, args);
    if (!run.ok) {
      return c.json({ ok: false, absPath: resolved.absPath, error: run.error ?? 'spawn failed' });
    }
    return c.json({ ok: true, absPath: resolved.absPath });
  });

  // POST /api/projects/:id/nodes/:nodeId/files/upload — accept a multipart
  // image upload and persist it under `<project>/.seeflow/nodes/<nodeId>/`.
  // Multipart shape: `file` (Blob) and optional `filename` (the original OS
  // name). Allowlist + 5 MB cap guard against arbitrary uploads; the
  // destination folder is scoped to the node, so delete_node's removeNodeDir
  // cascade cleans up the asset along with the node row.
  api.post('/projects/:id/nodes/:nodeId/files/upload', async (c) => {
    const projectId = c.req.param('id');
    const nodeId = c.req.param('nodeId');
    const entry = registry.getById(projectId);
    if (!entry) return c.json({ error: 'unknown project' }, 404);

    // node id shape: `node-<10 base62 chars>` (matches shortId() output).
    if (!/^node-[A-Za-z0-9]{10}$/.test(nodeId)) {
      return c.json({ error: 'invalid nodeId' }, 400);
    }

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: 'Body must be valid multipart form-data' }, 400);
    }

    const fileField = form.get('file');
    if (!(fileField instanceof File)) {
      return c.json({ error: 'Missing file field' }, 400);
    }
    if (fileField.size > UPLOAD_MAX_BYTES) {
      return c.json({ error: 'file too large', maxBytes: UPLOAD_MAX_BYTES }, 413);
    }

    const suggestedRaw = form.get('filename');
    const suggested =
      typeof suggestedRaw === 'string' && suggestedRaw.length > 0 ? suggestedRaw : fileField.name;
    const sanitized = sanitizeUploadFilename(suggested);
    if (!sanitized) {
      return c.json({ error: 'invalid filename or extension' }, 400);
    }

    const nodeDir = join(entry.repoPath, '.seeflow', 'nodes', nodeId);
    try {
      mkdirSync(nodeDir, { recursive: true });
    } catch (err) {
      return c.json(
        {
          error: `Failed to create node dir: ${err instanceof Error ? err.message : String(err)}`,
        },
        500,
      );
    }

    const finalName = pickUploadFilename(nodeDir, sanitized.base, sanitized.ext);
    const absPath = join(nodeDir, finalName);
    try {
      await Bun.write(absPath, fileField);
    } catch (err) {
      return c.json(
        { error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}` },
        500,
      );
    }

    return c.json({ path: `nodes/${nodeId}/${finalName}` });
  });

  api.delete('/flows/:id', (c) => {
    const result = ops.deleteFlow(c.req.param('id'));
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true });
      case 'notFound':
        return c.json({ ok: false, error: 'not found' }, 404);
    }
  });

  // POST /api/flows/:id/layout — registered-flow ELK layout. Reads flow.json
  // from disk via the registry entry, computes layout, writes style.json
  // atomically next to flow.json, and broadcasts flow:reload so any open
  // canvas refreshes. Body is empty or `{ options? }`. Response on success is
  // just `{ ok: true }` — the layout is already on disk. On schema failure
  // returns `{ ok: false, issues }` mirroring /api/validate; on missing flow
  // file / unknown id / bad JSON / write failure returns HTTP 4xx/5xx.
  api.post('/flows/:id/layout', async (c) => {
    const id = c.req.param('id');
    const entry = registry.getById(id);
    if (!entry) return c.json({ error: 'unknown demo' }, 404);

    const flowAbs = resolveFilePath(entry.repoPath, entry.flowPath);
    if (!existsSync(flowAbs)) return c.json({ error: `Flow file not found: ${flowAbs}` }, 404);

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(flowAbs, 'utf8'));
    } catch (err) {
      return c.json(
        {
          error: 'Flow file is not valid JSON',
          detail: err instanceof Error ? err.message : String(err),
        },
        400,
      );
    }

    const flowParse = FlowSchema.safeParse(raw);
    if (!flowParse.success) {
      return c.json({
        ok: false as const,
        issues: flowParse.error.issues.map((i) => ({
          scope: 'flow' as const,
          path: [...i.path],
          message: i.message,
          code: i.code,
        })),
      });
    }

    // Empty body is valid — the skill always uses defaults. Only parse if the
    // caller actually sent something.
    let options: LayoutOptions | undefined;
    const text = await c.req.text();
    if (text.length > 0) {
      try {
        const parsed = JSON.parse(text) as { options?: LayoutOptions };
        options = parsed?.options;
      } catch {
        return c.json({ error: 'Body must be valid JSON' }, 400);
      }
    }

    const flow = flowParse.data;
    const result = await computeLayout(
      flow.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        // Only `shape` matters for layout (floating-annotation detection +
        // shape-specific sizing). Other Flow data fields are irrelevant.
        data: n.type === 'shapeNode' ? { shape: (n.data as { shape?: string }).shape } : undefined,
      })),
      flow.connectors.map((c) => ({ id: c.id, source: c.source, target: c.target })),
      options,
    );

    const styleAbs = join(dirname(flowAbs), 'style.json');
    const styleContent = `${JSON.stringify(result, null, 2)}\n`;
    try {
      writeFileAtomic(styleAbs, styleContent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to write style file: ${msg}` }, 500);
    }

    // Reparse + notifyWritten: the watcher seeds its snapshot AND broadcasts
    // flow:reload with the new merged payload directly, while suppressing the
    // fs-watcher echo that the style.json write would otherwise trigger.
    const snap = watcher?.reparse(id);
    if (watcher && snap) {
      const flowContent = readFileSync(flowAbs, 'utf8');
      watcher.notifyWritten(id, snap, flowContent, styleContent);
    } else {
      // No watcher (test harness, or watch() hasn't been called yet) — emit a
      // bare flow:reload so any subscribers still react.
      events?.broadcast({ type: 'flow:reload', flowId: id, payload: {} });
    }
    return c.json({ ok: true as const });
  });

  api.post('/flows/:id/play/:nodeId', async (c) => {
    const id = c.req.param('id');
    const nodeId = c.req.param('nodeId');
    const entry = registry.getById(id);
    if (!entry) return c.json({ error: 'unknown demo' }, 404);
    if (!events) return c.json({ error: 'events not enabled' }, 500);

    // Always re-read from disk so the user's most recent edit (validated or
    // not yet observed by the watcher) drives the actual fetch.
    const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
    if (!existsSync(fullPath)) {
      return c.json({ error: `Flow file not found: ${fullPath}` }, 404);
    }
    const merged = readMergedFlow(fullPath);
    if (!merged.flow) {
      const error = merged.error ?? 'Flow read failed';
      const status = error.startsWith('Invalid JSON in') ? 400 : 400;
      return c.json({ error }, status);
    }

    const node = merged.flow.nodes.find((n) => n.id === nodeId);
    if (!node) return c.json({ error: `Unknown nodeId: ${nodeId}` }, 404);
    if (
      node.type === 'shapeNode' ||
      node.type === 'imageNode' ||
      node.type === 'iconNode' ||
      node.type === 'htmlNode' ||
      !node.data.playAction
    ) {
      return c.json({ error: `Node ${nodeId} has no playAction` }, 400);
    }

    // Fan out the long-running statusAction scripts BEFORE awaiting the play
    // spawn — fire-and-forget so a slow status batch can't delay the click.
    // Individual spawn failures are surfaced via console.warn but never fail
    // the /play call itself.
    if (statusRunner) {
      void statusRunner.restart(id).catch((err) => {
        console.warn(
          `[api] statusRunner.restart(${id}) failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    const result = await proxy.runPlay({
      events,
      flowId: id,
      nodeId,
      cwd: entry.repoPath,
      action: node.data.playAction,
      spawner: processSpawner,
    });

    // Surface the symlink-escape error as a 400 so the frontend can show a
    // distinct "fix your scriptPath" message instead of a generic run failure.
    if (result.error === 'scriptPath escapes project root') {
      return c.json({ error: result.error }, 400);
    }
    return c.json(result);
  });

  // POST /api/flows/:id/reset — the "Restart demo" workflow (US-008). Order:
  //   1. Stop every live play-script + every long-running status-script for
  //      this demo in parallel — both must complete before any reset script
  //      spawns so the script sees no stragglers.
  //   2. Run the demo's `resetAction` script (if declared); any non-zero exit
  //      becomes a 502 to the caller but does NOT suppress reload/restart.
  //   3. Broadcast `flow:reload` unconditionally so the canvas re-fetches.
  //   4. Fire-and-forget `statusRunner.restart` so the next status batch is
  //      spawning by the time the response lands. Individual spawn failures
  //      surface via console.warn but never fail the /reset call.
  api.post('/flows/:id/reset', async (c) => {
    const id = c.req.param('id');
    const entry = registry.getById(id);
    if (!entry) return c.json({ error: 'unknown demo' }, 404);
    if (!events) return c.json({ error: 'events not enabled' }, 500);

    const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
    if (!existsSync(fullPath)) {
      return c.json({ error: `Flow file not found: ${fullPath}` }, 404);
    }
    const merged = readMergedFlow(fullPath);
    if (!merged.flow) {
      return c.json({ error: merged.error ?? 'Flow read failed' }, 400);
    }

    // 1. Stop every play + status script in parallel. await BOTH before
    //    spawning the reset script so a still-running play can't race the
    //    reset and re-dirty the running app's state.
    const stopPromises: Array<Promise<void>> = [proxy.stopAllPlays(id)];
    if (statusRunner) stopPromises.push(statusRunner.stop(id));
    await Promise.all(stopPromises);

    // 2. Run resetAction (if declared).
    const resetAction = merged.flow.resetAction;
    let calledResetAction = false;
    let resetActionError: string | undefined;

    if (resetAction) {
      calledResetAction = true;
      const result = await proxy.runReset({
        events,
        flowId: id,
        cwd: entry.repoPath,
        action: resetAction,
      });
      if (!result.ok && result.error) {
        resetActionError = result.error;
      }
    }

    // 3. Broadcast reload unconditionally — even when resetAction failed,
    //    the canvas should still refresh from disk in case the user just
    //    edited the file.
    events.broadcast({
      type: 'flow:reload',
      flowId: id,
      payload: {},
    });

    // 4. Fire-and-forget the next status batch.
    if (statusRunner) {
      void statusRunner.restart(id).catch((err) => {
        console.warn(
          `[api] statusRunner.restart(${id}) failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    if (resetActionError) {
      return c.json({ error: resetActionError, calledResetAction }, 502);
    }
    return c.json({ ok: true, calledResetAction });
  });

  // PATCH a single node's position back into the on-disk flow.json. This is
  // the second (and only other) place the studio mutates user files — the
  // first being the SDK helper write in `register`. Atomic write via tempfile
  // + rename keeps editor diffs clean and avoids corruption mid-write.
  api.patch('/flows/:id/nodes/:nodeId/position', async (c) => {
    const id = c.req.param('id');
    const nodeId = c.req.param('nodeId');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = PositionBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid position body', issues: parsed.error.issues }, 400);
    }

    const result = await ops.moveNode(id, nodeId, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true, position: result.data.position });
      case 'flowNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: `Flow file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow failed schema validation', issues: result.issues }, 400);
      case 'unknownNode':
        return c.json({ error: `Unknown nodeId: ${nodeId}` }, 404);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  // PATCH the z-order position of a single node within demo.nodes[]. React
  // Flow's painter renders nodes in array order, so moving a node to a later
  // index brings it visually forward (later nodes paint over earlier ones).
  // Five ops are supported: forward / backward (single-step swap), toFront /
  // toBack (remove + push/unshift), and toIndex (pin to an absolute index)
  // which the undo path uses to faithfully revert forward/backward gestures
  // even if the array changed between the original op and the undo.
  api.patch('/flows/:id/nodes/:nodeId/order', async (c) => {
    const id = c.req.param('id');
    const nodeId = c.req.param('nodeId');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = ReorderBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid reorder body', issues: parsed.error.issues }, 400);
    }

    const result = await ops.reorderNode(id, nodeId, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true });
      case 'flowNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: `Flow file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow failed schema validation', issues: result.issues }, 400);
      case 'unknownNode':
        return c.json({ error: `Unknown nodeId: ${nodeId}` }, 404);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  // PATCH a single node — partial update of position, label, detail, visual
  // fields, or shapeNode-only fields. Every UI-driven node edit (other than
  // the high-frequency drag fast-path above) flows through here. The mutation
  // is performed against the raw parsed JSON (so unknown v2 fields the schema
  // doesn't yet recognize survive round-trips) and the WHOLE resulting demo
  // is re-validated through ResolvedFlowSchema before commit, preventing partial
  // writes from breaking invariants like the connector→node superRefine.
  api.patch('/flows/:id/nodes/:nodeId', async (c) => {
    const id = c.req.param('id');
    const nodeId = c.req.param('nodeId');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = NodePatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid node patch body', issues: parsed.error.issues }, 400);
    }

    const result = await ops.patchNode(id, nodeId, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true });
      case 'flowNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: `Flow file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow failed schema validation', issues: result.issues }, 400);
      case 'unknownNode':
        return c.json({ error: `Unknown nodeId: ${nodeId}` }, 404);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  // POST a new node into the demo. Body is the node payload (id auto-generated
  // server-side if absent). Atomicity + final-ResolvedFlowSchema validation match the
  // PATCH path above, so a malformed node never produces a half-written file.
  api.post('/flows/:id/nodes', async (c) => {
    const id = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Body must be an object' }, 400);
    }

    const result = await ops.addNode(id, body as Record<string, unknown>);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true, id: result.data.id, node: result.data.node });
      case 'flowNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: `Flow file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow failed schema validation', issues: result.issues }, 400);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  // Bulk-create up to 100 nodes in one transactional write. Either the whole
  // batch lands and a single flow:reload broadcast fires, or nothing lands.
  // Intended for skill/LLM seeding where N singular calls would burn tokens
  // and round-trip latency. Per-item shape mirrors the singular endpoint.
  api.post('/flows/:id/nodes/bulk', async (c) => {
    const id = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = NodesBulkBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid bulk nodes body', issues: parsed.error.issues }, 400);
    }

    const result = await ops.addNodesBulk(id, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true, nodes: result.data.nodes });
      case 'flowNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: `Flow file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow failed schema validation', issues: result.issues }, 400);
      case 'duplicateIdInBatch':
        return c.json({ error: `Duplicate id in batch: ${result.id}` }, 400);
      case 'idAlreadyExists':
        return c.json({ error: `Node id already exists: ${result.id}` }, 400);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  // DELETE a node and cascade-remove every connector with source === nodeId or
  // target === nodeId in the same atomic write. Final-ResolvedFlowSchema validation
  // is still run after the mutation — connector cascade closure means it
  // should always pass, but the check makes the failure mode honest if the
  // file had a pre-existing schema violation we'd otherwise paper over.
  api.delete('/flows/:id/nodes/:nodeId', async (c) => {
    const id = c.req.param('id');
    const nodeId = c.req.param('nodeId');

    const result = await ops.deleteNode(id, nodeId);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true });
      case 'flowNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: `Flow file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow failed schema validation', issues: result.issues }, 400);
      case 'unknownNode':
        return c.json({ error: `Unknown nodeId: ${nodeId}` }, 404);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  // PATCH a single connector — partial update of label/style/color/direction
  // and (optionally) kind + per-kind payload fields. When `kind` changes,
  // stale kind-specific fields are dropped before the merge. The whole demo
  // is re-validated through ResolvedFlowSchema before commit so the discriminated
  // union catches missing-required-fields (e.g. kind='event' without
  // eventName) and the superRefine still gates source/target referential
  // integrity.
  api.patch('/flows/:id/connectors/:connId', async (c) => {
    const id = c.req.param('id');
    const connId = c.req.param('connId');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = ConnectorPatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid connector patch body', issues: parsed.error.issues }, 400);
    }

    const result = await ops.patchConnector(id, connId, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true });
      case 'flowNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: `Flow file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow failed schema validation', issues: result.issues }, 400);
      case 'unknownConnector':
        return c.json({ error: `Unknown connectorId: ${connId}` }, 404);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  // POST a new connector. Body is the connector payload; `id` is auto-generated
  // server-side if absent and `kind` defaults to 'default' (the no-semantics
  // user-drawn variant). Source/target referential integrity is enforced by
  // ResolvedFlowSchema's superRefine on the post-mutation parse.
  api.post('/flows/:id/connectors', async (c) => {
    const id = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Body must be an object' }, 400);
    }

    const result = await ops.addConnector(id, body as Record<string, unknown>);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true, id: result.data.id });
      case 'flowNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: `Flow file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow failed schema validation', issues: result.issues }, 400);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  // Bulk-create up to 100 connectors in one transactional write. Mirrors the
  // /nodes/bulk shape. Dangling source/target on any item rolls back the whole
  // batch via the post-mutation ResolvedFlowSchema parse.
  api.post('/flows/:id/connectors/bulk', async (c) => {
    const id = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = ConnectorsBulkBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid bulk connectors body', issues: parsed.error.issues }, 400);
    }

    const result = await ops.addConnectorsBulk(id, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true, connectors: result.data.connectors });
      case 'flowNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: `Flow file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow failed schema validation', issues: result.issues }, 400);
      case 'duplicateIdInBatch':
        return c.json({ error: `Duplicate id in batch: ${result.id}` }, 400);
      case 'idAlreadyExists':
        return c.json({ error: `Connector id already exists: ${result.id}` }, 400);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  // DELETE a connector. Just removes the entry from demo.connectors — node
  // deletion is what cascades, not connector deletion.
  api.delete('/flows/:id/connectors/:connId', async (c) => {
    const id = c.req.param('id');
    const connId = c.req.param('connId');

    const result = await ops.deleteConnector(id, connId);
    switch (result.kind) {
      case 'ok':
        return c.json({ ok: true });
      case 'flowNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: `Flow file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow failed schema validation', issues: result.issues }, 400);
      case 'unknownConnector':
        return c.json({ error: `Unknown connectorId: ${connId}` }, 404);
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  api.post('/emit', async (c) => {
    if (!events) return c.json({ error: 'events not enabled' }, 500);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }

    const parsed = EmitBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid emit body', issues: parsed.error.issues }, 400);
    }

    const { flowId, nodeId, status, runId, payload } = parsed.data;
    if (!registry.getById(flowId)) {
      return c.json({ error: `Unknown flowId: ${flowId}` }, 404);
    }

    const extras =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const eventPayload: Record<string, unknown> = { nodeId, ...extras };
    if (runId !== undefined) eventPayload.runId = runId;

    events.broadcast({
      type: EMIT_STATUS_TO_EVENT[status],
      flowId,
      payload: eventPayload,
    });

    return c.json({ ok: true });
  });

  api.get('/events', (c) => {
    const flowId = c.req.query('flowId');
    if (!flowId) return c.json({ error: 'flowId query param required' }, 400);
    if (!registry.getById(flowId)) return c.json({ error: 'unknown flowId' }, 404);
    if (!events) return c.json({ error: 'events not enabled' }, 500);

    return streamSSE(c, async (stream) => {
      let active = true;
      const queue: Array<{ event: string; data: string }> = [];
      let resume: (() => void) | null = null;

      const wake = () => {
        if (resume) {
          const r = resume;
          resume = null;
          r();
        }
      };

      const unsubscribe = events.subscribe(flowId, (e) => {
        queue.push({ event: e.type, data: JSON.stringify({ ts: e.ts, ...(e.payload as object) }) });
        wake();
      });

      stream.onAbort(() => {
        active = false;
        unsubscribe();
        wake();
      });

      // Initial 'hello' so reconnecting clients can confirm the stream is open
      // and trigger a re-fetch on the frontend.
      await stream.writeSSE({
        event: 'hello',
        data: JSON.stringify({ flowId, ts: Date.now() }),
      });

      try {
        while (active) {
          while (queue.length > 0) {
            const next = queue.shift();
            if (!next) break;
            await stream.writeSSE(next);
          }
          if (!active) break;
          await new Promise<void>((r) => {
            resume = r;
          });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  // Global registry channel — broadcasts `registry:reload` when an external
  // process (e.g. the CLI) writes to ~/.seeflow/registry.json. Subscribers
  // re-fetch the flow list. The channel id is the internal sentinel from
  // registry-watcher.ts (kept inline to avoid leaking the constant into
  // every SSE consumer).
  api.get('/registry/events', (c) => {
    if (!events) return c.json({ error: 'events not enabled' }, 500);

    return streamSSE(c, async (stream) => {
      let active = true;
      const queue: Array<{ event: string; data: string }> = [];
      let resume: (() => void) | null = null;

      const wake = () => {
        if (resume) {
          const r = resume;
          resume = null;
          r();
        }
      };

      const unsubscribe = events.subscribe('__registry__', (e) => {
        queue.push({ event: e.type, data: JSON.stringify({ ts: e.ts }) });
        wake();
      });

      stream.onAbort(() => {
        active = false;
        unsubscribe();
        wake();
      });

      await stream.writeSSE({
        event: 'hello',
        data: JSON.stringify({ channel: 'registry', ts: Date.now() }),
      });

      try {
        while (active) {
          while (queue.length > 0) {
            const next = queue.shift();
            if (!next) break;
            await stream.writeSSE(next);
          }
          if (!active) break;
          await new Promise<void>((r) => {
            resume = r;
          });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  return api;
}
