// Single source of truth for runtime schema introspection. The CLI
// (`seeflow schema`), the MCP tool (`seeflow_schema`), and the REST routes
// (`GET /api/schema[/:name]`) all delegate here so the agent-facing surface
// stays in lockstep with the on-disk Zod schemas in schema.ts. Built once at
// module load — each call returns a fresh shallow copy so callers can't
// mutate the cached payload.

import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ComponentActionSchema,
  ComponentSpecElementSchema,
  ComponentSpecSchema,
  FlowCloudNodeSchema,
  FlowComponentNodeSchema,
  FlowConnectorSchema,
  FlowDatabaseNodeSchema,
  FlowEllipseNodeSchema,
  FlowEnvelopeSchema,
  FlowHtmlNodeSchema,
  FlowIconNodeSchema,
  FlowImageNodeSchema,
  FlowQueueNodeSchema,
  FlowRectangleNodeSchema,
  FlowServerNodeSchema,
  FlowStickyNodeSchema,
  FlowTextNodeSchema,
  FlowUserNodeSchema,
  PlayActionSchema,
  StatusActionSchema,
  StatusReportSchema,
  StyleSchema,
} from './schema.ts';

export interface SchemaCategory {
  name: string;
  description: string;
}

export interface SchemaPayload {
  schemas: Record<string, unknown>;
  notes: string[];
}

// Draft-07 pin matches the widest tool support; the same target string is
// used by the MCP `tools/list` JSON Schemas (default in zod-to-json-schema)
// so consumers see one consistent dialect across the whole surface.
const toJsonSchema = (schema: ZodTypeAny): unknown =>
  zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' });

const CATEGORIES: SchemaCategory[] = [
  { name: 'flow', description: 'Top-level flow.json envelope.' },
  {
    name: 'node',
    description:
      'All 13 flat node variants (rectangle, ellipse, sticky, text, database, server, user, queue, cloud, image, html, icon, component). Visual kind is the type; capabilities (playAction / statusAction / stateSource) are independent optional fields on every variant.',
  },
  {
    name: 'connector',
    description: 'Edge between two nodes (id/source/target + optional label/style/metadata).',
  },
  {
    name: 'action',
    description:
      'playAction, statusAction, statusReport, plus componentAction (the set | script discriminated union dispatched on component-node action handles).',
  },
  {
    name: 'componentSpec',
    description:
      "Sidecar shape written to <project>/nodes/<id>/spec.json for type:'component' nodes. Carries the json-render element tree, initial state, and named actions the renderer dispatches on user input.",
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
      image: toJsonSchema(FlowImageNodeSchema),
      html: toJsonSchema(FlowHtmlNodeSchema),
      icon: toJsonSchema(FlowIconNodeSchema),
      component: toJsonSchema(FlowComponentNodeSchema),
    },
    notes: [
      "type:'image' data.path must start with 'nodes/<id>/'.",
      "scriptPath in playAction/statusAction is relative to nodes/<nodeId>/ and may not contain '..' or absolute paths.",
      "type:'component' nodes have no `spec` field on disk — the spec lives in <project>/nodes/<id>/spec.json (see `seeflow schema componentSpec`). The resolver inlines it into data.spec for runtime / SSE broadcasts.",
      "stateSource SHOULD be set on every node that has a statusAction — kind:'request' for poll-based (REST, healthcheck, DB query), kind:'event' for push-based (SSE, webhook, queue, message bus).",
      'stateSource may also be set without a statusAction on representational/architecture diagrams to signal data-flow intent (poll vs push) without wiring a runtime probe.',
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
      playAction: toJsonSchema(PlayActionSchema),
      statusAction: toJsonSchema(StatusActionSchema),
      statusReport: toJsonSchema(StatusReportSchema),
      componentAction: toJsonSchema(ComponentActionSchema),
    },
    notes: [
      "scriptPath in playAction/statusAction is relative to nodes/<nodeId>/ and may not contain '..' or absolute paths.",
      "componentAction is a `set | script` discriminated union: `set` mutates canvas state locally (path is a JSON Pointer starting with '/'), `script` shells out via POST /api/flows/:id/nodes/:nodeId/actions/:name with the same scriptPath rooting rules as playAction.",
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
    ],
  },
  style: {
    schemas: { style: toJsonSchema(StyleSchema) },
    notes: [],
  },
};

export function listSchemaCategories(): SchemaCategory[] {
  return CATEGORIES.map((c) => ({ ...c }));
}

export function getSchemaCategory(name: string): SchemaPayload | null {
  const payload = PAYLOADS[name];
  if (!payload) return null;
  return { schemas: { ...payload.schemas }, notes: [...payload.notes] };
}

export function schemaCategoryNames(): string[] {
  return CATEGORIES.map((c) => c.name);
}

// Drill into one named schema inside a category — e.g. ('node', 'rectangle')
// returns just the rectangle variant. The category-level notes ride along
// unchanged because they describe cross-variant invariants the caller still
// needs (image path prefix, scriptPath rooting, etc.). Returns null if either
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
