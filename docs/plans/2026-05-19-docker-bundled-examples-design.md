# Docker image: bundle seed examples

## Problem

A fresh `docker run --rm -it -p 4321:4321 tuongaz/seeflow` boots into an empty
studio. The bundled `order-pipeline` and `ecommerce-platform` examples — which
local installs (`seeflow start`, `npx tuongaz/seeflow start`) seed automatically
on first launch — never make it into the image.

The local seeding pipeline already does the right thing: on every `start`,
`seedExamples()` in `apps/studio/src/cli.ts` copies each bundled example out of
`apps/studio/examples/<name>/` into `seeflowHome()` (which resolves to
`/workspace/.seeflow/<name>/` inside Docker via `SEEFLOW_WORKSPACE=/workspace`)
and registers the flow with the in-memory registry.

The pipeline silently no-ops inside Docker because of two unrelated build
omissions.

## Root cause

1. **`.dockerignore`** excludes `**/.seeflow`. The rule was added to keep a
   developer's local workspace state (`.seeflow/registry.json`, snapshots) out
   of the build context, but it also matches the bundled example flow files at
   `apps/studio/examples/<name>/.seeflow/seeflow.json`. The builder stage never
   sees them.

2. **`Dockerfile` runtime stage** copies `apps/studio/{src,dist/web,bin,package.json}`
   but not `apps/studio/examples/`. Even if (1) were fixed, the runtime image
   has no source for `seedExamples()` to read; `seedExample()` early-returns at
   the `existsSync(srcDir)` check with no warning.

Net effect: the studio starts cleanly, `seedExamples()` runs as a silent no-op,
and the user sees an empty canvas plus the entrypoint's "no flow file at
/workspace/.seeflow/seeflow.json — serving studio without auto-registration"
log line.

## Fix

Two surgical changes. The seeding code itself is untouched.

### `.dockerignore`

Narrow the `.seeflow` exclusion so bundled examples are re-included:

```diff
 # Per-workspace registry/snapshots; the runtime mounts a real /workspace at run time.
 .seeflow
 **/.seeflow
+!apps/studio/examples/**/.seeflow
```

The negation pattern preserves the original intent (developer's local state and
any nested `.seeflow/` in user-mounted folders stay out) while allowing the
bundled examples through.

### `Dockerfile`

Add one COPY in the runtime stage so `seedExamples()` has its source tree:

```diff
 COPY --from=web-builder /src/apps/studio/src ./apps/studio/src
 COPY --from=web-builder /src/apps/studio/dist/web ./apps/studio/dist/web
 COPY --from=web-builder /src/apps/studio/bin ./apps/studio/bin
+COPY --from=web-builder /src/apps/studio/examples ./apps/studio/examples
 COPY --from=web-builder /src/apps/studio/package.json ./apps/studio/package.json
```

Placed adjacent to the other `apps/studio/*` copies so it's obvious why it's
there. The examples directory is small (~10 KB across both examples; no
`node_modules` — the per-example `package.json` is private with zero deps).

## Why not other approaches

- **Bake the seeded workspace into the image at `/workspace/.seeflow/`.** A
  user running `-v $(pwd):/workspace` would shadow the baked content with their
  bind mount, hiding the demo exactly when first-time-Docker users would also
  be exploring it. Run-time seeding is the only approach that works with both
  empty and mounted workspaces.
- **Ship only `order-pipeline`.** Diverges from local install behavior for no
  benefit. The `.dockerignore` re-include and Dockerfile COPY are simpler when
  they cover the whole `examples/` tree.
- **Document a manual `docker run image register ...` step.** Adds friction for
  the exact "try it without installing anything" use case the Docker image
  exists to serve.

## Behavior after the fix

- `docker run --rm -it -p 4321:4321 tuongaz/seeflow` — studio boots with
  `Order Pipeline` and `E-Commerce Platform` registered. **Play** on
  `POST /orders` works end-to-end.
- `docker run --rm -it -p 4321:4321 -v $(pwd):/workspace tuongaz/seeflow` — the
  same two examples seed into `$(pwd)/.seeflow/order-pipeline/` and
  `$(pwd)/.seeflow/ecommerce-platform/`. Any flow at
  `$(pwd)/.seeflow/seeflow.json` is still auto-registered by the entrypoint as
  before.
- Re-running with the same mounted workspace re-syncs the examples (existing
  `cpSync(..., { recursive: true })` is unconditional by design — schema
  updates always reach existing workspaces). Registry de-dup is unchanged: the
  `getByRepoPathAndDemoPath` check skips re-registration if already present.

## Verification

Manual smoke test, run before merge:

```bash
docker build -t seeflow:test .
docker run --rm -d --name seeflow-smoke -p 4321:4321 seeflow:test
sleep 2
curl -s http://localhost:4321/api/demos | jq '.[].name'
# expect: "Order Pipeline" and "E-Commerce Platform"
docker stop seeflow-smoke
```

No new unit tests — the change is purely in build configuration and the
seeding code path is already covered by `cli.test.ts`.

## Files touched

- `.dockerignore` — one added negation line.
- `Dockerfile` — one added `COPY` line in the runtime stage.
