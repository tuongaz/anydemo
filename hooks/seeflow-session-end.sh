#!/usr/bin/env bash
# SeeFlow SessionEnd hook.
#
# Reads ~/.seeflow/consent.json. If feedback is enabled and modes includes
# "transfer", reads ~/.seeflow/feedback.jsonl line by line, collects entries
# with status == "pending", POSTs them as a batched envelope to
# https://seeflow.dev/api/feedback, and on 2xx rewrites the file with those
# entries' status flipped to "sent". Silent on any failure (missing files,
# disabled consent, no entries, network error, non-2xx response) — never
# blocks the session close.

set -u

CONSENT="$HOME/.seeflow/consent.json"
FEEDBACK="$HOME/.seeflow/feedback.jsonl"
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

# 2. Parse pending entries, build envelope + flipped feedback.jsonl.
TMPDIR=$(mktemp -d -t seeflow-feedback.XXXXXX) || exit 0
trap 'rm -rf "$TMPDIR"' EXIT

ENVELOPE="$TMPDIR/envelope.json"
NEW_FEEDBACK="$TMPDIR/feedback.jsonl"

python3 - "$FEEDBACK" "$anonymous_id" "$ENVELOPE" "$NEW_FEEDBACK" <<'PY' 2>/dev/null
import json, sys, datetime, pathlib

src, aid, env_path, new_path = sys.argv[1:5]
lines = pathlib.Path(src).read_text(encoding="utf-8").splitlines()

pending_entries = []
rewritten_lines = []
flipped = False

for raw in lines:
    if not raw.strip():
        rewritten_lines.append(raw)
        continue
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        rewritten_lines.append(raw)
        continue

    if obj.get("status") == "pending":
        entry = {k: v for k, v in obj.items() if k != "status"}
        pending_entries.append(entry)
        obj["status"] = "sent"
        rewritten_lines.append(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
        flipped = True
    else:
        rewritten_lines.append(raw)

if not pending_entries:
    sys.exit(2)

envelope = {
    "anonymousId": aid,
    "sessionAt": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "entries": pending_entries,
}
pathlib.Path(env_path).write_text(
    json.dumps(envelope, ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8",
)

trailing = "\n" if pathlib.Path(src).read_text(encoding="utf-8").endswith("\n") else ""
pathlib.Path(new_path).write_text("\n".join(rewritten_lines) + trailing, encoding="utf-8")
PY
rc=$?
[ "$rc" -eq 0 ] || exit 0

# 3. POST. Silent on any failure.
http_code=$(curl --max-time 3 -sS -o /dev/null -w '%{http_code}' \
    -X POST \
    -H 'Content-Type: application/json' \
    -H 'User-Agent: seeflow-hook/0.2' \
    --data-binary @"$ENVELOPE" \
    "$ENDPOINT" 2>/dev/null) || exit 0

case "$http_code" in
    2*) cp "$NEW_FEEDBACK" "$FEEDBACK" ;;
    *) : ;;  # Leave pending; next SessionEnd retries.
esac

exit 0
