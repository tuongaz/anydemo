# Changelog

## 0.7.0

SeeFlow is now a purely localhost tool. The hosted layer at `cloud.seeflow.dev` was retired on 2026-08-03, and everything that talked to it has been deleted from this package rather than left dangling.

### Removed

- **BREAKING — schema:** the node field `handlerModule` is gone. A flow that still declares it no longer validates; delete the field from `flow.json` before upgrading.
- **CLI:** the `export`, `login`, `logout`, and `whoami` commands, the `--endpoint` and `--dry-run` flags they carried, and the `SEEFLOW_CLOUD_URL` environment variable.
- **HTTP:** `GET /api/config`, `POST /api/flows/validate`, `POST /api/diagram/propose-scope`, and `POST /api/diagram/assemble`.
- **Embedding API:** the `createApp({ getTenantId })` multi-tenant hook. `createApp` no longer takes a tenant resolver — the studio serves exactly one local registry.
- **UI:** Export to seeflow.dev, Share with people, and the Embed dialog. Downloading a flow as PNG or PDF is unaffected and stays.

### Obsolete on-disk state

Nothing reads or writes these any more, and SeeFlow will never recreate them. Delete them by hand at your convenience:

- `~/.seeflow/credentials.json` (or `$XDG_CONFIG_HOME/seeflow/credentials.json`) — cloud session tokens.
- `<project>/.seeflow/cloud.json` — the per-project link to a published cloud project.

### Added

- feat(icons): cloud icon packs — install AWS, GCP, and Azure icon sets into a local cache via `seeflow icons add <vendor>` or the in-app Browse Packs flow. Icon ids carry a vendor prefix (`aws:lambda`, `gcp:cloud-run`, `azure:functions`); unprefixed names continue to resolve against the bundled Lucide set. Azure requires explicit license acceptance.
- feat(icons): new CLI subcommands `seeflow icons list|add|update|remove`, documented under `seeflow help icons:*`.
- feat(api): new `/api/icons/*` routes — `GET /packs`, `GET /licenses/:vendor`, `POST /install`, `GET /jobs/:id/events` (SSE), `GET /:vendor/:name.svg`, `DELETE /packs/:vendor`. Install jobs serialize per vendor; a parallel install of the same vendor returns 409 with the in-flight `jobId`.
- feat(canvas): icon picker gains vendor tabs (Bundled · AWS · GCP · Azure · Logos) and a Browse Packs panel/modal/toast that drives the install pipeline through the new `CanvasAdapter.icons` surface area.
