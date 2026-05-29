# SeeFlow schema discovery — design

**Date:** 2026-05-29
**Status:** Approved, ready for implementation

## Problem

Two field reports (agent screenshots) surfaced three discoverability gaps in
the `seeflow schema` surface and the `/seeflow` skill that consumes it.

### 1. The component catalog is invisible (headline)

`ComponentSpecElementSchema` (`apps/studio/src/schema.ts:220`) defines:

```ts
type: z.string().min(1),
props: z.record(z.string(), z.unknown()).optional(),
```

So `zodToJsonSchema` emits only the field *names* (`type` / `props` /
`children` / `watch`) — never the valid `type` enum nor the per-type props.
The real catalog (`COMPONENT_NAMES` + a Zod props schema per component:
Card, Tabs, Chart, Table, Button, …) lives in `@seeflow/canvas/catalog` and is
only consulted by a server-side `superRefine` at flow-read time
(`schema.ts:445`). An agent cannot discover it through `seeflow schema`.

The skill makes this worse: `references/phases/p0-preflight.md:36-44` instructs
the orchestrator to populate `$componentCatalog` from
`$SEEFLOW schema node component`'s `spec.elements[].type` enum — a path that
**cannot exist** (component spec is a sidecar; `type` is `z.string()`). The
agent retries forever, the skill tells it "the schema evolved," and
`$componentCatalog` comes back null. This is the exact null-catalog failure in
the field report.

### 2. Root-shape inconsistency

With `--jq`, the CLI wraps output as `{ result: … }`
(`cli.ts:1120/1159/1178`); without it the root is
`{ name, schemas, notes, jqHints }`. No hint tells the agent which prefix
applies, so agents trial-and-error `.result.schemas…` vs `.schemas…`.

### 3. `audienceFraming` depth keyword buried in prose

The depth token (`overview` / `walkthrough` / `deep-architectural`) is the only
machine-consumed value, but it lives inside free prose in `audienceFraming`
(`seeflow-code-analyzer.md:131-145`), and `seeflow-node-planner.md:413` *scans
the sentence* to extract it. In the field report the keyword wasn't in a
parseable position; the planner only recovered by inferring depth implicitly.

## Decisions

- **Component catalog → new `componentCatalog` schema category.** Matches the
  existing progressive-disclosure drill pattern; keeps responses small.
- **Root-shape → add `jqHints.rootPath`** (no disruptive normalization; the
  `{ result }` output wrapper stays, the *input* root becomes explicit).
- **Depth → dedicated `depth` field** on the code-analyzer contract; planner
  reads `brief.depth` directly.
- **Out of scope this round:** a top-level `required` summary key and a
  `--required` flag (considered, deferred).

## Design

### A. `componentCatalog` schema category (CLI)

`apps/studio/src/schema-catalog.ts`:

- Import `componentCatalog`, `COMPONENT_NAMES` from `@seeflow/canvas/catalog`.
- Add to `CATEGORY_META`:

  ```
  { name: 'componentCatalog',
    description:
      "The legal values for componentSpec.elements[].type and the props each
       accepts. Drill: seeflow schema componentCatalog <Name>." }
  ```

- Build its `PAYLOADS` entry dynamically — one subname per `COMPONENT_NAMES`
  entry, schema body = `toJsonSchema(componentCatalog.components[name].props)`:

  ```
  seeflow schema componentCatalog
    → { name:'componentCatalog',
        schemas:{ Card:{…}, Tabs:{…}, Chart:{…}, … },
        subnames:[…COMPONENT_NAMES],
        notes:[…], jqHints:{…} }

  seeflow schema componentCatalog Chart
    → { name:'componentCatalog', subname:'Chart',
        schemas:{ Chart:<props json schema> },
        notes:[…], jqHints:{ examples:[…], required:…, rootPath:'.schemas.Chart' } }
  ```

- Cross-link breadcrumbs: append to the `componentSpec` notes
  (`schema-catalog.ts:161`) and the `node`-component note (line 133):
  *"The legal `elements[].type` values and their props are listed under
  `seeflow schema componentCatalog`."*

`apps/studio/src/schema.ts`: add `.describe(...)` to
`ComponentSpecElementSchema.type` pointing at `seeflow schema componentCatalog`,
so the breadcrumb also shows up inline in `componentSpec` output.

`apps/studio/src/cli.ts`: extend `runSchema` help (cli.ts:271-278) to list the
new category. No output-shape change.

### B. `jqHints.rootPath` (CLI)

`apps/studio/src/schema-catalog.ts` — `JqHints` interface + `buildJqHints`:

- Add `rootPath: string` = the jq prefix that reaches the schema body for this
  response level:
  - index (no category) → `.categories`
  - category level → `.schemas`
  - subname level → `.schemas.<subname>`
- Add a fixed `tip`: *"`--jq` runs against this object; the `result` wrapper in
  `--jq` output is presentational — never prefix your filter with `.result`."*

`rootPath` rides inside the existing `jqHints`, so it's present in the non-jq
response the agent reads first. The `{ result }` output wrapper in `cli.ts`
stays (load-bearing for `applyJqOrDie`'s single-stream unwrap). The MCP / REST
path computes `rootPath` relative to the `schemas` payload, so it stays valid
regardless of the outer envelope.

### C. `depth` field (skill)

`agents/seeflow-code-analyzer.md`:

- Add `depth: "overview" | "walkthrough" | "deep-architectural"` to the output
  schema block (line 97), the field spec (131-145 → split prose vs keyword),
  and the worked example (line 196).
- `audienceFraming` stays prose (who + what they walk away knowing).

`agents/seeflow-node-planner.md:413-424`: read `brief.depth` directly; drop the
sentence-scan.

Brief envelope validation: accept/require the new `depth` field.

## File map

**CLI / studio:**

- `apps/studio/src/schema-catalog.ts` — new category + `rootPath` + breadcrumbs.
- `apps/studio/src/schema.ts` — `.describe()` on `ComponentSpecElementSchema.type`.
- `apps/studio/src/cli.ts` — help text only.
- Tests: `schema-catalog.test.ts` (category present; every `COMPONENT_NAMES`
  entry resolvable; `rootPath` correct per level), `cli.test.ts`,
  `mcp.test.ts`, `api.test.ts` (drill + `--jq` against `componentCatalog`;
  `rootPath` echoed).

**Skill:**

- `references/phases/p0-preflight.md` — add `$SEEFLOW schema componentCatalog`
  to the Phase-0 parallel fetch (line 29); rewrite §"Extract the component
  catalog" (36-44) to read from it; delete the impossible
  `spec.elements[].type` jq dance.
- `agents/seeflow-node-planner.md:55-56, 256-257` — re-point `componentCatalog`
  definition + breadcrumbs; read `brief.depth` (413-424).
- `agents/seeflow-code-analyzer.md` — `depth` field (97, 131-145, 196).
- `SKILL.md:175,188` — replace `component.spec.elements[].type` with
  `seeflow schema componentCatalog`.
- `references/schema.md:51` + `references/cli.md` — document the new category
  and `jqHints.rootPath`; fix the `spec.elements[].type` comment.

## Verification

- `bun run typecheck && bun run format && bun run lint && bun test`.
- Manual: `seeflow schema componentCatalog`, `… componentCatalog Chart`,
  `… componentCatalog Chart --jq .schemas.Chart.required` all resolve; every
  response carries `jqHints.rootPath`.
