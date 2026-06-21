# Flow schema exposure — design

**Date:** 2026-05-22
**Status:** Approved, ready for implementation

## Problem

`apps/studio/src/schema.ts` is the canonical Zod definition of `flow.json` (and `style.json`). The `seeflow` skill has its own hand-maintained cheatsheet at `skills/seeflow/references/schema.md` describing the same shapes. The two drift — every schema change requires manual sync, and silent drift means the skill's sub-agents emit `flow.json` that the server rejects.

Make the schema itself reachable at runtime via CLI / MCP / API so the skill can never lie. Single source of truth.

## Non-goals

- Replacing `seeflow help <command>` (which already documents per-command request *bodies*). The new surface is for **on-disk file shapes** (`flow.json` / `style.json`), not CLI body shapes.
- Auto-generating the prose parts of `references/schema.md` (file conventions, icon-per-kind table, `timeoutMs` budgets, when-to-use guidance). Those stay hand-written because they're decisions, not shapes.
- Validating user-supplied JSON against the schema — `seeflow validate` already covers that.

## Design

### CLI

```
seeflow schema                # cheap category index
seeflow schema <category>     # full JSON Schema(s) for that category
```

**Categories:**

| Name | Returns |
|---|---|
| `flow` | `FlowSchema` envelope — version / name / description / resetAction. `nodes` / `connectors` referenced as `<see schema node>` placeholders rather than expanded inline. |
| `node` | Object keyed by node `type` → JSON Schema for each variant: `playNode`, `stateNode`, `shapeNode`, `imageNode`, `iconNode`, `htmlNode`. |
| `connector` | Object keyed by connector `kind` → `http`, `event`, `queue`, `default`. |
| `action` | `playAction`, `statusAction`, `resetAction`, `statusReport`. |
| `style` | `StyleSchema` (studio-owned; surfaced for completeness). |

**Return envelope** (matches the rest of the CLI):

```json
{
  "ok": true,
  "name": "node",
  "schemas": {
    "playNode": { /* JSON Schema (Draft-07) */ },
    "stateNode": { /* … */ },
    "shapeNode": { /* … */ },
    "imageNode": { /* … */ },
    "iconNode":  { /* … */ },
    "htmlNode":  { /* … */ }
  },
  "notes": []
}
```

`notes` is a hand-curated array of cross-field invariants that JSON Schema can't express (Zod's `superRefine`). Examples that ship with v1:

- Under `flow`: `"connectors[].source and connectors[].target must reference an existing nodes[].id."`
- Under `node`: `"imageNode.data.path must start with 'nodes/<id>/'."`, `"scriptPath in playAction/statusAction is relative to nodes/<nodeId>/ and may not contain '..' or absolute paths."`

Empty array when no invariants apply (e.g. `style`).

**Index response:**

```json
{
  "ok": true,
  "categories": [
    { "name": "flow",      "description": "Top-level flow.json envelope." },
    { "name": "node",      "description": "All six node variants (playNode, stateNode, shapeNode, imageNode, iconNode, htmlNode)." },
    { "name": "connector", "description": "All four connector kinds (http, event, queue, default)." },
    { "name": "action",    "description": "playAction, statusAction, resetAction, statusReport." },
    { "name": "style",     "description": "style.json (studio-owned)." }
  ]
}
```

**Errors:** unknown category → exit 3 with `{"error": "unknown schema category: <name>", "code": "notFound", "available": [...]}` — same `notFound` exit code already used by `flows:get` etc.

### MCP

```
seeflow_schema  (optional input: { "name": "node" })
```

Description (copy verbatim into the tool registration):

> Get the SeeFlow flow.json schema. Call with no args for a category index; call with `name` for one category's full JSON Schemas. Use this to learn what a node, connector, action, or flow envelope looks like before authoring writes. Categories: `flow`, `node`, `connector`, `action`, `style`.

Returns the same envelope as the CLI.

### API

```
GET /api/schema              → { ok: true, categories: [...] }
GET /api/schema/:name        → { ok: true, name, schemas, notes } | 404
```

404 body: `{ "error": "unknown schema category: <name>", "available": [...] }` — mirrors existing 404 conventions in `api.ts`.

### Implementation module

`apps/studio/src/schema-catalog.ts` — single source of truth, called from `cli-ops.ts`, `mcp.ts`, and `api.ts`:

```ts
export interface SchemaCategory { name: string; description: string; }
export interface SchemaPayload  { schemas: Record<string, unknown>; notes: string[]; }

export function listSchemaCategories(): SchemaCategory[];
export function getSchemaCategory(name: string): SchemaPayload | null;
```

Built once at module load by passing each relevant Zod schema through `zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' })`. `target: 'jsonSchema7'` pins Draft-07 (widest tooling support; matches mcp.ts's existing usage). The mapping from category → Zod schemas lives in this file and is the only thing that changes when categories expand.

Hand-curated `notes` arrays live in the same file as a constant keyed by category name.

## Skill changes (`skills/seeflow/`)

Per `superpowers:writing-skills`.

### `references/schema.md`

Keep:
- Per-node file convention (`<project>/.seeflow/nodes/<nodeId>/...`).
- `file://` substitution behaviour for `detail` / `html`.
- `kind` → suggested `icon` table.
- `scriptPath` anchor rules.
- `timeoutMs` per-language budget guidance.
- When-to-use guidance for each shape / node variant.

Strip:
- The literal field-by-field "Required: name, kind, …" blocks for each node variant.
- The connector field tables.
- The `playAction` / `statusAction` field shapes.

Replace stripped sections with:

```markdown
## Discovering the schema at runtime

Never memorize field shapes — the CLI is the source of truth. Run before
authoring any flow.json write:

    $SEEFLOW schema              # category index
    $SEEFLOW schema node         # all node variants
    $SEEFLOW schema connector    # all connector kinds
    $SEEFLOW schema action       # playAction / statusAction / resetAction / statusReport
    $SEEFLOW schema flow         # top-level envelope

Returns Draft-07 JSON Schema per variant plus a `notes` array carrying
cross-field invariants the schema can't express (e.g. dangling connector
source/target, imageNode path prefix).
```

### `SKILL.md`

1. **Phase 0 capability probe** — extend the required-subcommand list to include `schema`. Missing → `env-capability-mismatch` blocker (same as today's missing `flow:add-bulk` etc.).
2. **Phase 2 (`seeflow-node-planner`) and Phase 4 (designers)** — add one line to each sub-agent's prompt: *"Before emitting any node / connector / action JSON, run `$SEEFLOW schema <category>` and conform to it. `references/schema.md` covers conventions but not field shapes."*

### Sub-agent prompts (`skills/seeflow/agents/`)

Touch only `seeflow-node-planner.md`, `seeflow-play-designer.md`, `seeflow-status-designer.md`. Each gets the same one-line "run schema first" directive in its input section.

### Verification

After edits land, spawn a fresh subagent with a sample prompt (existing fixtures in `skills/seeflow-lookup/test/`) and confirm the trace shows `$SEEFLOW schema node` (and friends) called before any `flow:add-bulk` / `nodes:patch` body is composed. If the subagent skips the call, the directive is too soft — strengthen until it's bulletproof per `superpowers:writing-skills`.

## Build sequence

1. `apps/studio/src/schema-catalog.ts` + `.test.ts`.
2. CLI — wire `schema` subcommand in `cli.ts`, handler in `cli-ops.ts`, help-block entry under `meta` next to `validate`. Test in `cli.test.ts`.
3. MCP — register `seeflow_schema` in `mcp.ts`; extend `mcp-parity.test.ts` to cover the new tool.
4. API — `GET /api/schema` and `GET /api/schema/:name` in `api.ts`; cover both in `api.test.ts`.
5. Skill — edit `references/schema.md`, `SKILL.md`, the three agent prompts.
6. Verify the skill via a subagent run.

## Open questions

None — answered during brainstorming:
- JSON Schema target: **Draft-07** (matches mcp.ts; broadest tooling).
- Category set: **5 categories** (`flow`, `node`, `connector`, `action`, `style`); no deeper drill-down in v1.
- Surface parity: **CLI + MCP + API**, identical envelope and category set.
- Format: **JSON Schema only** (no markdown variant).
