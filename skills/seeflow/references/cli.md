# CLI reference

The CLI is the only way the skill mutates a flow. Do not memorise commands,
flags, or body shapes — the CLI documents itself.

Resolve `$SEEFLOW` once at session start:

```bash
SEEFLOW="$(command -v seeflow >/dev/null 2>&1 && echo seeflow || echo 'npx -y @tuongaz/seeflow@latest')"
```

Then ask the CLI:

- `$SEEFLOW help` — list every subcommand by category.
- `$SEEFLOW help <command>` — synopsis, args, flags, body schema, output shape, error kinds, examples.

Treat the help output as the source of truth and follow the instructions it
prints. If a flag, body shape, or error kind is not in `help`, it does not
exist.

## Schema cache — fetched once at Phase 0

**Run schema lookups BEFORE designing or authoring any node.** The
orchestrator fetches `$SEEFLOW schema {flow,node,connector,action,componentCatalog,style}`
in parallel during Phase 0 and caches the outputs for the rest of the
run. Phase 2 (node-planner) receives the relevant cached entries in its
launching prompt — it doesn't re-fetch the whole category, but DOES
re-drill into a single subname (with `--jq` for a single field) when
composing patches. The cache also drives the Phase 0 type-surface diff
against `references/schema.md` § "Skill-known node types" (silent
maintainer signal when the install drifts from the docs; no runtime
effect).

If a Phase 0 schema call fails, the run stops and surfaces the failure
to the user — downstream agents can't author conforming JSON without
the contract.

### Progressive workflow

The CLI is built for cheap progressive disclosure — three levels, each
enriching the response with affordances for the next call:

```
# 1. Catalog — every category, with its drill targets inlined.
$SEEFLOW schema
#   → { categories: [{ name, description, subnames: [...] }, …],
#       usage: { drill, filter, examples },
#       jqHints: { rootPath: '.categories', examples, tip } }

# 2. Category — full schemas + subnames + jqHints to drill further.
$SEEFLOW schema node
$SEEFLOW schema componentCatalog      # every legal componentSpec.elements[].type
                                      # + the props each accepts
#   → { name, schemas, notes, subnames: [...],
#       jqHints: { examples: [...], rootPath: '.schemas', tip } }

# 3. Variant — one named schema + per-variant jqHints with the EXACT
#    list of data.<field> names you can target with --jq.
$SEEFLOW schema node component        # just the component variant
$SEEFLOW schema node rectangle        # just the rectangle variant
$SEEFLOW schema connector             # connector variants
$SEEFLOW schema componentCatalog Chart # just Chart's props schema
#   → { name, subname, schemas, notes,
#       jqHints: { dataFields: [...], examples: [...],
#                  rootPath: '.schemas.<subname>', tip } }
```

Every response carries `jqHints.rootPath` — the jq prefix that reaches
the schema body at that level (`.categories` on the index, `.schemas`
on a category, `.schemas.<subname>` on a drill). The `{ result }`
wrapper printed under `--jq` is presentational: filters run against the
response object itself, so never prefix a filter with `.result`.

Unknown subname → exit 3 with `{ code:"notFound", category,
available:[…] }` listing the valid subnames. The same access patterns
exist on every transport — MCP `seeflow_schema { name, subname }` and
REST `GET /api/schema/<category>/<subname>` — and both return the same
`subnames` / `usage` / `jqHints` affordances the CLI prints.

### `--jq` extraction with `jqHints.dataFields`

Pair `subname` with `--jq <filter>` to extract a slice in the CLI
rather than post-processing the JSON downstream — jq-path subset
(identity, field access, brackets, iteration, optional `?`, pipe).
Single-output filters return `{ result: <value> }`; multi-output
filters return `{ result: [<v1>, …] }`. Bad filters exit 2 with
`code:"badJq"`.

**`jqHints.dataFields` (per-variant lookups only)** lists every
`data.<field>` available on a node variant — the answer to "what
fields can I jq for?" Paste any of them into the canonical path:

```
$SEEFLOW schema node rectangle \
    --jq '.schemas.rectangle.properties.data.properties.icon'

$SEEFLOW schema node component \
    --jq '.schemas.component.properties.data.properties.spec'
```

For non-node variants (connector / componentSpec / style)
there is no `data` wrapper, so `dataFields` is absent on those
responses — reach for `jqHints.examples` instead, which still
pre-builds drill paths like `.schemas.connector.required`.

`badJq` means the path is wrong, **not** that the tool is broken —
re-run the parent (`$SEEFLOW schema node rectangle`) without `--jq`,
read `jqHints` for the right path, retry. Never fall back to in-process
JSON parsing. Run `$SEEFLOW help schema` for the authoritative grammar
and live examples.

## Addressing — `--project` + `--flow`

Every flow-scoped CLI verb (`nodes:*`, `connectors:*`, `flow:add-bulk`,
`flows:layout`, `flows:get`, `flows:delete`, etc.)
takes `--project $projectSlug --flow $flowSlug` — two explicit flags,
no positional `<flowId>`. The single combined `<projectSlug>/<flowSlug>`
form was the old shape and is gone. The studio resolves the pair via
`/api/projects/:project/flows/:flow` and returns the structured 404
codes `project-not-found` / `flow-not-found` when either side misses.

The canvas URL is `$STUDIO_URL/projects/<projectSlug>/flows/<flowSlug>`.

## New project vs existing project vs new flow

- **New project (no `<repoPath>/seeflow.json` yet)** — use
  `projects:create --path <repoPath> --name <name> [--description <text>]`.
  The CLI writes both `<repoPath>/seeflow.json` (manifest with a single
  `flows[]` entry `{ id: 'main', name: 'Main' }`) AND
  `<repoPath>/flows/main/flow.json` (empty envelope) in one shot, then
  registers the resulting project — returning `{ ok, id, slug }` where
  `slug` is the combined `"<projectSlug>/<flowSlug>"` (split on `/`;
  `flowSlug` is `main` for a fresh project). This is the default for `/seeflow`'s
  Phase 3. The skill convention for `<repoPath>` is
  `<host>/.seeflow/<projectSlug>/`.
- **Existing project (manifest already on disk)** — use
  `register --path <repoPath>` to re-scan `seeflow.json` and re-attach
  every declared flow. When `projects:create` exits with `alreadyExists`
  (code 4), the orchestrator stops and asks the user (see
  `phases/p3-scaffold.md` §"Existing-project gate"); `register` is only
  invoked via the gate's "Open the existing project" branch — never as an
  automatic fallback. Auto-falling-back was data-loss-adjacent (silently
  re-attached a stale envelope under a new name) and is forbidden.
- **Add a flow to an existing project** — use
  `flows:create --project <projectSlug> --flow <flowSlug> --name <name> [--icon <iconName>]`.
  The CLI atomically creates `flows/<flowSlug>/flow.json` (empty
  envelope), appends `{ id, name, icon? }` to the manifest's `flows[]`,
  and upserts the registry entry. Reject pattern violators
  (`^[a-z0-9][a-z0-9-]*$`) and duplicates. **There is no legacy
  fallback to a project-root `flow.json`** — every flow lives under
  `flows/<flowSlug>/`.
- **Rename a flow** — `flows:rename --project <projectSlug> --flow <flowSlug> [--new-id <newSlug>] [--name <name>] [--icon <icon>]`.
  Renaming `--new-id` atomically renames the on-disk folder
  `flows/<oldSlug>` → `flows/<newSlug>` AND rewrites the manifest's
  `flows[].id` (plus `defaultFlow` when the renamed flow was default).
- **Delete a flow** — `flows:delete --project <projectSlug> --flow <flowSlug> [--new-default <otherSlug>]`.
  Refuses to leave the project empty (`last-flow`) or without a default
  (`default-flow-no-replacement` — pass `--new-default` to flip it).
- **List projects** — `projects:list` prints every registered project
  with its `projectSlug`, name, `defaultFlow`, and `flowCount`.

Note: node-attached content (`detail.md`, `view.html`, uploaded images)
lives under `<repoPath>/flows/<flowSlug>/nodes/<nodeId>/` — one folder
per node, anchored inside the owning flow's folder. The studio's per-
node upload endpoint
(`POST /api/projects/<project>/flows/<flow>/nodes/<nodeId>/files/upload`)
enforces the same anchor.

## Generating canonical ids

`$SEEFLOW ids <node|connector> <count>` prints `count` canonical short
ids (10 base62 chars), one per line. Use `node` for node ids
(`node-<...>`) and `connector` for connector ids (`conn-<...>`) — the
shape matches every other id producer in the studio (canvas, server
auto-assign, the upload endpoint regex). `count` must be in `[1, 100]`;
call once per type.

The studio URL resolves from `SEEFLOW_STUDIO_URL` → `~/.seeflow/config.json`
port → `http://localhost:4321`.
