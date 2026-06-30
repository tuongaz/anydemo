#!/usr/bin/env bash
# Local twin of release.yml's npm path — publish @tuongaz/seeflow to npm BY HAND
# when GitHub Actions is unavailable (e.g. over quota). Reproduces the
# prepare-release + tests + publish-npm jobs locally; it does NOT cover the
# Docker Hub push or the seeflow-cloud lockstep deploy (run `make docker.push`
# and seeflow-cloud's `make deploy.local` separately).
#
#   Usage:  make release.local [BUMP=patch|minor|major]   (default: patch)
#           make release.local DRY_RUN=1                   (gate only, no publish)
#
# Flow (mirrors release.yml's workflow_dispatch path):
#   1. preflight — clean tree + valid npm auth
#   2. bump apps/studio/package.json, `bun run format`
#   3. gate — canvas build + typecheck + lint + unit tests
#   4. commit `chore: bump version to X` + tag vX  (LOCAL only)
#   5. npm publish (PTY-wrapped for web 2FA, NO --provenance)
#   6. verify the new version is live on npm
#   7. push commit + tag to origin
#
# Hard-won gotchas baked in (see the local-release-deploy-gotchas memory):
#   - `--provenance` is dropped: it needs CI OIDC and fails locally.
#   - npm 2FA is web-auth and bails to EOTP in a non-TTY shell, so publish runs
#     under a pseudo-TTY via BSD `script`; a watcher opens the auth URL for you.
#   - `prepack-publish.mjs` strips @seeflow/canvas from package.json and leaves
#     it stripped; `prepublishOnly` regenerates the tracked tailwind runtime.
#     We restore BOTH on exit so the tree matches the bump commit.
#   - A stale token makes `npm whoami` return 401 and publish fail with a
#     confusing E404, so we verify auth up front with an actionable message.

set -euo pipefail

BUMP="${BUMP:-patch}"
DRY_RUN="${DRY_RUN:-0}"
case "$BUMP" in
  patch | minor | major) ;;
  *)
    echo "ERROR: BUMP must be patch, minor, or major (got '$BUMP')" >&2
    exit 1
    ;;
esac

# Resolve the repo root from this script's location so cwd doesn't matter.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
STUDIO_DIR="$REPO_ROOT/apps/studio"
PKG="$STUDIO_DIR/package.json"
cd "$REPO_ROOT"

log() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }

# prepack strips @seeflow/canvas from package.json (and leaves it stripped);
# prepublishOnly rewrites the tracked tailwind runtime. Both must be restored to
# the committed state. Idempotent — safe to call explicitly and from the trap.
restore_tree() {
  git -C "$REPO_ROOT" checkout -- \
    apps/studio/package.json \
    apps/studio/public/runtime/tailwind.js 2>/dev/null || true
}

# --- Preflight ---------------------------------------------------------------
log "Preflight"

# A clean tree is assumed by both the bump commit and the post-publish restore.
# (README.md, dist/web, and the vendored catalog are gitignored, so a normal
# publish leaves nothing untracked behind.)
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is dirty. Commit or stash first:" >&2
  git status --short >&2
  exit 1
fi

# A stale token returns 401 here and makes publish fail later with a misleading
# E404 ("you do not have permission"). Catch it now.
if ! whoami_out="$(npm whoami 2>&1)"; then
  echo "ERROR: 'npm whoami' failed — your npm token is likely stale/expired:" >&2
  echo "  $whoami_out" >&2
  echo "Fix: web-login under a PTY, approve in the browser, then re-run:" >&2
  echo "  script -q /tmp/npm-login.log npm login --auth-type=web" >&2
  exit 1
fi
echo "npm user:  $whoami_out"
echo "bump:      $BUMP"
[ "$DRY_RUN" = "1" ] && echo "DRY_RUN:    gate only, will NOT bump/tag/publish"

# --- Bump --------------------------------------------------------------------
OLD="$(node -p "require('$PKG').version")"
NEW="$(node -e "
  const [a,b,c] = process.argv[1].split('.').map(Number);
  const t = process.argv[2];
  const v = t === 'major' ? [a + 1, 0, 0] : t === 'minor' ? [a, b + 1, 0] : [a, b, c + 1];
  console.log(v.join('.'));
" "$OLD" "$BUMP")"
TAG="v$NEW"

log "Release $OLD -> $NEW  (tag $TAG)"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "ERROR: tag $TAG already exists. Delete it or pick a different BUMP." >&2
  exit 1
fi
if [ "$(npm view "@tuongaz/seeflow@$NEW" version 2>/dev/null | tail -n1)" = "$NEW" ]; then
  echo "ERROR: @tuongaz/seeflow@$NEW is already published to npm." >&2
  exit 1
fi

if [ "$DRY_RUN" != "1" ]; then
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('$PKG'));
    p.version = process.argv[1];
    fs.writeFileSync('$PKG', JSON.stringify(p, null, '\t') + '\n');
  " "$NEW"
  bun run format
fi

# --- Gate (the tests job, minus the Docker-bound e2e/visual tier) ------------
# Matches the documented hand-release gate. Run `make test.it` for the full
# integration + Playwright tier if you want it before releasing.
log "Build @seeflow/canvas (studio typecheck resolves its dist/*.d.ts)"
bun run --filter @seeflow/canvas build

log "typecheck"
bun run typecheck
log "lint"
bun run lint
log "unit tests"
bun test

if [ "$DRY_RUN" = "1" ]; then
  restore_tree
  log "DRY_RUN complete — gate passed for $NEW. Nothing published."
  exit 0
fi

# --- Commit + tag (LOCAL; pushed only after a successful publish) -------------
log "Commit + tag (local)"
git add apps/studio/package.json apps/studio/public/runtime/tailwind.js
git commit -m "chore: bump version to $NEW"
git tag "$TAG"

# From here on, always restore the tree; warn loudly if we bail before pushing.
PUSHED=0
cleanup() {
  restore_tree
  if [ "$PUSHED" -eq 0 ]; then
    echo "" >&2
    echo "NOTE: the bump commit + tag $TAG exist LOCALLY but were NOT pushed." >&2
    echo "  - retry:  re-run 'make release.local' (the tag/version guard will stop you" >&2
    echo "            if $NEW already published — delete the local tag first)" >&2
    echo "  - undo:   git tag -d $TAG && git reset --hard HEAD~1" >&2
  fi
}
trap cleanup EXIT

# --- Publish -----------------------------------------------------------------
log "npm publish (PTY for web 2FA; no provenance)"
PUB_LOG="$(mktemp -t seeflow-publish.XXXXXX)"

# Background watcher: npm prints the web-auth URL to the transcript; open it so
# you can approve. Publish output still streams live to this terminal.
(
  for _ in $(seq 1 180); do
    u="$(grep -oE 'https://www\.npmjs\.com/[A-Za-z0-9/_?=&%.-]+' "$PUB_LOG" 2>/dev/null | head -n1 || true)"
    if [ -n "$u" ]; then
      echo ">>> Approve the publish in your browser: $u"
      case "$(uname)" in
        Darwin) open "$u" >/dev/null 2>&1 || true ;;
        *) xdg-open "$u" >/dev/null 2>&1 || true ;;
      esac
      break
    fi
    sleep 1
  done
) &
WATCHER=$!

# BSD `script` (macOS): `script -q <logfile> <command...>`. It allocates the PTY
# npm's web-auth needs and tees the session to both this terminal and $PUB_LOG.
set +e
(cd "$STUDIO_DIR" && script -q "$PUB_LOG" npm publish --access public)
set -e
kill "$WATCHER" 2>/dev/null || true
restore_tree

# `script`'s exit status doesn't reliably reflect npm's, so decide from the
# transcript + the registry (authoritative).
if grep -qiE 'npm (error|ERR!)' "$PUB_LOG" && ! grep -q "+ @tuongaz/seeflow@$NEW" "$PUB_LOG"; then
  echo "ERROR: npm publish reported an error. Transcript:" >&2
  cat "$PUB_LOG" >&2
  exit 1
fi

# --- Verify ------------------------------------------------------------------
log "Verify @tuongaz/seeflow@$NEW is live on npm"
SEEN=""
for attempt in $(seq 1 12); do
  SEEN="$(npm view "@tuongaz/seeflow@$NEW" version 2>/dev/null | tail -n1 || true)"
  [ "$SEEN" = "$NEW" ] && break
  echo "registry hasn't served $NEW yet (attempt $attempt/12); sleeping 15s"
  sleep 15
done
if [ "$SEEN" != "$NEW" ]; then
  echo "ERROR: $NEW never appeared on npm after publish. Transcript:" >&2
  cat "$PUB_LOG" >&2
  exit 1
fi
echo "npm serves @tuongaz/seeflow@$NEW"

# --- Push --------------------------------------------------------------------
log "Push commit + tag to origin"
git push origin HEAD
git push origin "$TAG"
PUSHED=1

log "Released @tuongaz/seeflow@$NEW  ->  https://www.npmjs.com/package/@tuongaz/seeflow"
echo ""
echo "Not done by this target (run separately if you want them):"
echo "  - Docker Hub image:  make docker.push DOCKER_TAG=$NEW   (and DOCKER_TAG=latest)"
echo "  - cloud.seeflow.dev: bump @tuongaz/seeflow to ^$NEW + SEEFLOW_REF=$TAG in"
echo "                       seeflow-cloud, then its 'make deploy.local'"
