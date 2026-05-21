# CLI reference

Every flow-management op is a `seeflow <sub>` invocation. The CLI ships with
`@tuongaz/seeflow` — version sync is automatic. Bodies arrive via exactly one
of `--file <path>`, `--stdin`, or `--json '<inline>'`. Output is
`{"ok":true,…}` to stdout on success, plain text to stderr on failure, exit
`0`/`1`. Invoke as `npx -y @tuongaz/seeflow@latest <sub> …`.

## Discovery

- `seeflow flows:list` → `{ok, flows:[{id,slug,name,repoPath,lastModified,valid}]}`.
- `seeflow flows:get <flowId>` → `{ok, id, slug, name, filePath, flow, valid, error}`. Errors: `flowNotFound`, `fileNotFound`.

## Project lifecycle

### projects:create

Scaffold a fresh project under `~/.seeflow/<slug>/` (or `$SEEFLOW_WORKSPACE/.seeflow/<slug>/` in Docker) and register it. Idempotent on `--name`.

```bash
seeflow projects:create --name "Order Pipeline"
```

Output: `{ok, id, slug, scaffolded}`. Errors: `badSchema`, `scaffoldFailed`.

### flows:register

Register a flow already on disk. Legacy `seeflow register` is the alias.

```bash
seeflow flows:register --path <repoPath> --flow <relpath>
```

Output: `{ok, id, slug, sdk:{outcome,filePath}}`. Errors: `fileNotFound`, `badJson`, `badSchema`, `sdkWriteFailed`.

### flows:delete

```bash
seeflow flows:delete <flowId>
```

Output: `{ok}`. No cascade — `.seeflow/<slug>/` files stay on disk. Errors: `flowNotFound`.

## Node mutations

### nodes:add

```bash
seeflow nodes:add <flowId> --json '{"type":"playNode","data":{…}}'
```

Output: `{ok, id, node}`. Auto-assigns `id` and default `position:{0,0}` if absent. Errors: `flowNotFound`, `fileNotFound`, `badJson`, `badSchema`, `writeFailed`.

### nodes:add-bulk

POST 1-100 nodes atomically. Either all land or none.

```bash
seeflow nodes:add-bulk <flowId> --file /tmp/sf-nodes-<flowId>.json
```

Body: `{ "nodes": [ {"id","type","data":{…}}, … ] }`. Output: `{ok, nodes:[{id}]}`. Errors: `duplicateIdInBatch`, `idAlreadyExists`, `badSchema`, `writeFailed`.

### nodes:patch

```bash
seeflow nodes:patch <flowId> <nodeId> --json '{"playAction":{…}}'
```

Body accepts every node-data key (`name`, `description`, `detail`, `html`, `icon`, `playAction`, `statusAction`, `stateSource`, plus visual fields). Empty string on `description`/`detail` clears the field; explicit `null` on `icon` clears it. Output: `{ok}`. Errors: `unknownNode`, `badSchema`, `writeFailed`.

### nodes:move / nodes:reorder / nodes:delete

```bash
seeflow nodes:move    <flowId> <nodeId> --x 120 --y 240
seeflow nodes:reorder <flowId> <nodeId> --op forward|backward|toFront|toBack|toIndex [--index N]
seeflow nodes:delete  <flowId> <nodeId>
```

`nodes:move` → `{ok, position}`. `nodes:reorder` → `{ok}` (no-op also returns ok). `nodes:delete` → `{ok}` and cascade-removes connectors touching the node AND the `.seeflow/nodes/<nodeId>/` folder.

## Connector mutations

```bash
seeflow connectors:add       <flowId> --json '{"kind":"event","source":"a","target":"b"}'
seeflow connectors:add-bulk  <flowId> --file /tmp/sf-conns.json   # body: {"connectors":[…]}
seeflow connectors:patch     <flowId> <connId> --json '{"label":"…","kind":"event","eventName":"…"}'
seeflow connectors:delete    <flowId> <connId>
```

`kind` defaults to `"default"`. Changing `kind` on patch drops the previous kind's payload fields; explicit `null` clears a field. No cascade on delete (node deletion is what cascades). Errors: `duplicateIdInBatch`, `idAlreadyExists`, `unknownConnector`, `badSchema`.

## Layout

### flows:layout

Re-run ELK and overwrite `style.json` positions. Cheap; safe after any batch of mutations.

```bash
seeflow flows:layout <flowId>
```

Output: `{ "ok": true }`.

### flows:play

```bash
seeflow flows:play <flowId> <nodeId>
```

Triggers the node's `playAction`. Output mirrors the studio's `/play` response.

## Validation + e2e

### validate

Stateless schema check — no registry side effects.

```bash
seeflow validate --file flow.json [--style style.json]
```

Output: `{ "ok": true }` or `{ "ok": false, "issues": [{"scope","path","message","code"}] }`. Exits `1` on `ok:false`.

### e2e

Replaces the old `validate-end-to-end.ts` helper.

```bash
seeflow e2e <flowId> [--skip-nodes id1,id2]
```

Drives `/api/events` SSE and `/play/:nodeId`. Output: `{ "ok": true|false, "plays": [...], "statuses": [...], "skipped": [...] }`. Hard ceiling ~2 min.

## Common error envelopes

| `kind` | HTTP | Recovery |
|---|---|---|
| `flowNotFound` | 404 | re-list, fix the id |
| `fileNotFound` | 404 | the project moved — re-register |
| `unknownNode` | 404 | the node id is stale; re-fetch the flow |
| `unknownConnector` | 404 | same — re-fetch |
| `badJson` | 400 | malformed body — fix and retry |
| `badSchema` | 400 | look at `issues[]`, feed back to the producing agent |
| `duplicateIdInBatch` | 400 | dedupe your own payload |
| `idAlreadyExists` | 409 | rename or delete the existing item first |
| `scaffoldFailed` | 500 | usually a permissions issue — surface to user |
| `writeFailed` | 500 | retry once; if it persists, the disk is unhappy |
| `sdkWriteFailed` | 500 | SDK helper write blocked — non-fatal but surface |

## Global flags

- `--no-start` — fail with a clear message if the studio isn't already running, instead of auto-spawning a background daemon.
- `--debug` — verbose logs; pipes daemon output to `~/.seeflow/seeflow.log` when spawning.

The studio URL resolves from (in order): `SEEFLOW_STUDIO_URL` env var → `~/.seeflow/config.json` port → `http://localhost:4321`.
