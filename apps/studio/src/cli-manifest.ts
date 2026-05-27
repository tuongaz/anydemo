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
      okExample: { id: 'abc12345', slug: 'checkout' },
      errorKinds: ['fileNotFound', 'badJson', 'badSchema'],
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
      okExample: { id: 'abc12345', slug: 'checkout' },
      errorKinds: ['fileNotFound', 'badJson', 'badSchema'],
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
    synopsis: 'seeflow flows:get --project <p> --flow <f>',
    description: 'Get the full merged flow definition and on-disk state for one flow.',
    category: 'flows',
    args: [],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
    ],
    outputs: { errorKinds: ['notFound', 'fileNotFound'] },
    requiresStudio: false,
    examples: ['seeflow flows:get --project order-pipeline --flow main'],
  },
  {
    name: 'flows:graph',
    synopsis: 'seeflow flows:graph --project <p> --flow <f>',
    description:
      'Get nodes + connectors for one flow without inlining per-node file-backed ' +
      'content (detail.md, view.html). Cheap topology read.',
    category: 'flows',
    args: [],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
    ],
    outputs: { errorKinds: ['notFound', 'fileNotFound', 'badJson', 'badSchema'] },
    requiresStudio: false,
    examples: ['seeflow flows:graph --project order-pipeline --flow main'],
  },
  {
    name: 'flows:delete',
    synopsis: 'seeflow flows:delete --project <p> --flow <f> [--new-default <other>]',
    description:
      'Delete a flow from a project. Removes the `flows/<flow>/` folder, updates ' +
      '`seeflow.json`, and drops the registry entry. Refuses to delete the last flow ' +
      'in a project or the project default without --new-default.',
    category: 'flows',
    args: [],
    flags: [
      {
        name: 'project',
        valuePlaceholder: '<p>',
        description: 'Project slug',
        required: true,
      },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
      {
        name: 'new-default',
        valuePlaceholder: '<other>',
        description: 'Required when deleting the project default — names the flow that takes over',
      },
    ],
    outputs: {
      okExample: { ok: true },
      errorKinds: ['notFound'],
    },
    requiresStudio: false,
    examples: [
      'seeflow flows:delete --project order-pipeline --flow retry',
      'seeflow flows:delete --project order-pipeline --flow main --new-default retry',
    ],
  },
  {
    name: 'flows:create',
    synopsis: 'seeflow flows:create --project <p> --flow <id> --name <n> [--icon <i>]',
    description:
      'Create a new flow within an existing project. Writes ' +
      '`<repoPath>/flows/<id>/flow.json` with an empty envelope and appends the ' +
      'new entry to the project manifest atomically.',
    category: 'flows',
    args: [],
    flags: [
      {
        name: 'project',
        valuePlaceholder: '<p>',
        description: 'Project slug',
        required: true,
      },
      {
        name: 'flow',
        valuePlaceholder: '<id>',
        description: 'New flow id (lowercase alphanumeric + dashes)',
        required: true,
      },
      {
        name: 'name',
        valuePlaceholder: '<n>',
        description: 'Human-readable flow name',
        required: true,
      },
      {
        name: 'icon',
        valuePlaceholder: '<i>',
        description: 'Optional icon name shown next to the flow in the switcher',
      },
    ],
    outputs: {
      okExample: { id: 'abc12345', slug: 'order-pipeline/retry', flowSlug: 'retry' },
      errorKinds: ['notFound'],
    },
    requiresStudio: false,
    examples: [
      'seeflow flows:create --project order-pipeline --flow retry --name "Retry"',
      'seeflow flows:create --project order-pipeline --flow retry --name "Retry" --icon refresh',
    ],
  },
  {
    name: 'flows:rename',
    synopsis:
      'seeflow flows:rename --project <p> --flow <id> [--new-id <x>] [--name <n>] [--icon <i>]',
    description:
      "Rename a flow's id, name, and/or icon. Changing --new-id moves the on-disk " +
      '`flows/<id>/` folder atomically and rewrites the manifest (including ' +
      '`defaultFlow` if it pointed at the renamed flow). Updating only --name / ' +
      '--icon edits the manifest in place without touching the filesystem layout.',
    category: 'flows',
    args: [],
    flags: [
      {
        name: 'project',
        valuePlaceholder: '<p>',
        description: 'Project slug',
        required: true,
      },
      {
        name: 'flow',
        valuePlaceholder: '<id>',
        description: 'Current flow id within the project',
        required: true,
      },
      { name: 'new-id', valuePlaceholder: '<x>', description: 'New flow id (renames the folder)' },
      { name: 'name', valuePlaceholder: '<n>', description: 'New human-readable name' },
      { name: 'icon', valuePlaceholder: '<i>', description: 'New icon name' },
    ],
    outputs: {
      okExample: { id: 'abc12345', slug: 'order-pipeline/retry-v2', flowSlug: 'retry-v2' },
      errorKinds: ['notFound'],
    },
    requiresStudio: false,
    examples: [
      'seeflow flows:rename --project order-pipeline --flow retry --new-id retry-v2',
      'seeflow flows:rename --project order-pipeline --flow main --name "Primary"',
    ],
  },
  {
    name: 'flows:layout',
    synopsis: 'seeflow flows:layout --project <p> --flow <f> [--json | --file | --stdin]',
    description:
      'Compute an ELK layout for the flow and write style.json next to flow.json. ' +
      'Body is optional — `{ options? }` shape. Empty body uses defaults.',
    category: 'flows',
    args: [],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
      ...BODY_FLAGS,
    ],
    body: { example: { options: { 'elk.direction': 'RIGHT' } } },
    outputs: {
      okExample: { ok: true },
      errorKinds: ['flowNotFound', 'fileNotFound', 'badJson', 'badSchema', 'writeFailed'],
    },
    requiresStudio: false,
    examples: ['seeflow flows:layout --project order-pipeline --flow main'],
  },
  {
    name: 'flow:add-bulk',
    synopsis: 'seeflow flow:add-bulk --project <p> --flow <f> [--json | --file | --stdin]',
    description:
      'Add up to 100 nodes + 100 connectors atomically. Body shape: ' +
      '`{ nodes?: Node[], connectors?: Connector[] }` (at least one non-empty). ' +
      'Connectors may reference nodes added in the same batch; the whole flow ' +
      'is re-validated post-merge so a dangling source/target — or any per-item ' +
      'schema failure — rolls back both arrays together and emits no broadcast.',
    category: 'flows',
    args: [],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
      ...BODY_FLAGS,
    ],
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
      'seeflow flow:add-bulk --project order-pipeline --flow main --json \'{"nodes":[{"id":"a","type":"rectangle","data":{}}],"connectors":[]}\'',
      'seeflow flow:add-bulk --project order-pipeline --flow main --file batch.json',
    ],
  },
  {
    name: 'flows:play',
    synopsis: 'seeflow flows:play --project <p> --flow <f> <nodeId> [--no-start]',
    description:
      "Trigger the node's playAction on the studio and wait for the spawn-level " +
      'result. The studio also broadcasts node:running/done/error events on the ' +
      "flow's SSE stream — subscribe separately if you want live progress. " +
      'Requires a running studio.',
    category: 'live',
    args: [{ name: 'nodeId', required: true, description: 'Node id in the flow' }],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
      { name: 'no-start', description: 'Fail if the studio is not already running' },
    ],
    outputs: {
      okExample: { runId: 'run-9b3', status: 200, body: { ok: true } },
    },
    requiresStudio: true,
    examples: ['seeflow flows:play --project order-pipeline --flow main api-checkout'],
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
    synopsis: 'seeflow nodes:add --project <p> --flow <f> [--json | --file | --stdin]',
    description: 'Add a single node to a flow. Body is the node object (auto-id if omitted).',
    category: 'nodes',
    args: [],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
      ...BODY_FLAGS,
    ],
    body: {
      example: {
        type: 'rectangle',
        data: { name: 'hello', stateSource: { kind: 'request' } },
      },
    },
    outputs: {
      okExample: { id: 'node-abc' },
      errorKinds: ['flowNotFound', 'fileNotFound', 'badJson', 'badSchema', 'writeFailed'],
    },
    requiresStudio: false,
    examples: [
      'seeflow nodes:add --project order-pipeline --flow main --json \'{"type":"rectangle","data":{}}\'',
    ],
  },
  {
    name: 'nodes:get',
    synopsis: 'seeflow nodes:get --project <p> --flow <f> <nodeId>',
    description:
      'Get one node with its file-backed content (detail.md, view.html) inlined. ' +
      'Use after flows:graph to drill in.',
    category: 'nodes',
    args: [{ name: 'nodeId', required: true, description: 'Node id in the flow' }],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
    ],
    outputs: { errorKinds: ['notFound', 'fileNotFound', 'unknownNode', 'badJson', 'badSchema'] },
    requiresStudio: false,
    examples: ['seeflow nodes:get --project order-pipeline --flow main api-checkout'],
  },
  {
    name: 'nodes:patch',
    synopsis: 'seeflow nodes:patch --project <p> --flow <f> <nodeId> [--json | --file | --stdin]',
    description: 'Patch fields on an existing node. Validates the partial against NodePatchBody.',
    category: 'nodes',
    args: [{ name: 'nodeId', required: true, description: 'Node id in the flow' }],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
      ...BODY_FLAGS,
    ],
    body: { schemaRef: 'NodePatchBody' },
    outputs: {
      errorKinds: [
        'flowNotFound',
        'fileNotFound',
        'unknownNode',
        'badJson',
        'badSchema',
        'writeFailed',
      ],
    },
    requiresStudio: false,
    examples: [
      'seeflow nodes:patch --project order-pipeline --flow main api-checkout --json \'{"data":{"name":"renamed"}}\'',
    ],
  },
  {
    name: 'nodes:move',
    synopsis: 'seeflow nodes:move --project <p> --flow <f> <nodeId> --x <n> --y <n>',
    description: 'Set the node position in style.json (does not touch flow.json).',
    category: 'nodes',
    args: [{ name: 'nodeId', required: true, description: 'Node id in the flow' }],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
      { name: 'x', valuePlaceholder: '<n>', description: 'X coordinate', required: true },
      { name: 'y', valuePlaceholder: '<n>', description: 'Y coordinate', required: true },
    ],
    body: { schemaRef: 'PositionBody' },
    outputs: {
      errorKinds: [
        'flowNotFound',
        'fileNotFound',
        'unknownNode',
        'badJson',
        'badSchema',
        'writeFailed',
      ],
    },
    requiresStudio: false,
    examples: [
      'seeflow nodes:move --project order-pipeline --flow main api-checkout --x 250 --y 320',
    ],
  },
  {
    name: 'nodes:reorder',
    synopsis:
      'seeflow nodes:reorder --project <p> --flow <f> <nodeId> --op forward|backward|toFront|toBack|toIndex [--index <n>]',
    description: "Reorder a node's z-position within the flow.",
    category: 'nodes',
    args: [{ name: 'nodeId', required: true, description: 'Node id in the flow' }],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
      {
        name: 'op',
        valuePlaceholder: '<op>',
        description: 'forward | backward | toFront | toBack | toIndex',
        required: true,
      },
      { name: 'index', valuePlaceholder: '<n>', description: 'Required when --op toIndex' },
    ],
    body: { schemaRef: 'ReorderBody' },
    outputs: {
      errorKinds: [
        'flowNotFound',
        'fileNotFound',
        'unknownNode',
        'badJson',
        'badSchema',
        'writeFailed',
      ],
    },
    requiresStudio: false,
    examples: [
      'seeflow nodes:reorder --project order-pipeline --flow main api-checkout --op forward',
      'seeflow nodes:reorder --project order-pipeline --flow main api-checkout --op toIndex --index 0',
    ],
  },
  {
    name: 'nodes:delete',
    synopsis: 'seeflow nodes:delete --project <p> --flow <f> <nodeId>',
    description: 'Delete a node and any connectors that reference it.',
    category: 'nodes',
    args: [{ name: 'nodeId', required: true, description: 'Node id in the flow' }],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
    ],
    outputs: {
      okExample: { ok: true, removedConnectors: 0 },
      errorKinds: [
        'flowNotFound',
        'fileNotFound',
        'unknownNode',
        'badJson',
        'badSchema',
        'writeFailed',
      ],
    },
    requiresStudio: false,
    examples: ['seeflow nodes:delete --project order-pipeline --flow main api-checkout'],
  },
  // ---- connectors --------------------------------------------------------
  {
    name: 'connectors:add',
    synopsis: 'seeflow connectors:add --project <p> --flow <f> [--json | --file | --stdin]',
    description:
      'Add a connector. Body is the connector object — `source` and `target` are ' +
      'the connected node ids (strings). Auto-generates an id when absent.',
    category: 'connectors',
    args: [],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
      ...BODY_FLAGS,
    ],
    body: {
      example: { source: 'a', target: 'b' },
    },
    outputs: {
      okExample: { id: 'conn-abc' },
      errorKinds: ['flowNotFound', 'fileNotFound', 'badJson', 'badSchema', 'writeFailed'],
    },
    requiresStudio: false,
    examples: [
      'seeflow connectors:add --project order-pipeline --flow main --json \'{"source":"a","target":"b"}\'',
    ],
  },
  {
    name: 'connectors:patch',
    synopsis:
      'seeflow connectors:patch --project <p> --flow <f> <connectorId> [--json | --file | --stdin]',
    description: 'Patch fields on an existing connector.',
    category: 'connectors',
    args: [{ name: 'connectorId', required: true, description: 'Connector id in the flow' }],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
      ...BODY_FLAGS,
    ],
    body: { schemaRef: 'ConnectorPatchBody' },
    outputs: {
      errorKinds: [
        'flowNotFound',
        'fileNotFound',
        'unknownConnector',
        'badJson',
        'badSchema',
        'writeFailed',
      ],
    },
    requiresStudio: false,
    examples: [
      'seeflow connectors:patch --project order-pipeline --flow main conn-1 --json \'{"label":"new"}\'',
    ],
  },
  {
    name: 'connectors:delete',
    synopsis: 'seeflow connectors:delete --project <p> --flow <f> <connectorId>',
    description: 'Delete a connector.',
    category: 'connectors',
    args: [{ name: 'connectorId', required: true, description: 'Connector id in the flow' }],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
    ],
    outputs: {
      okExample: { ok: true },
      errorKinds: [
        'flowNotFound',
        'fileNotFound',
        'unknownConnector',
        'badJson',
        'badSchema',
        'writeFailed',
      ],
    },
    requiresStudio: false,
    examples: ['seeflow connectors:delete --project order-pipeline --flow main conn-1'],
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
    synopsis: 'seeflow schema [<category> [<subname>]] [--jq <filter>]',
    description:
      'Introspect the SeeFlow flow.json / style.json / spec.json schemas at ' +
      'runtime. Call without arguments to list the six categories (flow, node, ' +
      'connector, action, componentSpec, style); call with a category name to ' +
      'get its full JSON Schema(s) (Draft-07) plus a `notes` array of cross-' +
      "field invariants the schema can't express. The `node` payload includes " +
      "all 13 flat variants (including type:'component', whose `spec` field " +
      'lives in a sidecar — drill into `componentSpec` for that shape).\n\n' +
      'Pass a third positional `subname` to get just one named schema within ' +
      'the category — e.g. `seeflow schema node component`, `seeflow schema ' +
      'node rectangle`, `seeflow schema action playAction`. The category-' +
      'level `notes` ride along unchanged because the cross-variant invariants ' +
      'still apply when looking at one variant. Use this before authoring any ' +
      'flow.json / spec.json write — never memorise field shapes.\n\n' +
      'Pass --jq <filter> to extract a slice of the response with a jq path ' +
      'expression. Supported subset: identity (`.`), field access ' +
      '(`.foo.bar`), bracket access (`.["foo"]`, `.[3]`, negative indices ' +
      'allowed), iteration (`.foo[]`), optional `?` (e.g. `.foo?` to suppress ' +
      'type errors), and pipe (`|`). Single-output filters return the value ' +
      'under `{ result: <value> }`; multi-output filters (from `[]` or `|`) ' +
      'return `{ result: [<v1>, <v2>, ...] }`. Bad filters exit with code 2 ' +
      'and `code:"badJq"`.',
    category: 'meta',
    args: [
      {
        name: 'category',
        required: false,
        description: 'One of: flow, node, connector, action, componentSpec, style',
      },
      {
        name: 'subname',
        required: false,
        description:
          'Optional named schema within the category — e.g. for `node`: ' +
          'rectangle, ellipse, sticky, text, database, server, user, queue, ' +
          'cloud, image, html, icon, component. For `action`: playAction, ' +
          'statusAction, resetAction, statusReport, componentAction. For ' +
          '`componentSpec`: componentSpec, componentSpecElement.',
      },
    ],
    flags: [
      {
        name: 'jq',
        valuePlaceholder: '<filter>',
        description:
          'Apply a jq path-subset filter to the response payload. Examples: ' +
          '`.schemas.rectangle`, `.schemas.image.properties.data.properties.path`, ' +
          '`.schemas[]`, `.notes[0]`.',
      },
    ],
    outputs: {
      okExample: { categories: [{ name: 'flow', description: 'Top-level flow.json envelope.' }] },
      errorKinds: ['notFound', 'badJq'],
    },
    requiresStudio: false,
    examples: [
      'seeflow schema',
      'seeflow schema node',
      'seeflow schema node component',
      'seeflow schema node rectangle',
      'seeflow schema action playAction',
      'seeflow schema connector',
      'seeflow schema componentSpec',
      'seeflow schema node --jq .schemas.rectangle',
      "seeflow schema node --jq '.schemas.image.properties.data.properties.path'",
      "seeflow schema node --jq '.schemas[]'",
    ],
  },
  // ---- live --------------------------------------------------------------
  {
    name: 'e2e',
    synopsis: 'seeflow e2e --project <p> --flow <f> [--skip-nodes a,b] [--no-start]',
    description:
      'End-to-end validate a registered flow. Walks every node with a playAction ' +
      "in flow.json order, POSTs each play, then drains the flow's SSE stream " +
      'for node:done/error + node:status reports. Returns a single JSON report ' +
      'when finished; exits non-zero if any play failed, any statusAction failed ' +
      'to report, or the 120s ceiling was exceeded. Requires a running studio.',
    category: 'live',
    args: [],
    flags: [
      { name: 'project', valuePlaceholder: '<p>', description: 'Project slug', required: true },
      {
        name: 'flow',
        valuePlaceholder: '<f>',
        description: 'Flow id within the project',
        required: true,
      },
      {
        name: 'skip-nodes',
        valuePlaceholder: '<a,b>',
        description: 'Comma-separated node ids to skip',
      },
      { name: 'no-start', description: 'Fail if the studio is not already running' },
    ],
    outputs: {
      okExample: {
        ok: true,
        plays: [{ nodeId: 'api-checkout', outcome: 'ok', runId: 'run-9b3' }],
        statuses: [],
        skipped: [],
      },
    },
    requiresStudio: true,
    examples: [
      'seeflow e2e --project order-pipeline --flow main',
      'seeflow e2e --project order-pipeline --flow main --skip-nodes flaky-1,flaky-2',
    ],
  },
  {
    name: 'emit',
    synopsis:
      'seeflow emit <flowId> <nodeId> <status> [--run-id <id>] [--payload <json>] [--studio-url <url>]',
    description:
      'Broadcast a node-status event to the studio (status: running | done | error). ' +
      'User apps shell out to this command instead of importing an in-repo helper; ' +
      "the studio re-broadcasts the event on the flow's SSE stream.",
    category: 'live',
    args: [
      { name: 'flowId', required: true, description: 'Flow id or slug' },
      { name: 'nodeId', required: true, description: 'Node id in the flow' },
      { name: 'status', required: true, description: 'Status: running | done | error' },
    ],
    flags: [
      {
        name: 'run-id',
        valuePlaceholder: '<id>',
        description: 'Correlate events emitted within a single run',
      },
      {
        name: 'payload',
        valuePlaceholder: '<json>',
        description: 'JSON string merged into the event payload',
      },
      {
        name: 'studio-url',
        valuePlaceholder: '<url>',
        description: 'Override studio base URL (skips auto-start; targets the URL as-is)',
      },
      { name: 'no-start', description: 'Fail if the studio is not already running' },
    ],
    outputs: {
      okExample: { ok: true },
      errorKinds: [],
    },
    requiresStudio: true,
    examples: [
      'seeflow emit abc12345 api-charge done',
      'seeflow emit abc12345 api-charge error --payload \'{"code":402}\'',
      'seeflow emit abc12345 api-charge running --run-id run-9b3 --studio-url http://localhost:4321',
    ],
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
