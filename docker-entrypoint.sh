#!/bin/sh
set -e

# Env defaults — keep in sync with the Dockerfile's ENV block.
SEEFLOW_WORKSPACE="${SEEFLOW_WORKSPACE:-/workspace}"
SEEFLOW_FLOW="${SEEFLOW_FLOW:-flow.json}"
SEEFLOW_PORT="${SEEFLOW_PORT:-4321}"
# The studio binds loopback by default (see DEFAULT_CONFIG in
# apps/studio/src/runtime.ts). A container that only listened on 127.0.0.1
# would be unreachable through `-p 4321:4321`, so pass the wildcard explicitly.
SEEFLOW_HOST="${SEEFLOW_HOST:-0.0.0.0}"

# Escape hatch: any non-`start` first arg runs as a one-shot CLI call.
# e.g. `docker run image register --path /other`, `docker run image help`.
case "${1:-start}" in
  start)
    ;;
  *)
    exec bun /app/apps/studio/src/cli.ts "$@"
    ;;
esac

# Start the studio attached (--foreground). `start` defaults to spawning a
# DETACHED daemon and returning — fatal in a container, where PID 1 exiting stops
# the container (and kills the daemon with it). `--foreground` keeps the studio as
# this script's child so the `wait` below holds the container open.
bun /app/apps/studio/src/cli.ts start --port "$SEEFLOW_PORT" --host "$SEEFLOW_HOST" --foreground &
STUDIO_PID=$!

# PID-1 hygiene: forward SIGTERM/SIGINT to the studio so `docker stop` is clean.
trap 'kill -TERM "$STUDIO_PID" 2>/dev/null; wait "$STUDIO_PID"' TERM INT

# Auto-register the bind-mounted workspace when it looks like a SeeFlow project.
# Manifest projects carry `seeflow.json` at the root (the flows themselves live
# under `flows/<id>/flow.json`); pre-manifest projects carry a bare flow file,
# whose name SEEFLOW_FLOW overrides. `register` picks the right path itself.
if [ -f "${SEEFLOW_WORKSPACE}/seeflow.json" ] || [ -f "${SEEFLOW_WORKSPACE}/${SEEFLOW_FLOW}" ]; then
  i=1
  while [ "$i" -le 50 ]; do
    if wget -qO- "http://127.0.0.1:${SEEFLOW_PORT}/healthz" >/dev/null 2>&1; then
      bun /app/apps/studio/src/cli.ts register \
        --path "$SEEFLOW_WORKSPACE" \
        --flow "$SEEFLOW_FLOW" || true
      break
    fi
    sleep 0.2
    i=$((i + 1))
  done
else
  echo "seeflow: no seeflow.json or ${SEEFLOW_FLOW} at ${SEEFLOW_WORKSPACE} — serving studio without auto-registration"
fi

# Stay attached so PID 1 reflects the studio's exit code on shutdown.
wait "$STUDIO_PID"
