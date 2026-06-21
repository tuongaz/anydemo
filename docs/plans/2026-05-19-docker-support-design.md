# Docker Support — Design

**Date:** 2026-05-19
**Status:** Design approved, implementation not started
**Owner:** Tuong Le

## Goal

Distribute SeeFlow as a Docker image (`tuongaz/seeflow`) on Docker Hub, alongside the existing npm package. Users run `docker run … tuongaz/seeflow` instead of `npm install -g @tuongaz/seeflow`.

## Use case

Docker is an alternative distribution channel for end users running the studio locally. Users bind-mount a host directory containing a `.seeflow/seeflow.json` flow file, and the studio serves on `:4321`.

Out of scope: self-hosted multi-tenant deployments, dev/CI containers for contributors.

## Image layout

- **Name:** `tuongaz/seeflow`
- **Platforms:** `linux/amd64`, `linux/arm64`
- **Base:** `oven/bun:1.3-alpine`
- **Dockerfile:** repo root, two-stage build

### Stage 1 — `web-builder`

Installs workspace deps, copies source, runs `cd apps/web && bun run build` to produce `apps/studio/dist/web/`. Mirrors the npm `prepublishOnly` script so Docker and npm stay in lockstep.

### Stage 2 — `runtime`

Copies only what's needed at runtime:
- `apps/studio/src/` (TS executed by Bun)
- `apps/studio/dist/web/` (built SPA from stage 1)
- `apps/studio/package.json`, root `package.json`, `bun.lock`
- `packages/sdk/` (workspace dep)
- `node_modules` (or fresh `bun install --production` — whichever is smaller; decided at implementation time)

### Runtime env defaults

```
SEEFLOW_HOST=0.0.0.0
SEEFLOW_PORT=4321
SEEFLOW_WORKSPACE=/workspace
NODE_ENV=production
```

### Container shape

- `WORKDIR /app` for studio code
- `/workspace` is the bind-mount point (not declared as `VOLUME` — state is ephemeral)
- `EXPOSE 4321`
- `ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]`
- `CMD ["start"]`

### `.dockerignore`

Excludes `node_modules`, `dist`, `.git`, `.seeflow`, `.playwright-mcp`, `ralph/`, and other build/dev artifacts.

## Entrypoint & auto-register

`docker-entrypoint.sh` at repo root:

```sh
#!/bin/sh
set -e

WORKSPACE="${SEEFLOW_WORKSPACE:-/workspace}"
FLOW_FILE="${SEEFLOW_FLOW:-.seeflow/seeflow.json}"

# Pass-through for non-start commands
case "$1" in
  start|"")
    ;;
  *)
    exec bun /app/apps/studio/src/cli.ts "$@"
    ;;
esac

# Start studio in background, then register, then hand off
bun /app/apps/studio/src/cli.ts start --port "${SEEFLOW_PORT:-4321}" &
STUDIO_PID=$!

trap 'kill -TERM "$STUDIO_PID" 2>/dev/null; wait "$STUDIO_PID"' TERM INT

if [ -f "$WORKSPACE/$FLOW_FILE" ]; then
  for i in $(seq 1 50); do
    if wget -qO- "http://127.0.0.1:${SEEFLOW_PORT:-4321}/healthz" >/dev/null 2>&1; then
      bun /app/apps/studio/src/cli.ts register --path "$WORKSPACE" --flow "$FLOW_FILE" || true
      break
    fi
    sleep 0.2
  done
else
  echo "seeflow: no $FLOW_FILE under $WORKSPACE — serving studio without auto-registration"
fi

wait "$STUDIO_PID"
```

**Properties:**
- PID-1 hygiene via `trap` + `wait` so `docker stop` delivers SIGTERM cleanly.
- Silent no-op when no flow file is mounted — studio still serves.
- Escape hatch: `docker run tuongaz/seeflow register --path /other` or `… help` bypass auto-register.
- Re-uses existing `register --path` CLI — no studio code changes for auto-discovery.

**Open question for implementation:** does `/healthz` already exist? If not, add it OR fall back to polling `GET /`. Either way it's internal to the container.

## CI workflow

New file: `.github/workflows/docker.yml`. **Separate workflow** from `publish.yml` — if Docker Hub is down, npm still publishes.

**Trigger:** same `v*.*.*` tag as npm publish, so one tag releases both.

**Steps:**
1. Checkout
2. Verify tag matches `apps/studio/package.json` version (same check as `publish.yml`)
3. `docker/setup-qemu-action@v3`
4. `docker/setup-buildx-action@v3`
5. `docker/login-action@v3` (uses `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN` secrets)
6. `docker/metadata-action@v5` to compute tags
7. `docker/build-push-action@v6` — multi-arch, GHA cache

**Tag scheme** for `v0.1.16`:
- `tuongaz/seeflow:0.1.16` (immutable)
- `tuongaz/seeflow:0.1` (latest patch on minor line)
- `tuongaz/seeflow:latest`

**Secrets to add to the repo (one-time setup):**
- `DOCKERHUB_USERNAME = tuongaz`
- `DOCKERHUB_TOKEN` = Docker Hub access token (Account → Security → New Access Token, read/write/delete scope)

## Local dev — Makefile

Append to existing `Makefile`:

```make
DOCKER_IMAGE ?= tuongaz/seeflow
DOCKER_TAG   ?= dev

docker.build: ## Build local image (single-arch)
	docker build -t $(DOCKER_IMAGE):$(DOCKER_TAG) .

docker.run: ## Run studio with $(DIR) bind-mounted
	docker run --rm -it \
	  -p 4321:4321 \
	  -v $(abspath $(DIR)):/workspace \
	  $(DOCKER_IMAGE):$(DOCKER_TAG)

docker.buildx: ## Multi-arch local build (no push)
	docker buildx build --platform linux/amd64,linux/arm64 -t $(DOCKER_IMAGE):$(DOCKER_TAG) .

docker.push: ## Manual push (CI normally handles this on tag)
	docker buildx build --platform linux/amd64,linux/arm64 \
	  -t $(DOCKER_IMAGE):$(DOCKER_TAG) --push .
```

Re-uses the existing `DIR ?= .` so `make docker.run DIR=examples/todo-demo-target` mirrors `make register`.

## README

New "Run with Docker" section, slotted after the npm quickstart:

```bash
docker run --rm -it \
  -p 4321:4321 \
  -v $(pwd):/workspace \
  tuongaz/seeflow

# then open http://localhost:4321
```

Plus a brief note on `SEEFLOW_PORT`, `SEEFLOW_FLOW`, and the auto-register behaviour.

## Files added / touched

| File | Action |
|---|---|
| `Dockerfile` | new (repo root) |
| `.dockerignore` | new |
| `docker-entrypoint.sh` | new |
| `.github/workflows/docker.yml` | new |
| `Makefile` | edit — add 4 targets, extend `.PHONY` |
| `README.md` | edit — add Docker section |

## Explicitly out of scope (YAGNI)

- **docker-compose** — single container, no companions needed
- **Distroless / scratch** — Alpine is small enough
- **HEALTHCHECK** directive — orchestrators that need it add their own
- **Non-root user** — adds friction with bind-mount UIDs on Linux; revisit if self-hosted shared studio becomes a goal
- **Adding `/healthz`** unless it's genuinely missing — verify first, add only if needed

## Decisions log

| Decision | Choice | Reason |
|---|---|---|
| Use case | End-user distribution | Alternative to `npm install -g`, not for deployment or CI |
| Demo input | Bind-mount host directory | Matches existing `register --path` UX |
| State dir | Ephemeral inside container | No volume needed; rebuild from bind-mount each run |
| Auto-register | On entrypoint when flow file present | Single-command UX |
| Platforms | amd64 + arm64 | Apple Silicon users common; emulation is slow |
| CI trigger | `v*.*.*` git tag | Lockstep with npm release |
| Image name | `tuongaz/seeflow` | Matches npm owner |
| CI structure | Separate workflow from `publish.yml` | Docker outage shouldn't block npm |
