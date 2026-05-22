# SeeFlow — convenience wrapper over the bun commands documented in CLAUDE.md.
# `make help` (or just `make`) lists every target with its one-line description.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# `make register DIR=<path>` — DIR avoids clobbering the shell PATH env var.
DIR ?= .
ITERATIONS ?= 10
DOCKER_IMAGE ?= tuongaz/seeflow
DOCKER_TAG ?= dev

CLI := bun run apps/studio/src/cli.ts

.PHONY: help install dev build typecheck lint format test test.it test.it.update-snapshots clean cli start stop register demo example-order-pipeline ralph ralph-clean sync-seeflow-schema verify-seeflow-schema-sync smoke-seeflow release deploy gh.deploy docker.build docker.run docker.buildx docker.push

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
	@echo ""
	@echo "Examples:"
	@echo "  make dev"
	@echo "  make register DIR=examples/todo-demo-target"
	@echo "  make docker.run DIR=examples/todo-demo-target"

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

demo: ## Quickstart: start studio, register the bundled todo example, open in browser
	@OUTPUT="$$($(CLI) register --path examples/todo-demo-target)"; \
	echo "$$OUTPUT"; \
	URL="$$(echo "$$OUTPUT" | grep -oE 'http://[^ ]+' | head -1)"; \
	if [ -n "$$URL" ]; then \
	  case "$$(uname)" in \
	    Darwin) open "$$URL" ;; \
	    Linux)  xdg-open "$$URL" >/dev/null 2>&1 || true ;; \
	  esac; \
	fi

example-order-pipeline: ## Run the order-pipeline example app (port 3040)
	cd examples/order-pipeline && bun start

clean: ## Remove node_modules + apps/studio/dist (preserves ~/.seeflow and examples/*/sdk)
	rm -rf node_modules apps/*/node_modules packages/*/node_modules examples/*/node_modules
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

smoke-seeflow: ## End-to-end smoke: registers TWO demos in one repo via plugin scripts (studio must be running)
	@bun run skills/seeflow/scripts/smoke.ts

docker.build: ## Build the local Docker image (DOCKER_IMAGE:DOCKER_TAG)
	docker build -t $(DOCKER_IMAGE):$(DOCKER_TAG) .

docker.run: ## Run the Docker image, mounting DIR as /workspace (port 4321)
	docker run --rm -it -p 4321:4321 -v $(abspath $(DIR)):/workspace $(DOCKER_IMAGE):$(DOCKER_TAG)

docker.buildx: ## Build multi-arch image (linux/amd64,linux/arm64) without pushing
	docker buildx build --platform linux/amd64,linux/arm64 -t $(DOCKER_IMAGE):$(DOCKER_TAG) .

docker.push: ## Build and push multi-arch image to the registry
	docker buildx build --platform linux/amd64,linux/arm64 -t $(DOCKER_IMAGE):$(DOCKER_TAG) --push .

deploy: gh.deploy ## Alias for gh.deploy

gh.deploy: ## Bump patch version, commit+tag (triggers npm publish), then deploy viewer to S3
	@PKG=apps/studio/package.json; \
	OLD=$$(bun -e "console.log(require('./$$PKG').version)"); \
	NEW=$$(echo "$$OLD" | awk -F. '{print $$1"."$$2"."$$3+1}'); \
	echo "Bumping $$OLD -> $$NEW"; \
	bun -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('./$$PKG'));p.version='$$NEW';fs.writeFileSync('./$$PKG',JSON.stringify(p,null,'\t')+'\n')"; \
	bun run format; \
	git add apps/studio/package.json; \
	git commit -m "chore: bump version to $$NEW"; \
	git push; \
	git tag v$$NEW; \
	git push origin v$$NEW; \
	gh workflow run deploy.yml --repo tuongaz/seeflow-viewer; \
	echo "Tag v$$NEW pushed — npm publish running at: https://github.com/tuongaz/seeflow/actions/workflows/publish.yml"; \
	echo "Viewer deploy running at: https://github.com/tuongaz/seeflow-viewer/actions/workflows/deploy.yml"
