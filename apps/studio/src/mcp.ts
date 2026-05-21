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
  ConnectorsBulkBodySchema,
  CreateProjectBodySchema,
  NodePatchBodySchema,
  NodesBulkBodySchema,
  type Operations,
  PositionBodySchema,
  RegisterBodySchema,
  ReorderBodySchema,
  createOperations,
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

const okResult = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

// Error payloads (e.g. 'unknown demo', 'Failed to write demo file') still say
// "demo" so the strings match the REST handlers in api.ts byte-for-byte.
// Renaming requires updating api.ts + ~18 test assertions in lockstep — a
// separate refactor from this MCP review.
const errorResult = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});

// Most MCP tools take a single flowId argument. Defined inline as plain
// JSON Schema (rather than a one-off Zod schema) because there's no REST
// counterpart to share with.
const FLOW_ID_INPUT_SCHEMA = {
  type: 'object',
  properties: { flowId: { type: 'string', minLength: 1 } },
  required: ['flowId'],
  additionalProperties: false,
} as const;

const requireFlowId = (args: unknown): { flowId: string } | { error: string } => {
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
const FlowNodeIdBaseSchema = z.object({
  flowId: z.string().min(1),
  nodeId: z.string().min(1),
});

// add_node input: { flowId, node: <node payload> }. The inner `node` object is
// loose here (additionalProperties=true via passthrough) because ResolvedFlowSchema
// runs the full validation server-side after the new node is merged in.
const AddNodeInputSchema = z.object({
  flowId: z.string().min(1),
  node: z.record(z.unknown()),
});

// add_nodes input: { flowId, nodes: [...] }. Same loose per-item shape as
// add_node — ResolvedFlowSchema runs once over the whole batch server-side
// after the merge. Min/max bounds come from NodesBulkBodySchema so the
// 100-item cap shows up in the JSON Schema the agent introspects.
const AddNodesInputSchema = NodesBulkBodySchema.extend({
  flowId: z.string().min(1),
});

const DeleteNodeInputSchema = FlowNodeIdBaseSchema;

// move_node input: { flowId, nodeId } extended with PositionBodySchema's
// { x, y } fields so agents see one flat schema.
const MoveNodeInputSchema = FlowNodeIdBaseSchema.extend({
  x: PositionBodySchema.shape.x,
  y: PositionBodySchema.shape.y,
});

// reorder_node input: each branch of the existing ReorderBodySchema
// discriminated union extended with flowId/nodeId. Keeps the discriminator
// on `op` so the emitted JSON Schema is an oneOf the agent can introspect.
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
// ResolvedFlowSchema runs the full validation server-side after the new connector is
// merged in (post-mutation parse catches dangling source/target refs and
// kind-discriminator violations).
const AddConnectorInputSchema = z.object({
  flowId: z.string().min(1),
  connector: z.record(z.unknown()),
});

// add_connectors input: { flowId, connectors: [...] }. Mirrors add_nodes.
const AddConnectorsInputSchema = ConnectorsBulkBodySchema.extend({
  flowId: z.string().min(1),
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

const buildTools = (ops: Operations): McpTool[] => [
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
    description: 'Get the full flow definition and on-disk state for a flowId.',
    inputSchema: FLOW_ID_INPUT_SCHEMA,
    handler: async (args) => {
      const v = requireFlowId(args);
      if ('error' in v) return errorResult(v.error);
      const result = await ops.getFlow(v.flowId);
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
    name: 'seeflow_get_flow_graph',
    description:
      "Get a flow's nodes + connectors without inlining per-node file-backed " +
      'content (`detail`, `html`). Cheap topology read — pair with seeflow_get_node ' +
      "when you need a specific node's long-form body.",
    inputSchema: FLOW_ID_INPUT_SCHEMA,
    handler: async (args) => {
      const v = requireFlowId(args);
      if ('error' in v) return errorResult(v.error);
      const result = await ops.getFlowGraph(v.flowId);
      switch (result.kind) {
        case 'ok':
          return okResult(result.data);
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
        flowId: { type: 'string', minLength: 1 },
        nodeId: { type: 'string', minLength: 1 },
      },
      required: ['flowId', 'nodeId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return errorResult('Invalid arguments: expected an object with flowId + nodeId');
      }
      const { flowId, nodeId } = args as { flowId?: unknown; nodeId?: unknown };
      if (typeof flowId !== 'string' || flowId.length === 0) {
        return errorResult('Invalid arguments: flowId must be a non-empty string');
      }
      if (typeof nodeId !== 'string' || nodeId.length === 0) {
        return errorResult('Invalid arguments: nodeId must be a non-empty string');
      }
      const result = await ops.getNode(flowId, nodeId);
      switch (result.kind) {
        case 'ok':
          return okResult(result.data);
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
    description: 'Unregister a flow from the studio (the on-disk file is left untouched).',
    inputSchema: FLOW_ID_INPUT_SCHEMA,
    handler: async (args) => {
      const v = requireFlowId(args);
      if ('error' in v) return errorResult(v.error);
      const result = ops.deleteFlow(v.flowId);
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
      const result = await ops.createProject(parsed.data);
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
    description:
      'Append a new node to a flow (cascade-safe; id auto-generated when omitted). Text content fields (detail on every node; html on htmlNode) are auto-externalized to <project>/.seeflow/nodes/<id>/ and stored as file:// refs in flow.json; reads inline the resolved content transparently.',
    inputSchema: inputSchemaFromZod(AddNodeInputSchema),
    handler: async (args) => {
      const parsed = AddNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid add_node arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { flowId, node } = parsed.data;
      const result = await ops.addNode(flowId, node);
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
    name: 'seeflow_add_nodes',
    description:
      'Append 1–100 nodes to a flow in a single transactional write. Either every node lands or nothing does — if any item fails schema validation the whole batch is rejected. Use this instead of multiple seeflow_add_node calls when seeding a flow; it avoids per-item round-trips. Same per-item shape and externalization rules as seeflow_add_node.',
    inputSchema: inputSchemaFromZod(AddNodesInputSchema),
    handler: async (args) => {
      const parsed = AddNodesInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid add_nodes arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { flowId, nodes } = parsed.data;
      const result = await ops.addNodesBulk(flowId, { nodes });
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true, nodes: result.data.nodes });
        case 'flowNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Flow failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'duplicateIdInBatch':
          return errorResult(`Duplicate id in batch: ${result.id}`);
        case 'idAlreadyExists':
          return errorResult(`Node id already exists: ${result.id}`);
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
      const result = await ops.deleteNode(flowId, nodeId);
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
      const result = await ops.moveNode(flowId, nodeId, { x, y });
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
      'Update fields on an existing node (position, name, description, detail, icon, colors, border, font, shape, dimensions, autoSize, plus iconNode-only color/strokeWidth/alt). Setting detail (every node) or html (htmlNode) writes the content to <project>/.seeflow/nodes/<id>/{detail.md|view.html}; the file:// ref on the node persists. Empty-string detail empties the file but keeps the ref.',
    inputSchema: inputSchemaFromZod(PatchNodeInputSchema),
    handler: async (args) => {
      const parsed = PatchNodeInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(`Invalid patch_node arguments: ${JSON.stringify(parsed.error.issues)}`);
      }
      const { flowId, nodeId, ...updates } = parsed.data;
      const result = await ops.patchNode(flowId, nodeId, updates);
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
      const { flowId, nodeId, ...body } = parsed.data;
      // Delegate the op-specific shape to the existing ReorderBodySchema so
      // reorderNodeImpl receives the same discriminated union the REST route
      // does — keeps a single source of truth for op semantics.
      const reorderBody = ReorderBodySchema.parse(body);
      const result = await ops.reorderNode(flowId, nodeId, reorderBody);
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
      const result = await ops.addConnector(flowId, connector);
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
    name: 'seeflow_add_connectors',
    description:
      'Append 1–100 connectors to a flow in a single transactional write. Either every connector lands or nothing does — a dangling source/target on any item rolls back the whole batch. Use after seeflow_add_nodes when seeding a flow.',
    inputSchema: inputSchemaFromZod(AddConnectorsInputSchema),
    handler: async (args) => {
      const parsed = AddConnectorsInputSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          `Invalid add_connectors arguments: ${JSON.stringify(parsed.error.issues)}`,
        );
      }
      const { flowId, connectors } = parsed.data;
      const result = await ops.addConnectorsBulk(flowId, { connectors });
      switch (result.kind) {
        case 'ok':
          return okResult({ ok: true, connectors: result.data.connectors });
        case 'flowNotFound':
          return errorResult('unknown demo');
        case 'fileNotFound':
          return errorResult(`Flow file not found: ${result.path}`);
        case 'badJson':
          return errorResult(`Flow file is not valid JSON: ${result.message}`);
        case 'badSchema':
          return errorResult(`Flow failed schema validation: ${JSON.stringify(result.issues)}`);
        case 'duplicateIdInBatch':
          return errorResult(`Duplicate id in batch: ${result.id}`);
        case 'idAlreadyExists':
          return errorResult(`Connector id already exists: ${result.id}`);
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
      const { flowId, connectorId, ...updates } = parsed.data;
      const result = await ops.patchConnector(flowId, connectorId, updates);
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
      const result = await ops.deleteConnector(flowId, connectorId);
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
    projectBaseDir: options.projectBaseDir,
  });
  const tools = buildTools(ops);

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
