# SeeFlow Skill — CLI Migration Design

**Date:** 2026-05-21
**Status:** Design approved; implementation deferred.
**Scope:** `skills/seeflow/`, `apps/studio/src/cli.ts`, plus three supporting studio changes (operations, proxy, status-runner).

## Why

The studio's HTTP/MCP surface has grown to cover every flow mutation (create project, add node, patch node, add connector, etc.). The current skill predates that and authors `.seeflow/<slug>/flow.json` directly, then validates and registers the file as an atomic blob. That model is now redundant:

- Each API write auto-validates via post-merge `ResolvedFlowSchema` reparse — no separate validation step is needed.
- Bulk add endpoints (`POST /api/flows/:id/nodes/bulk`, `…/connectors/bulk`) let the skill seed a flow in two calls instead of authoring a whole JSON file.
- `detail` and `html` content auto-externalise into `.seeflow/nodes/<id>/`; the skill should never manage those files.

The skill needs to switch from "author a file, validate it, register it" to "create the project, then call write APIs incrementally." Everything goes through the CLI; the skill never touches `flow.json` directly.

## Decisions captured

1. **Transport: CLI-only.** No MCP detection, no dual code path. Every flow-management op invokes `npx -y @tuongaz/seeflow@latest <subcommand> …`. CLI ships with the studio package, so version sync is automatic.
2. **Pipeline: compress to 6 phases.** P3 collapses to "scaffold + populate + layout + review". P5 collapses to "patch overlays + layout". No standalone validation gate.
3. **Phase 3 user-review checkpoint stays** — opening the canvas before designers spend effort on scripts catches wrong node graphs cheaply.
4. **Old helper scripts deleted.** `skills/seeflow/scripts/` removed entirely; the CLI subsumes `register.ts`, `validate.ts`, `unregister.ts`, `refresh-layout.ts`, and `validate-end-to-end.ts`.
5. **Per-node file convention.** Every file owned by a node lives in `.seeflow/nodes/<nodeId>/`. `scriptPath` is relative to that folder; the studio's resolver prepends the anchor. Cascade-delete already cleans the folder up.
6. **`NodePatchBodySchema` extension.** `playAction`, `statusAction`, `stateSource` become patchable so Phase 5 can attach behaviour without re-issuing the node.
7. **`resetAction` out of scope** for this round. The skill won't emit it; the studio still parses hand-authored values.
8. **MCP not used at runtime.** Tool surface in `apps/studio/src/mcp.ts` stays for other consumers (Cursor, etc.) but the skill doesn't call it.

## Studio code changes

### 1. `apps/studio/src/operations.ts`

Extend `NodePatchBodySchema` (around line 78) to accept three additional `data`-section keys. Reuse the existing Zod schemas from `apps/studio/src/schema.ts` so there's a single source of truth:

```ts
export const NodePatchBodySchema = z.object({
  // …existing fields…
  playAction: PlayActionSchema.optional(),
  statusAction: StatusActionSchema.optional(),
  stateSource: StateSourceSchema.optional(),
}).strict();
```

Add `'playAction'`, `'statusAction'`, `'stateSource'` to `NODE_DATA_PATCH_KEYS` so `mergeNodeUpdates` writes them onto `node.data`.

### 2. `apps/studio/src/proxy.ts` + `status-runner.ts`

Both files own a `resolveScript` helper that today anchors `scriptPath` at `<repoPath>/.seeflow/<scriptPath>`. Change the signature to thread `nodeId` through:

```ts
function resolveScript(cwd: string, nodeId: string, scriptPath: string): Resolved {
  const nodeRoot = resolve(cwd, '.seeflow', 'nodes', nodeId);
  const target = resolve(nodeRoot, scriptPath);
  // …existing realpath escape check, retargeted at nodeRoot…
}
```

Callers (`proxy.ts:160, :307`, `status-runner.ts:182`) already have the `nodeId` in scope from the action context — pass it through. `SCRIPT_PATH_ESCAPE` error message stays the same.

### 3. `apps/studio/src/schema.ts`

Update the two `scriptPath` validators (lines 73-74 and 96-97) so the hint message reflects the new anchor:

```ts
scriptPath: z.string().min(1).refine(isCleanRelativePath, {
  message: 'scriptPath must be a relative path under the node folder (no absolute / traversal)',
})
```

`isCleanRelativePath` itself is unchanged — it's still rejecting absolute paths and `..` traversal.

### 4. `apps/studio/src/cli.ts`

Extend with new subcommands. Names mirror the MCP tool names so a future MCP-mode revival would map 1:1. All subcommands accept payload bodies via one of `--file <path>`, `--stdin`, or `--json '<inline>'`.

| Subcommand | Endpoint | Notes |
|---|---|---|
| `projects:create --name <n> [--repo <path>]` | `POST /api/projects` | Returns `{id, slug, scaffolded}` |
| `flows:register --repo <path> --flow <relpath>` | `POST /api/flows/register` | Existing endpoint |
| `flows:list` | `GET /api/flows` | |
| `flows:get <flowId>` | `GET /api/flows/:id` | |
| `flows:delete <flowId>` | `DELETE /api/flows/:id` | |
| `flows:layout <flowId>` | `POST /api/flows/:id/layout` | |
| `flows:play <flowId> <nodeId>` | `POST /api/flows/:id/play/:nodeId` | |
| `nodes:add <flowId>` | `POST /api/flows/:id/nodes` | Single |
| `nodes:add-bulk <flowId>` | `POST /api/flows/:id/nodes/bulk` | Body: `{nodes:[…]}` |
| `nodes:patch <flowId> <nodeId>` | `PATCH /api/flows/:id/nodes/:nodeId` | |
| `nodes:move <flowId> <nodeId> --x N --y N` | `PATCH …/position` | |
| `nodes:reorder <flowId> <nodeId> --op …` | `PATCH …/order` | |
| `nodes:delete <flowId> <nodeId>` | `DELETE …/nodes/:nodeId` | |
| `connectors:add <flowId>` | `POST …/connectors` | Single |
| `connectors:add-bulk <flowId>` | `POST …/connectors/bulk` | Body: `{connectors:[…]}` |
| `connectors:patch <flowId> <connId>` | `PATCH …/connectors/:id` | |
| `connectors:delete <flowId> <connId>` | `DELETE …/connectors/:id` | |
| `validate --file flow.json [--style style.json]` | `POST /api/validate` | Stateless |
| `e2e <flowId> [--skip-nodes id1,id2]` | drives `/api/events` SSE + `/play/:nodeId` | Was `validate-end-to-end.ts` |

**Output contract:** JSON to stdout on success, plain text to stderr on failure, exit `0` or `1`. `ensureStudioRunning` from the existing `register` flow is reused.

### 5. `apps/studio/src/cli.test.ts`

Add coverage for each new subcommand: happy path + at least one error path (e.g. unknown `flowId`, bad JSON body). Existing patterns from `cli.test.ts` apply.

### 6. `apps/studio/examples/*`

Relocate scripts from `.seeflow/<slug>/scripts/<name>.ts` into `.seeflow/<slug>/nodes/<nodeId>/scripts/<name>.ts`. Rewrite `scriptPath` in each example's `flow.json` so the new anchor resolves correctly. The skill's `register.ts` test fixtures also move.

## Skill changes

### 1. `skills/seeflow/SKILL.md`

Full rewrite. Target ≤ 350 lines (current is 240 but includes redundancy that will grow without intervention). Apply `superpowers:writing-skills` hygiene:

- Description: keeps "Use when …" + concrete triggers, under 500 characters.
- One canonical example block (the P3 scaffold path) rather than JSONC sprinkled through each phase.
- Move the Phase-1 parallelism wrong/right block into a single subsection; reference it from later phases instead of repeating.
- Delete callouts whose invariants the API now enforces (`never skip style.json`, `flow.json must be …`).
- Cross-refs use skill name only (`references/cli.md`), no `@` force-loads.

New pipeline narrative:

```
P0    /health probe ‖ read WIKI.md
P1    code-analyzer ‖ system-analyzer
P2    node-planner (kicks off as soon as code-analyzer returns;
                   system-analyzer continues in background)
P3    projects:create → nodes:add-bulk → connectors:add-bulk
      → flows:layout → USER REVIEW
P3.5  dynamic gate (continue with scripts, or stop static?)
P4    play-designer ‖ status-designer
P5    write scripts to .seeflow/nodes/<nodeId>/scripts/
      + nodes:patch (per node, with playAction / statusAction)
      + inject trigger nodes via nodes:add-bulk + connectors:add-bulk
      + flows:layout
P6    e2e (was P7)
```

P5 retry budget: per-node patch failure → re-dispatch *that one* designer with the Zod issues, retry, max 3 per node. P6 retry: same as today, max 2.

### 2. `skills/seeflow/references/operations.md`

Rewrite. Replace "helper scripts" table with a CLI subcommand reference table (same content as the studio subcommand table above, plus per-command flag reference). Keep the error-handling table; remove rows that referenced deleted scripts.

### 3. `skills/seeflow/references/schema.md`

Edits, not rewrite:
- Remove the "RULE — never skip `style.json`" callout and surrounding manual-authoring guidance — the studio owns style.json end to end now.
- Add a "Per-node file convention" subsection describing `.seeflow/nodes/<nodeId>/` and the relative `scriptPath` anchor.
- Update the `playAction` example to use the new relative scriptPath form.

### 4. `skills/seeflow/references/cli.md` (NEW)

Per-subcommand documentation: invocation example, body JSON shape, output JSON shape, common error modes. ≤ 200 lines.

Example entry:

```markdown
## nodes:add-bulk

POST 1-100 nodes atomically. Either all land or none.

```bash
seeflow nodes:add-bulk <flowId> --file /tmp/sf-nodes-<flowId>.json
```

Body:
```json
{ "nodes": [ {"id":"…","type":"playNode","data":{…}}, … ] }
```

Output (stdout, JSON):
```json
{ "ok": true, "nodes": [ {"id":"…"}, … ] }
```

Errors: `duplicateIdInBatch`, `idAlreadyExists`, `badSchema` (with `issues[]`).
```

### 5. `skills/seeflow/agents/seeflow-node-planner.md`

Update the expected output schema so the bulk-add payload shape is what the planner emits — i.e. the orchestrator can write the file straight to disk and pass it to `nodes:add-bulk --file`:

```jsonc
{
  "name": "…",
  "slug": "…",
  "nodes": [
    { "id": "…", "type": "playNode", "data": { "name": "…", "kind": "…", "icon": "…", "stateSource": { … } } }
  ],
  "connectors": [
    { "id": "…", "kind": "…", "source": "…", "target": "…" }
  ]
}
```

No `position`, no `playAction`, no `statusAction` at planner output — those come in P5.

### 6. `skills/seeflow/agents/seeflow-play-designer.md` + `seeflow-status-designer.md`

Update the expected output schema so each overlay is a `{ nodeId, patch, scriptFile }` triple:

```jsonc
{
  "playOverlays": [
    {
      "nodeId": "checkout-api",
      "patch": {
        "description": "Receives a cart, creates an order.",
        "detail": "…long markdown…",
        "playAction": {
          "kind": "script", "interpreter": "bun", "args": ["run"],
          "scriptPath": "scripts/play.ts",
          "input": { "items":[{"sku":"ABC","qty":1}] },
          "timeoutMs": 30000
        }
      },
      "scriptFile": {
        "path": ".seeflow/nodes/checkout-api/scripts/play.ts",
        "body": "#!/usr/bin/env bun\n…",
        "chmod": "755"
      },
      "validationSafe": true,
      "rationale": "…"
    }
  ],
  "newTriggerNodes": [ … ]
}
```

The orchestrator writes `scriptFile.path` directly with the Write tool, then runs `nodes:patch <flowId> <nodeId> --json '<patch>'`. `scriptPath` is relative to the node folder — no `<slug>/` prefix.

### 7. `skills/seeflow/scripts/` — DELETE

Remove the directory and all tests. The CLI replaces every script. Verify nothing else in the skill imports from `scripts/`.

## Open follow-ups (not in scope)

- **`resetAction` support.** Needs an anchor (likely `.seeflow/<slug>/`) and a `flows:patch` endpoint. Defer until a demo demands it.
- **MCP-mode revival.** The MCP tool surface is healthy; if a later session needs MCP calls, the same skill prose maps 1:1 to MCP tool names. Probably worth doing once the CLI path is proven.
- **Migration of seeded examples.** `apps/studio/examples/order-pipeline`, `ecommerce-platform` etc. need their scripts moved into per-node folders. Best handled as part of the studio change PR.

## File-change manifest

```
NEW    docs/plans/2026-05-21-seeflow-skill-cli-migration-design.md
NEW    skills/seeflow/references/cli.md

EDIT   apps/studio/src/operations.ts          (NodePatchBodySchema + NODE_DATA_PATCH_KEYS)
EDIT   apps/studio/src/proxy.ts               (resolveScript nodeId arg)
EDIT   apps/studio/src/status-runner.ts       (resolveScript nodeId arg)
EDIT   apps/studio/src/schema.ts              (scriptPath hint message)
EDIT   apps/studio/src/cli.ts                 (new subcommands)
EDIT   apps/studio/src/cli.test.ts            (coverage)
EDIT   apps/studio/examples/*                 (per-node file layout)

REWRITE skills/seeflow/SKILL.md
REWRITE skills/seeflow/references/operations.md
EDIT    skills/seeflow/references/schema.md
EDIT    skills/seeflow/agents/seeflow-node-planner.md
EDIT    skills/seeflow/agents/seeflow-play-designer.md
EDIT    skills/seeflow/agents/seeflow-status-designer.md

DELETE  skills/seeflow/scripts/               (entire directory + tests)
```
