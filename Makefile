# SeeFlow — convenience wrapper over the bun commands documented in CLAUDE.md.
# `make help` (or just `make`) lists every target with its one-line description.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# `make register DIR=<path>` — DIR avoids clobbering the shell PATH env var.
DIR ?= .
ITERATIONS ?= 10
DOCKER_IMAGE ?= tuongaz/seeflow
DOCKER_TAG ?= dev
BUMP ?= patch
DRY_RUN ?= 0

CLI := bun run apps/studio/src/cli.ts

.PHONY: help install dev build typecheck lint format test test.it test.it.update-snapshots clean cli start stop register demo ralph ralph-clean sync-seeflow-schema verify-seeflow-schema-sync release release.local docker.build docker.run docker.buildx docker.push

SEEFLOW_SCHEMA_SRC := apps/studio/src/schema.ts
SEEFLOW_SCHEMA_DST := skills/seeflow/vendored/schema.ts

help: ## Show this target list
	@echo "SeeFlow — make targets"
	@echo ""
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z._-]+:.*## / {printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "Variables (override on the command line):"
	@echo "  DIR=<path>           path passed to 'make register' / 'make docker.run' (default: .)"
	@echo "  ITERATIONS=<n>       iterations passed to 'make ralph' (default: 10)"
	@echo "  DOCKER_IMAGE=<name>  image name for docker.* targets (default: tuongaz/seeflow)"
	@echo "  DOCKER_TAG=<tag>     image tag for docker.* targets (default: dev)"
	@echo "  BUMP=<level>         semver bump for 'make release.local' (patch, minor, major; default: patch)"
	@echo "  DRY_RUN=1            'make release.local' runs the gate only (no bump/tag/publish)"
	@echo ""
	@echo "Examples:"
	@echo "  make dev"
	@echo "  make register DIR=apps/studio/examples/order-pipeline"
	@echo "  make docker.run DIR=apps/studio/examples/order-pipeline"
	@echo "  make release.local BUMP=minor"

install: ## Install all workspace deps via bun
	bun install

dev: ## Run Vite (5173) + Hono studio (4321) in parallel
	bun run dev

build: ## Build the prod web bundle into apps/studio/dist/web/
	cd apps/web && bun run build

typecheck: ## tsc --noEmit across all workspaces
	bun run typecheck

lint: ## biome check
	bun run lint

format: ## biome format --write (run before lint)
	bun run format

test: ## bun test
	bun test

test.it: ## Run the integration tier (bun-test + Playwright e2e) via the orchestrator
	bun run test:it

test.it.update-snapshots: ## Regenerate Playwright visual baselines under apps/studio/e2e/
	bun run test:it:update-snapshots

cli: ## Run the seeflow CLI: make cli ARGS="<subcommand and flags>"
	$(CLI) $(ARGS)

start: ## Start the studio daemon (writes ~/.seeflow/seeflow.pid)
	$(CLI) start --daemon

stop: ## Stop the studio daemon (sends SIGTERM)
	$(CLI) stop

register: ## Register a demo: make register DIR=<path>
	$(CLI) register --path $(DIR)

demo: ## Quickstart: register the bundled order-pipeline example and open it in the browser
	@OUTPUT="$$($(CLI) register --path apps/studio/examples/order-pipeline)"; \
	echo "$$OUTPUT"; \
	URL="$$(echo "$$OUTPUT" | grep -oE 'http://[^ ]+' | head -1)"; \
	if [ -n "$$URL" ]; then \
	  case "$$(uname)" in \
	    Darwin) open "$$URL" ;; \
	    Linux)  xdg-open "$$URL" >/dev/null 2>&1 || true ;; \
	  esac; \
	fi

clean: ## Remove node_modules + apps/studio/dist (preserves ~/.seeflow)
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/studio/dist

ralph: ## Run ralph loop (default 10 iterations; override with ITERATIONS=N)
	./ralph/ralph.sh $(ITERATIONS)

ralph-clean: ## Clear ralph state: progress.txt, prd.json, .last-branch, archive/
	rm -f ralph/progress.txt ralph/prd.json ralph/.last-branch
	rm -rf ralph/archive

sync-seeflow-schema: ## Copy apps/studio/src/schema.ts into the seeflow plugin's vendored/
	@mkdir -p $(dir $(SEEFLOW_SCHEMA_DST))
	@cp $(SEEFLOW_SCHEMA_SRC) $(SEEFLOW_SCHEMA_DST)
	@echo "Synced $(SEEFLOW_SCHEMA_SRC) -> $(SEEFLOW_SCHEMA_DST)"

verify-seeflow-schema-sync: ## Fail if vendored schema has drifted from apps/studio/src/schema.ts
	@if [ ! -f $(SEEFLOW_SCHEMA_DST) ]; then \
		echo "ERROR: $(SEEFLOW_SCHEMA_DST) does not exist. Run: make sync-seeflow-schema" >&2; \
		exit 1; \
	fi
	@if ! diff -q $(SEEFLOW_SCHEMA_SRC) $(SEEFLOW_SCHEMA_DST) >/dev/null; then \
		echo "ERROR: vendored schema drifted from $(SEEFLOW_SCHEMA_SRC)." >&2; \
		echo "Run: make sync-seeflow-schema" >&2; \
		diff -u $(SEEFLOW_SCHEMA_SRC) $(SEEFLOW_SCHEMA_DST) || true; \
		exit 1; \
	fi
	@echo "OK: $(SEEFLOW_SCHEMA_DST) matches $(SEEFLOW_SCHEMA_SRC)"

docker.build: ## Build the local Docker image (DOCKER_IMAGE:DOCKER_TAG)
	docker build -t $(DOCKER_IMAGE):$(DOCKER_TAG) .

docker.run: ## Run the Docker image, mounting DIR as /workspace (port 4321)
	docker run --rm -it -p 4321:4321 -v $(abspath $(DIR)):/workspace $(DOCKER_IMAGE):$(DOCKER_TAG)

docker.buildx: ## Build multi-arch image (linux/amd64,linux/arm64) without pushing
	docker buildx build --platform linux/amd64,linux/arm64 -t $(DOCKER_IMAGE):$(DOCKER_TAG) .

docker.push: ## Build and push multi-arch image to the registry
	docker buildx build --platform linux/amd64,linux/arm64 -t $(DOCKER_IMAGE):$(DOCKER_TAG) --push .

release.local: ## Publish @tuongaz/seeflow to npm BY HAND when GitHub Actions is down (BUMP=patch|minor|major; DRY_RUN=1 to gate only)
	BUMP=$(BUMP) DRY_RUN=$(DRY_RUN) bash apps/studio/scripts/release-local.sh
