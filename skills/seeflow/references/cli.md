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

## Flow id vs slug

`help` documents most `<flowId>` arguments as "Flow id or slug" — but the
server currently only resolves by id (`flowNotFound` if a slug is passed).
**Use the `id` returned by `projects:create` (or `register`) for every
follow-up call.** Treat the slug as a URL convenience (the canvas opens
at `$STUDIO_URL/d/<slug>`), not as an addressable identifier from the CLI.

## New project vs existing project

- **New project (no `<repoPath>/flow.json` yet)** — use
  `projects:create --path <repoPath> --name <name> [--description <text>]`.
  The CLI writes the empty envelope at `<repoPath>/flow.json` (project
  root) and registers it in one step, returning `{ id, slug }`. This is
  the default for `/seeflow`'s Phase 3. The skill convention for
  `<repoPath>` is `<host>/.seeflow/<slug>/`.
- **Existing project (envelope already on disk)** — use
  `register --path <repoPath>` to register the existing envelope.
  `projects:create` exits with `alreadyExists` (code 4) when
  `<repoPath>/flow.json` is present; fall back to `register` and continue.

Note: node-attached content (`detail.md`, `view.html`, `scripts/`) still
lives under `<projectPath>/nodes/<nodeId>/` regardless of where
`flow.json` itself sits.

## Generating canonical ids

`$SEEFLOW ids <node|connector> <count>` prints `count` canonical short
ids (10 base62 chars), one per line. Use `node` for node ids
(`node-<...>`) and `connector` for connector ids (`conn-<...>`) — the
shape matches every other id producer in the studio (canvas, server
auto-assign, the upload endpoint regex). `count` must be in `[1, 100]`;
call once per type.

The studio URL resolves from `SEEFLOW_STUDIO_URL` → `~/.seeflow/config.json`
port → `http://localhost:4321`.
