#!/usr/bin/env bash
# SeeFlow SessionEnd hook.
#
# Reads ~/.seeflow/consent.json. If feedback is enabled and modes includes
# "transfer", scans ~/.seeflow/feedback.md for blocks with status: pending,
# POSTs them as a batched envelope to https://seeflow.dev/api/feedback, and
# on 2xx flips those blocks' status to "sent" in place. Silent on any
# failure (missing files, disabled consent, no entries, network error,
# non-2xx response) — never blocks the session close.

set -u

CONSENT="$HOME/.seeflow/consent.json"
FEEDBACK="$HOME/.seeflow/feedback.md"
ENDPOINT="${SEEFLOW_FEEDBACK_ENDPOINT:-https://seeflow.dev/api/feedback}"

[ -r "$CONSENT" ]  || exit 0
[ -r "$FEEDBACK" ] || exit 0

command -v python3 >/dev/null 2>&1 || exit 0
command -v curl    >/dev/null 2>&1 || exit 0

# 1. Gate: enabled + transfer mode + anonymousId present.
anonymous_id=$(python3 - "$CONSENT" <<'PY' 2>/dev/null
import json, sys
try:
    with open(sys.argv[1]) as f:
        c = json.load(f)
    fb = c.get("feedback") or {}
    if not fb.get("enabled"):
        sys.exit(1)
    if "transfer" not in (fb.get("modes") or []):
        sys.exit(1)
    aid = fb.get("anonymousId")
    if not aid:
        sys.exit(1)
    print(aid)
except Exception:
    sys.exit(1)
PY
) || exit 0

# 2. Parse pending blocks, build envelope + flipped feedback.md.
TMPDIR=$(mktemp -d -t seeflow-feedback.XXXXXX) || exit 0
trap 'rm -rf "$TMPDIR"' EXIT

ENVELOPE="$TMPDIR/envelope.json"
NEW_FEEDBACK="$TMPDIR/feedback.md"

python3 - "$FEEDBACK" "$anonymous_id" "$ENVELOPE" "$NEW_FEEDBACK" <<'PY' 2>/dev/null
import json, sys, re, datetime, pathlib

src, aid, env_path, new_path = sys.argv[1:5]
text = pathlib.Path(src).read_text(encoding="utf-8")

blocks = []
current = None
seen_separator = False

for line in text.splitlines():
    if line.strip() == "---":
        if current is not None:
            blocks.append(current)
        current = {}
        seen_separator = True
        continue
    if not seen_separator:
        continue
    m = re.match(r"^([a-zA-Z]+):\s*(.*)$", line)
    if m:
        current[m.group(1)] = m.group(2).rstrip()

if current is not None:
    blocks.append(current)

pending = [b for b in blocks if b.get("status") == "pending"]
if not pending:
    sys.exit(2)

entries = [{k: v for k, v in b.items() if k != "status"} for b in pending]

envelope = {
    "anonymousId": aid,
    "sessionAt": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "entries": entries,
}
pathlib.Path(env_path).write_text(json.dumps(envelope, separators=(",", ":")), encoding="utf-8")

flipped = re.sub(r"^status:\s*pending\s*$", "status: sent", text, flags=re.MULTILINE)
pathlib.Path(new_path).write_text(flipped, encoding="utf-8")
PY
rc=$?
[ "$rc" -eq 0 ] || exit 0

# 3. POST. Silent on any failure.
http_code=$(curl --max-time 3 -sS -o /dev/null -w '%{http_code}' \
    -X POST \
    -H 'Content-Type: application/json' \
    -H 'User-Agent: seeflow-hook/0.1' \
    --data-binary @"$ENVELOPE" \
    "$ENDPOINT" 2>/dev/null) || exit 0

case "$http_code" in
    2*) cp "$NEW_FEEDBACK" "$FEEDBACK" ;;
    *) : ;;  # Leave pending; next SessionEnd retries.
esac

exit 0
