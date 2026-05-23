// Single source of truth for runtime schema introspection. The CLI
// (`seeflow schema`), the MCP tool (`seeflow_schema`), and the REST routes
// (`GET /api/schema[/:name]`) all delegate here so the agent-facing surface
// stays in lockstep with the on-disk Zod schemas in schema.ts. Built once at
// module load — each call returns a fresh shallow copy so callers can't
// mutate the cached payload.

import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  FlowCloudNodeSchema,
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
  ResetActionSchema,
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
      'All 12 flat node variants (rectangle, ellipse, sticky, text, database, server, user, queue, cloud, image, html, icon). Visual kind is the type; capabilities (playAction / statusAction / stateSource) are independent optional fields on every variant.',
  },
  {
    name: 'connector',
    description: 'Edge between two nodes (id/source/target + optional label/style/metadata).',
  },
  {
    name: 'action',
    description: 'playAction, statusAction, resetAction, statusReport.',
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
    },
    notes: [
      "type:'image' data.path must start with 'nodes/<id>/'.",
      "scriptPath in playAction/statusAction is relative to nodes/<nodeId>/ and may not contain '..' or absolute paths.",
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
      resetAction: toJsonSchema(ResetActionSchema),
      statusReport: toJsonSchema(StatusReportSchema),
    },
    notes: [
      "scriptPath in playAction/statusAction is relative to nodes/<nodeId>/ and may not contain '..' or absolute paths.",
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
