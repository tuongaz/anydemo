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

The orchestrator fetches `$SEEFLOW schema {flow,node,connector,action,style}`
in parallel during Phase 0 and caches the outputs for the rest of the
run. Phase 2 (node-planner) and Phase 4 (play/status designers) receive
the relevant cached entries in their launching prompts — they don't
re-fetch. The cache also drives the Phase 0 type-surface diff against
`references/schema.md` § "Skill-known node types" (silent maintainer
signal when the install drifts from the docs; no runtime effect).

If a Phase 0 schema call fails, the run stops and surfaces the failure
to the user — downstream agents can't author conforming JSON without
the contract.

### Drilling into one schema (`subname` positional)

`$SEEFLOW schema <category>` returns every schema in the category. Pass
a third positional `subname` to get just one named schema — cheaper
than the whole category, and the same `notes` ride along because the
cross-variant invariants still apply:

```
$SEEFLOW schema node component        # just the component variant
$SEEFLOW schema node rectangle        # just the rectangle variant
$SEEFLOW schema action playAction     # just the playAction shape
```

Unknown subname → exit 3 with `{ code:"notFound", category, available:[…] }`
listing the valid subnames. The same access patterns exist on every
transport: MCP `seeflow_schema { name, subname }` and REST
`GET /api/schema/<category>/<subname>`. Use this when an agent only
needs one variant's contract (e.g. patching a single node type) instead
of forwarding the full category payload.

## Addressing — `--project` + `--flow`

Every flow-scoped CLI verb (`nodes:*`, `connectors:*`, `flow:add-bulk`,
`flows:layout`, `flows:play`, `flows:get`, `flows:delete`, `e2e`, etc.)
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
  registers the resulting project — returning `{ projectSlug, entries }`
  with one entry per declared flow. This is the default for `/seeflow`'s
  Phase 3. The skill convention for `<repoPath>` is
  `<host>/.seeflow/<projectSlug>/`.
- **Existing project (manifest already on disk)** — use
  `register --path <repoPath>` to re-scan `seeflow.json` and re-attach
  every declared flow. When `projects:create` exits with `alreadyExists`
  (code 4), the orchestrator stops and asks the user (see
  `phases/p3-scaffold.md` §"Existing-flow gate"); `register` is only
  invoked via the gate's "Open the existing flow" branch — never as an
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

Note: node-attached content (`detail.md`, `view.html`, `scripts/`)
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
