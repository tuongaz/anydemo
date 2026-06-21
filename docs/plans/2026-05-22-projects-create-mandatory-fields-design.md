# `projects:create` mandatory fields

## Goal

Tighten `projects:create` so callers must supply where the project lives
and what it's called. Optionally accept a human description that flows
into both `flow.json` and the registry entry.

Pre-launch — no backward-compat shims.

## CLI surface

```
projects:create --path <dir> --name <name> [--description <text>]
```

- `--path` (required) — absolute or cwd-relative folder for the seeflow
  project. Resolved via `resolve()` to absolute, matching `runRegister`
  at `apps/studio/src/cli.ts:511`.
- `--name` (required) — display name for the flow.
- `--description` (optional) — free-form text.

Each missing required flag prints a specific message via the existing
`printError(...)` helper and exits non-zero, mirroring today's
`--name` handling at `cli.ts:617`.

Help text (`printHelp()` at `cli.ts:186` and example at `cli.ts:245`)
is updated accordingly:

```
projects:create   Create a new project
                  (--path <dir> --name <name> [--description <text>])
```

```
npx -y @tuongaz/seeflow@latest projects:create \
  --path ./checkout --name "Checkout" \
  --description "Cart + payments flow"
```

## Input schema

`CreateProjectBodySchema` at `apps/studio/src/operations.ts:54-57`
becomes:

```ts
export const CreateProjectBodySchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
});
```

This schema is shared by REST (`apps/studio/src/api.ts:442`) and MCP
(`apps/studio/src/mcp.ts:453`), so all three surfaces require `path`
and `name` going forward.

## Folder semantics

`<path>` is the exact seeflow project folder. `flow.json` lives at
`<path>/.seeflow/flow.json` — same layout `flows:register` expects.

| State of `<path>`              | Action                                              |
|--------------------------------|-----------------------------------------------------|
| Doesn't exist                  | `mkdirSync(.seeflow, { recursive: true })`, scaffold |
| Exists, no `.seeflow/flow.json`| Scaffold `flow.json`                                |
| Exists, has `.seeflow/flow.json`| Error — `{ kind: 'alreadyExists', path }`          |

The "load existing flow.json and register it" branch at
`operations.ts:1160-1180` is removed — that workflow is what
`flows:register` already does.

`projectBaseDir` on `OperationsDeps` is no longer used by this code
path. We can leave the field in place for now if other ops reference
it; otherwise remove during implementation.

## Scaffolded `flow.json`

```jsonc
{
  "version": 2,
  "name": "<name>",
  "description": "<description>",   // omitted when not supplied
  "nodes": [],
  "connectors": []
}
```

`Flow` schema already supports `description?: string`
(`apps/studio/src/schema.ts:388`); no schema change required.

## Registry upsert

```ts
registry.upsert({
  name,
  description,                       // only when defined
  repoPath: path,
  flowPath: '.seeflow/flow.json',
  valid: true,
  lastModified,
});
```

`FlowEntry` already accepts `description?: string`
(`apps/studio/src/registry.ts:11`), so we're filling an existing
optional slot.

## Outcome union

`CreateProjectOutcome` changes:

- Drops the `scaffolded: false` branch (no longer reachable — existing
  project is now an error).
- Adds `{ kind: 'alreadyExists'; path: string }`.
- `ok` payload simplifies to `{ id, slug }`.

CLI prints `Project already exists at <path>` for the new error case.

## Tests to update

- `apps/studio/integration/cli.it.ts` — `projects:create` invocations
  gain `--path` and (where useful) `--description`.
- `apps/studio/integration/cli-in-process.it.ts` — same.
- `apps/studio/integration/rest.it.ts` — POST body for create-project
  gains `path` and (optionally) `description`.
- `apps/studio/src/mcp.test.ts:154` — `seeflow_create_project` input
  schema snapshot updates.

New coverage:

- Missing `--path` or `--name` → exit 1 with specific message.
- `<path>/.seeflow/flow.json` already exists → `alreadyExists` outcome.
- Scaffold writes `description` when supplied, omits it when not.
- Registry entry carries `description` when supplied.

## Out of scope

- No changes to `flows:register` behaviour.
- No changes to the `Flow` or `FlowEntry` schemas.
- No CLI alias for `--path` (e.g. positional arg) — keep the surface
  minimal.
