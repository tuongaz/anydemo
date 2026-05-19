# syntax=docker/dockerfile:1.7

# ---- Stage 1: build the SPA bundle ----
FROM oven/bun:1.3-alpine AS web-builder

WORKDIR /src

# Copy lockfile + every workspace manifest first so dep install is cacheable
# independently of source changes. `bun install --frozen-lockfile` needs every
# workspace's package.json present (per `workspaces: ["apps/*", "packages/*"]`
# in the root package.json) to resolve the workspace graph from the lockfile.
COPY package.json bun.lock ./
COPY apps/studio/package.json apps/studio/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/canvas/package.json packages/canvas/package.json
COPY packages/sdk/package.json packages/sdk/package.json

RUN bun install --frozen-lockfile

# Pull in the remaining source. `.dockerignore` strips dist/, node_modules,
# .git, ralph/, docs/, etc. so this is roughly the 27 MB context measured in
# US-012 minus the workspace manifests already copied above.
COPY . .

# Build the SPA into apps/studio/dist/web (vite outDir is "../studio/dist/web").
RUN cd apps/web && bun run build

# Fail fast if the build didn't produce the expected entrypoint; the runtime
# stage `COPY --from` would silently produce an empty dir otherwise.
RUN test -f apps/studio/dist/web/index.html

# ---- Stage 2: runtime ----
FROM oven/bun:1.3-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    SEEFLOW_HOST=0.0.0.0 \
    SEEFLOW_PORT=4321 \
    SEEFLOW_WORKSPACE=/workspace

# Copy only what the studio needs at runtime. Workspace packages live next to
# the studio so bun's workspace resolver can still find them; the hoisted
# node_modules tree carries the third-party deps and the workspace symlinks.
COPY --from=web-builder /src/apps/studio/src ./apps/studio/src
COPY --from=web-builder /src/apps/studio/dist/web ./apps/studio/dist/web
COPY --from=web-builder /src/apps/studio/bin ./apps/studio/bin
COPY --from=web-builder /src/apps/studio/examples ./apps/studio/examples
COPY --from=web-builder /src/apps/studio/package.json ./apps/studio/package.json
COPY --from=web-builder /src/packages ./packages
COPY --from=web-builder /src/package.json ./package.json
COPY --from=web-builder /src/bun.lock ./bun.lock
COPY --from=web-builder /src/node_modules ./node_modules

# Entrypoint: PID-1-clean studio launcher with auto-register on /workspace.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Bind-mount target — exists even when the user runs without `-v`.
RUN mkdir -p /workspace

EXPOSE 4321

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["start"]
