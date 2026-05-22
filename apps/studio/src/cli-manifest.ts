// Machine-readable command catalogue. Powers `seeflow help` and
// `seeflow help <command>` so AI agents and downstream tools can discover
// every subcommand without scraping the human help text.

import { zodToJsonSchema } from 'zod-to-json-schema';
import { EXIT_CODE_BY_KIND, exitCodeForKind } from './cli-helpers.ts';
import {
  ConnectorPatchBodySchema,
  CreateProjectBodySchema,
  FlowBulkBodySchema,
  NodePatchBodySchema,
  PositionBodySchema,
  RegisterBodySchema,
  ReorderBodySchema,
} from './operations.ts';

export interface CommandFlag {
  /** Flag name without the leading `--`. */
  name: string;
  /** Placeholder shown in synopsis (e.g. `<n>`, `<path>`, `<JSON>`). */
  valuePlaceholder?: string;
  description: string;
  required?: boolean;
}

export interface CommandArg {
  /** Positional argument name (no angle brackets). */
  name: string;
  required: boolean;
  description: string;
}

export type CommandCategory =
  | 'lifecycle'
  | 'flows'
  | 'nodes'
  | 'connectors'
  | 'project'
  | 'live'
  | 'meta';

export type CommandOutputKind = 'json' | 'text' | 'stream';

export interface CommandManifestEntry {
  name: string;
  synopsis: string;
  description: string;
  category: CommandCategory;
  args: CommandArg[];
  flags: CommandFlag[];
  body?: {
    /** Name of a Zod schema exported from operations.ts (resolved to JSON
     *  Schema in the rendered JSON output). */
    schemaRef?: string;
    /** Concrete example body the caller can copy. */
    example?: unknown;
  };
  /** Shape of stdout. Default 'json' (envelope {ok:true,...}). 'text' for
   *  human-readable lifecycle output. 'stream' for SSE-driven runs. */
  outputKind?: CommandOutputKind;
  outputs: {
    okExample?: unknown;
    errorKinds?: string[];
  };
  requiresStudio: boolean;
  examples: string[];
}

const BODY_FLAGS: CommandFlag[] = [
  { name: 'json', valuePlaceholder: '<JSON>', description: 'Inline JSON body' },
  { name: 'file', valuePlaceholder: '<path>', description: 'Read JSON body from file' },
  { name: 'stdin', description: 'Read JSON body from stdin' },
];

export const COMMAND_MANIFEST: CommandManifestEntry[] = [
  // ---- lifecycle ---------------------------------------------------------
  {
    name: 'start',
    synopsis: 'seeflow start [--port <n>] [--foreground] [--debug]',
    description: 'Start the SeeFlow Studio server. Default when no command is given.',
    category: 'lifecycle',
    args: [],
    flags: [
      { name: 'port', valuePlaceholder: '<n>', description: 'Listen on port n (default: 4321)' },
      { name: 'foreground', description: 'Run attached to the terminal (default: background)' },
      { name: 'debug', description: 'Verbose logs + pipe daemon output to ~/.seeflow/seeflow.log' },
    ],
    outputKind: 'text',
    outputs: { okExample: { url: 'http://localhost:4321', port: 4321, pid: 12345 } },
    requiresStudio: false,
    examples: ['seeflow start', 'seeflow start --port 8080 --foreground'],
  },
  {
    name: 'stop',
    synopsis: 'seeflow stop',
    description: 'Stop a background studio instance (no-op if none is running).',
    category: 'lifecycle',
    args: [],
    flags: [],
    outputKind: 'text',
    outputs: { okExample: { stopped: true, pid: 12345 } },
    requiresStudio: false,
    examples: ['seeflow stop'],
  },
  // ---- meta --------------------------------------------------------------
  {
    name: 'version',
    synopsis: 'seeflow version',
    description: 'Print the CLI version.',
    category: 'meta',
    args: [],
    flags: [],
    outputs: { okExample: { version: '0.1.47' } },
    requiresStudio: false,
    examples: ['seeflow version'],
  },
  {
    name: 'help',
    synopsis: 'seeflow help [<command>]',
    description:
      'Show CLI help. With no args lists every command grouped by category. ' +
      "With a command name shows that command's synopsis, flags, body schema, " +
      'output shape, error kinds, and examples.',
    category: 'meta',
    args: [{ name: 'command', required: false, description: 'Name of a command to drill into' }],
    flags: [],
    outputs: {},
    requiresStudio: false,
    examples: ['seeflow help', 'seeflow help nodes:add'],
  },
  // ---- flows -------------------------------------------------------------
  {
    name: 'register',
    synopsis: 'seeflow register [--path <dir>] [--flow <file>]',
    description:
      'Register a demo repo with the studio. Reads <repoPath>/<flow> (defaulting ' +
      'to ./flow.json), validates the schema, and writes an entry to ' +
      '~/.seeflow/registry.json. Alias of flows:register.',
    category: 'flows',
    args: [],
    flags: [
      { name: 'path', valuePlaceholder: '<dir>', description: 'Path to repo root (default: cwd)' },
      {
        name: 'flow',
        valuePlaceholder: '<file>',
        description: 'Path to flow.json relative to repo root (default: flow.json)',
      },
    ],
    outputs: {
      okExample: { id: 'abc12345', slug: 'checkout', sdk: { outcome: 'skipped', filePath: null } },
      errorKinds: ['fileNotFound', 'badJson', 'badSchema', 'sdkWriteFailed'],
    },
    requiresStudio: false,
    examples: ['seeflow register', 'seeflow register --path ./my-app'],
  },
  {
    name: 'flows:register',
    synopsis: 'seeflow flows:register [--path <dir>] [--flow <file>]',
    description: 'Register a demo repo. Identical behaviour to `register`.',
    category: 'flows',
    args: [],
    flags: [
      { name: 'path', valuePlaceholder: '<dir>', description: 'Path to repo root (default: cwd)' },
      {
        name: 'flow',
        valuePlaceholder: '<file>',
        description: 'Path to flow.json relative to repo root (default: flow.json)',
      },
    ],
    body: { schemaRef: 'RegisterBody' },
    outputs: {
      okExample: { id: 'abc12345', slug: 'checkout', sdk: { outcome: 'skipped', filePath: null } },
      errorKinds: ['fileNotFound', 'badJson', 'badSchema', 'sdkWriteFailed'],
    },
    requiresStudio: false,
    examples: ['seeflow flows:register --path ./my-app'],
  },
  {
    name: 'flows:list',
    synopsis: 'seeflow flows:list',
    description: 'List every registered flow with id, slug, name, repoPath, and valid flag.',
    category: 'flows',
    args: [],
    flags: [],
    outputs: { okExample: { flows: [{ id: 'abc12345', slug: 'checkout', name: 'Checkout' }] } },
    requiresStudio: false,
    examples: ['seeflow flows:list'],
  },
  {
    name: 'flows:summary',
    synopsis: 'seeflow flows:summary',
    description:
      'Cheap discovery — returns { id, name, description } only. Pair with flows:get ' +
      'or flows:graph to drill into one flow.',
    category: 'flows',
    args: [],
    flags: [],
    outputs: { okExample: { flows: [{ id: 'abc12345', name: 'Checkout' }] } },
    requiresStudio: false,
    examples: ['seeflow flows:summary'],
  },
  {
    name: 'flows:get',
    synopsis: 'seeflow flows:get <flowId>',
    description: 'Get the full merged flow definition and on-disk state for one flow.',
    category: 'flows',
    args: [{ name: 'flowId', required: true, description: 'Flow id or slug' }],
    flags: [],
    outputs: { errorKinds: ['notFound', 'fileNotFound'] },
    requiresStudio: false,
    examples: ['seeflow flows:get abc12345'],
  },
  {
    name: 'flows:graph',
    synopsis: 'seeflow flows:graph <flowId>',
    description:
      'Get nodes + connectors for one flow without inlining per-node file-backed ' +
      'content (detail.md, view.html). Cheap topology read.',
    category: 'flows',
    args: [{ name: 'flowId', required: true, description: 'Flow id or slug' }],
    flags: [],
    outputs: { errorKinds: ['notFound', 'fileNotFound', 'badJson', 'badSchema'] },
    requiresStudio: false,
    examples: ['seeflow flows:graph abc12345'],
  },
  {
    name: 'flows:delete',
    synopsis: 'seeflow flows:delete <flowId>',
    description: 'Unregister a flow from the studio (the on-disk file is left untouched).',
    category: 'flows',
    args: [{ name: 'flowId', required: true, description: 'Flow id or slug' }],
    flags: [],
    outputs: { okExample: { ok: true }, errorKinds: ['notFound'] },
    requiresStudio: false,
    examples: ['seeflow flows:delete abc12345'],
  },
  {
    name: 'flows:layout',
    synopsis: 'seeflow flows:layout <flowId> [--json | --file | --stdin]',
    description:
      'Compute an ELK layout for the flow and write style.json next to flow.json. ' +
      'Body is optional — `{ options? }` shape. Empty body uses defaults.',
    category: 'flows',
    args: [{ name: 'flowId', required: true, description: 'Flow id or slug' }],
    flags: BODY_FLAGS,
    body: { example: { options: { 'elk.direction': 'RIGHT' } } },
    outputs: {
      okExample: { ok: true },
      errorKinds: ['flowNotFound', 'fileNotFound', 'badJson', 'badSchema', 'writeFailed'],
    },
    requiresStudio: false,
    examples: ['seeflow flows:layout abc12345'],
  },
  {
    name: 'flow:add-bulk',
    synopsis: 'seeflow flow:add-bulk <flowId> [--json | --file | --stdin]',
    description:
      'Add up to 100 nodes + 100 connectors atomically. Body shape: ' +
      '`{ nodes?: Node[], connectors?: Connector[] }` (at least one non-empty). ' +
      'Connectors may reference nodes added in the same batch; the whole flow ' +
      'is re-validated post-merge so a dangling source/target — or any per-item ' +
      'schema failure — rolls back both arrays together and emits no broadcast.',
    category: 'flows',
    args: [{ name: 'flowId', required: true, description: 'Flow id or slug' }],
    flags: BODY_FLAGS,
    body: { schemaRef: 'FlowBulkBody' },
    outputs: {
      okExample: {
        nodes: [{ id: 'node-a', node: { id: 'node-a' } }],
        connectors: [{ id: 'conn-a' }],
      },
      errorKinds: [
        'flowNotFound',
        'fileNotFound',
        'badJson',
        'badSchema',
        'duplicateIdInBatch',
        'idAlreadyExists',
        'writeFailed',
      ],
    },
    requiresStudio: false,
    examples: [
      'seeflow flow:add-bulk abc12345 --json \'{"nodes":[{"id":"a","type":"shapeNode","data":{"shape":"rectangle"}}],"connectors":[]}\'',
      'seeflow flow:add-bulk abc12345 --file batch.json',
    ],
  },
  {
    name: 'flows:play',
    synopsis: 'seeflow flows:play <flowId> <nodeId>',
    description: 'Trigger a play action on one node. Requires a running studio.',
    category: 'live',
    args: [
      { name: 'flowId', required: true, description: 'Flow id or slug' },
      { name: 'nodeId', required: true, description: 'Node id in the flow' },
    ],
    flags: [{ name: 'no-start', description: 'Fail if the studio is not already running' }],
    outputKind: 'stream',
    outputs: {},
    requiresStudio: true,
    examples: ['seeflow flows:play abc12345 api-checkout'],
  },
  // ---- project -----------------------------------------------------------
  {
    name: 'projects:create',
    synopsis: 'seeflow projects:create --path <dir> --name <name> [--description <text>]',
    description:
      'Scaffold a new project at <path> with an empty flow.json and register it. ' +
      'Errors if <path>/flow.json already exists — use flows:register for ' +
      'an existing project.',
    category: 'project',
    args: [],
    flags: [
      {
        name: 'path',
        valuePlaceholder: '<dir>',
        description: 'Project folder (created if it does not exist)',
        required: true,
      },
      { name: 'name', valuePlaceholder: '<name>', description: 'Project name', required: true },
      {
        name: 'description',
        valuePlaceholder: '<text>',
        description: 'Optional human description, written into flow.json',
      },
    ],
    body: { schemaRef: 'CreateProjectBody' },
    outputs: {
      okExample: { id: 'abc12345', slug: 'checkout' },
      errorKinds: ['alreadyExists', 'scaffoldFailed'],
    },
    requiresStudio: false,
    examples: [
      'seeflow projects:create --path ./checkout --name "Checkout" --description "Cart + payments flow"',
    ],
  },
  // ---- nodes -------------------------------------------------------------
  {
    name: 'nodes:add',
    synopsis: 'seeflow nodes:add <flowId> [--json | --file | --stdin]',
    description: 'Add a single node to a flow. Body is the node object (auto-id if omitted).',
    category: 'nodes',
    args: [{ name: 'flowId', required: true, description: 'Flow id or slug' }],
    flags: BODY_FLAGS,
    body: {
      example: {
        type: 'stateNode',
        data: { name: 'hello', kind: 'state', stateSource: { kind: 'request' } },
      },
    },
    outputs: {
      okExample: { id: 'node-abc' },
      errorKinds: [
        'flowNotFound',
        'fileNotFound',
        'badJson',
        'badSchema',
        'idAlreadyExists',
        'writeFailed',
      ],
    },
    requiresStudio: false,
    examples: [
      'seeflow nodes:add abc12345 --json \'{"type":"shapeNode","data":{"shape":"rectangle"}}\'',
    ],
  },
  {
    name: 'nodes:get',
    synopsis: 'seeflow nodes:get <flowId> <nodeId>',
    description:
      'Get one node with its file-backed content (detail.md, view.html) inlined. ' +
      'Use after flows:graph to drill in.',
    category: 'nodes',
    args: [
      { name: 'flowId', required: true, description: 'Flow id or slug' },
      { name: 'nodeId', required: true, description: 'Node id in the flow' },
    ],
    flags: [],
    outputs: { errorKinds: ['notFound', 'fileNotFound', 'unknownNode', 'badJson', 'badSchema'] },
    requiresStudio: false,
    examples: ['seeflow nodes:get abc12345 api-checkout'],
  },
  {
    name: 'nodes:patch',
    synopsis: 'seeflow nodes:patch <flowId> <nodeId> [--json | --file | --stdin]',
    description: 'Patch fields on an existing node. Validates the partial against NodePatchBody.',
    category: 'nodes',
    args: [
      { name: 'flowId', required: true, description: 'Flow id or slug' },
      { name: 'nodeId', required: true, description: 'Node id in the flow' },
    ],
    flags: BODY_FLAGS,
    body: { schemaRef: 'NodePatchBody' },
    outputs: {
      errorKinds: ['flowNotFound', 'fileNotFound', 'unknownNode', 'badSchema', 'writeFailed'],
    },
    requiresStudio: false,
    examples: ['seeflow nodes:patch abc12345 api-checkout --json \'{"data":{"name":"renamed"}}\''],
  },
  {
    name: 'nodes:move',
    synopsis: 'seeflow nodes:move <flowId> <nodeId> --x <n> --y <n>',
    description: 'Set the node position in style.json (does not touch flow.json).',
    category: 'nodes',
    args: [
      { name: 'flowId', required: true, description: 'Flow id or slug' },
      { name: 'nodeId', required: true, description: 'Node id in the flow' },
    ],
    flags: [
      { name: 'x', valuePlaceholder: '<n>', description: 'X coordinate', required: true },
      { name: 'y', valuePlaceholder: '<n>', description: 'Y coordinate', required: true },
    ],
    body: { schemaRef: 'PositionBody' },
    outputs: { errorKinds: ['flowNotFound', 'fileNotFound', 'unknownNode', 'writeFailed'] },
    requiresStudio: false,
    examples: ['seeflow nodes:move abc12345 api-checkout --x 250 --y 320'],
  },
  {
    name: 'nodes:reorder',
    synopsis:
      'seeflow nodes:reorder <flowId> <nodeId> --op forward|backward|toFront|toBack|toIndex [--index <n>]',
    description: "Reorder a node's z-position within the flow.",
    category: 'nodes',
    args: [
      { name: 'flowId', required: true, description: 'Flow id or slug' },
      { name: 'nodeId', required: true, description: 'Node id in the flow' },
    ],
    flags: [
      {
        name: 'op',
        valuePlaceholder: '<op>',
        description: 'forward | backward | toFront | toBack | toIndex',
        required: true,
      },
      { name: 'index', valuePlaceholder: '<n>', description: 'Required when --op toIndex' },
    ],
    body: { schemaRef: 'ReorderBody' },
    outputs: { errorKinds: ['flowNotFound', 'fileNotFound', 'unknownNode', 'writeFailed'] },
    requiresStudio: false,
    examples: [
      'seeflow nodes:reorder abc12345 api-checkout --op forward',
      'seeflow nodes:reorder abc12345 api-checkout --op toIndex --index 0',
    ],
  },
  {
    name: 'nodes:delete',
    synopsis: 'seeflow nodes:delete <flowId> <nodeId>',
    description: 'Delete a node and any connectors that reference it.',
    category: 'nodes',
    args: [
      { name: 'flowId', required: true, description: 'Flow id or slug' },
      { name: 'nodeId', required: true, description: 'Node id in the flow' },
    ],
    flags: [],
    outputs: {
      okExample: { ok: true, removedConnectors: 0 },
      errorKinds: ['flowNotFound', 'unknownNode'],
    },
    requiresStudio: false,
    examples: ['seeflow nodes:delete abc12345 api-checkout'],
  },
  // ---- connectors --------------------------------------------------------
  {
    name: 'connectors:add',
    synopsis: 'seeflow connectors:add <flowId> [--json | --file | --stdin]',
    description: 'Add a connector. Body is the connector object (source/target required).',
    category: 'connectors',
    args: [{ name: 'flowId', required: true, description: 'Flow id or slug' }],
    flags: BODY_FLAGS,
    body: {
      example: { source: { nodeId: 'a' }, target: { nodeId: 'b' } },
    },
    outputs: {
      okExample: { id: 'conn-abc' },
      errorKinds: ['flowNotFound', 'badSchema', 'idAlreadyExists', 'writeFailed'],
    },
    requiresStudio: false,
    examples: [
      'seeflow connectors:add abc12345 --json \'{"source":{"nodeId":"a"},"target":{"nodeId":"b"}}\'',
    ],
  },
  {
    name: 'connectors:patch',
    synopsis: 'seeflow connectors:patch <flowId> <connectorId> [--json | --file | --stdin]',
    description: 'Patch fields on an existing connector.',
    category: 'connectors',
    args: [
      { name: 'flowId', required: true, description: 'Flow id or slug' },
      { name: 'connectorId', required: true, description: 'Connector id in the flow' },
    ],
    flags: BODY_FLAGS,
    body: { schemaRef: 'ConnectorPatchBody' },
    outputs: { errorKinds: ['flowNotFound', 'unknownConnector', 'badSchema', 'writeFailed'] },
    requiresStudio: false,
    examples: ['seeflow connectors:patch abc12345 conn-1 --json \'{"label":"new"}\''],
  },
  {
    name: 'connectors:delete',
    synopsis: 'seeflow connectors:delete <flowId> <connectorId>',
    description: 'Delete a connector.',
    category: 'connectors',
    args: [
      { name: 'flowId', required: true, description: 'Flow id or slug' },
      { name: 'connectorId', required: true, description: 'Connector id in the flow' },
    ],
    flags: [],
    outputs: { okExample: { ok: true }, errorKinds: ['flowNotFound', 'unknownConnector'] },
    requiresStudio: false,
    examples: ['seeflow connectors:delete abc12345 conn-1'],
  },
  // ---- validate ----------------------------------------------------------
  {
    name: 'validate',
    synopsis: 'seeflow validate --file <flow.json> [--style <style.json>]',
    description:
      'Schema-validate a flow.json (and optional style.json) without registering. ' +
      'Pure compute — no registry side-effects, no file:// resolution.',
    category: 'meta',
    args: [],
    flags: [
      {
        name: 'file',
        valuePlaceholder: '<flow.json>',
        description: 'Flow file to validate',
        required: true,
      },
      { name: 'style', valuePlaceholder: '<style.json>', description: 'Optional style file' },
    ],
    outputs: { okExample: { ok: true } },
    requiresStudio: false,
    examples: ['seeflow validate --file flow.json'],
  },
  {
    name: 'ids',
    synopsis: 'seeflow ids <type> <count>',
    description:
      'Generate <count> canonical short ids of the given <type>, one per line ' +
      'on stdout. <type> must be `node` (emits `node-<10 base62 chars>`) or ' +
      '`connector` (emits `conn-<10 base62 chars>`). <count> must be an ' +
      'integer in [1, 100]. Uses the same alphabet, length, and rejection-' +
      'sampling logic as the canvas / server / upload regex, so skill-minted ' +
      'ids match every other id producer in the studio. Pure compute — no ' +
      'studio required. Call once per type (i.e. one call for nodes, one for ' +
      'connectors) when seeding a flow.json.',
    category: 'meta',
    args: [
      {
        name: 'type',
        required: true,
        description: "Id kind to generate: 'node' (→ `node-…`) or 'connector' (→ `conn-…`)",
      },
      {
        name: 'count',
        required: true,
        description: 'How many ids to print (integer, 1..100)',
      },
    ],
    flags: [],
    outputKind: 'text',
    outputs: {},
    requiresStudio: false,
    examples: ['seeflow ids node 10', 'seeflow ids connector 5'],
  },
  {
    name: 'schema',
    synopsis: 'seeflow schema [<category>]',
    description:
      'Introspect the SeeFlow flow.json / style.json schemas at runtime. Call ' +
      'without arguments to list the five categories (flow, node, connector, ' +
      'action, style); call with a category name to get its full JSON Schema(s) ' +
      '(Draft-07) plus a `notes` array of cross-field invariants the schema ' +
      "can't express. Use this before authoring any flow.json write — never " +
      'memorise field shapes.',
    category: 'meta',
    args: [
      {
        name: 'category',
        required: false,
        description: 'One of: flow, node, connector, action, style',
      },
    ],
    flags: [],
    outputs: {
      okExample: { categories: [{ name: 'flow', description: 'Top-level flow.json envelope.' }] },
      errorKinds: ['notFound'],
    },
    requiresStudio: false,
    examples: ['seeflow schema', 'seeflow schema node', 'seeflow schema connector'],
  },
  // ---- live --------------------------------------------------------------
  {
    name: 'e2e',
    synopsis: 'seeflow e2e <flowId> [--skip-nodes a,b]',
    description: 'End-to-end validate a registered flow. Requires a running studio.',
    category: 'live',
    args: [{ name: 'flowId', required: true, description: 'Flow id or slug' }],
    flags: [
      {
        name: 'skip-nodes',
        valuePlaceholder: '<a,b>',
        description: 'Comma-separated node ids to skip',
      },
      { name: 'no-start', description: 'Fail if the studio is not already running' },
    ],
    outputKind: 'stream',
    outputs: {},
    requiresStudio: true,
    examples: ['seeflow e2e abc12345'],
  },
];

function resolveSchemaRef(ref: string): unknown {
  switch (ref) {
    case 'NodePatchBody':
      return zodToJsonSchema(NodePatchBodySchema, { $refStrategy: 'none' });
    case 'ConnectorPatchBody':
      return zodToJsonSchema(ConnectorPatchBodySchema, { $refStrategy: 'none' });
    case 'FlowBulkBody':
      return zodToJsonSchema(FlowBulkBodySchema, { $refStrategy: 'none' });
    case 'CreateProjectBody':
      return zodToJsonSchema(CreateProjectBodySchema, { $refStrategy: 'none' });
    case 'RegisterBody':
      return zodToJsonSchema(RegisterBodySchema, { $refStrategy: 'none' });
    case 'PositionBody':
      return zodToJsonSchema(PositionBodySchema, { $refStrategy: 'none' });
    case 'ReorderBody':
      return zodToJsonSchema(ReorderBodySchema, { $refStrategy: 'none' });
    default:
      return undefined;
  }
}

export function renderCommandHelp(name: string): string {
  const entry = COMMAND_MANIFEST.find((e) => e.name === name);
  if (!entry) throw new Error(`Unknown command: ${name}`);

  const lines: string[] = [];
  lines.push(`# ${entry.name}`, '');
  lines.push(entry.description, '');

  lines.push('## Synopsis', `  ${entry.synopsis}`, '');

  if (entry.args.length > 0) {
    lines.push('## Arguments');
    for (const a of entry.args) {
      const req = a.required ? '(required)' : '(optional)';
      lines.push(`  <${a.name}>  ${req} — ${a.description}`);
    }
    lines.push('');
  }

  if (entry.flags.length > 0) {
    lines.push('## Flags');
    for (const f of entry.flags) {
      const value = f.valuePlaceholder ? ` ${f.valuePlaceholder}` : '';
      const req = f.required ? '(required)' : '(optional)';
      lines.push(`  --${f.name}${value}  ${req} — ${f.description}`);
    }
    lines.push('');
  }

  if (entry.body) {
    lines.push('## Input (body)');
    if (entry.body.schemaRef) {
      const schema = resolveSchemaRef(entry.body.schemaRef);
      if (schema !== undefined) {
        lines.push('Schema (JSON Schema, resolved from Zod):', '');
        lines.push(indent(JSON.stringify(schema, null, 2), '    '));
        lines.push('');
      }
    }
    if (entry.body.example !== undefined) {
      lines.push('Example body:', '');
      lines.push(indent(JSON.stringify(entry.body.example, null, 2), '    '));
      lines.push('');
    }
  }

  lines.push('## Output');
  lines.push(...renderOutputSection(entry));
  lines.push('');

  if (entry.examples.length > 0) {
    lines.push('## Examples');
    for (const ex of entry.examples) lines.push(`  ${ex}`);
    lines.push('');
  }

  lines.push(`Requires studio running: ${entry.requiresStudio ? 'yes' : 'no'}`);
  return lines.join('\n');
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((l) => `${prefix}${l}`)
    .join('\n');
}

function renderOutputSection(entry: CommandManifestEntry): string[] {
  const kind = entry.outputKind ?? 'json';
  if (kind === 'text') return renderOutputText(entry);
  if (kind === 'stream') return renderOutputStream(entry);
  return renderOutputJson(entry);
}

function renderOutputJson(entry: CommandManifestEntry): string[] {
  const out: string[] = [];
  out.push('On success (stdout, exit 0):', '');
  if (entry.outputs.okExample !== undefined) {
    const merged = { ok: true, ...(entry.outputs.okExample as object) };
    out.push(indent(JSON.stringify(merged, null, 2), '    '));
  } else {
    out.push('    { "ok": true }');
  }
  out.push('');
  out.push('On error (stderr, non-zero exit):', '');
  out.push('    { "error": "<message>", "code": "<kind>" }', '');
  const kinds = entry.outputs.errorKinds ?? [];
  if (kinds.length > 0) {
    out.push('Error kinds for this command:');
    for (const group of groupKindsByExitCode(kinds)) {
      for (const k of group.kinds) {
        out.push(`  ${k}  → exit ${group.code}`);
      }
    }
  }
  return out;
}

function renderOutputText(entry: CommandManifestEntry): string[] {
  const out: string[] = [];
  out.push('Prints human-readable status to stdout (no JSON envelope).');
  out.push('Exit 0 on success, non-zero on failure.', '');
  if (entry.name === 'start') {
    out.push('Example stdout:');
    out.push('  SeeFlow Studio listening on http://localhost:4321');
    out.push('  SeeFlow Studio started in background on http://localhost:4321 (pid 12345)');
  } else if (entry.name === 'stop') {
    out.push('Example stdout:');
    out.push('  Stopped studio (pid 12345).');
    out.push('  No studio running (no pid file at ~/.seeflow/seeflow.pid).');
  }
  return out;
}
function renderOutputStream(entry: CommandManifestEntry): string[] {
  const out: string[] = [];
  out.push('Streams progress events to stdout until the run completes.');
  out.push('Exit 0 on success, non-zero on failure.');
  if (entry.name === 'flows:play') {
    out.push('');
    out.push("Triggers the node's play action and prints status updates as the studio drives it.");
  } else if (entry.name === 'e2e') {
    out.push('');
    out.push(
      'Walks every node in topological order, prints per-node status, exits non-zero on the first failure.',
    );
  }
  return out;
}

/**
 * Bucket a list of error kinds by their runtime exit code, preserving the
 * caller's order within each bucket. Shared between the global preamble
 * (which passes all known kinds) and the per-command output section (which
 * passes only the kinds that command can emit). Both render via the same
 * formatter so output style cannot drift.
 */
function groupKindsByExitCode(kinds: string[]): Array<{ code: number; kinds: string[] }> {
  const byCode = new Map<number, string[]>();
  for (const kind of kinds) {
    const code = exitCodeForKind(kind);
    const arr = byCode.get(code) ?? [];
    arr.push(kind);
    byCode.set(code, arr);
  }
  return [...byCode.entries()].sort(([a], [b]) => a - b).map(([code, k]) => ({ code, kinds: k }));
}

function renderExitCodeTable(): string {
  // Derive the ordered set of unique exit codes from the runtime map, skipping
  // 1 (the catch-all is rendered as a final literal line). This keeps the
  // preamble future-proof if a new exit code is added to EXIT_CODE_BY_KIND.
  const codes = [...new Set(Object.values(EXIT_CODE_BY_KIND))].sort((a, b) => a - b);
  const groups = groupKindsByExitCode(Object.keys(EXIT_CODE_BY_KIND));
  const byCode = new Map(groups.map((g) => [g.code, g.kinds]));
  const lines: string[] = ['Exit codes:'];
  for (const code of codes) {
    if (code === 1) continue;
    const kinds = byCode.get(code);
    if (!kinds) continue;
    lines.push(`  ${kinds.join(', ')} — exit ${code}`);
  }
  lines.push('  anything else — exit 1');
  return lines.join('\n');
}

export function renderCommandList(): string {
  // Stable category order for predictable output regardless of manifest order.
  const order: CommandCategory[] = [
    'lifecycle',
    'flows',
    'nodes',
    'connectors',
    'project',
    'live',
    'meta',
  ];
  const byCategory = new Map<CommandCategory, CommandManifestEntry[]>();
  for (const entry of COMMAND_MANIFEST) {
    const arr = byCategory.get(entry.category) ?? [];
    arr.push(entry);
    byCategory.set(entry.category, arr);
  }
  const lines: string[] = [];
  lines.push('seeflow — local studio for file-defined interactive demos');
  lines.push('');
  lines.push('Run `seeflow help <command>` for full detail on any command below.');
  lines.push('');
  lines.push('## Calling convention');
  lines.push(
    "  Body-bearing commands accept JSON via exactly one of: --json '<inline>' | --file <path> | --stdin",
  );
  lines.push('  On success: stdout = {"ok": true, ...payload}; exit 0.');
  lines.push('  On error: stderr = {"error": "<msg>", "code": "<kind>"}; non-zero exit.');
  lines.push('');
  lines.push(renderExitCodeTable());
  lines.push('');
  for (const category of order) {
    const entries = byCategory.get(category);
    if (!entries || entries.length === 0) continue;
    lines.push(`## ${category}`);
    for (const e of entries) {
      const liveMarker = e.requiresStudio ? ' (requires running studio)' : '';
      lines.push(`  ${e.name} — ${e.description.split('\n')[0]}${liveMarker}`);
      // Include the synopsis so flags (like `--foreground` on start) are
      // discoverable from the top-level listing without a drill-in.
      lines.push(`    ${e.synopsis}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
