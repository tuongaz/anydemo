# SeeFlow is localhost-only

Status: accepted (2026-08-25)

The hosted layer at `cloud.seeflow.dev` was retired on 2026-08-03 — its AWS stacks, buckets, auth pool and distributions were deleted, and `seeflow-cloud` is kept as a source archive only. The open-source repo, however, still shipped the client half of that layer: a publish command, a login flow, an export dialog, an embed dialog, a multi-tenant hook in the server factory, and a schema field reserved for a runtime that no longer exists. All of it pointed at a domain that no longer resolves.

We have decided the product this leaves behind is the whole product: **SeeFlow is a localhost tool**. One studio, one machine, files in your repo. This PR removes every cloud code path from the OSS repo rather than leaving it dormant behind a feature flag, because dead code that "still compiles" is what let stale claims survive the last pivot ([0001](./0001-pivot-to-ai-human-bridge.md)).

## Decision

- **Nothing in this repo talks to a network service it does not own.** The studio binds loopback (`127.0.0.1`) by default — exposing it on a network is an explicit `seeflow start --host <addr>` opt-out, which is what the Docker image passes. The CLI, the MCP server, and the canvas have no remote endpoint left to call.
- The publish/share/embed surface is deleted outright — CLI commands, HTTP routes, canvas exports, and UI — not deprecated, not stubbed.
- **Export** now means one thing: downloading a flow as a PNG or PDF from the canvas. `CONTEXT.md` carries that definition; `docs/FEATURES.md` is written against it.

## Consequences

- **`handlerModule` is dropped from the node schema — breaking.** A `flow.json` that still declares it no longer validates. It was reserved for a skills runtime that the execution-layer removal ([0001](./0001-pivot-to-ai-human-bridge.md)) already made moot, and `docs/FEATURES.md` had it listed as "not a feature". Anyone carrying one deletes the field.
- **The canvas collapses to edit-only.** The read-only and thumbnail render paths existed for the hosted viewer and dashboard; with no viewer there is one mode. `@seeflow/canvas` loses `EmbedDialog`, `ShareMenuMode`, `NodeCapabilities`, `resolveFileSrc`, the `onExportToCloud` / `onShareWithMembers` / `enableEmbed` props, `openEmbedDialog()`, and `capturePreview()`. Download PDF/PNG stays.
- **Credentials on disk are orphaned, not migrated.** `~/.seeflow/credentials.json` (or `$XDG_CONFIG_HOME/seeflow/credentials.json`) and any `<project>/.seeflow/cloud.json` are never read or written again. SeeFlow does not delete them for you — remove them by hand.
- **No release lockstep.** Publishing to npm no longer triggers a downstream deploy; `release.yml` ends at npm + Docker Hub.
- **`docs/FEATURES.md` lost its appendices.** Appendix A and Appendix B went with the cloud sections, so [0001](./0001-pivot-to-ai-human-bridge.md)'s pointer at "`FEATURES.md` Appendix B tracks the scrub" now resolves to nothing. That is intended: the scrub it tracked is complete. `skills/seeflow/test/contract.test.ts` is the standing guard against the removed tokens coming back.
- **`docs/plans/` is untracked.** The 100-plus design documents stay on disk and out of git — they described a two-repo product and were the largest remaining source of contradictory guidance for agents reading the repo. Reach for `git history` if you need one back.

## Considered options

- **Keep the cloud client behind a flag, in case the service returns.** Rejected: the service is deleted, not paused; a flag would preserve the exact stale-claim surface 0001 was written to stop, and re-adding a publish path later is cheaper than carrying a broken one.
- **Keep `handlerModule` as an inert schema field.** Rejected: `FEATURES.md` already had to carry an appendix explaining that it was not a feature. A documented lie in the schema costs more than one breaking change on a pre-1.0 package.
- **Point the export flow at a self-hosted deployment instead.** Rejected: nobody runs one, the server half is archived and unmaintained, and the claim would outrun the code — the same failure 0001 catalogued.
