#!/bin/sh
set -e

# Env defaults — keep in sync with the Dockerfile's ENV block.
SEEFLOW_WORKSPACE="${SEEFLOW_WORKSPACE:-/workspace}"
SEEFLOW_FLOW="${SEEFLOW_FLOW:-.seeflow/flow.json}"
SEEFLOW_PORT="${SEEFLOW_PORT:-4321}"

# Escape hatch: any non-`start` first arg runs as a one-shot CLI call.
# e.g. `docker run image register --path /other`, `docker run image help`.
case "${1:-start}" in
  start)
    ;;
  *)
    exec bun /app/apps/studio/src/cli.ts "$@"
    ;;
esac

# Start the studio in the background; pin its PID for signal forwarding.
bun /app/apps/studio/src/cli.ts start --port "$SEEFLOW_PORT" &
STUDIO_PID=$!

# PID-1 hygiene: forward SIGTERM/SIGINT to the studio so `docker stop` is clean.
trap 'kill -TERM "$STUDIO_PID" 2>/dev/null; wait "$STUDIO_PID"' TERM INT

# Auto-register the bind-mounted workspace if it contains a flow file.
if [ -f "${SEEFLOW_WORKSPACE}/${SEEFLOW_FLOW}" ]; then
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
  echo "seeflow: no flow file at ${SEEFLOW_WORKSPACE}/${SEEFLOW_FLOW} — serving studio without auto-registration"
fi

# Stay attached so PID 1 reflects the studio's exit code on shutdown.
wait "$STUDIO_PID"
