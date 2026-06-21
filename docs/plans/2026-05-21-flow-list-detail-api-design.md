# Flow list + detail API design

Status: design approved, ready for implementation plan.
Date: 2026-05-21.

## Motivation

Agents and human callers need three lighter-weight reads against the studio:

1. A flat list of registered flows with just enough to choose one (id, name, description).
2. A flow's node + connector graph **without** the cost of pulling every per-node `file://` payload (markdown detail, htmlNode `view.html`).
3. A single node fetched with its file-backed content resolved.

Today the only paths are `seeflow_list_flows` (returns id/slug/name/repoPath/lastModified/valid) and `seeflow_get_flow` (returns the entire `ResolvedFlow` with every `file://` ref already inlined). The latter forces an agent to read kilobytes of node bodies even when it only needs to know which nodes exist.

This work is **additive** — every existing endpoint, MCP tool, and CLI subcommand keeps its current shape. New surfaces sit alongside.

## Schema changes

`apps/studio/src/schema.ts`:

- Add `description: z.string().optional()` to `FlowSchema` next to `name`.
- Add the same field to `ResolvedFlowSchema` so resolved-flow callers see it too.
- Both flow files on disk (`flow.json`) and resolved-flow responses round-trip the new field. Absent stays absent — no `description: undefined` written.

Existing flows (`order-pipeline`, `ecommerce-platform`, user-authored) continue to parse without modification.

## Registry changes

`apps/studio/src/registry.ts`:

- `FlowEntry` gains `description?: string`.
- `RegisterInput` gains `description?: string`.
- `upsert()` persists it into `registry.json` alongside `name`.
- Loader tolerates entries without the field (back-compat for existing registries).

`apps/studio/src/operations.ts`:

- `registerFlowImpl` reads `merged.flow.description` and passes it to `registry.upsert()`.
- Watcher reload path is **not** modified — `listFlowsSummaryImpl` reads from the live watcher snapshot when available (so author edits to `description` in flow.json show up in the summary) and falls back to the registry value when no snapshot exists. This stays consistent with how `name` is sourced today (`name` does not auto-update from disk in `list_flows`) and avoids cross-cutting watcher mutation.

## New endpoints

### A. List flows (summary)

Minimal list for agent discovery — reads straight from `registry.list()`, no flow.json IO.

| Layer | Surface |
|---|---|
| REST | `GET /api/flows/summary` |
| MCP | `seeflow_list_flows_summary` |
| CLI | `flows:summary` |

Response:

```json
[
  { "id": "abc123", "name": "Order pipeline", "description": "Stripe → inventory → ship" },
  { "id": "def456", "name": "Checkout", "description": null }
]
```

Existing `GET /api/flows` / `seeflow_list_flows` / `flows:list` remain unchanged.

### B. Get flow graph (no file content)

Returns the on-disk `Flow` shape with `detail` and `html` stripped from every node's `data`. `description` stays.

| Layer | Surface |
|---|---|
| REST | `GET /api/flows/:id/graph` |
| MCP | `seeflow_get_flow_graph` |
| CLI | `flows:graph <id>` |

Implementation: `readMergedFlow(path)` (raw, BEFORE `resolveFileRefs`), then `stripFileBackedFields(node)` over every node. Connectors pass through unchanged.

Response:

```json
{
  "id": "abc123",
  "name": "Order pipeline",
  "description": "Stripe → inventory → ship",
  "nodes": [
    { "id": "n1", "type": "playNode", "data": { "name": "Charge card", "kind": "...", "playAction": { ... } } }
  ],
  "connectors": [
    { "id": "e1", "source": "n1", "target": "n2", "kind": "http", "method": "POST", "url": "/charge" }
  ]
}
```

### C. Get node (content resolved)

Single node with `file://` refs inlined.

| Layer | Surface |
|---|---|
| REST | `GET /api/flows/:id/nodes/:nodeId` |
| MCP | `seeflow_get_node` |
| CLI | `nodes:get <id> <nodeId>` |

Implementation: `readMergedFlow(path)` → `resolveFileRefs(...)` (same path `get_flow` already uses) → `.find(n => n.id === nodeId)`. 404 if the node isn't in the flow.

## Operations API

```typescript
// listFlowsSummaryImpl — uses registry.list(); no IO.
export type FlowSummary = { id: string; name: string; description?: string };
export type ListFlowsSummaryOutcome = { kind: 'ok'; data: FlowSummary[] };
export function listFlowsSummaryImpl(deps: OperationsDeps): ListFlowsSummaryOutcome;

// getFlowGraphImpl — reads raw Flow, strips file-backed fields.
export type FlowGraphResponse = {
  id: string; name: string; description?: string;
  nodes: FlowNode[];
  connectors: FlowConnector[];
};
export type GetFlowGraphOutcome =
  | { kind: 'ok'; data: FlowGraphResponse }
  | { kind: 'notFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; detail: string };
export async function getFlowGraphImpl(deps: OperationsDeps, flowId: string): Promise<GetFlowGraphOutcome>;

// getNodeImpl — resolves file refs, returns one node.
export type GetNodeOutcome =
  | { kind: 'ok'; data: { id: string; node: ResolvedFlowNode } }
  | { kind: 'notFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'unknownNode' };
export async function getNodeImpl(deps: OperationsDeps, flowId: string, nodeId: string): Promise<GetNodeOutcome>;
```

Shared helper:

```typescript
// Narrow allow-list keeps this from drifting out of sync with file-ref.ts.
// Only `detail` (every node) and `html` (htmlNode) are file-backed today.
function stripFileBackedFields(node: FlowNode): FlowNode;
```

## Wiring

- **REST** (`apps/studio/src/api.ts`): three new routes immediately after the existing `/flows` block. Each returns the outcome-tag → HTTP-status mapping already used elsewhere in the file.
- **MCP** (`apps/studio/src/mcp.ts`): three new entries in `buildTools()`. Each gets a short, agent-friendly description so list/graph/node usage is discoverable. Outcome-tag handling mirrors `seeflow_get_flow`.
- **CLI** (`apps/studio/src/cli.ts`): three new branches + help-text entries; thin wrappers over `fetch(studioUrl + path)`.

## Tests

- `schema.test.ts` — `description` round-trips on both schemas; absent stays absent.
- `registry.test.ts` — `description` persisted, reloaded, and updated by watcher reload path.
- `operations.test.ts` — outcomes for each new impl (ok, notFound, fileNotFound, unknownNode, badJson where relevant).
- `api.test.ts` — REST routes for summary / graph / node, including 404 paths.
- `mcp.test.ts` + `mcp-parity.test.ts` — three new MCP tools, parity-checked against REST.
- `cli.test.ts` — three new subcommands hit the right URLs and surface errors cleanly.
- `integration/{rest,mcp,cli}.it.ts` — end-to-end against the seeded `order-pipeline` example with and without a `description` set.

## Out of scope

- Trimming existing `seeflow_list_flows` / `seeflow_get_flow` responses (additive only).
- A PATCH endpoint for editing `description` outside flow.json (file is the source of truth).
- Pagination of flow lists (counts are small).
- Returning hints about whether a node has long-form content (`hasDetail` flag) — explicitly rejected in design; callers fetch `get_node` when they want detail.

## Doc updates

- README API table — add three new endpoints.
- Plugin skill prompts — surface new MCP tool names where they describe list/get semantics.
- CHANGELOG — one entry under the next version bump.
