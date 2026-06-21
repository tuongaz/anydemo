# Remove connector `kind` discriminator

**Date:** 2026-05-22
**Status:** Design — ready for implementation

## Problem

`Connector` is a discriminated union over `kind: 'http' | 'event' | 'queue' | 'default'`. Nothing reads `kind` at runtime: the renderer never branches on it, the SDK template never inspects it, and the per-variant payload fields (`method`, `url`, `eventName`, `queueName`) are stored on disk but never displayed. The discriminator adds schema noise, complicates `mergeConnectorUpdates` (kind-swap clearing logic), bloats the `seeflow schema connector` introspection output, and confuses authors who must pick a kind before drawing an edge.

Node `type` vs. node `data.kind` is a separate confusion and out of scope for this change.

## Scope

Drop the `kind` discriminator from connectors. Keep `method` / `url` / `eventName` / `queueName` as optional metadata on a single connector shape — non-destructive for any author who has been writing those fields. Hard cut, no migration, no version bump.

## Design

### Schema (`apps/studio/src/schema.ts`)

Replace both connector discriminated unions with single object shapes.

```ts
// Resolved (in-memory) shape
const ConnectorSchema = z.object({
  ...ConnectorBaseShape,                  // id/source/target/label/handles/pins/visual
  method: HttpMethodSchema.optional(),
  url: z.string().min(1).optional(),
  eventName: z.string().min(1).optional(),
  queueName: z.string().min(1).optional(),
});

// On-disk shape (strict)
export const FlowConnectorSchema = z
  .object({
    ...FlowConnectorBaseShape,
    method: HttpMethodSchema.optional(),
    url: z.string().min(1).optional(),
    eventName: z.string().min(1).optional(),
    queueName: z.string().min(1).optional(),
  })
  .strict();
```

Remove the four variant subschemas (`HttpConnectorSchema`, `EventConnectorSchema`, `QueueConnectorSchema`, `DefaultConnectorSchema`) and their flow-side mirrors. Remove the exported variant types (`HttpConnector`, `EventConnector`, `QueueConnector`, `DefaultConnector`). Collapse to one exported `Connector` and one `FlowConnector` type.

`ConnectorBaseShape`, `ConnectorVisualBaseShape`, handle/pin schemas, and the `superRefine` referential checks stay untouched — all orthogonal to the discriminator.

Unrelated `kind` usages stay (clarified by comments where needed):
- `StateSourceSchema` discriminates node `stateSource` on `kind: 'request' | 'event'`.
- `ScriptActionSchema` uses `kind: z.literal('script')`.

### Operations (`apps/studio/src/operations.ts`)

- Delete `ConnectorKindSchema = z.enum(['http', 'event', 'queue', 'default'])` (~line 522).
- Drop the `kind` field from `ConnectorPatchBodySchema` (~line 533). Keep `method`/`url`/`eventName`/`queueName` as optional.
- Delete `CONNECTOR_KIND_FIELDS` (~line 574) and the kind-swap clearing loop in `mergeConnectorUpdates` (~lines 580–584). Without a discriminator there's no phantom-payload risk.
- Delete the two `kind = 'default'` fallback writes in the bulk-add paths (~lines 1349–1350 and 1620–1621).

### Merge (`apps/studio/src/merge.ts`)

- Remove `'kind'` from `CONNECTOR_FLOW_KEYS` (line 79). `method`/`url`/`eventName`/`queueName` stay in the whitelist.

### Diagram (`apps/studio/src/diagram.ts`)

- Remove `String(raw.kind ?? '')` from the connector dedup key in `normalizeConnectors` (line 228). New key: `[source, target, sourceHandle, targetHandle].join('\t')`. Dedup semantics shift slightly: two connectors between the same pair with the same handles collapse regardless of payload. Matches the historical `kind: 'default'` collision behavior; parallel-edge cases already rendered as overlapping.

### Web (`apps/web/src/pages/demo-view.tsx`)

- Remove the three hardcoded `kind: 'default'` literals at edge-creation sites (lines 1825, 1835, 1905). New connectors omit the field.
- Update the comment at line 854 referring to "the discriminated union over `kind`".

### Examples

Strip `kind` from every connector in:
- `apps/studio/examples/order-pipeline/.seeflow/flow.json`
- `apps/studio/examples/ecommerce-platform/.seeflow/flow.json`

Keep `eventName` / other payload fields intact.

## Hard cut — no migration

Any flow.json on a user's disk containing `kind: '...'` on a connector fails `FlowSchema.safeParse` with a strict-mode "unrecognized key" error. Users delete the field manually. No migration helper, no deprecation warning, no `version: 3` bump — the schema shape was never consumer-facing in a way that justifies a grace period.

## Tests to update

Schema:
- `apps/studio/src/schema.test.ts` — drop discriminated-union cases (`event` requires `eventName`, etc.); add a case that asserts an arbitrary combination of `method`/`url`/`eventName`/`queueName` parses on a single shape.

Operations:
- `apps/studio/src/operations.test.ts` — drop kind-swap field-clearing cases and `kind = 'default'` fallback cases.

Merge / diagram:
- `apps/studio/src/merge.test.ts` — confirm `kind` no longer routes into flow.json.
- `apps/studio/src/diagram.test.ts` — confirm dedup still works without `kind` in the key.

Integration:
- `apps/studio/integration/cli.it.ts` (~line 408 uses `kind: 'event'`) and `rest.it.ts` — strip `kind` from constructed connectors.

Catalog / MCP:
- `apps/studio/src/mcp.test.ts`, `mcp-parity.test.ts`, `schema-catalog.test.ts` — `seeflow schema connector` output changes from a discriminated-union JSON Schema to a single object schema. Update snapshots/assertions.

## What we explicitly don't do

- No node `data.kind` removal (separate concern, free-form, still pass-through).
- No `StateSourceSchema` / `ScriptActionSchema` changes (unrelated `kind` usages).
- No `version: 3` bump.
- No migration tool, no deprecation log, no compat field.
- No new ADR — design doc + commit message carry the rationale.

## Verification

Pre-flight grep:
```
rg '"kind":\s*"(http|event|queue|default)"' apps/
```
…must return only the two example flow.json files before the change, and nothing in `apps/` after.

After implementation:
- `bun run typecheck` clean.
- `bun run lint` clean.
- `bun test` green (after test rewrites listed above).
- Loading either example demo through the studio renders identically to today.

## Risks

- External users with their own flow.json files break on next read. Acceptable per the hard-cut decision; surface in the CHANGELOG as a breaking schema change.
- `seeflow schema connector` consumers (LLMs authoring flows via MCP) lose the kind hint. They use `label` for semantic differentiation, which the existing demos already do (`label: "order.created"`).
