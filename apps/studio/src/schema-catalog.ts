// Single source of truth for runtime schema introspection. The CLI
// (`seeflow schema`), the MCP tool (`seeflow_schema`), and the REST routes
// (`GET /api/schema[/:name]`) all delegate here so the agent-facing surface
// stays in lockstep with the on-disk Zod schemas in schema.ts. Built once at
// module load — each call returns a fresh shallow copy so callers can't
// mutate the cached payload.

import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  FlowDefaultConnectorSchema,
  FlowEnvelopeSchema,
  FlowEventConnectorSchema,
  FlowHtmlNodeSchema,
  FlowHttpConnectorSchema,
  FlowIconNodeSchema,
  FlowImageNodeSchema,
  FlowPlayNodeSchema,
  FlowQueueConnectorSchema,
  FlowShapeNodeSchema,
  FlowStateNodeSchema,
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
      'All six node variants (playNode, stateNode, shapeNode, imageNode, iconNode, htmlNode).',
  },
  {
    name: 'connector',
    description: 'All four connector kinds (http, event, queue, default).',
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
      playNode: toJsonSchema(FlowPlayNodeSchema),
      stateNode: toJsonSchema(FlowStateNodeSchema),
      shapeNode: toJsonSchema(FlowShapeNodeSchema),
      imageNode: toJsonSchema(FlowImageNodeSchema),
      iconNode: toJsonSchema(FlowIconNodeSchema),
      htmlNode: toJsonSchema(FlowHtmlNodeSchema),
    },
    notes: [
      "imageNode.data.path must start with 'nodes/<id>/'.",
      "scriptPath in playAction/statusAction is relative to nodes/<nodeId>/ and may not contain '..' or absolute paths.",
    ],
  },
  connector: {
    schemas: {
      http: toJsonSchema(FlowHttpConnectorSchema),
      event: toJsonSchema(FlowEventConnectorSchema),
      queue: toJsonSchema(FlowQueueConnectorSchema),
      default: toJsonSchema(FlowDefaultConnectorSchema),
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
