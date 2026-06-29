// Single source of truth for runtime schema introspection. The CLI
// (`seeflow schema`), the MCP tool (`seeflow_schema`), and the REST routes
// (`GET /api/schema[/:name]`) all delegate here so the agent-facing surface
// stays in lockstep with the on-disk Zod schemas in schema.ts. Built once at
// module load — each call returns a fresh shallow copy so callers can't
// mutate the cached payload.

import { componentCatalog } from '@seeflow/canvas/catalog';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ComponentActionSchema,
  ComponentSpecElementSchema,
  ComponentSpecSchema,
  FlowCloudNodeSchema,
  FlowComponentNodeAuthoringSchema,
  FlowConnectorSchema,
  FlowDatabaseNodeSchema,
  FlowDiamondNodeSchema,
  FlowDocumentNodeSchema,
  FlowEllipseNodeSchema,
  FlowEnvelopeSchema,
  FlowHexagonNodeSchema,
  FlowHtmlNodeSchema,
  FlowIconNodeSchema,
  FlowImageNodeSchema,
  FlowLinkflowNodeSchema,
  FlowParallelogramNodeSchema,
  FlowQueueNodeSchema,
  FlowRectangleNodeSchema,
  FlowServerNodeSchema,
  FlowStickyNodeSchema,
  FlowTextNodeSchema,
  FlowTriangleNodeSchema,
  FlowUserNodeSchema,
  StyleSchema,
} from './schema.ts';

export interface SchemaCategory {
  name: string;
  description: string;
  // Every drill target valid for `seeflow schema <name> <subname>`. Lets the
  // agent pick a variant without a second round-trip to listCategorySubnames.
  subnames: string[];
}

export interface SchemaPayload {
  schemas: Record<string, unknown>;
  notes: string[];
}

// Hint payload attached to every schema response so the agent can drill in
// further without round-tripping. `examples` are ready-to-paste jq paths;
// `dataFields` lists the node-variant `data.<field>` keys (single-variant
// lookups only — undefined for non-node categories or category-level
// responses). `rootPath` is the jq prefix that reaches the schema body at
// this response level (`.categories` on the index, `.schemas` on a category,
// `.schemas.<subname>` on a drill) — present in the plain (non-`--jq`)
// response the agent reads first, so it never has to guess the prefix.
export interface JqHints {
  dataFields?: string[];
  examples: string[];
  rootPath: string;
  tip?: string;
}

// Appended to every `jqHints.tip`. The `--jq` filter runs against the schema
// object itself; the `{ result }` wrapper the CLI prints under `--jq` is
// presentational, so a filter must never be prefixed with `.result`.
const JQ_RESULT_TIP =
  '`--jq` runs against this object directly; the `result` wrapper in `--jq` output is presentational — never prefix your filter with `.result`.';

const withResultTip = (hint: string): string => `${hint} ${JQ_RESULT_TIP}`;

// Draft-07 pin matches the widest tool support; the same target string is
// used by the MCP `tools/list` JSON Schemas (default in zod-to-json-schema)
// so consumers see one consistent dialect across the whole surface.
const toJsonSchema = (schema: ZodTypeAny): unknown =>
  zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' });

// Recipe block returned on the schema index (CLI / REST / MCP) so the agent
// sees the drill + filter pattern in the response itself, not just in
// `seeflow help schema`.
export const SCHEMA_INDEX_USAGE = {
  drill: 'seeflow schema <category> [<subname>]',
  filter: 'seeflow schema <category> [<subname>] --jq <jq-path>',
  examples: [
    'seeflow schema node',
    'seeflow schema node rectangle',
    'seeflow schema node rectangle --jq .schemas.rectangle.properties.data.properties.name',
    'seeflow schema action componentAction',
  ],
} as const;

// Description metadata. `subnames` are filled in by listSchemaCategories()
// at call time from PAYLOADS, so the two stay in lockstep automatically.
const CATEGORY_META: Array<Omit<SchemaCategory, 'subnames'>> = [
  { name: 'flow', description: 'Top-level flow.json envelope.' },
  {
    name: 'node',
    description:
      'All 19 flat node variants (rectangle, ellipse, sticky, text, database, server, user, queue, cloud, diamond, hexagon, triangle, parallelogram, document, image, html, icon, component, linkflow). Visual kind is the type. The linkflow variant carries an optional `target: { project, flow }` slug pair that turns the node into a clickable cross-flow link.',
  },
  {
    name: 'connector',
    description: 'Edge between two nodes (id/source/target + optional label/style/metadata).',
  },
  {
    name: 'action',
    description:
      'componentAction — the `set` mutation dispatched on component-node action handles.',
  },
  {
    name: 'componentSpec',
    description:
      "Sidecar shape written to <project>/nodes/<id>/spec.json for type:'component' nodes. Carries the json-render element tree, initial state, and named actions the renderer dispatches on user input.",
  },
  {
    name: 'componentCatalog',
    description:
      'The legal values for componentSpec.elements[].type and the props each accepts. Drill: seeflow schema componentCatalog <Name>.',
  },
  { name: 'style', description: 'style.json (studio-owned).' },
];

const PAYLOADS: Record<string, SchemaPayload> = {
  flow: {
    schemas: { flow: toJsonSchema(FlowEnvelopeSchema) },
    notes: ['connectors[].source and connectors[].target must reference an existing nodes[].id.'],
  },
  node: {
    schemas: {
      rectangle: toJsonSchema(FlowRectangleNodeSchema),
      ellipse: toJsonSchema(FlowEllipseNodeSchema),
      sticky: toJsonSchema(FlowStickyNodeSchema),
      text: toJsonSchema(FlowTextNodeSchema),
      database: toJsonSchema(FlowDatabaseNodeSchema),
      server: toJsonSchema(FlowServerNodeSchema),
      user: toJsonSchema(FlowUserNodeSchema),
      queue: toJsonSchema(FlowQueueNodeSchema),
      cloud: toJsonSchema(FlowCloudNodeSchema),
      diamond: toJsonSchema(FlowDiamondNodeSchema),
      hexagon: toJsonSchema(FlowHexagonNodeSchema),
      triangle: toJsonSchema(FlowTriangleNodeSchema),
      parallelogram: toJsonSchema(FlowParallelogramNodeSchema),
      document: toJsonSchema(FlowDocumentNodeSchema),
      image: toJsonSchema(FlowImageNodeSchema),
      html: toJsonSchema(FlowHtmlNodeSchema),
      icon: toJsonSchema(FlowIconNodeSchema),
      component: toJsonSchema(FlowComponentNodeAuthoringSchema),
      linkflow: toJsonSchema(FlowLinkflowNodeSchema),
    },
    notes: [
      "type:'image' data.path must start with 'nodes/<id>/'.",
      "type:'component': pass the `spec` object inline at data.spec on add_node / add_bulk / patch — it is REQUIRED (shape: `seeflow schema componentSpec`). The studio then externalizes it to <project>/nodes/<id>/spec.json, so flow.json on disk carries no data.spec; the resolver inlines the sidecar back into data.spec on read for runtime / SSE broadcasts.",
      'The legal `elements[].type` values and their props are listed under `seeflow schema componentCatalog`.',
    ],
  },
  connector: {
    schemas: {
      connector: toJsonSchema(FlowConnectorSchema),
    },
    notes: [],
  },
  action: {
    schemas: {
      componentAction: toJsonSchema(ComponentActionSchema),
    },
    notes: [
      "componentAction is a `set` mutation: it updates canvas state locally (path is a JSON Pointer starting with '/') and never round-trips to the server.",
    ],
  },
  componentSpec: {
    schemas: {
      componentSpec: toJsonSchema(ComponentSpecSchema),
      componentSpecElement: toJsonSchema(ComponentSpecElementSchema),
    },
    notes: [
      "spec.json is the on-disk source of truth for type:'component' nodes; the resolver inlines it into data.spec at read time and splitFlow strips it back out before writing flow.json so the sidecar is never double-stored.",
      'elements is keyed by element id; `root` names the entry element. Element ids referenced from children / actions must exist in elements.',
      'state and actions are both keyed by user-chosen names. Action handles in the rendered UI reference these names; see `seeflow schema action` for the per-action shape.',
      'The legal `elements[].type` values and their props are listed under `seeflow schema componentCatalog`.',
    ],
  },
  componentCatalog: {
    // One subname per catalog entry; schema body = the props object that
    // element type accepts. Built dynamically so adding a catalog component
    // surfaces here automatically (the canvas catalog is the single source).
    schemas: Object.fromEntries(
      Object.entries(componentCatalog.components).map(([name, def]) => [
        name,
        toJsonSchema(def.props),
      ]),
    ),
    notes: [
      "Each key is a legal componentSpec.elements[].type; its schema is the props object that element type accepts. Set them on the element's `props` field.",
      'Any prop value may instead be a { $state } / { $action } / { $cond,$then,$else } ref resolved by the json-render runtime at render time — the per-prop schema shows the concrete (non-ref) shape.',
    ],
  },
  style: {
    schemas: { style: toJsonSchema(StyleSchema) },
    notes: [],
  },
};

export function listSchemaCategories(): SchemaCategory[] {
  return CATEGORY_META.map((c) => ({
    ...c,
    subnames: Object.keys(PAYLOADS[c.name]?.schemas ?? {}),
  }));
}

export function getSchemaCategory(name: string): SchemaPayload | null {
  const payload = PAYLOADS[name];
  if (!payload) return null;
  return { schemas: { ...payload.schemas }, notes: [...payload.notes] };
}

export function schemaCategoryNames(): string[] {
  return CATEGORY_META.map((c) => c.name);
}

// Drill into one named schema inside a category — e.g. ('node', 'rectangle')
// returns just the rectangle variant. The category-level notes ride along
// unchanged because they describe cross-variant invariants the caller still
// needs (image path prefix, etc.). Returns null if either
// the category or the subname is unknown; callers use listCategorySubnames
// to build a helpful "available" list in that case.
export function getCategorySubschema(category: string, subname: string): SchemaPayload | null {
  const payload = PAYLOADS[category];
  if (!payload) return null;
  const schema = payload.schemas[subname];
  if (schema === undefined) return null;
  return { schemas: { [subname]: schema }, notes: [...payload.notes] };
}

// Returns the subname keys (rectangle, ellipse, …) for a known category, or
// null if the category itself is unknown. Used to surface "available" lists
// on lookup failures so the error message is self-correcting.
export function listCategorySubnames(category: string): string[] | null {
  const payload = PAYLOADS[category];
  if (!payload) return null;
  return Object.keys(payload.schemas);
}

// Top-level keys under `data.properties` for a single node variant — i.e.
// the per-shape data fields an author actually sets on a flow.json node
// (`name`, `icon`, etc.). Returns null when the variant has
// no `data.properties` wrapper (action / connector / style / componentSpec
// schemas, plus anything malformed). Pure helper consumed by buildJqHints
// to surface concrete drill-down paths.
export function getDataFieldNames(category: string, subname: string): string[] | null {
  const sub = PAYLOADS[category]?.schemas[subname] as
    | { properties?: { data?: { properties?: Record<string, unknown> } } }
    | undefined;
  const dataProps = sub?.properties?.data?.properties;
  if (!dataProps) return null;
  return Object.keys(dataProps);
}

// Build ready-to-paste jq path examples for a schema response. When `subname`
// is provided, the examples drill into that single variant — including one
// path per `data.<field>` so the agent can `--jq` straight to (say)
// `.schemas.rectangle.properties.data.properties.name` without first
// reading the whole envelope. When `subname` is omitted, the hints cover the
// whole category (iteration, one sample variant, notes). `dataFields` only
// surfaces on single-variant lookups for shapes that actually carry a
// `data.properties` wrapper.
export function buildJqHints(category: string, subname?: string): JqHints | null {
  const payload = PAYLOADS[category];
  if (!payload) return null;
  if (subname) {
    if (payload.schemas[subname] === undefined) return null;
    const dataFields = getDataFieldNames(category, subname);
    const examples = [
      `.schemas.${subname}`,
      `.schemas.${subname}.required`,
      ...(dataFields && dataFields.length > 0
        ? [
            `.schemas.${subname}.properties.data.properties`,
            ...dataFields
              .slice(0, 6)
              .map((f) => `.schemas.${subname}.properties.data.properties.${f}`),
          ]
        : [`.schemas.${subname}.properties`]),
      '.notes',
      '.notes[]',
    ];
    const hint = dataFields
      ? `dataFields lists every \`data.<field>\` available on this variant — point \`--jq\` at any of them with \`.schemas.${subname}.properties.data.properties.<field>\`.`
      : `Use \`--jq\` to pluck a single property — e.g. \`.schemas.${subname}.required\`.`;
    return {
      ...(dataFields ? { dataFields } : {}),
      examples,
      rootPath: `.schemas.${subname}`,
      tip: withResultTip(hint),
    };
  }
  const subs = Object.keys(payload.schemas);
  const sample = subs[0];
  if (!sample) {
    return {
      examples: ['.schemas', '.notes', '.notes[]'],
      rootPath: '.schemas',
      tip: JQ_RESULT_TIP,
    };
  }
  const examples = [
    '.schemas',
    `.schemas.${sample}`,
    `.schemas.${sample}.required`,
    `.schemas.${sample}.properties.data.properties`,
    '.schemas[]',
    '.notes',
    '.notes[]',
  ];
  return {
    examples,
    rootPath: '.schemas',
    tip: withResultTip(
      subs.length > 1
        ? `Pass \`seeflow schema ${category} <subname>\` (one of: ${subs.join(', ')}) to drop the other ${subs.length - 1} variant(s) from the payload before \`--jq\`-ing.`
        : `Single-variant category — \`--jq\` paths drill straight into \`.schemas.${sample}\`.`,
    ),
  };
}

// jqHints for the schema index (`seeflow schema` with no category). The index
// payload is `{ categories, usage }`, so `--jq` filters root at `.categories`.
// Surfaced so the index carries the same `rootPath` affordance as every drill
// level — the agent never has to guess the prefix.
export function buildIndexJqHints(): JqHints {
  return {
    examples: ['.categories', '.categories[].name', '.usage', '.usage.examples'],
    rootPath: '.categories',
    tip: withResultTip(
      'Each entry under `.categories` names a drill target — pass its `name` as `<category>`.',
    ),
  };
}
