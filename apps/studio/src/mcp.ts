import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type ZodTypeAny, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ConnectorPatchBodySchema,
  CreateProjectBodySchema,
  NodePatchBodySchema,
  type OperationsDeps,
  PositionBodySchema,
  RegisterBodySchema,
  ReorderBodySchema,
  addConnectorImpl,
  addNodeImpl,
  createProjectImpl,
  deleteConnectorImpl,
  deleteFlowImpl,
  deleteNodeImpl,
  getFlowImpl,
  listDemosImpl,
  moveNodeImpl,
  patchConnectorImpl,
  patchNodeImpl,
  registerFlowImpl,
  reorderNodeImpl,
  validateImpl,
} from './operations.ts';
import type { Registry } from './registry.ts';
import type { FlowWatcher } from './watcher.ts';

export interface CreateMcpServerOptions {
  registry: Registry;
  watcher?: FlowWatcher;
  /** Override base directory for new projects. Defaults to ~/.seeflow. Tests inject a tmp dir. */
  projectBaseDir?: string;
}

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
const inputSchemaFromZod = (schema: ZodTypeAny): Record<string, unknown> => {
  const json = zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>;
  const { $schema: _$schema, ...rest } = json;
  return rest;
};

const okResult = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

const errorResult = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});

// Most MCP tools take a single flowId argument. Defined inline as plain
// JSON Schema (rather than a one-off Zod schema) because there's no REST
// counterpart to share with.
const DEMO_ID_INPUT_SCHEMA = {
  type: 'object',
  properties: { flowId: { type: 'string', minLength: 1 } },
  required: ['flowId'],
  additionalProperties: false,
} as const;

const requireDemoId = (args: unknown): { flowId: string } | { error: string } => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { error: 'Invalid arguments: expected an object with flowId' };
  }
  const { flowId } = args as { flowId?: unknown };
  if (typeof flowId !== 'string' || flowId.length === 0) {
    return { error: 'Invalid arguments: flowId must be a non-empty string' };
  }
  return { flowId };
};

// {flowId, nodeId} body shape shared by move + reorder + delete inputs.
const DemoNodeIdBaseSchema = z.object({
  flowId: z.string().min(1),
  nodeId: z.string().min(1),
});

// add_node input: { flowId, node: <node payload> }. The inner `node` object is
// loose here (additionalProperties=true via passthrough) because FlowSchema
// runs the full validation server-side after the new node is merged in.
const AddNodeInputSchema = z.object({
  flowId: z.string().min(1),
  node: z.record(z.unknown()),
});

const DeleteNodeInputSchema = DemoNodeIdBaseSchema;

// move_node input: { flowId, nodeId } extended with PositionBodySchema's
// { x, y } fields so agents see one flat schema.
const MoveNodeInputSchema = DemoNodeIdBaseSchema.extend({
  x: PositionBodySchema.shape.x,
  y: PositionBodySchema.shape.y,
});

// reorder_node input: each branch of the existing ReorderBodySchema
// discriminated union extended with flowId/nodeId. Keeps the discriminator
// on `op` so the emitted JSON Schema is an oneOf the agent can introspect.
const ReorderNodeInputSchema = z.discriminatedUnion('op', [
  DemoNodeIdBaseSchema.extend({ op: z.literal('forward') }),
  DemoNodeIdBaseSchema.extend({ op: z.literal('backward') }),
  DemoNodeIdBaseSchema.extend({ op: z.literal('toFront') }),
  DemoNodeIdBaseSchema.extend({ op: z.literal('toBack') }),
  DemoNodeIdBaseSchema.extend({
    op: z.literal('toIndex'),
    index: z.number().int().nonnegative(),
  }),
]);

// patch_node input: { flowId, nodeId } merged with NodePatchBodySchema's
// optional fields. .extend() on the strict body schema preserves strict
// mode, so unknown top-level keys still trip the Zod parse before any disk
// IO — matching the REST handler's "Invalid node patch body" 400 path.
const PatchNodeInputSchema = NodePatchBodySchema.extend({
  flowId: z.string().min(1),
  nodeId: z.string().min(1),
});

// add_connector input: { flowId, connector: <connector payload> }. The inner
// `connector` object is loose (additionalProperties=true via z.record) because
// FlowSchema runs the full validation server-side after the new connector is
// merged in (post-mutation parse catches dangling source/target refs and
// kind-discriminator violations).
const AddConnectorInputSchema = z.object({
  flowId: z.string().min(1),
  connector: z.record(z.unknown()),
});

// patch_connector input: { flowId, connectorId } merged with the strict
// ConnectorPatchBodySchema. .extend() preserves strict mode so unknown
// top-level keys trip the Zod parse before any IO — matching the REST
// handler's "Invalid connector patch body" 400 path.
const PatchConnectorInputSchema = ConnectorPatchBodySchema.extend({
  flowId: z.string().min(1),
  connectorId: z.string().min(1),
});

const DeleteConnectorInputSchema = z.object({
  flowId: z.string().min(1),
  connectorId: z.string().min(1),
});

const buildTools = (deps: OperationsDeps): McpTool[] => [
  {
    name: 'seeflow_list_flows',
    description: 'List every demo registered with the studio.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const result = listDemosImpl(deps);
      return okResult(result.data);
    },
  },
  {
    name: 'validate_seeflow',
    description:
      'Validate an architecture.json (and optional style.json) against the ' +
      'SeeFlow schemas. Stateless: no flow id, no file:// resolution, no ' +
      'registry side-effects. Returns { ok: true } or { ok: false, issues }.',
    inputSchema: {
      type: 'object',
      properties: {
        architecture: { type: 'object' },
        style: { type: 'object' },
      },
      required: ['architecture'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const body = args as Record<string, unknown> | undefined;
      if (!body || !('architecture' in body)) {
        return errorResult('Body must include `architecture`');
      }
      const result = validateImpl({
        architecture: body.architecture,
        style: body.style as unknown,
      });
      return okResult(result);
    },
  },
  {
    name: 'seeflow_get_flow',
    description: 'Get the full demo definition and on-disk state for a flowId.',
    inputSchema: DEMO_ID_INPUT_SCHEMA,
    handler: async (args) => {
      const v = requireDemoId(args);
      if ('error' in v) return errorResult(v.error);
      const result = await getFlowImpl(deps, v.flowId);
      switch (result.kind) {
        case 'ok':
          return okResult(result.data);
        case 'notFound':
          return errorResult('not found');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
      }
    },
  },
  {
    name: 'seeflow_register_flow',
    description: 'Register an existing demo file on disk with the studio.',
    inputSchema: inputSchemaFromZod(RegisterBodySchema),
    handler: async (args) => {
      const parsed = RegisterBodySchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid register body: ${JSON.stringify(parsed.error.issues)}`);
      }
      const result = await registerFlowImpl(deps, parsed.data);
      switch (result.kind) {
        case 'ok':
          return okResult(result.data);
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.detail}`);
        case 'badSchema':
          return errorResult(
            `Flow file failed schema validation: ${JSON.stringify(result.issues)}`,
          );
        case 'sdkWriteFailed':
          return errorResult(`Failed to write SDK helper: ${result.message}`);
      }
    },
  },
  {
    name: 'seeflow_delete_flow',
    description: 'Unregister a demo from the studio (the on-disk file is left untouched).',
    inputSchema: DEMO_ID_INPUT_SCHEMA,
    handler: async (args) => {
      const v = requireDemoId(args);
      if ('error' in v) return errorResult(v.error);
      const result = deleteFlowImpl(deps, v.flowId);
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
    description: 'Create a new SeeFlow project folder, or register an existing one.',
    inputSchema: inputSchemaFromZod(CreateProjectBodySchema),
    handler: async (args) => {
      const parsed = CreateProjectBodySchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid create project body: ${JSON.stringify(parsed.error.issues)}`);
      }
      const result = await createProjectImpl(deps, parsed.data);
      switch (result.kind) {
        case 'ok':
          return okResult(result.data);
        case 'badJson':
          return errorResult(`Existing demo file is not valid JSON: ${result.detail}`);
        case 'badSchema':
          return errorResult(
            `Existing demo file failed schema validation: ${JSON.stringify(result.issues)}`,
          );
        case 'scaffoldFailed':
          return errorResult(`Failed to scaffold project: ${result.message}`);
        case 'sdkWriteFailed':
          return errorResult(`Failed to write SDK helper: ${result.message}`);
      }
    },
  },
  {
    name: 'seeflow_add_node',
    description: 'Append a new node to a demo (cascade-safe; id auto-generated when omitted).',
    inputSchema: inputSchemaFromZod(AddNodeInputSchema),
    handler: async (args) => {
      const parsed = AddNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid add_node arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { flowId, node } = parsed.data;
      const result = await addNodeImpl(deps, flowId, node);
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
    name: 'seeflow_delete_node',
    description: 'Delete a node and cascade-remove every connector touching it.',
    inputSchema: inputSchemaFromZod(DeleteNodeInputSchema),
    handler: async (args) => {
      const parsed = DeleteNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid delete_node arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { flowId, nodeId } = parsed.data;
      const result = await deleteNodeImpl(deps, flowId, nodeId);
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
      const { flowId, nodeId, x, y } = parsed.data;
      const result = await moveNodeImpl(deps, flowId, nodeId, { x, y });
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
      'Update fields on an existing node (position, name, description, detail, colors, border, font, shape, dimensions).',
    inputSchema: inputSchemaFromZod(PatchNodeInputSchema),
    handler: async (args) => {
      const parsed = PatchNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid patch_node arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { flowId, nodeId, ...updates } = parsed.data;
      const result = await patchNodeImpl(deps, flowId, nodeId, updates);
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
      'Reorder a node within demo.nodes[] (forward / backward / toFront / toBack / toIndex).',
    inputSchema: inputSchemaFromZod(ReorderNodeInputSchema),
    handler: async (args) => {
      const parsed = ReorderNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          `Invalid reorder_node arguments: ${JSON.stringify(parsed.error.issues)}`,
        );
      }
      const { flowId, nodeId, ...body } = parsed.data;
      // Delegate the op-specific shape to the existing ReorderBodySchema so
      // reorderNodeImpl receives the same discriminated union the REST route
      // does — keeps a single source of truth for op semantics.
      const reorderBody = ReorderBodySchema.parse(body);
      const result = await reorderNodeImpl(deps, flowId, nodeId, reorderBody);
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
      const { flowId, connector } = parsed.data;
      const result = await addConnectorImpl(deps, flowId, connector);
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
      'Update fields on an existing connector (label, style, color, kind, per-kind payload, reconnect endpoints).',
    inputSchema: inputSchemaFromZod(PatchConnectorInputSchema),
    handler: async (args) => {
      const parsed = PatchConnectorInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          `Invalid patch_connector arguments: ${JSON.stringify(parsed.error.issues)}`,
        );
      }
      const { flowId, connectorId, ...updates } = parsed.data;
      const result = await patchConnectorImpl(deps, flowId, connectorId, updates);
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
      const { flowId, connectorId } = parsed.data;
      const result = await deleteConnectorImpl(deps, flowId, connectorId);
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
  const tools = buildTools({
    registry: options.registry,
    watcher: options.watcher,
    projectBaseDir: options.projectBaseDir,
  });

  const server = new Server({ name: 'seeflow', version: '0.1.0' }, { capabilities: { tools: {} } });

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

  return server;
}
