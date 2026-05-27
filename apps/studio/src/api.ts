import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { registerProject } from './cli-ops.ts';
import { runComponentAction } from './component-action-runner.ts';
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
  CreateProjectBodySchema,
  FlowBulkBodySchema,
  NodePatchBodySchema,
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
import type { FlowEntry, Registry } from './registry.ts';
import { resolveProjectFlow } from './route-resolve.ts';
import {
  getCategorySubschema,
  getSchemaCategory,
  listCategorySubnames,
  listSchemaCategories,
  schemaCategoryNames,
} from './schema-catalog.ts';
import type { ComponentAction, SeeflowManifest } from './schema.ts';
import { FlowIdPattern, FlowSchema, ResolvedFlowSchema, SeeflowManifestSchema } from './schema.ts';
import { type Spawner, defaultSpawner } from './shellout.ts';
import { ID_TYPES, MAX_ID_COUNT, generateIds, isIdType } from './short-id.ts';
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

// Body for POST /api/projects/:project/flows (US-015). The flow id reuses
// FlowIdPattern from schema.ts — same constraint the seeflow.json manifest
// enforces, so a manifest round-trip after this route runs cannot fail
// validation on the new entry's id.
const CreateFlowBodySchema = z.object({
  id: z.string().regex(FlowIdPattern, {
    message: 'flow id must match /^[a-z0-9][a-z0-9-]*$/',
  }),
  name: z.string().min(1),
  icon: z.string().min(1).optional(),
});

// Body for PATCH /api/projects/:project/flows/:flow (US-016). All three
// fields are optional; the .refine() rejects an empty body so callers can't
// no-op the route. The same FlowIdPattern that guards POST guards id renames
// here, so a renamed flow's id stays manifest-compatible.
const PatchFlowBodySchema = z
  .object({
    id: z
      .string()
      .regex(FlowIdPattern, {
        message: 'flow id must match /^[a-z0-9][a-z0-9-]*$/',
      })
      .optional(),
    name: z.string().min(1).optional(),
    icon: z.string().min(1).optional(),
  })
  .refine((b) => b.id !== undefined || b.name !== undefined || b.icon !== undefined, {
    message: 'body must include at least one of id, name, icon',
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
  | { kind: 'ok'; absPath: string; projectRoot: string }
  | { kind: 'unknownProject' }
  | { kind: 'invalidPath'; reason: string }
  | { kind: 'fileMissing'; absPath: string };

// Shared path-safety + filesystem resolution for project-scoped file routes.
// Performs textual rejection of absolute paths / `..` traversal, then layered
// realpath verification that the resolved file stays inside the project root
// (defense against symlink escapes). Returns the realpath of an existing file
// on success, or `fileMissing` with the would-be absolute path so callers can
// soft-fail with that path included for clipboard fallback.
//
// Project addressing is by `projectSlug` (post-US-008): the first registry
// entry whose `projectSlug` matches supplies `repoPath` since every entry in
// a project shares the same on-disk root.
function resolveProjectFile(
  registry: Registry,
  projectSlug: string,
  relPath: string,
): ResolvedProjectFile {
  const entry = registry.list().find((e) => e.projectSlug === projectSlug);
  if (!entry) return { kind: 'unknownProject' };

  const guard = validateRelativePath(relPath);
  if (guard.kind === 'invalid') return { kind: 'invalidPath', reason: guard.reason };

  const projectRoot = entry.repoPath;
  let realRoot: string;
  try {
    realRoot = realpathSync(projectRoot);
  } catch {
    return { kind: 'fileMissing', absPath: resolve(projectRoot, relPath) };
  }

  const target = resolve(projectRoot, relPath);
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

  return { kind: 'ok', absPath: realTarget, projectRoot: realRoot };
}

// Read + validate `<repoPath>/seeflow.json` for the project listing routes.
// Returns `null` for missing or malformed manifests so callers can fall back
// to derived defaults (projectSlug + isDefault entry) instead of failing the
// whole listing on one bad project.
function readProjectManifest(repoPath: string): SeeflowManifest | null {
  const manifestPath = join(repoPath, 'seeflow.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const parsed = SeeflowManifestSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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
  const ops = createOperations({ registry, watcher });
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
    if (result.kind === 'ok') {
      events?.broadcast({ type: 'registry:reload', flowId: '__registry__', payload: {} });
    }
    switch (result.kind) {
      case 'ok':
        return c.json(result.data);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 400);
      case 'badJson':
        return c.json({ error: 'Flow file is not valid JSON', detail: result.detail }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow file failed schema validation', issues: result.issues }, 400);
    }
  });

  // POST /api/projects/register — manifest-driven registration. Reads
  // <repoPath>/seeflow.json + walks declared flows under flows/<id>/flow.json,
  // upserting one FlowEntry per declared flow with the manifest's name +
  // per-flow names (vs. /api/flows/register which is the legacy single-flow
  // path that uses the same name for both project and flow).
  api.post('/projects/register', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = z.object({ repoPath: z.string().min(1) }).safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid register body', issues: parsed.error.issues }, 400);
    }
    const result = registerProject({ repoPath: parsed.data.repoPath, registry });
    if (result.kind === 'ok') {
      for (const entry of result.entries) watcher?.watch(entry.id);
      events?.broadcast({ type: 'registry:reload', flowId: '__registry__', payload: {} });
      return c.json({
        ok: true as const,
        projectSlug: result.projectSlug,
        entries: result.entries.map((e) => ({
          id: e.id,
          slug: e.slug,
          projectSlug: e.projectSlug,
          flowSlug: e.flowSlug,
          name: e.name,
          isDefault: e.isDefault,
        })),
      });
    }
    return c.json({ ok: false as const, error: result.kind }, 400);
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
  // skill writes the response to $TARGET/flow.json. No schema validation
  // here — call /demos/validate for that.
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
        flow.nodes.map((n) => ({ id: n.id, type: n.type })),
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
            | 'rectangle'
            | 'ellipse'
            | 'sticky'
            | 'text'
            | 'database'
            | 'server'
            | 'user'
            | 'queue'
            | 'cloud'
            | 'image'
            | 'html'
            | 'icon',
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

  // POST /api/projects — UI-driven "Create new project" flow (US-020).
  // Scaffolds `<path>/flow.json` with the supplied name + optional
  // description, then registers it. If the target already has a
  // `flow.json`, returns 409 — callers should use POST /api/flows/register
  // instead.
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
      case 'alreadyExists':
        return c.json({ error: `Project already exists at ${result.path}` }, 409);
      case 'scaffoldFailed':
        return c.json({ error: `Failed to scaffold project: ${result.message}` }, 500);
    }
  });

  // GET /api/schema — index of categories the skill / agents can introspect.
  // Mirrors `seeflow schema` and the `seeflow_schema` MCP tool. Drill in via
  // GET /api/schema/:name for the full JSON Schema(s) + invariant notes.
  api.get('/schema', (c) => c.json({ ok: true as const, categories: listSchemaCategories() }));

  api.get('/schema/:name', (c) => {
    const name = c.req.param('name');
    const payload = getSchemaCategory(name);
    if (!payload) {
      return c.json(
        { error: `unknown schema category: ${name}`, available: schemaCategoryNames() },
        404,
      );
    }
    return c.json({ ok: true as const, name, schemas: payload.schemas, notes: payload.notes });
  });

  // GET /api/schema/:name/:subname — drill into one named schema within a
  // category. Mirrors `seeflow schema <category> <subname>` and the MCP
  // `seeflow_schema` tool's `subname` arg. Notes ride along unchanged because
  // they describe cross-variant invariants the caller still needs (image
  // path prefix, scriptPath rooting, etc.).
  api.get('/schema/:name/:subname', (c) => {
    const name = c.req.param('name');
    const subname = c.req.param('subname');
    const single = getCategorySubschema(name, subname);
    if (single) {
      return c.json({
        ok: true as const,
        name,
        subname,
        schemas: single.schemas,
        notes: single.notes,
      });
    }
    const availableSubs = listCategorySubnames(name);
    if (availableSubs === null) {
      return c.json(
        { error: `unknown schema category: ${name}`, available: schemaCategoryNames() },
        404,
      );
    }
    return c.json(
      {
        error: `unknown schema subname: ${subname}`,
        category: name,
        available: availableSubs,
      },
      404,
    );
  });

  // GET /api/ids/:type/:count — batch-mint canonical short ids. Mirrors
  // `seeflow ids <type> <count>` and the `seeflow_ids` MCP tool. Pure compute,
  // no state read, no studio side effects. Same alphabet, length, and
  // rejection-sampling as every other id producer (operations.ts, canvas,
  // upload regex), so generated ids match wherever they're inserted.
  api.get('/ids/:type/:count', (c) => {
    const type = c.req.param('type');
    if (!isIdType(type)) {
      return c.json(
        {
          ok: false as const,
          error: `invalid type: ${type} (expected one of: ${ID_TYPES.join(', ')})`,
        },
        400,
      );
    }
    const rawCount = c.req.param('count');
    const count = Number.parseInt(rawCount, 10);
    if (
      !Number.isFinite(count) ||
      String(count) !== rawCount ||
      count < 1 ||
      count > MAX_ID_COUNT
    ) {
      return c.json(
        {
          ok: false as const,
          error: `invalid count: ${rawCount} (expected an integer in [1, ${MAX_ID_COUNT}])`,
        },
        400,
      );
    }
    return c.json({ ok: true as const, ids: generateIds(type, count) });
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

  // GET /api/projects — projects landing index. Groups registry.list() by
  // projectSlug and reads each project's `seeflow.json` for the human-readable
  // name + defaultFlow. When the manifest is missing or malformed, falls back
  // to the projectSlug for name and the flowSlug of the registry's
  // `isDefault: true` entry for defaultFlow — so a partially-broken project
  // still surfaces in the picker.
  api.get('/projects', (c) => {
    const grouped = new Map<string, FlowEntry[]>();
    for (const entry of registry.list()) {
      const existing = grouped.get(entry.projectSlug);
      if (existing) {
        existing.push(entry);
      } else {
        grouped.set(entry.projectSlug, [entry]);
      }
    }
    const projects: Array<{
      projectSlug: string;
      name: string;
      description?: string;
      defaultFlow: string;
      flowCount: number;
      repoPath: string;
    }> = [];
    for (const [projectSlug, entries] of grouped) {
      const head = entries[0];
      if (!head) continue;
      const manifest = readProjectManifest(head.repoPath);
      const defaultEntry = entries.find((e) => e.isDefault) ?? head;
      projects.push({
        projectSlug,
        name: manifest?.name ?? projectSlug,
        description: manifest?.description,
        defaultFlow: manifest?.defaultFlow ?? defaultEntry.flowSlug,
        flowCount: entries.length,
        repoPath: head.repoPath,
      });
    }
    return c.json({ projects });
  });

  // GET /api/projects/:project — per-project metadata + flow entries. 404s
  // with `project-not-found` when no registry entry shares the slug — same
  // shape the flow-scoped routes (US-007) use for resolution failures, so
  // clients have a single error pattern across the projects/* tree. The
  // manifest read is best-effort (missing/malformed → null) so the route
  // never depends on disk state for the slug check itself.
  api.get('/projects/:project', (c) => {
    const projectSlug = c.req.param('project');
    const flows = registry.list().filter((e) => e.projectSlug === projectSlug);
    const head = flows[0];
    if (!head) {
      return c.json({ ok: false as const, error: 'project-not-found' as const }, 404);
    }
    const manifest = readProjectManifest(head.repoPath);
    const defaultEntry = flows.find((e) => e.isDefault) ?? head;
    return c.json({
      projectSlug,
      name: manifest?.name ?? projectSlug,
      description: manifest?.description,
      defaultFlow: manifest?.defaultFlow ?? defaultEntry.flowSlug,
      flows,
    });
  });

  // GET /api/projects/:project/flows — per-project flow listing. Powers the
  // canvas page's Figma-style flow switcher popover (US-024). Returns the
  // narrow shape the picker needs — id, flowSlug, name, icon, isDefault —
  // rather than the full FlowEntry; clients that need repoPath/flowPath go
  // through `GET /api/projects/:project` instead. 404s with `project-not-found`
  // when no registry entry shares the slug (same shape US-007 + the
  // GET /api/projects/:project route above use for resolution failures).
  api.get('/projects/:project/flows', (c) => {
    const projectSlug = c.req.param('project');
    const entries = registry.list().filter((e) => e.projectSlug === projectSlug);
    if (entries.length === 0) {
      return c.json({ ok: false as const, error: 'project-not-found' as const }, 404);
    }
    const flows = entries.map((e) => ({
      id: e.id,
      flowSlug: e.flowSlug,
      name: e.name,
      icon: e.icon,
      isDefault: e.isDefault,
    }));
    return c.json({ flows });
  });

  // POST /api/projects/:project/flows — create a new flow within an existing
  // project (US-015). Atomically: write `flows/<id>/flow.json` with an empty
  // envelope → append the new entry to `seeflow.json` → `registry.upsert()`.
  // If the manifest write fails after the flow folder is on disk, the folder
  // is removed so the project state stays consistent with the manifest. New
  // flows are never the project default — the caller has to use PATCH
  // /projects/:project/flows/:flow (US-016) to flip defaultFlow.
  api.post('/projects/:project/flows', async (c) => {
    const projectSlug = c.req.param('project');
    const entries = registry.list().filter((e) => e.projectSlug === projectSlug);
    const head = entries[0];
    if (!head) {
      return c.json({ ok: false as const, error: 'project-not-found' as const }, 404);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = CreateFlowBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid create flow body', issues: parsed.error.issues }, 400);
    }
    const { id, name, icon } = parsed.data;

    // Duplicate check: any registered flow in the project or any pre-existing
    // folder under `flows/<id>/` (covers manual edits that never made it to
    // the registry) collides. Manifest entry duplication is structurally
    // impossible if the registry is the source of truth, but the disk check
    // catches drift.
    if (entries.some((e) => e.flowSlug === id)) {
      return c.json({ ok: false as const, error: 'duplicate-flow-id' as const }, 409);
    }

    const repoPath = head.repoPath;
    const manifestPath = join(repoPath, 'seeflow.json');
    const manifest = readProjectManifest(repoPath);
    if (!manifest) {
      return c.json(
        {
          ok: false as const,
          error: 'manifest-missing-or-invalid' as const,
          path: manifestPath,
        },
        500,
      );
    }
    if (manifest.flows.some((f) => f.id === id)) {
      return c.json({ ok: false as const, error: 'duplicate-flow-id' as const }, 409);
    }

    const flowDir = join(repoPath, 'flows', id);
    if (existsSync(flowDir)) {
      return c.json({ ok: false as const, error: 'duplicate-flow-id' as const }, 409);
    }

    // 1. Create the flow folder + flow.json. Atomic write guarantees no
    //    half-written file lands; mkdir is recursive in case `flows/` itself
    //    is missing on a partially-scaffolded project.
    try {
      mkdirSync(flowDir, { recursive: true });
      const envelope = { version: 2 as const, name, nodes: [], connectors: [] };
      writeFileAtomic(join(flowDir, 'flow.json'), `${JSON.stringify(envelope, null, 2)}\n`);
    } catch (err) {
      try {
        rmSync(flowDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      return c.json(
        { ok: false as const, error: 'scaffold-failed' as const, detail: String(err) },
        500,
      );
    }

    // 2. Append the new entry to the manifest. Roll the folder back if the
    //    write fails so the project never has an orphan `flows/<id>/`.
    const manifestEntry: { id: string; name: string; icon?: string } = { id, name };
    if (icon !== undefined) manifestEntry.icon = icon;
    const updatedManifest = {
      ...manifest,
      flows: [...manifest.flows, manifestEntry],
    };
    try {
      writeFileAtomic(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`);
    } catch (err) {
      try {
        rmSync(flowDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      return c.json(
        { ok: false as const, error: 'manifest-write-failed' as const, detail: String(err) },
        500,
      );
    }

    // 3. Register the new entry. `flowPath` is project-relative — matches the
    //    scanner output for manifest-driven projects.
    const entry = registry.upsert({
      name,
      repoPath,
      flowPath: `flows/${id}/flow.json`,
      projectSlug,
      flowSlug: id,
      isDefault: false,
      icon,
      valid: true,
    });
    watcher?.watch(entry.id);
    events?.broadcast({ type: 'registry:reload', flowId: '__registry__', payload: {} });

    return c.json(entry, 201);
  });

  // PATCH /api/projects/:project/flows/:flow — rename a flow id and/or update
  // its name / icon (US-016). Two modes:
  //   1. id change → rename `flows/<oldId>/` to `flows/<newId>/`, rewrite the
  //      manifest entry (and `defaultFlow` if it pointed at the renamed flow),
  //      then re-bind the registry entry + watcher under the new flowPath. On
  //      manifest-write failure, the folder rename is rolled back.
  //   2. name/icon only → manifest-only edit; the filesystem layout and the
  //      registry entry id are untouched, only `name` / `icon` are refreshed.
  // The handler is single-flight in the no-collision sense: it serialises
  // through the registry + filesystem so two concurrent id renames against
  // the same project cannot interleave to produce a duplicate folder.
  api.patch('/projects/:project/flows/:flow', async (c) => {
    const projectSlug = c.req.param('project');
    const flowSlug = c.req.param('flow');
    const resolved = resolveProjectFlow(registry, projectSlug, flowSlug);
    if (resolved.kind === 'error') {
      return c.json({ ok: false as const, error: resolved.code }, 404);
    }
    const entry = resolved.entry;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = PatchFlowBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid patch flow body', issues: parsed.error.issues }, 400);
    }
    const { id: requestedId, name: requestedName, icon: requestedIcon } = parsed.data;

    const repoPath = entry.repoPath;
    const manifestPath = join(repoPath, 'seeflow.json');
    const manifest = readProjectManifest(repoPath);
    if (!manifest) {
      return c.json(
        {
          ok: false as const,
          error: 'manifest-missing-or-invalid' as const,
          path: manifestPath,
        },
        500,
      );
    }

    const manifestEntryIdx = manifest.flows.findIndex((f) => f.id === entry.flowSlug);
    if (manifestEntryIdx === -1) {
      // Registry and manifest are out of sync — the entry knows itself by
      // flowSlug but the manifest disagrees. Bail rather than rebuild the
      // manifest unilaterally; a future `seeflow reconcile` verb could repair.
      return c.json({ ok: false as const, error: 'manifest-entry-missing' as const }, 500);
    }
    const existingManifestEntry = manifest.flows[manifestEntryIdx];
    if (!existingManifestEntry) {
      return c.json({ ok: false as const, error: 'manifest-entry-missing' as const }, 500);
    }

    const idChanging = requestedId !== undefined && requestedId !== entry.flowSlug;

    // Branch 1: id rename. The folder move is the only side-effect we have to
    // undo on manifest-write failure, so it goes BEFORE the manifest write.
    if (idChanging) {
      const newId = requestedId;
      if (newId === undefined) {
        // Narrowing for TS — `idChanging` already implies non-undefined.
        return c.json({ ok: false as const, error: 'duplicate-flow-id' as const }, 409);
      }

      // Collision checks: manifest, registry, on-disk folder. Each catches a
      // different drift; cheapest first.
      if (manifest.flows.some((f) => f.id === newId)) {
        return c.json({ ok: false as const, error: 'duplicate-flow-id' as const }, 409);
      }
      const projectEntries = registry.list().filter((e) => e.projectSlug === projectSlug);
      if (projectEntries.some((e) => e.flowSlug === newId)) {
        return c.json({ ok: false as const, error: 'duplicate-flow-id' as const }, 409);
      }
      const oldFolder = join(repoPath, 'flows', entry.flowSlug);
      const newFolder = join(repoPath, 'flows', newId);
      if (existsSync(newFolder)) {
        return c.json({ ok: false as const, error: 'duplicate-flow-id' as const }, 409);
      }

      // 1. Move the folder.
      try {
        renameSync(oldFolder, newFolder);
      } catch (err) {
        return c.json(
          { ok: false as const, error: 'folder-rename-failed' as const, detail: String(err) },
          500,
        );
      }

      // 2. Build + atomically write the updated manifest.
      const finalName = requestedName ?? existingManifestEntry.name;
      const finalIcon = requestedIcon !== undefined ? requestedIcon : existingManifestEntry.icon;
      const updatedFlowEntry: { id: string; name: string; icon?: string } = {
        id: newId,
        name: finalName,
      };
      if (finalIcon !== undefined) updatedFlowEntry.icon = finalIcon;
      const updatedManifest: SeeflowManifest = {
        ...manifest,
        defaultFlow: manifest.defaultFlow === entry.flowSlug ? newId : manifest.defaultFlow,
        flows: manifest.flows.map((f, i) => (i === manifestEntryIdx ? updatedFlowEntry : f)),
      };

      try {
        writeFileAtomic(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`);
      } catch (err) {
        try {
          renameSync(newFolder, oldFolder);
        } catch {
          // best-effort rollback
        }
        return c.json(
          { ok: false as const, error: 'manifest-write-failed' as const, detail: String(err) },
          500,
        );
      }

      // 3. Rebind the registry entry under the new flowPath. The shortId
      //    changes — registry slugs are addressed via projectSlug/flowSlug, so
      //    clients re-resolve via the new URL. Watcher is unwatch-then-watch
      //    because the flowPath that the watcher reads is sourced from the
      //    new registry entry.
      watcher?.unwatch(entry.id);
      registry.remove(entry.id);
      const newEntry = registry.upsert({
        name: finalName,
        description: entry.description,
        repoPath,
        flowPath: `flows/${newId}/flow.json`,
        projectSlug,
        flowSlug: newId,
        isDefault: entry.isDefault,
        icon: finalIcon,
        valid: entry.valid,
      });
      watcher?.watch(newEntry.id);
      events?.broadcast({ type: 'registry:reload', flowId: '__registry__', payload: {} });

      return c.json(newEntry);
    }

    // Branch 2: name / icon only. Filesystem layout untouched.
    const finalName = requestedName ?? existingManifestEntry.name;
    const finalIcon = requestedIcon !== undefined ? requestedIcon : existingManifestEntry.icon;
    const updatedFlowEntry: { id: string; name: string; icon?: string } = {
      id: existingManifestEntry.id,
      name: finalName,
    };
    if (finalIcon !== undefined) updatedFlowEntry.icon = finalIcon;
    const updatedManifest: SeeflowManifest = {
      ...manifest,
      flows: manifest.flows.map((f, i) => (i === manifestEntryIdx ? updatedFlowEntry : f)),
    };

    try {
      writeFileAtomic(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`);
    } catch (err) {
      return c.json(
        { ok: false as const, error: 'manifest-write-failed' as const, detail: String(err) },
        500,
      );
    }

    const updatedEntry = registry.upsert({
      name: finalName,
      description: entry.description,
      repoPath,
      flowPath: entry.flowPath,
      projectSlug,
      flowSlug: entry.flowSlug,
      isDefault: entry.isDefault,
      icon: finalIcon,
      valid: entry.valid,
    });
    events?.broadcast({ type: 'registry:reload', flowId: '__registry__', payload: {} });

    return c.json(updatedEntry);
  });

  api.get('/projects/:project/flows/:flow', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const result = await ops.getFlow(resolved.entry.id);
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
  // Pairs with GET /projects/:project/flows/:flow/nodes/:nodeId for full per-node detail.
  api.get('/projects/:project/flows/:flow/graph', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const result = await ops.getFlowGraph(resolved.entry.id);
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

  api.get('/projects/:project/flows/:flow/nodes/:nodeId', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const result = await ops.getNode(resolved.entry.id, c.req.param('nodeId'));
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

  // GET /api/projects/:project/files/<path> — stream a project-scoped file
  // from <repoPath>/<path>. Path safety is layered: textual rejection
  // (absolute / traversal), then realpath check that the resolved file stays
  // inside the project root (defends against symlink escapes). The route is
  // shared across every flow within the project — assets that live at the
  // project root or under a sibling flow folder are addressable here.
  api.get('/projects/:project/files/:path{.+}', async (c) => {
    const rawPath = c.req.param('path');
    let relPath: string;
    try {
      relPath = decodeURIComponent(rawPath);
    } catch {
      return c.json({ error: 'invalid path encoding' }, 400);
    }

    const resolved = resolveProjectFile(registry, c.req.param('project'), relPath);
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

  // POST /api/projects/:project/files/open — shell out to `$EDITOR <abs>` so
  // the user can edit a project-scoped file (type:'html' block, image asset)
  // in their IDE. The endpoint always returns the resolved absolute path in
  // the response body so the frontend can copy-to-clipboard when $EDITOR
  // isn't set or the spawn fails. Path safety mirrors the GET route.
  api.post('/projects/:project/files/open', async (c) => {
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

    const resolved = resolveProjectFile(registry, c.req.param('project'), parsed.data.path);
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

  // POST /api/projects/:project/files/reveal — open the OS file manager with
  // the target file selected. Platform commands: `open -R <abs>` (macOS),
  // `explorer /select,<abs>` (Windows), `xdg-open <dir>` (Linux — selects the
  // containing directory; xdg has no portable "select-this-file" verb). Same
  // fallback shape as /open: response always includes `absPath` for clipboard.
  api.post('/projects/:project/files/reveal', async (c) => {
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

    const resolved = resolveProjectFile(registry, c.req.param('project'), parsed.data.path);
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

  // POST /api/projects/:project/flows/:flow/nodes/:nodeId/files/upload —
  // accept a multipart image upload and persist it under
  // `<repoPath>/<dirname(entry.flowPath)>/nodes/<nodeId>/`. For manifest-
  // driven projects this resolves to `flows/<flow>/nodes/<nodeId>/`; for
  // legacy single-flow registrations (flow.json at the project root) it
  // collapses to `nodes/<nodeId>/`. Multipart shape: `file` (Blob) and
  // optional `filename` (the original OS name). Allowlist + 5 MB cap guard
  // against arbitrary uploads; the destination folder is scoped to the node,
  // so delete_node's removeNodeDir cascade cleans up the asset along with
  // the node row.
  api.post('/projects/:project/flows/:flow/nodes/:nodeId/files/upload', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const entry = resolved.entry;
    const nodeId = c.req.param('nodeId');

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

    const flowDir = dirname(entry.flowPath);
    const nodeDir = join(entry.repoPath, flowDir, 'nodes', nodeId);
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

  // DELETE /api/projects/:project/flows/:flow — manifest-aware delete (US-017).
  // Guards:
  //   - last-flow: refuse when the target is the only flow in the project.
  //   - default-flow-no-replacement: refuse when target is manifest.defaultFlow
  //     and no `?newDefault=<other-flow-id>` query arg is supplied.
  //   - invalid-new-default: the supplied newDefault must exist in the
  //     manifest and must not be the flow being deleted.
  // On success: rename the flow folder to a sibling `.deleted-*` snapshot
  // (atomic on POSIX), write the updated manifest atomically, then rm the
  // snapshot and drop the registry entry. On manifest-write failure the
  // snapshot is renamed back so the externally-observable state is preserved.
  api.delete('/projects/:project/flows/:flow', (c) => {
    const projectSlug = c.req.param('project');
    const flowSlug = c.req.param('flow');
    const newDefault = c.req.query('newDefault');

    const resolved = resolveProjectFlow(registry, projectSlug, flowSlug);
    if (resolved.kind === 'error') {
      return c.json({ ok: false as const, error: resolved.code }, 404);
    }
    const entry = resolved.entry;

    const projectEntries = registry.list().filter((e) => e.projectSlug === projectSlug);
    if (projectEntries.length <= 1) {
      return c.json({ ok: false as const, error: 'last-flow' as const }, 409);
    }

    const repoPath = entry.repoPath;
    const manifestPath = join(repoPath, 'seeflow.json');
    const manifest = readProjectManifest(repoPath);
    if (!manifest) {
      return c.json(
        {
          ok: false as const,
          error: 'manifest-missing-or-invalid' as const,
          path: manifestPath,
        },
        500,
      );
    }

    const targetIsDefault = manifest.defaultFlow === entry.flowSlug;
    if (targetIsDefault && (newDefault === undefined || newDefault.length === 0)) {
      return c.json({ ok: false as const, error: 'default-flow-no-replacement' as const }, 409);
    }
    if (targetIsDefault && newDefault !== undefined) {
      if (newDefault === entry.flowSlug) {
        return c.json({ ok: false as const, error: 'invalid-new-default' as const }, 400);
      }
      if (!manifest.flows.some((f) => f.id === newDefault)) {
        return c.json({ ok: false as const, error: 'invalid-new-default' as const }, 400);
      }
    }

    const flowDir = join(repoPath, 'flows', entry.flowSlug);
    const tmpHolder = join(repoPath, 'flows', `.deleted-${entry.flowSlug}-${Date.now()}`);

    // Snapshot the folder by renaming it to a sibling tmp location. Same
    // filesystem → POSIX guarantees the rename is atomic. If the folder is
    // missing on disk (manual `rm -rf` between registration and delete), skip
    // the snapshot — the manifest+registry mutation still proceeds.
    let movedToTmp = false;
    if (existsSync(flowDir)) {
      try {
        renameSync(flowDir, tmpHolder);
        movedToTmp = true;
      } catch (err) {
        return c.json(
          { ok: false as const, error: 'folder-rename-failed' as const, detail: String(err) },
          500,
        );
      }
    }

    const updatedManifest: SeeflowManifest = {
      ...manifest,
      defaultFlow: targetIsDefault ? (newDefault as string) : manifest.defaultFlow,
      flows: manifest.flows.filter((f) => f.id !== entry.flowSlug),
    };

    try {
      writeFileAtomic(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`);
    } catch (err) {
      if (movedToTmp) {
        try {
          renameSync(tmpHolder, flowDir);
        } catch {
          // best-effort restore — caller surfaces the original write error
        }
      }
      return c.json(
        { ok: false as const, error: 'manifest-write-failed' as const, detail: String(err) },
        500,
      );
    }

    // Manifest committed — drop the snapshot.
    if (movedToTmp) {
      try {
        rmSync(tmpHolder, { recursive: true, force: true });
      } catch {
        // best-effort cleanup — manifest is the source of truth now
      }
    }

    // Promote the new default in the registry (the upsert finds the existing
    // entry by repoPath + flowPath and updates in place, preserving its id).
    if (targetIsDefault && newDefault !== undefined) {
      const promoted = projectEntries.find((e) => e.flowSlug === newDefault);
      if (promoted) {
        registry.upsert({
          name: promoted.name,
          description: promoted.description,
          repoPath: promoted.repoPath,
          flowPath: promoted.flowPath,
          projectSlug: promoted.projectSlug,
          flowSlug: promoted.flowSlug,
          isDefault: true,
          icon: promoted.icon,
          valid: promoted.valid,
        });
      }
    }

    watcher?.unwatch(entry.id);
    registry.remove(entry.id);
    events?.broadcast({ type: 'registry:reload', flowId: '__registry__', payload: {} });

    return c.json({ ok: true });
  });

  // POST /api/projects/:project/flows/:flow/layout — registered-flow ELK
  // layout. Reads flow.json from disk via the registry entry, computes
  // layout, writes style.json atomically next to flow.json, and broadcasts
  // flow:reload so any open canvas refreshes. Body is empty or `{ options? }`.
  // Response on success is just `{ ok: true }` — the layout is already on
  // disk. On schema failure returns `{ ok: false, issues }` mirroring
  // /api/validate; on missing flow file / bad JSON / write failure returns
  // HTTP 4xx/5xx.
  api.post('/projects/:project/flows/:flow/layout', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const id = resolved.entry.id;

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

    const result = await ops.applyLayout(id, options);
    switch (result.kind) {
      case 'ok':
        // No watcher (test harness, or watch() hasn't been called yet) — emit
        // a bare flow:reload so any subscribers still react. When the watcher
        // exists, applyLayoutImpl already notified it directly.
        if (!watcher) {
          events?.broadcast({ type: 'flow:reload', flowId: id, payload: {} });
        }
        return c.json({ ok: true as const });
      case 'flowNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: 'Flow file is not valid JSON', detail: result.detail }, 400);
      case 'badSchema':
        return c.json({ ok: false as const, issues: result.issues });
      case 'writeFailed':
        return c.json({ error: `Failed to write style file: ${result.message}` }, 500);
    }
  });

  api.post('/projects/:project/flows/:flow/play/:nodeId', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const entry = resolved.entry;
    const id = entry.id;
    const nodeId = c.req.param('nodeId');
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
    // playAction is optional on every node type post-flat-types. The runtime
    // gate is purely "is the field set?" — visual kind doesn't constrain
    // playability.
    if (!node.data.playAction) {
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

  // POST /api/projects/:project/flows/:flow/nodes/:nodeId/actions/:name —
  // dispatch a component node's named action over HTTP. Only `script`-kind
  // actions cross this seam; `set`-kind actions mutate canvas state locally
  // and never round-trip through the API (the runner rejects them with
  // statusHint 400). Payload is the JSON request body (defaults to {} on
  // parse failure) and is piped to the script's stdin by
  // `runComponentAction`. Response is the script's parsed JSON stdout on
  // success.
  api.post('/projects/:project/flows/:flow/nodes/:nodeId/actions/:name', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const entry = resolved.entry;
    const id = entry.id;
    const nodeId = c.req.param('nodeId');
    const actionName = c.req.param('name');

    if (!events) return c.json({ error: 'events not enabled' }, 500);

    const fullPath = resolveFilePath(entry.repoPath, entry.flowPath);
    if (!existsSync(fullPath)) {
      return c.json({ error: `Flow file not found: ${fullPath}` }, 404);
    }
    const merged = readMergedFlow(fullPath);
    if (!merged.flow) {
      return c.json({ error: merged.error ?? 'Flow read failed' }, 400);
    }

    const node = merged.flow.nodes.find((n) => n.id === nodeId);
    if (!node) return c.json({ error: `Unknown nodeId: ${nodeId}` }, 404);
    if (node.type !== 'component') {
      return c.json({ error: `Node ${nodeId} is not a component node` }, 400);
    }

    const action = (node.data as { spec: { actions?: Record<string, ComponentAction> } }).spec
      .actions?.[actionName];
    if (!action) return c.json({ error: `Unknown action: ${actionName}` }, 404);

    const payload = await c.req.json().catch(() => ({}));
    // US-031: per-node sidecar scripts now anchor at
    // `<repoPath>/<dirname(flowPath)>/nodes/<id>/` post-multi-flow migration —
    // the runner still resolves scripts as `<cwd>/nodes/<nodeId>/<scriptPath>`,
    // so feed the per-flow folder as `cwd`.
    const result = await runComponentAction({
      events,
      flowId: id,
      nodeId,
      cwd: join(entry.repoPath, dirname(entry.flowPath)),
      actionName,
      action,
      payload,
      spawner: processSpawner,
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.statusHint as 400 | 404 | 500 | 504);
    }
    return c.json(result.body);
  });

  // POST /api/projects/:project/flows/:flow/reset — the "Restart demo"
  // workflow (US-008). Order:
  //   1. Stop every live play-script + every long-running status-script for
  //      this demo in parallel — both must complete before any reset script
  //      spawns so the script sees no stragglers.
  //   2. Run the demo's `resetAction` script (if declared); any non-zero exit
  //      becomes a 502 to the caller but does NOT suppress reload/restart.
  //   3. Broadcast `flow:reload` unconditionally so the canvas re-fetches.
  //   4. Fire-and-forget `statusRunner.restart` so the next status batch is
  //      spawning by the time the response lands. Individual spawn failures
  //      surface via console.warn but never fail the /reset call.
  api.post('/projects/:project/flows/:flow/reset', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const entry = resolved.entry;
    const id = entry.id;
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

  // PATCH a single node's position back into the on-disk flow.json. Atomic
  // write via tempfile + rename keeps editor diffs clean and avoids
  // corruption mid-write.
  api.patch('/projects/:project/flows/:flow/nodes/:nodeId/position', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const id = resolved.entry.id;
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
  api.patch('/projects/:project/flows/:flow/nodes/:nodeId/order', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const id = resolved.entry.id;
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
  // fields, or geometric-only fields. Every UI-driven node edit (other than
  // the high-frequency drag fast-path above) flows through here. The mutation
  // is performed against the raw parsed JSON (so unknown v2 fields the schema
  // doesn't yet recognize survive round-trips) and the WHOLE resulting demo
  // is re-validated through ResolvedFlowSchema before commit, preventing partial
  // writes from breaking invariants like the connector→node superRefine.
  api.patch('/projects/:project/flows/:flow/nodes/:nodeId', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const id = resolved.entry.id;
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
  api.post('/projects/:project/flows/:flow/nodes', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const id = resolved.entry.id;

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

  // Bulk-create up to 100 nodes + 100 connectors in one transactional write.
  // Either the whole batch lands (single flow:reload broadcast) or nothing
  // does — a post-mutation ResolvedFlowSchema reject (e.g. dangling connector
  // source/target) rolls back both arrays together. Connectors may reference
  // nodes added in the same call; the parse sees the merged graph as a whole.
  // Intended for skill/LLM seeding where multiple singular calls would burn
  // tokens and round-trip latency.
  api.post('/projects/:project/flows/:flow/bulk', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const id = resolved.entry.id;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Body must be valid JSON' }, 400);
    }
    const parsed = FlowBulkBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid bulk body', issues: parsed.error.issues }, 400);
    }

    const result = await ops.addBulk(id, parsed.data);
    switch (result.kind) {
      case 'ok':
        return c.json({
          ok: true,
          nodes: result.data.nodes,
          connectors: result.data.connectors,
        });
      case 'flowNotFound':
        return c.json({ error: 'unknown demo' }, 404);
      case 'fileNotFound':
        return c.json({ error: `Flow file not found: ${result.path}` }, 404);
      case 'badJson':
        return c.json({ error: `Flow file is not valid JSON: ${result.message}` }, 400);
      case 'badSchema':
        return c.json({ error: 'Flow failed schema validation', issues: result.issues }, 400);
      case 'duplicateIdInBatch':
        return c.json({ error: `Duplicate ${result.collection} id in batch: ${result.id}` }, 400);
      case 'idAlreadyExists':
        return c.json(
          {
            error: `${result.collection === 'nodes' ? 'Node' : 'Connector'} id already exists: ${result.id}`,
          },
          400,
        );
      case 'writeFailed':
        return c.json({ error: `Failed to write demo file: ${result.message}` }, 500);
    }
  });

  // DELETE a node and cascade-remove every connector with source === nodeId or
  // target === nodeId in the same atomic write. Final-ResolvedFlowSchema validation
  // is still run after the mutation — connector cascade closure means it
  // should always pass, but the check makes the failure mode honest if the
  // file had a pre-existing schema violation we'd otherwise paper over.
  api.delete('/projects/:project/flows/:flow/nodes/:nodeId', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const id = resolved.entry.id;
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
  api.patch('/projects/:project/flows/:flow/connectors/:connId', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const id = resolved.entry.id;
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
  api.post('/projects/:project/flows/:flow/connectors', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const id = resolved.entry.id;

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

  // DELETE a connector. Just removes the entry from demo.connectors — node
  // deletion is what cascades, not connector deletion.
  api.delete('/projects/:project/flows/:flow/connectors/:connId', async (c) => {
    const resolved = resolveProjectFlow(registry, c.req.param('project'), c.req.param('flow'));
    if (resolved.kind === 'error') return c.json({ ok: false, error: resolved.code }, 404);
    const id = resolved.entry.id;
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
