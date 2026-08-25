# Changelog

## 0.7.0

SeeFlow is now a purely localhost tool. The hosted layer at `cloud.seeflow.dev` was retired on 2026-08-03, and everything that talked to it has been deleted from this package rather than left dangling.

### Removed

- **BREAKING — schema:** the node field `handlerModule` is gone. A flow that still declares it no longer validates; delete the field from `flow.json` before upgrading.
- **CLI:** the `export`, `login`, `logout`, and `whoami` commands, the `--endpoint` and `--dry-run` flags they carried, and the `SEEFLOW_CLOUD_URL` environment variable.
- **HTTP:** `GET /api/config`, `POST /api/flows/validate`, `POST /api/diagram/propose-scope`, and `POST /api/diagram/assemble`.
- **In-process embedding (`createApp`, reached by deep import — the package publishes no `main`/`exports` entrypoint):** the `createApp({ getTenantId })` multi-tenant hook is gone. `createApp` no longer takes a tenant resolver — the studio serves exactly one local registry.
- **UI:** Export to seeflow.dev, Share with people, and the Embed dialog. Downloading a flow as PNG or PDF is unaffected and stays.

### Changed

- **Vocabulary: "demo" is now "flow" everywhere.** The renamed artifact reaches the wire in error payloads: REST and MCP responses now say `unknown flow` (was `unknown demo`) and `Failed to write flow file: …` (was `Failed to write demo file: …`). Any client matching on the literal text needs updating; status codes, error `code` kinds, and every response shape are unchanged. CLI help text moved with it.
- **BREAKING — the studio binds loopback.** `seeflow start` now listens on `127.0.0.1:4321` instead of `0.0.0.0:4321`, matching [ADR 0002](../../docs/adr/0002-localhost-only.md). Every mutating route (including the one that opens a file in `$EDITOR`) was reachable from the LAN before. Pass `seeflow start --host 0.0.0.0` — or set `host` in `~/.seeflow/config.json` — to opt back in. The Docker image passes the wildcard for you via `SEEFLOW_HOST`.
- **Docker auto-registration.** The entrypoint now registers `$SEEFLOW_WORKSPACE` when it holds a `seeflow.json` manifest. It previously gated on `$SEEFLOW_WORKSPACE/.seeflow/flow.json`, a path no supported project layout produces, so the mounted workspace was silently never registered. `SEEFLOW_FLOW` now defaults to `flow.json` and applies only to pre-manifest single-flow projects.

### Obsolete on-disk state

Nothing reads or writes these any more, and SeeFlow will never recreate them. Delete them by hand at your convenience:

- `~/.seeflow/credentials.json` (or `$XDG_CONFIG_HOME/seeflow/credentials.json`) — cloud session tokens.
- `<project>/.seeflow/cloud.json` — the per-project link to a published cloud project.

### Added

- feat(icons): cloud icon packs — install the AWS and Azure icon sets into a local cache via `seeflow icons add <vendor>` or the in-app Browse Packs flow. Icon ids carry a vendor prefix (`aws:lambda`, `gcp:cloud-run`, `azure:functions`); unprefixed names continue to resolve against the bundled Lucide set. Azure requires explicit license acceptance.
- feat(icons): new CLI subcommands `seeflow icons list|add|update|remove`, documented under `seeflow help icons:*`.
- feat(api): new `/api/icons/*` routes — `GET /packs`, `GET /licenses/:vendor`, `POST /install`, `GET /jobs/:id/events` (SSE), `GET /:vendor/:name.svg`, `DELETE /packs/:vendor`. Install jobs serialize per vendor; a parallel install of the same vendor returns 409 with the in-flight `jobId`.
- feat(canvas): icon picker gains vendor tabs (Bundled · AWS · Azure · Logos · Emoji) and a Browse Packs panel/modal/toast that drives the install pipeline through the new `CanvasAdapter.icons` surface area.
