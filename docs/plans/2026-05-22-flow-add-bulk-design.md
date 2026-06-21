# flow:add-bulk — merged nodes+connectors bulk endpoint

**Date:** 2026-05-22
**Status:** Design approved, ready to implement
**Supersedes:** the split bulk surfaces introduced in
`2026-05-21-bulk-create-endpoints-design.md`.

## Problem

Across API, CLI, and MCP we expose two parallel bulk-add surfaces:

| Layer | Nodes                                    | Connectors                                       |
| ----- | ---------------------------------------- | ------------------------------------------------ |
| API   | `POST /flows/:id/nodes/bulk`             | `POST /flows/:id/connectors/bulk`                |
| CLI   | `seeflow nodes:add-bulk <id>`            | `seeflow connectors:add-bulk <id>`               |
| MCP   | `seeflow_add_nodes`                      | `seeflow_add_connectors`                         |
| Ops   | `addNodesBulkImpl` / `addNodesBulk`      | `addConnectorsBulkImpl` / `addConnectorsBulk`    |

The seeflow skill calls them sequentially in Phase 3 (initial seed) and
Phase 5 (trigger injection) — nodes first, then connectors. Two
writes, two SSE broadcasts, and a real correctness hole: if the
connector batch fails its post-mutation `ResolvedFlowSchema` parse
(e.g. a typo in `source`/`target`, a missing `eventName` on a
`kind:'event'` connector), the node batch has already committed. The
flow now contains nodes the skill is half-done wiring, and the skill
has no clean recovery beyond "delete the stranded nodes."

## Goal

One transactional bulk-add surface that takes nodes and connectors
together and either lands both or rolls back both, end-to-end.

## Decisions (all confirmed in brainstorm)

1. **Merge into a truly atomic surface** — `{ nodes?: [...],
   connectors?: [...] }` in one body, one transaction, one
   `ResolvedFlowSchema` parse. Connectors can reference nodes from the
   same call.
2. **Delete the old surfaces outright.** Pre-1.0 internal tool, no
   external consumers, no deprecation shims.
3. **Names:**
   - API: `POST /flows/:id/bulk`
   - CLI: `seeflow flow:add-bulk <id>`
   - MCP: `seeflow_add_bulk`
   - Ops: `addBulk` / `addFlowBulkImpl`
4. **Body shape:** both fields optional, at least one non-empty
   (refine-rejected with a clear message otherwise).
5. **Cap:** `BULK_MAX_ITEMS = 100` per kind. A 100-node skeleton with
   ~150 connectors stays expressible.

## Design

### Schema & outcome (`apps/studio/src/operations.ts`)

```ts
export const FlowBulkBodySchema = z
  .object({
    nodes: z.array(z.record(z.unknown())).max(BULK_MAX_ITEMS).optional(),
    connectors: z.array(z.record(z.unknown())).max(BULK_MAX_ITEMS).optional(),
  })
  .refine(
    (b) => (b.nodes?.length ?? 0) + (b.connectors?.length ?? 0) > 0,
    { message: 'Body must include at least one node or connector' },
  );
export type FlowBulkBody = z.infer<typeof FlowBulkBodySchema>;

export type FlowBulkOutcome =
  | { kind: 'ok'; data: {
      nodes: Array<{ id: string; node: Record<string, unknown> }>;
      connectors: Array<{ id: string }>;
    } }
  | { kind: 'flowNotFound' }
  | { kind: 'fileNotFound'; path: string }
  | { kind: 'badJson'; message: string }
  | { kind: 'badSchema'; issues: ZodIssue[] }
  | { kind: 'duplicateIdInBatch'; collection: 'nodes' | 'connectors'; id: string }
  | { kind: 'idAlreadyExists'; collection: 'nodes' | 'connectors'; id: string }
  | { kind: 'writeFailed'; message: string };
```

The `collection` discriminator on the two id-collision kinds is the
only semantic addition over the existing outcome shapes — without it,
error messages can't say *which* kind of id collided.

`NodesBulkBodySchema`, `ConnectorsBulkBodySchema`,
`AddNodesBulkOutcome`, `AddConnectorsBulkOutcome` are deleted in the
same edit.

### Implementation — `addFlowBulkImpl(deps, flowId, body)`

**Phase A — prepare (no IO):**

1. Walk `body.nodes ?? []`, then `body.connectors ?? []`.
2. Assign missing ids (`node-${shortId()}` / `conn-${shortId()}`).
3. Default `position` for nodes, `kind: 'default'` for connectors.
4. Run externalization for nodes (capture `{ absPath, content }` per
   `externalizedFieldsForNodeType`).
5. Per-collection duplicate-id check →
   `{ kind: 'duplicateIdInBatch', collection, id }`. Cross-collection
   collisions are allowed — today a node and a connector can share
   an id; the merger preserves that.

**Phase B — single transactional mutate** via `mutateMergedFlowAndBroadcast`:

1. Read merged flow.
2. Build `existingNodeIds` / `existingConnIds` sets; bail with
   `idAlreadyExists` (with `collection`) on collision.
3. Push prepared nodes onto `flow.nodes`, then prepared connectors
   onto `flow.connectors`.
4. Inside the same mutator, write the queued externalized node files.
   A `writeFailed` mid-batch still leaves the same "stranded folders"
   shape today's `addNodesBulkImpl` has — comment carries forward,
   same caller-retry contract.
5. Post-mutation `ResolvedFlowSchema` parse runs once. It validates
   the merged graph as a whole — including `superRefine`'s
   source/target referential integrity — so a connector that
   references a node from this same batch succeeds, and a dangling ref
   rolls back *everything* (both arrays).

**One broadcast.** `mutateMergedFlowAndBroadcast` already emits a
single `flow:reload`, so the merger replaces *two* broadcasts (today's
seed sequence) with one. Free latency improvement for the canvas.

### Surface flips

- `api.ts`: delete the two `/bulk` routes; add `POST /flows/:id/bulk`
  with the same outcome-switch shape as the singular routes. Returns
  `{ ok: true, nodes: [...], connectors: [...] }` — arrays empty when
  the input section was absent.
- `cli.ts`: delete `nodes:add-bulk` / `connectors:add-bulk` branches,
  `runNodesAddBulk`, `runConnectorsAddBulk`, and their `help` lines;
  add `flow:add-bulk` branch, `runFlowAddBulk`, help line. Body comes
  from existing `bodyFromFlags()` (`--json` / `--file` / `--stdin`).
- `cli-manifest.ts`: same swap in manifest entries (the
  `cli-manifest.test.ts` snapshot will need regen).
- `mcp.ts`: delete `AddNodesInputSchema`, `AddConnectorsInputSchema`,
  `seeflow_add_nodes`, `seeflow_add_connectors`. Add
  `AddBulkInputSchema = FlowBulkBodySchema.extend({ flowId: z.string().min(1) })`
  and the `seeflow_add_bulk` tool. Tool description spells out the
  atomicity guarantee — that's the load-bearing teaching for the LLM
  caller.

### Tests (replace, don't add)

One combined suite per file replaces the two split suites. New
coverage to add explicitly:

- single SSE `flow:reload` broadcast per call,
- connectors referencing nodes from the *same* call succeed,
- dangling connector ref rolls back the nodes from the same call too,
- duplicate-id-in-batch reports the correct `collection`,
- id-already-exists reports the correct `collection`,
- empty-body and both-empty-arrays bodies reject with the refine
  message,
- externalization-write-fail still rolls back the merged write the
  same way it does today.

Files: `operations.test.ts`, `api.test.ts`, `cli.test.ts`,
`mcp.test.ts`, `mcp-parity.test.ts`, `cli-manifest.test.ts`.

### Skill updates (`skills/seeflow/`)

Five files reference the old surfaces. Each is a targeted swap — no
rewrites.

**`SKILL.md`** — 5 hits:
- L43 phase map: `nodes:add-bulk → connectors:add-bulk` → single
  `flow:add-bulk` step.
- L48: `optional newTriggerNodes via nodes:add-bulk + connectors:add-bulk`
  → `via flow:add-bulk`.
- L183–184 (P3 sequence): collapse two steps into one
  `flow:add-bulk`, body `{ nodes, connectors }` straight from the
  normalized planner output.
- L228 (P5 trigger injection): `batch them via nodes:add-bulk +
  connectors:add-bulk` → `via flow:add-bulk`.
- L230 (edit-case retype): `nodes:delete + nodes:add-bulk` →
  `nodes:delete + flow:add-bulk`.

**`references/operations.md`** — 4 hits:
- L26–27 / L30–31: collapse paired P3 and P5 rows into single
  `flow:add-bulk` rows; description "Atomic seed of skeleton nodes +
  connectors."
- L45 (planner-output description): `nodes:add-bulk /
  connectors:add-bulk shape` → `flow:add-bulk shape`.

**`agents/seeflow-node-planner.md`** — 4 hits:
- L87: rewrite the "How the orchestrator uses this" paragraph to
  describe one forwarding call. Keep all existing guidance about not
  emitting `position`, `playAction`, visual fields — unchanged.
- L124 / L220: `before nodes:add-bulk` / `before connectors:add-bulk`
  → `before flow:add-bulk` (id-helper guidance).
- L399 & L514: same swap in retype-routing and placeholder-injection
  paragraphs.

**`agents/seeflow-play-designer.md`** — L185–186:
- `orchestrator forwards them to seeflow nodes:add-bulk and seeflow
  connectors:add-bulk` → `... to seeflow flow:add-bulk`.

**`lib/short-id.mjs`** — L4 comment:
- `nodes:add-bulk auto-assign` → `flow:add-bulk auto-assign`.

**`feedback.md`** — L92, L121, L122:
- Swap `nodes:add-bulk rejected` → `flow:add-bulk rejected` in the
  good/bad summary examples.

**Behavioral implication.** P3 drops from two CLI calls to one. P5
trigger-injection drops from two to one. The "if connectors fail
you've already committed nodes" failure mode is gone — rollback is
whole-batch, so any sentence in the skill that defensively reasons
about partial commits can drop. Scan for `rollback` / `partial` /
`orphan` while editing.

## Build sequence

1. **Schema + outcome** in `operations.ts` (add new, delete old).
2. **Impl** `addFlowBulkImpl`; delete `addNodesBulkImpl` /
   `addConnectorsBulkImpl`; update `Operations` interface and factory.
3. **Surface flips** in parallel: `api.ts`, `cli.ts`,
   `cli-manifest.ts`, `mcp.ts`.
4. **Tests** — replace split suites with combined suites; regen
   `cli-manifest` snapshot.
5. **Skill text swap** per the file-by-file plan above.
6. **Verify** `bun run format && bun run lint && bun run typecheck && bun test`.

**Grep sweep before commit** — these should each return zero hits in
`apps/` and `skills/`:

```
nodes:add-bulk
connectors:add-bulk
add_nodes\b
add_connectors\b
```

(The `\b` matters — don't match `add_nodes_bulk` if a leftover sneaks
in under a different name.)

## Out of scope (explicit YAGNI)

- No deprecation shims / aliases — clean break, pre-1.0.
- No per-item partial-success mode — atomicity is the whole point.
- No `update` / `delete` in the same bulk call — additive-only,
  matches today's scope.
- No web app changes — the canvas doesn't call bulk endpoints (it does
  singular adds via drag/drop); codebase grep confirms.
