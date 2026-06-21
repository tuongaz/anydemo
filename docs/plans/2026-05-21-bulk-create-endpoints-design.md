# Bulk-create endpoints — `POST /nodes/bulk` + `POST /connectors/bulk`

## Problem

The `/seeflow` skill makes one MCP call per node and one per connector when seeding a flow. A typical 8-node / 10-connector flow is 18 sequential round-trips, each one paying the full request/response token + latency cost. Each call also pays the full read-validate-write-broadcast cost server-side (one `flow.json` + `style.json` read, one `ResolvedFlowSchema` parse, one atomic write, one SSE notify), so the studio also spends 18× the work it needs to.

The driver is skill round-trip cost, not external programmatic use. The fix has to land on the MCP surface, not just REST — REST-only would not benefit the actual caller.

## Goal

Add two transactional bulk endpoints — `POST /api/flows/:id/nodes/bulk` and `POST /api/flows/:id/connectors/bulk` — that accept up to 100 items per call, run inside one `mutateMergedFlowAndBroadcast`, and either commit the whole batch or reject it. Add matching MCP tools (`seeflow_add_nodes`, `seeflow_add_connectors`). Singular endpoints and singular MCP tools stay, unchanged.

## Design

### Wire contract

**`POST /api/flows/:id/nodes/bulk`**

```jsonc
// Request
{
  "nodes": [
    { "type": "playNode", "data": { "name": "POST /checkout", "kind": "service", … } },
    { "id": "order-db", "type": "stateNode", "data": { … } }
  ]
}

// 200 OK
{
  "ok": true,
  "nodes": [
    { "id": "node-aB12cd34Xy", "node": { /* full node */ } },
    { "id": "order-db",         "node": { /* full node */ } }
  ]
}

// 400 — any item invalid → entire batch rejected
{
  "error": "Flow failed schema validation",
  "issues": [ /* Zod issues from the post-mutation parse */ ]
}
```

**`POST /api/flows/:id/connectors/bulk`** — identical shape with `connectors` instead of `nodes`. Response is `{ ok, connectors: [{ id }, …] }`.

### Per-item rules — identical to singular

- `id` optional → server fills with `node-<shortId>` / `c-<shortId>`.
- `position` optional for nodes → defaults to `{0,0}` so the post-mutation parse passes. Positions are owned by `style.json` and overwritten by the layout step.
- Per-node externalization runs per item: `detail` → `nodes/<id>/detail.md`, `html` → `nodes/<id>/view.html`. The existing `EXTERNALIZED_NODE_FIELDS` spec already covers this; no changes to that mechanism.

### Per-batch rules — new

- **Intra-batch ID dedupe.** Two items with the same `id` in one request → 400 `duplicateIdInBatch` before disk I/O.
- **Collision with existing.** Any item `id` already in `flow.nodes` (or `flow.connectors`) → 400 `idAlreadyExists`. Checked inside the mutator against the freshly-read flow snapshot, so the lock window is honoured.
- **Soft cap.** Max 100 items per request (`min(1).max(100)`). Larger → 400. Keeps one SSE broadcast payload reasonable.
- **All-or-nothing.** If the post-mutation `ResolvedFlowSchema.parse` rejects any item, the mutator returns the validation error, the lock releases, nothing is written, nothing is broadcast. Same semantics as the singular path failing — just amortised over N items.

### Storage shape

Storage doesn't change. `flow.json` still holds the canonical `nodes` and `connectors` arrays; per-node file externalization (detail.md, view.html) still happens inside `addNode`-equivalent logic. A bulk add just pushes N items onto the in-memory snapshot before the single validate/write/broadcast cycle runs.

## Implementation

### New ops in `apps/studio/src/operations.ts`

```ts
export async function addNodesBulkImpl(
  deps: OperationsDeps,
  flowId: string,
  body: { nodes: ReadonlyArray<Record<string, unknown>> },
): Promise<AddNodesBulkOutcome>;

export async function addConnectorsBulkImpl(
  deps: OperationsDeps,
  flowId: string,
  body: { connectors: ReadonlyArray<Record<string, unknown>> },
): Promise<AddConnectorsBulkOutcome>;
```

The mutator passed to `mutateMergedFlowAndBroadcast` runs the singular per-item logic in a loop:

```ts
(flow) => {
  // 1. intra-batch dedupe pre-check (cheap, before any allocation)
  // 2. collide-with-existing pre-check against flow.nodes
  const externalized: Array<{ absPath: string; content: string }> = [];
  const created: Array<{ id: string; node: Record<string, unknown> }> = [];

  for (const item of body.nodes) {
    // 3. fill defaults (id, position)
    // 4. capture detail/html → file:// ref, queue file writes
    // 5. flow.nodes.push(...)
    created.push({ id, node });
  }

  // 6. flush file writes — first failure rolls the whole batch back
  for (const ext of externalized) {
    try { writeNodeFile(ext.absPath, ext.content); }
    catch (err) { return { kind: 'writeFailed', message: … }; }
  }

  return { kind: 'ok', created };
}
```

Validation happens once via the existing `mutateMergedFlow` ResolvedFlowSchema parse — so any malformed item rolls back the whole batch automatically. There is no per-item early validation: per-item Zod parsing would duplicate the schema's discriminated-union work and miss cross-item invariants the schema-level superRefine already covers.

`addConnectorsBulkImpl` is structurally identical but skips the externalization step — connectors don't own per-node folders.

### Body schemas in `apps/studio/src/schema.ts`

```ts
export const NodesBulkBodySchema = z.object({
  nodes: z.array(z.record(z.unknown())).min(1).max(100),
});
export const ConnectorsBulkBodySchema = z.object({
  connectors: z.array(z.record(z.unknown())).min(1).max(100),
});
```

These only gate the envelope shape and cap. Per-item shape stays implicit and is enforced by the post-mutation `ResolvedFlowSchema.parse` — same pattern the singular endpoints already rely on.

### New routes in `apps/studio/src/api.ts`

Two new routes, immediately after their singular siblings:

- `POST /api/flows/:id/nodes/bulk` — envelope parse → `addNodesBulkImpl` → 200/400/404/500.
- `POST /api/flows/:id/connectors/bulk` — envelope parse → `addConnectorsBulkImpl` → 200/400/404/500.

Same outcome-kind switch as the singular routes; just two more cases (`duplicateIdInBatch`, `idAlreadyExists`) that both map to 400.

### New MCP tools in `apps/studio/src/mcp.ts`

- `seeflow_add_nodes` — wraps the bulk REST endpoint. Input: `{ projectId, nodes: [...] }`. Output mirrors the REST response.
- `seeflow_add_connectors` — same for connectors.

Singular `seeflow_add_node` / `seeflow_add_connector` stay unchanged. The skill picks the plural tools for flow seeding; the singular tools remain for one-off edits.

The tool descriptions explicitly call out the all-or-nothing semantic and the 100-item cap, so the LLM doesn't try to chunk poorly or rely on partial success.

## Testing

Mirror the existing singular-endpoint test coverage across the bulk pair:

- **`operations.test.ts`** — happy path (5 nodes seeded in one call, all on disk, externalization files written); single-bad-item rollback (4 good + 1 invalid → 0 written, no `nodes/<id>/` folders created); intra-batch ID dedupe; ID collision with existing flow; cap enforcement.
- **`api.test.ts`** — full HTTP round-trip for both endpoints; SSE broadcast fires once per successful batch.
- **`mcp.test.ts`** — both new MCP tools accept the bulk envelope and forward the same response shape.

## Out of scope

- **Bulk delete / patch.** Singular delete already cascades correctly; patch isn't where the skill spends round-trips. Revisit if a new use case appears.
- **Combined `{nodes, connectors}` endpoint.** Considered and rejected — couples node and connector validation paths and breaks the symmetry with the existing singular endpoints. Two calls (nodes first, then connectors) is fine for the skill.
- **Partial-success mode.** Considered and rejected — a half-applied batch is worse than nothing for the skill's retry loop, and per-item validation would duplicate ResolvedFlowSchema's work.
- **External / programmatic callers.** Not the driver. The contract above happens to be usable by external clients but no extra design work is being done on their behalf.
