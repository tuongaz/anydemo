# Changelog

## Unreleased

- feat(icons): cloud icon packs — install AWS, GCP, and Azure icon sets into a local cache via `seeflow icons add <vendor>` or the in-app Browse Packs flow. Icon ids carry a vendor prefix (`aws:lambda`, `gcp:cloud-run`, `azure:functions`); unprefixed names continue to resolve against the bundled Lucide set. Azure requires explicit license acceptance.
- feat(icons): new CLI subcommands `seeflow icons list|add|update|remove`, documented under `seeflow help icons:*`.
- feat(api): new `/api/icons/*` routes — `GET /packs`, `GET /licenses/:vendor`, `POST /install`, `GET /jobs/:id/events` (SSE), `GET /:vendor/:name.svg`, `DELETE /packs/:vendor`. Install jobs serialize per vendor; a parallel install of the same vendor returns 409 with the in-flight `jobId`.
- feat(canvas): icon picker gains vendor tabs (Bundled · AWS · GCP · Azure · Logos) and a Browse Packs panel/modal/toast that drives the install pipeline through the new `CanvasAdapter.icons` surface area.
