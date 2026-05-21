// Machine-readable command catalogue. Powers `seeflow help`, `seeflow help
// <command>`, and `seeflow help --json` so AI agents and downstream tools
// can discover every subcommand without scraping the human help text.

import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ConnectorPatchBodySchema,
  ConnectorsBulkBodySchema,
  CreateProjectBodySchema,
  NodePatchBodySchema,
  NodesBulkBodySchema,
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
    synopsis: 'seeflow help [<command>] [--json]',
    description:
      'Show CLI help. With no args lists every command. With a command name shows ' +
      "that command's synopsis, flags, body schema, and examples. --json emits the " +
      'full manifest (or the named command) as a machine-readable JSON document.',
    category: 'meta',
    args: [{ name: 'command', required: false, description: 'Name of a command to drill into' }],
    flags: [{ name: 'json', description: 'Emit the manifest as JSON' }],
    outputs: {},
    requiresStudio: false,
    examples: ['seeflow help', 'seeflow help nodes:add', 'seeflow help --json'],
  },
  // ---- flows -------------------------------------------------------------
  {
    name: 'register',
    synopsis: 'seeflow register [--path <dir>] [--flow <file>]',
    description:
      'Register a demo repo with the studio. Reads <repoPath>/<flow> (defaulting ' +
      'to ./.seeflow/flow.json), validates the schema, and writes an entry to ' +
      '~/.seeflow/registry.json. Alias of flows:register.',
    category: 'flows',
    args: [],
    flags: [
      { name: 'path', valuePlaceholder: '<dir>', description: 'Path to repo root (default: cwd)' },
      {
        name: 'flow',
        valuePlaceholder: '<file>',
        description: 'Path to flow.json relative to repo root (default: .seeflow/flow.json)',
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
        description: 'Path to flow.json relative to repo root (default: .seeflow/flow.json)',
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
    name: 'flows:play',
    synopsis: 'seeflow flows:play <flowId> <nodeId>',
    description: 'Trigger a play action on one node. Requires a running studio.',
    category: 'live',
    args: [
      { name: 'flowId', required: true, description: 'Flow id or slug' },
      { name: 'nodeId', required: true, description: 'Node id in the flow' },
    ],
    flags: [{ name: 'no-start', description: 'Fail if the studio is not already running' }],
    outputs: {},
    requiresStudio: true,
    examples: ['seeflow flows:play abc12345 api-checkout'],
  },
  // ---- project -----------------------------------------------------------
  {
    name: 'projects:create',
    synopsis: 'seeflow projects:create --name <name>',
    description:
      'Scaffold a new project under ~/.seeflow/<slug>/ with an empty flow.json and ' +
      'register it. The flow id is returned for follow-up writes.',
    category: 'project',
    args: [],
    flags: [
      { name: 'name', valuePlaceholder: '<name>', description: 'Project name', required: true },
    ],
    body: { schemaRef: 'CreateProjectBody' },
    outputs: {
      okExample: { id: 'abc12345', slug: 'checkout', scaffolded: true },
      errorKinds: ['scaffoldFailed'],
    },
    requiresStudio: false,
    examples: ['seeflow projects:create --name "Checkout"'],
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
    name: 'nodes:add-bulk',
    synopsis: 'seeflow nodes:add-bulk <flowId> [--json | --file | --stdin]',
    description:
      'Add up to 100 nodes in one transactional write. Body shape: ' +
      '`{ nodes: Node[] }`. Any duplicate id rolls back the whole batch.',
    category: 'nodes',
    args: [{ name: 'flowId', required: true, description: 'Flow id or slug' }],
    flags: BODY_FLAGS,
    body: { schemaRef: 'NodesBulkBody' },
    outputs: {
      okExample: { ids: ['a', 'b'] },
      errorKinds: ['flowNotFound', 'fileNotFound', 'badSchema', 'duplicateIdInBatch'],
    },
    requiresStudio: false,
    examples: [
      'seeflow nodes:add-bulk abc12345 --json \'{"nodes":[{"id":"a","type":"shapeNode","data":{"shape":"rectangle"}}]}\'',
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
    name: 'connectors:add-bulk',
    synopsis: 'seeflow connectors:add-bulk <flowId> [--json | --file | --stdin]',
    description: 'Add up to 100 connectors transactionally. Body: `{ connectors: Connector[] }`.',
    category: 'connectors',
    args: [{ name: 'flowId', required: true, description: 'Flow id or slug' }],
    flags: BODY_FLAGS,
    body: { schemaRef: 'ConnectorsBulkBody' },
    outputs: { errorKinds: ['flowNotFound', 'badSchema', 'duplicateIdInBatch'] },
    requiresStudio: false,
    examples: ['seeflow connectors:add-bulk abc12345 --file connectors.json'],
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
    examples: ['seeflow validate --file .seeflow/flow.json'],
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
    case 'NodesBulkBody':
      return zodToJsonSchema(NodesBulkBodySchema, { $refStrategy: 'none' });
    case 'ConnectorsBulkBody':
      return zodToJsonSchema(ConnectorsBulkBodySchema, { $refStrategy: 'none' });
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

const MANIFEST_VERSION = '1';

export function renderManifestJson(): string {
  const commands = COMMAND_MANIFEST.map((entry) => ({
    ...entry,
    body: entry.body
      ? {
          ...entry.body,
          schema: entry.body.schemaRef ? resolveSchemaRef(entry.body.schemaRef) : undefined,
        }
      : undefined,
  }));
  return JSON.stringify({ version: MANIFEST_VERSION, commands }, null, 2);
}

export function renderCommandHelp(name: string): string {
  const entry = COMMAND_MANIFEST.find((e) => e.name === name);
  if (!entry) throw new Error(`Unknown command: ${name}`);
  const lines: string[] = [];
  lines.push(`# ${entry.name}`);
  lines.push('');
  lines.push(entry.description);
  lines.push('');
  lines.push('## Synopsis');
  lines.push(`  ${entry.synopsis}`);
  lines.push('');
  if (entry.args.length > 0) {
    lines.push('## Arguments');
    for (const a of entry.args) {
      lines.push(`  <${a.name}>${a.required ? '' : ' (optional)'} — ${a.description}`);
    }
    lines.push('');
  }
  if (entry.flags.length > 0) {
    lines.push('## Flags');
    for (const f of entry.flags) {
      const value = f.valuePlaceholder ? ` ${f.valuePlaceholder}` : '';
      lines.push(`  --${f.name}${value}${f.required ? '' : ' (optional)'} — ${f.description}`);
    }
    lines.push('');
  }
  if (entry.body) {
    lines.push('## Body');
    if (entry.body.schemaRef) lines.push(`  Schema: ${entry.body.schemaRef}`);
    if (entry.body.example !== undefined) {
      lines.push('  Example:');
      lines.push(`    ${JSON.stringify(entry.body.example)}`);
    }
    lines.push('');
  }
  lines.push('## Output');
  if (entry.outputs.okExample !== undefined) {
    lines.push('  On success:');
    lines.push(`    ${JSON.stringify(entry.outputs.okExample)}`);
  }
  if (entry.outputs.errorKinds?.length) {
    lines.push(`  Error kinds: ${entry.outputs.errorKinds.join(', ')}`);
  }
  lines.push('');
  if (entry.examples.length > 0) {
    lines.push('## Examples');
    for (const ex of entry.examples) {
      lines.push(`  ${ex}`);
    }
    lines.push('');
  }
  lines.push(`Requires studio running: ${entry.requiresStudio ? 'yes' : 'no'}`);
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
  for (const category of order) {
    const entries = byCategory.get(category);
    if (!entries || entries.length === 0) continue;
    lines.push(`## ${category}`);
    for (const e of entries) {
      const liveMarker = e.requiresStudio ? ' (requires running studio)' : '';
      lines.push(`  ${e.name} — ${e.description.split('\n')[0]}${liveMarker}`);
    }
    lines.push('');
  }
  lines.push('Run `seeflow help <command>` for details on one command,');
  lines.push('or `seeflow help --json` for the full machine-readable manifest.');
  return lines.join('\n');
}
