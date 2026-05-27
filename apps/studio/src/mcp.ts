import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type ZodTypeAny, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CANVAS_RESOURCE_MIME,
  CANVAS_RESOURCE_URI,
  type CanvasWidgetState,
  canvasMeta,
  readCanvasHtml,
} from './mcp-ui.ts';
import {
  ConnectorPatchBodySchema,
  CreateProjectBodySchema,
  FLOW_BULK_NON_EMPTY_MESSAGE,
  FlowBulkBodyShape,
  NodePatchBodySchema,
  type Operations,
  PositionBodySchema,
  RegisterBodySchema,
  ReorderBodySchema,
  createOperations,
  flowBulkNonEmpty,
} from './operations.ts';
import type { Registry } from './registry.ts';
import {
  SCHEMA_INDEX_USAGE,
  buildJqHints,
  getCategorySubschema,
  getSchemaCategory,
  listCategorySubnames,
  listSchemaCategories,
  schemaCategoryNames,
} from './schema-catalog.ts';
import { ID_TYPES, MAX_ID_COUNT, generateIds, isIdType } from './short-id.ts';
import type { FlowWatcher } from './watcher.ts';

export interface CreateMcpServerOptions {
  registry: Registry;
  watcher?: FlowWatcher;
  /** Per-process token forwarded to the MCP App iframe via
   *  `_meta['openai/widgetState'].backendToken` so cross-origin requests
   *  from the sandboxed (`Origin: null`) iframe can carry it as
   *  `X-Seeflow-Token`. Same value as the one passed to
   *  `createApp({ token })`. Wired into canvas-bearing tool handlers; non-
   *  canvas tools ignore it. */
  token?: string;
  /** Reachable loopback URL of the studio HTTP backend (e.g.
   *  `http://127.0.0.1:54321`). The MCP App iframe uses it as the REST
   *  base URL to load flow data. When unset, canvas-bearing tools omit
   *  `_meta` entirely so non-Apps hosts still work (the iframe can't
   *  reach a backend without both `httpUrl` and `token`). */
  httpUrl?: string;
}

/** Subset of `CreateMcpServerOptions` that the canvas-bearing tool
 *  handlers need at call time. Built once in `createMcpServer` and
 *  passed into `buildTools` so the closures inside each handler can
 *  attach `_meta` without re-reading the outer options. */
interface ToolContext {
  registry: Registry;
  token?: string;
  httpUrl?: string;
}

// Distributive Omit so the discriminated union arms stay distinct after
// stripping the host-only `backendUrl` / `backendToken` keys.
type DistOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type CanvasWidgetStateInput = DistOmit<CanvasWidgetState, 'backendUrl' | 'backendToken'>;

/** Build the `_meta` block for a canvas-bearing tool result, when both
 *  `httpUrl` and `token` are configured. Returns `undefined` if either
 *  is missing (e.g. proxy mode in `mcp-shim.ts`, or tests that bypass
 *  the shim) so non-Apps callers still get a plain JSON-only result. */
const canvasMetaFor = (
  ctx: ToolContext,
  state: CanvasWidgetStateInput,
): Record<string, unknown> | undefined => {
  if (!ctx.httpUrl || !ctx.token) return undefined;
  return canvasMeta({ ...state, backendUrl: ctx.httpUrl, backendToken: ctx.token });
};

// Tools are pushed into this in-memory list inside `createMcpServer`. Each
// tool has a tiny one-sentence description, a JSON Schema for its input
// (built from existing Zod schemas via zod-to-json-schema where reuse is
// possible), and a handler that calls the same Outcome-returning inner
// helper the REST handler uses.
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown) => Promise<CallToolResult>;
}

// zod-to-json-schema emits `$schema` and other top-level Draft fields by
// default. The MCP `tools/list` response carries `inputSchema` inline, so
// stripping the wrapper keeps the wire payload tidy without losing any of
// the actual shape constraints.
//
// MCP clients validate that every `inputSchema.type === "object"`. Plain
// `z.object(...)` schemas already produce that, but `z.discriminatedUnion`
// emits `{anyOf: [...]}` with no top-level `type` — so we force it on.
// Every tool argument is an object envelope, so this is always correct.
const inputSchemaFromZod = (schema: ZodTypeAny): Record<string, unknown> => {
  const json = zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>;
  const { $schema: _$schema, ...rest } = json;
  return rest.type === 'object' ? rest : { type: 'object', ...rest };
};

const okResult = (value: unknown, meta?: Record<string, unknown>): CallToolResult => {
  const result: CallToolResult = {
    content: [{ type: 'text', text: JSON.stringify(value) }],
  };
  if (meta) result._meta = meta;
  return result;
};

// Error payloads (e.g. 'unknown demo', 'Failed to write demo file') still say
// "demo" so the strings match the REST handlers in api.ts byte-for-byte.
// Renaming requires updating api.ts + ~18 test assertions in lockstep — a
// separate refactor from this MCP review.
const errorResult = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});

// Most flow-scoped MCP tools take { project, flow } to address a registered
// flow. Defined inline as plain JSON Schema (rather than a one-off Zod
// schema) because there's no REST counterpart to share with.
const PROJECT_FLOW_PROPERTIES = {
  project: {
    type: 'string',
    minLength: 1,
    description: 'Project slug (e.g. `order-pipeline`) addressing a registered project.',
  },
  flow: {
    type: 'string',
    minLength: 1,
    description: 'Flow slug within that project (e.g. `main` or `retry`).',
  },
} as const;

const FLOW_PROJECT_INPUT_SCHEMA = {
  type: 'object',
  properties: { ...PROJECT_FLOW_PROPERTIES },
  required: ['project', 'flow'],
  additionalProperties: false,
} as const;

const requireProjectFlow = (
  args: unknown,
): { project: string; flow: string } | { error: string } => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { error: 'Invalid arguments: expected an object with project + flow' };
  }
  const { project, flow } = args as { project?: unknown; flow?: unknown };
  if (typeof project !== 'string' || project.length === 0) {
    return { error: 'Invalid arguments: project must be a non-empty string' };
  }
  if (typeof flow !== 'string' || flow.length === 0) {
    return { error: 'Invalid arguments: flow must be a non-empty string' };
  }
  return { project, flow };
};

// Project + flow slug pair used by every flow-scoped tool input as a Zod
// envelope. Each field carries its own description so the JSON Schema
// `tools/list` surfaces is self-documenting.
const ProjectFlowSchema = z.object({
  project: z
    .string()
    .min(1)
    .describe('Project slug (e.g. `order-pipeline`) addressing a registered project.'),
  flow: z.string().min(1).describe('Flow slug within that project (e.g. `main` or `retry`).'),
});

// {project, flow, nodeId} body shape shared by move + reorder + delete inputs.
const FlowNodeIdBaseSchema = ProjectFlowSchema.extend({
  nodeId: z.string().min(1),
});

// add_node input: { project, flow, node: <node payload> }. The inner `node`
// object is loose here (additionalProperties=true via passthrough) because
// ResolvedFlowSchema runs the full validation server-side after the new
// node is merged in.
const AddNodeInputSchema = ProjectFlowSchema.extend({
  node: z.record(z.unknown()),
});

// add_bulk input: { project, flow, nodes?: [...], connectors?: [...] }. Same
// loose per-item shape as add_node / add_connector — ResolvedFlowSchema runs
// once over the whole merged graph server-side after the batch lands. The
// 100-per-kind cap and "at least one non-empty" invariant come from
// FlowBulkBodyShape + flowBulkNonEmpty (the unrefined object + reusable
// predicate exported by operations.ts) so the JSON Schema the agent
// introspects stays a clean object — not an intersection.
const AddBulkInputSchema = FlowBulkBodyShape.extend({
  project: ProjectFlowSchema.shape.project,
  flow: ProjectFlowSchema.shape.flow,
}).refine(flowBulkNonEmpty, { message: FLOW_BULK_NON_EMPTY_MESSAGE });

const DeleteNodeInputSchema = FlowNodeIdBaseSchema;

// move_node input: { project, flow, nodeId } extended with PositionBodySchema's
// { x, y } fields so agents see one flat schema.
const MoveNodeInputSchema = FlowNodeIdBaseSchema.extend({
  x: PositionBodySchema.shape.x,
  y: PositionBodySchema.shape.y,
});

// reorder_node input: each branch of the existing ReorderBodySchema
// discriminated union extended with project/flow/nodeId. Keeps the
// discriminator on `op` so the emitted JSON Schema is an oneOf the agent
// can introspect.
const ReorderNodeInputSchema = z.discriminatedUnion('op', [
  FlowNodeIdBaseSchema.extend({ op: z.literal('forward') }),
  FlowNodeIdBaseSchema.extend({ op: z.literal('backward') }),
  FlowNodeIdBaseSchema.extend({ op: z.literal('toFront') }),
  FlowNodeIdBaseSchema.extend({ op: z.literal('toBack') }),
  FlowNodeIdBaseSchema.extend({
    op: z.literal('toIndex'),
    index: z.number().int().nonnegative(),
  }),
]);

// patch_node input: { project, flow, nodeId } merged with NodePatchBodySchema's
// optional fields. .extend() on the strict body schema preserves strict
// mode, so unknown top-level keys still trip the Zod parse before any disk
// IO — matching the REST handler's "Invalid node patch body" 400 path.
const PatchNodeInputSchema = NodePatchBodySchema.extend({
  project: ProjectFlowSchema.shape.project,
  flow: ProjectFlowSchema.shape.flow,
  nodeId: z.string().min(1),
});

// add_connector input: { project, flow, connector: <connector payload> }.
// The inner `connector` object is loose (additionalProperties=true via
// z.record) because ResolvedFlowSchema runs the full validation server-side
// after the new connector is merged in (post-mutation parse catches dangling
// source/target refs and kind-discriminator violations).
const AddConnectorInputSchema = ProjectFlowSchema.extend({
  connector: z.record(z.unknown()),
});

// patch_connector input: { project, flow, connectorId } merged with the
// strict ConnectorPatchBodySchema. .extend() preserves strict mode so
// unknown top-level keys trip the Zod parse before any IO — matching the
// REST handler's "Invalid connector patch body" 400 path.
const PatchConnectorInputSchema = ConnectorPatchBodySchema.extend({
  project: ProjectFlowSchema.shape.project,
  flow: ProjectFlowSchema.shape.flow,
  connectorId: z.string().min(1),
});

const DeleteConnectorInputSchema = ProjectFlowSchema.extend({
  connectorId: z.string().min(1),
});

const buildTools = (ops: Operations, ctx: ToolContext): McpTool[] => [
  {
    name: 'seeflow_list_flows',
    description: 'List every flow registered with the studio.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const result = ops.listFlows();
      return okResult(result.data);
    },
  },
  {
    name: 'seeflow_list_flows_summary',
    description:
      'List registered flows as { id, name, description } only. Use this for ' +
      'cheap discovery before drilling into a specific flow with ' +
      'seeflow_get_flow_graph or seeflow_get_node.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const result = ops.listFlowsSummary();
      return okResult(result.data);
    },
  },
  {
    name: 'seeflow_schema',
    description:
      'Get the SeeFlow flow.json / spec.json schemas. Call with no args for a ' +
      "category index; call with `name` for one category's full JSON Schemas; " +
      'call with `name` + `subname` for just one named schema within that ' +
      "category (e.g. name='node', subname='component' → just the component " +
      "node variant; name='node', subname='rectangle' → just the rectangle " +
      "node variant; name='action', subname='playAction' → just the playAction " +
      'shape). Use this to learn what a node, connector, action, component ' +
      'spec, or flow envelope looks like before authoring writes. Categories: ' +
      '`flow`, `node` (15 flat variants — rectangle/ellipse/sticky/text/' +
      'database/server/user/queue/cloud/diamond/hexagon/image/html/icon/component), ' +
      '`connector`, `action` (playAction/statusAction/statusReport/' +
      "componentAction), `componentSpec` (sidecar shape for type:'component' " +
      'nodes), `style`.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Optional category name. Omit for the index.',
        },
        subname: {
          type: 'string',
          description:
            'Optional named schema within the category (requires `name`). For ' +
            "name='node': rectangle, ellipse, sticky, text, database, server, " +
            'user, queue, cloud, diamond, hexagon, image, html, icon, component. For ' +
            "name='action': playAction, statusAction, statusReport, " +
            "componentAction. For name='componentSpec': componentSpec, " +
            'componentSpecElement.',
        },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const argObj =
        args && typeof args === 'object' && !Array.isArray(args)
          ? (args as { name?: unknown; subname?: unknown })
          : {};
      const name = argObj.name;
      const subname = argObj.subname;
      if (name === undefined || name === null || name === '') {
        if (subname !== undefined && subname !== null && subname !== '') {
          return errorResult('Invalid arguments: `subname` requires `name` to be set');
        }
        return okResult({
          categories: listSchemaCategories(),
          usage: SCHEMA_INDEX_USAGE,
        });
      }
      if (typeof name !== 'string') {
        return errorResult('Invalid arguments: `name` must be a string when present');
      }
      if (subname !== undefined && subname !== null && subname !== '') {
        if (typeof subname !== 'string') {
          return errorResult('Invalid arguments: `subname` must be a string when present');
        }
        const single = getCategorySubschema(name, subname);
        if (single) {
          return okResult({
            name,
            subname,
            schemas: single.schemas,
            notes: single.notes,
            jqHints: buildJqHints(name, subname),
          });
        }
        const availableSubs = listCategorySubnames(name);
        if (availableSubs === null) {
          return errorResult(
            `unknown schema category: ${name} (available: ${schemaCategoryNames().join(', ')})`,
          );
        }
        return errorResult(
          `unknown schema subname: ${subname} in category ${name} (available: ${availableSubs.join(', ')})`,
        );
      }
      const payload = getSchemaCategory(name);
      if (!payload) {
        return errorResult(
          `unknown schema category: ${name} (available: ${schemaCategoryNames().join(', ')})`,
        );
      }
      return okResult({
        name,
        schemas: payload.schemas,
        notes: payload.notes,
        subnames: listCategorySubnames(name) ?? [],
        jqHints: buildJqHints(name),
      });
    },
  },
  {
    name: 'seeflow_ids',
    description:
      'Batch-mint canonical short ids. `type` is `node` (emits `node-<10 base62 chars>`) ' +
      'or `connector` (emits `conn-<10 base62 chars>`); `count` is an integer in ' +
      '[1, 100]. Pure compute — no flow side effects, no studio state read. Use ' +
      'before authoring a flow.json so minted ids match every other id producer ' +
      'in the studio (canvas, server, upload regex). Call once per type when ' +
      'seeding a flow (one call for nodes, one for connectors).',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [...ID_TYPES],
          description: "Id kind: 'node' (→ `node-…`) or 'connector' (→ `conn-…`)",
        },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_ID_COUNT,
          description: `How many ids to mint (1..${MAX_ID_COUNT})`,
        },
      },
      required: ['type', 'count'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const body =
        args && typeof args === 'object' && !Array.isArray(args)
          ? (args as { type?: unknown; count?: unknown })
          : {};
      const { type, count } = body;
      if (!isIdType(type)) {
        return errorResult(
          `invalid type: ${String(type)} (expected one of: ${ID_TYPES.join(', ')})`,
        );
      }
      if (
        typeof count !== 'number' ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > MAX_ID_COUNT
      ) {
        return errorResult(
          `invalid count: ${String(count)} (expected an integer in [1, ${MAX_ID_COUNT}])`,
        );
      }
      return okResult({ ids: generateIds(type, count) });
    },
  },
  {
    name: 'validate_seeflow',
    description:
      'Validate a flow.json (and optional style.json) against the SeeFlow ' +
      'schemas. Stateless: no flow id, no file:// resolution, no registry ' +
      'side-effects. Returns { ok: true } or { ok: false, issues }.',
    inputSchema: {
      type: 'object',
      properties: {
        flow: { type: 'object' },
        style: { type: 'object' },
      },
      required: ['flow'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const body = args as Record<string, unknown> | undefined;
      if (!body || !('flow' in body)) {
        return errorResult('Body must include `flow`');
      }
      const result = ops.validate({
        flow: body.flow,
        style: body.style as unknown,
      });
      return okResult(result);
    },
  },
  {
    name: 'seeflow_get_flow',
    description: 'Get the full flow definition and on-disk state for a (project, flow) pair.',
    inputSchema: FLOW_PROJECT_INPUT_SCHEMA,
    handler: async (args) => {
      const v = requireProjectFlow(args);
      if ('error' in v) return errorResult(v.error);
      const flowSlug = `${v.project}/${v.flow}`;
      const result = await ops.getFlow(flowSlug);
      switch (result.kind) {
        case 'ok': {
          const entry = ctx.registry.resolve(flowSlug);
          const meta = entry
            ? canvasMetaFor(ctx, {
                kind: 'navigate',
                projectSlug: entry.projectSlug,
                flowSlug: entry.flowSlug,
              })
            : undefined;
          return okResult(result.data, meta);
        }
        case 'notFound':
          return errorResult('not found');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
      }
    },
  },
  {
    name: 'seeflow_get_flow_graph',
    description:
      "Get a flow's nodes + connectors without inlining per-node file-backed " +
      'content (`detail`, `html`). Cheap topology read — pair with seeflow_get_node ' +
      "when you need a specific node's long-form body.",
    inputSchema: FLOW_PROJECT_INPUT_SCHEMA,
    handler: async (args) => {
      const v = requireProjectFlow(args);
      if ('error' in v) return errorResult(v.error);
      const flowSlug = `${v.project}/${v.flow}`;
      const result = await ops.getFlowGraph(flowSlug);
      switch (result.kind) {
        case 'ok': {
          const entry = ctx.registry.resolve(flowSlug);
          const meta = entry
            ? canvasMetaFor(ctx, {
                kind: 'navigate',
                projectSlug: entry.projectSlug,
                flowSlug: entry.flowSlug,
              })
            : undefined;
          return okResult(result.data, meta);
        }
        case 'notFound':
          return errorResult('not found');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.detail}`);
        case 'badSchema':
          return errorResult(
            `Flow file failed schema validation: ${JSON.stringify(result.issues)}`,
          );
      }
    },
  },
  {
    name: 'seeflow_get_node',
    description:
      'Get a single node from a flow with its file-backed content (detail.md, ' +
      'view.html) inlined. Use after seeflow_get_flow_graph to drill into one node.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROJECT_FLOW_PROPERTIES,
        nodeId: { type: 'string', minLength: 1 },
      },
      required: ['project', 'flow', 'nodeId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const v = requireProjectFlow(args);
      if ('error' in v) return errorResult(v.error);
      const { nodeId } = (args as { nodeId?: unknown }) ?? {};
      if (typeof nodeId !== 'string' || nodeId.length === 0) {
        return errorResult('Invalid arguments: nodeId must be a non-empty string');
      }
      const flowSlug = `${v.project}/${v.flow}`;
      const result = await ops.getNode(flowSlug, nodeId);
      switch (result.kind) {
        case 'ok': {
          const entry = ctx.registry.resolve(flowSlug);
          const meta = entry
            ? canvasMetaFor(ctx, {
                kind: 'navigate',
                projectSlug: entry.projectSlug,
                flowSlug: entry.flowSlug,
                nodeId,
              })
            : undefined;
          return okResult(result.data, meta);
        }
        case 'notFound':
          return errorResult('not found');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'unknownNode':
          return errorResult(`Unknown nodeId: ${nodeId}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.detail}`);
        case 'badSchema':
          return errorResult(
            `Flow file failed schema validation: ${JSON.stringify(result.issues)}`,
          );
      }
    },
  },
  {
    name: 'seeflow_register_flow',
    description: 'Register an existing flow file on disk with the studio.',
    inputSchema: inputSchemaFromZod(RegisterBodySchema),
    handler: async (args) => {
      const parsed = RegisterBodySchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid register body: ${JSON.stringify(parsed.error.issues)}`);
      }
      const result = await ops.registerFlow(parsed.data);
      switch (result.kind) {
        case 'ok': {
          const entry = ctx.registry.resolve(result.data.id);
          const meta = entry
            ? canvasMetaFor(ctx, {
                kind: 'create',
                projectSlug: entry.projectSlug,
                flowSlug: entry.flowSlug,
                justCreated: true,
              })
            : undefined;
          return okResult(result.data, meta);
        }
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.detail}`);
        case 'badSchema':
          return errorResult(
            `Flow file failed schema validation: ${JSON.stringify(result.issues)}`,
          );
      }
    },
  },
  {
    name: 'seeflow_delete_flow',
    description: 'Unregister a flow from the studio (the on-disk file is left untouched).',
    inputSchema: FLOW_PROJECT_INPUT_SCHEMA,
    handler: async (args) => {
      const v = requireProjectFlow(args);
      if ('error' in v) return errorResult(v.error);
      const result = ops.deleteFlow(`${v.project}/${v.flow}`);
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true });
        case 'notFound':
          return errorResult('not found');
      }
    },
  },
  {
    name: 'seeflow_create_project',
    description:
      'Scaffold a new SeeFlow project at the given path. Errors if a project already exists there.',
    inputSchema: inputSchemaFromZod(CreateProjectBodySchema),
    handler: async (args) => {
      const parsed = CreateProjectBodySchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid create project body: ${JSON.stringify(parsed.error.issues)}`);
      }
      const result = await ops.createProject(parsed.data);
      switch (result.kind) {
        case 'ok': {
          const meta = canvasMetaFor(ctx, {
            kind: 'create',
            projectSlug: result.data.slug,
          });
          return okResult(result.data, meta);
        }
        case 'alreadyExists':
          return errorResult(`Project already exists at ${result.path}`);
        case 'scaffoldFailed':
          return errorResult(`Failed to scaffold project: ${result.message}`);
      }
    },
  },
  {
    name: 'seeflow_add_node',
    description:
      "Append a new node to a flow (cascade-safe; id auto-generated when omitted). Text content fields (detail on every node; html on type:'html') are auto-externalized to <project>/nodes/<id>/ and stored as file:// refs in flow.json; reads inline the resolved content transparently.",
    inputSchema: inputSchemaFromZod(AddNodeInputSchema),
    handler: async (args) => {
      const parsed = AddNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid add_node arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { project, flow, node } = parsed.data;
      const result = await ops.addNode(`${project}/${flow}`, node);
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true, id: result.data.id, node: result.data.node });
        case 'flowNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Flow failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
  {
    name: 'seeflow_add_bulk',
    description:
      'Append 1–100 nodes and 1–100 connectors to a flow in a SINGLE transactional write. Either every item lands or nothing does — a dangling connector source/target, a duplicate id, or any per-item schema failure rolls back BOTH arrays together (no flow:reload broadcast emitted). Connectors may reference nodes added in the same call. Body: { flowId, nodes?, connectors? } with at least one non-empty. Use this — not multiple seeflow_add_node / seeflow_add_connector round-trips — when seeding a flow. Same per-item shape and externalization rules as the singular tools.',
    inputSchema: inputSchemaFromZod(AddBulkInputSchema),
    handler: async (args) => {
      const parsed = AddBulkInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid add_bulk arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { project, flow, nodes, connectors } = parsed.data;
      const result = await ops.addBulk(`${project}/${flow}`, { nodes, connectors });
      switch (result.kind) {
        case 'ok':
          return okResult({
            ok: true,
            nodes: result.data.nodes,
            connectors: result.data.connectors,
          });
        case 'flowNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Flow failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'duplicateIdInBatch':
          return errorResult(`Duplicate ${result.collection} id in batch: ${result.id}`);
        case 'idAlreadyExists':
          return errorResult(
            `${result.collection === 'nodes' ? 'Node' : 'Connector'} id already exists: ${result.id}`,
          );
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
  {
    name: 'seeflow_delete_node',
    description: 'Delete a node and cascade-remove every connector touching it.',
    inputSchema: inputSchemaFromZod(DeleteNodeInputSchema),
    handler: async (args) => {
      const parsed = DeleteNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid delete_node arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { project, flow, nodeId } = parsed.data;
      const result = await ops.deleteNode(`${project}/${flow}`, nodeId);
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true });
        case 'flowNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Flow failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'unknownNode':
          return errorResult(`Unknown nodeId: ${nodeId}`);
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
  {
    name: 'seeflow_move_node',
    description: "Set a node's { x, y } canvas position.",
    inputSchema: inputSchemaFromZod(MoveNodeInputSchema),
    handler: async (args) => {
      const parsed = MoveNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid move_node arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { project, flow, nodeId, x, y } = parsed.data;
      const result = await ops.moveNode(`${project}/${flow}`, nodeId, { x, y });
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true, position: result.data.position });
        case 'flowNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Flow failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'unknownNode':
          return errorResult(`Unknown nodeId: ${nodeId}`);
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
  {
    name: 'seeflow_patch_node',
    description:
      "Update fields on an existing node (position, name, description, detail, icon, colors, border, font, dimensions, autoSize, plus type:'icon'-only color/strokeWidth/alt and capabilities playAction/statusAction/stateSource). `type` can flip a node between any of the 14 visual variants (rectangle/ellipse/sticky/text/database/server/user/queue/cloud/diamond/hexagon/image/html/icon); the post-merge schema reparse gates required fields on the new type (image.data.path, icon.data.icon). Setting detail (every node) or html (type:'html') writes the content to <project>/nodes/<id>/{detail.md|view.html}; the file:// ref on the node persists. Empty-string detail empties the file but keeps the ref.",
    inputSchema: inputSchemaFromZod(PatchNodeInputSchema),
    handler: async (args) => {
      const parsed = PatchNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid patch_node arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { project, flow, nodeId, ...updates } = parsed.data;
      const result = await ops.patchNode(`${project}/${flow}`, nodeId, updates);
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true });
        case 'flowNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Flow failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'unknownNode':
          return errorResult(`Unknown nodeId: ${nodeId}`);
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
  {
    name: 'seeflow_reorder_node',
    description:
      'Reorder a node within flow.nodes[] (forward / backward / toFront / toBack / toIndex).',
    inputSchema: inputSchemaFromZod(ReorderNodeInputSchema),
    handler: async (args) => {
      const parsed = ReorderNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          `Invalid reorder_node arguments: ${JSON.stringify(parsed.error.issues)}`,
        );
      }
      const { project, flow, nodeId, ...body } = parsed.data;
      // Delegate the op-specific shape to the existing ReorderBodySchema so
      // reorderNodeImpl receives the same discriminated union the REST route
      // does — keeps a single source of truth for op semantics.
      const reorderBody = ReorderBodySchema.parse(body);
      const result = await ops.reorderNode(`${project}/${flow}`, nodeId, reorderBody);
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true });
        case 'flowNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Flow failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'unknownNode':
          return errorResult(`Unknown nodeId: ${nodeId}`);
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
  {
    name: 'seeflow_add_connector',
    description:
      "Append a new connector between two nodes (kind defaults to 'default'; id auto-generated when omitted).",
    inputSchema: inputSchemaFromZod(AddConnectorInputSchema),
    handler: async (args) => {
      const parsed = AddConnectorInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          `Invalid add_connector arguments: ${JSON.stringify(parsed.error.issues)}`,
        );
      }
      const { project, flow, connector } = parsed.data;
      const result = await ops.addConnector(`${project}/${flow}`, connector);
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true, id: result.data.id });
        case 'flowNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Flow failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
  {
    name: 'seeflow_patch_connector',
    description:
      'Update fields on an existing connector (label, style, color, direction, path, borderSize, fontSize, kind, per-kind payload, reconnect endpoints + handles + pins).',
    inputSchema: inputSchemaFromZod(PatchConnectorInputSchema),
    handler: async (args) => {
      const parsed = PatchConnectorInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          `Invalid patch_connector arguments: ${JSON.stringify(parsed.error.issues)}`,
        );
      }
      const { project, flow, connectorId, ...updates } = parsed.data;
      const result = await ops.patchConnector(`${project}/${flow}`, connectorId, updates);
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true });
        case 'flowNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Flow failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'unknownConnector':
          return errorResult(`Unknown connectorId: ${connectorId}`);
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
  {
    name: 'seeflow_delete_connector',
    description: 'Delete a connector by id.',
    inputSchema: inputSchemaFromZod(DeleteConnectorInputSchema),
    handler: async (args) => {
      const parsed = DeleteConnectorInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          `Invalid delete_connector arguments: ${JSON.stringify(parsed.error.issues)}`,
        );
      }
      const { project, flow, connectorId } = parsed.data;
      const result = await ops.deleteConnector(`${project}/${flow}`, connectorId);
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true });
        case 'flowNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Flow failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'unknownConnector':
          return errorResult(`Unknown connectorId: ${connectorId}`);
        case 'writeFailed':
          return errorResult(`Failed to write demo file: ${result.message}`);
      }
    },
  },
];

/**
 * Build a fresh MCP Server scoped to a registry + watcher. The server speaks
 * `tools/list` and `tools/call` against the tool list. Wired to a transport
 * by the caller (see the /mcp route in server.ts and the stdio shim in
 * mcp-shim.ts) — every request builds its own server in stateless mode.
 */
export function createMcpServer(options: CreateMcpServerOptions): Server {
  const ops = createOperations({
    registry: options.registry,
    watcher: options.watcher,
  });
  const tools = buildTools(ops, {
    registry: options.registry,
    token: options.token,
    httpUrl: options.httpUrl,
  });

  const server = new Server(
    { name: 'seeflow', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      };
    }
    return tool.handler(request.params.arguments);
  });

  // MCP Apps resource: a single readable HTML bundle the host iframes when a
  // canvas-bearing tool returns `_meta['openai/outputTemplate'] = CANVAS_RESOURCE_URI`.
  // Listed unconditionally — the bundle is part of the binary, even on hosts
  // that don't speak MCP Apps (they just ignore the resource).
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [
      {
        uri: CANVAS_RESOURCE_URI,
        name: 'SeeFlow Canvas',
        mimeType: CANVAS_RESOURCE_MIME,
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    if (request.params.uri !== CANVAS_RESOURCE_URI) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    return {
      contents: [
        {
          uri: CANVAS_RESOURCE_URI,
          mimeType: CANVAS_RESOURCE_MIME,
          text: readCanvasHtml(),
        },
      ],
    };
  });

  return server;
}
