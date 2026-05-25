# Feedback collection

> **PAUSED — not wired into the skill.** `SKILL.md` no longer reads `~/.seeflow/consent.json` or appends to `~/.seeflow/feedback.jsonl`. The `SessionEnd` hook stays registered but is a silent no-op while nothing produces the file. This spec is retained verbatim for future restoration; to revive, re-add the Phase 0 consent block and the `log <kind>` instructions called out in the kind catalog below back into `SKILL.md`.

The skill records its own failures and friction to `~/.seeflow/feedback.jsonl` so the next iteration can fix them. User opt-in. Optionally relayed to `seeflow.dev`. **The skill only writes locally — a `SessionEnd` hook handles the network call.**

Storage is **JSON Lines** (one complete JSON object per line, append-only). No custom parser, no escape gymnastics, trivial to forward verbatim in the transfer envelope.

## Consent — silent check, top of every invocation

Before doing anything else, read `~/.seeflow/consent.json` silently.

- **File missing** → run the first-run prompt (below), then write the file before continuing.
- **`feedback.enabled === false`** → no logging this session. Carry on with the user's request.
- **`feedback.enabled === true`** → log qualifying events per "When to log" below.

Never re-prompt if `consent.json` already exists. Users who change their mind edit the file by hand.

### First-run prompt

Use `AskUserQuestion`:

> **Help improve /seeflow with anonymous feedback?**
> We'd record CLI errors, retries, validation failures, pre-flight mismatches, and silent auto-corrections — never your code, prompts, or file paths.
>
> 1. **Yes, share with seeflow.dev** *(Recommended)* — `~/.seeflow/feedback.jsonl` plus an anonymous POST at session end.
> 2. **Yes, keep on this machine** — local file only, nothing leaves.
> 3. **No** — never collect.

Mapping to `consent.json`:

| Answer | `feedback.enabled` | `feedback.modes` | `anonymousId` |
|---|---|---|---|
| Yes, share | `true` | `["local","transfer"]` | new UUID v4 |
| Yes, keep local | `true` | `["local"]` | omit |
| No | `false` | omit | omit |

Write `~/.seeflow/consent.json` (create the directory if missing). Shapes:

```json
{
  "version": 1,
  "decidedAt": "<ISO 8601 UTC>",
  "feedback": {
    "enabled": true,
    "modes": ["local", "transfer"],
    "anonymousId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

```json
{
  "version": 1,
  "decidedAt": "<ISO 8601 UTC>",
  "feedback": { "enabled": false }
}
```

UUID generation: prefer `uuidgen`; fall back to `/proc/sys/kernel/random/uuid`.

## When to log

Append one JSON object as a single line to `~/.seeflow/feedback.jsonl` for each of the kinds in the catalog below. Don't log success, timing, or usage stats — only failures, friction, and silent corrections.

### Kind catalog

| `kind` | Default `severity` | Fires when |
|---|---|---|
| `env-tool-missing` | `blocker` | Required binary not on PATH after fallback (e.g. `seeflow` and `npx` both unavailable). |
| `env-capability-mismatch` | `blocker` | Tool is present but lacks expected subcommands or flags (Phase 0 `$SEEFLOW help` probe). |
| `env-service-unreachable` | `blocker` | Required service (studio `/health`) didn't respond after retry. |
| `env-version-mismatch` | `degraded` | Tool/service version below stated minimum but a fallback exists. Promote to `blocker` if no fallback. |
| `cli-error` | `failure` | `seeflow` CLI returned a structured error (`badSchema`, `flowNotFound`, `unknownNode`, `fileNotFound`, …) after the retry budget. |
| `validation-fail` | `failure` | Phase 5 patch rejected server-side by the studio after retries. |
| `agent-output-corrected` | `corrected` | Orchestrator silently patched a sub-agent's output before the next CLI call (Phase 3 normalization: unknown type/field rename, bidir-connector strip, placeholder injection, id rewrite, …). One entry per `(agent, correction-kind)` with the count in `details`. |
| `agent-output-unparseable` | `failure` | Sub-agent returned unparseable JSON after the single retry. |
| `retry-exhausted` | `failure` | Any retry budget was exhausted (Phase 5 per-node `nodes:patch`, Phase 6 fix-up loop). |
| `mode-fallback` | `degraded` | Skill switched to a lesser operating mode (Phase 1 empty-project `design-only`; Phase 3 dynamic→static auto-downgrade). |
| `phase-skipped` | `degraded` | A phase was skipped due to an upstream condition (e.g. Phase 6 skipped in design-only mode). |
| `plan-revision` | `friction` | User rejected the layout or asked for material changes at the Phase 3 gate. |
| `repeated-ask` | `friction` | The skill asked the user the same clarifying question twice in a single session. |
| `user-complaint` | `friction` | User explicitly expressed frustration, repeated a correction, or rejected the skill's choice. |
| `seeflow:e2e-fail` | `failure` | Phase 6 returned `ok: false` after the retry loop. Skill-specific because runtime e2e is a behavior assertion, not schema validation. |
| `other` | *caller-specified* | Friction observed that doesn't fit any kind above AND isn't worth its own. `details` and `severity` are required. |

**Severity is per-event, not per-kind.** The defaults above cover the common case; a specific event MAY emit with a different severity when context warrants (e.g. `env-version-mismatch` is `degraded` when a fallback exists, `blocker` when not). Pick one of the five values: `blocker · degraded · corrected · friction · failure`.

**`other` discipline.** Use only when no listed kind fits. `details` and `severity` are both required. If the same `other` summary recurs across runs, promote it to a named kind in the catalog above.

Don't log:

- Single-attempt failures that the retry loop will recover from. Wait until the retry budget is gone.
- Anything the user explicitly OKs ("yes that's fine, retry").
- CLI calls that succeed.
- Anything that would require including file paths, code, or prompt text in the summary.

## Line format

`~/.seeflow/feedback.jsonl` is append-only. Each line is one complete JSON object terminated by `\n`. Example:

```jsonl
{"ts":"2026-05-22T09:28:11Z","skill":"seeflow","skillVersion":"0.1.56","phase":"P3","kind":"agent-output-corrected","severity":"corrected","agent":"seeflow-node-planner","details":"type-rename resourceNode→rectangle (×3); field-rename label→name (×12); bidir-connector-strip (×5)","status":"pending","summary":"node-planner emitted unknown types/fields; orchestrator normalized 20 issues across 12 nodes before flow:add-bulk"}
```

Fields:

| Field | Required | Type | Purpose |
|---|---|---|---|
| `ts` | yes | string (ISO 8601 UTC) | The moment the event was observed. |
| `skill` | yes | `"seeflow"` | Discriminator. |
| `skillVersion` | yes | string | Value of `version` in `.claude-plugin/plugin.json`. |
| `phase` | optional | `"P0"`–`"P6"` | Omit when the event isn't tied to a phase. |
| `kind` | yes | string | One of the values in the catalog above. |
| `severity` | yes | `"blocker" \| "degraded" \| "corrected" \| "friction" \| "failure"` | Triage axis; default per-kind but overridable. |
| `agent` | conditional | string | Sub-agent slug (e.g. `"seeflow-node-planner"`). Required for `agent-output-corrected` and `agent-output-unparseable`; omit otherwise. |
| `details` | conditional | string | One-line `;`-separated breakdown. Required for `other` and `agent-output-corrected`; optional elsewhere. |
| `code` | optional | string | Structured CLI error code (`"badSchema"`, `"flowNotFound"`, …). Use on `cli-error` when available. |
| `status` | yes | `"pending"` on write | Hook flips to `"sent"` after a successful POST. Don't touch it again. |
| `summary` | yes | string | One sentence. Failure *shape*, not *content*. Obeys redaction. |

### Append discipline

- One object per line, terminated by `\n`. **Never** break a JSON object across multiple lines.
- Always `JSON.stringify` (or equivalent) — never hand-build the line, escape characters in `summary`/`details` matter.
- Append only; never rewrite or reorder lines. The hook is the only writer that mutates existing lines (flips `status`).
- First write: create `~/.seeflow/` if missing, then the file. No header — JSONL doesn't have one.

**Writing the line.** Build the object with `python3 -c 'import json,sys; print(json.dumps(...))'` or `jq -cn`, then `>> ~/.seeflow/feedback.jsonl`. Example:

```bash
python3 -c '
import json, datetime, sys
print(json.dumps({
  "ts": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
  "skill": "seeflow",
  "skillVersion": "'"$SKILL_VERSION"'",
  "phase": "P3",
  "kind": "agent-output-corrected",
  "severity": "corrected",
  "agent": "seeflow-node-planner",
  "details": "type-rename resourceNode→rectangle (×3)",
  "status": "pending",
  "summary": "node-planner emitted unknown types; normalized 3 nodes before flow:add-bulk",
}))
' >> ~/.seeflow/feedback.jsonl
```

## Redaction — never write to disk or transfer

- Absolute or repo-relative **file paths**.
- **Project names** and **slugs**.
- **Prompt text** (the user's request) and **code snippets**.
- **Hostnames**, **usernames**, environment variable values.
- **Error messages** that contain any of the above — rephrase, don't quote.

Good summary: `flow:add-bulk rejected: node.data.queueName not in schema`
Bad summary: `flow:add-bulk rejected at /Users/alice/work/myapp/.seeflow/orders-pipeline/flow.json`

Good summary: `play.ts ECONNREFUSED on :3001 after 2 retries`
Bad summary: `play.ts ECONNREFUSED hitting http://internal-api.acme.corp:3001/orders`

If you can't write a clean summary without leaking, **skip the entry**.

## Hook handoff

The `SessionEnd` hook (`hooks/seeflow-session-end.sh`, registered in `.claude-plugin/plugin.json`) handles transfer:

1. Reads `~/.seeflow/consent.json`.
2. If `feedback.enabled !== true` or `modes` lacks `"transfer"` → exit silently.
3. Reads `~/.seeflow/feedback.jsonl` line by line; selects entries with `status === "pending"`.
4. POSTs an envelope to `https://seeflow.dev/api/feedback`:
   ```json
   {
     "anonymousId": "550e8400-…",
     "sessionAt":   "<ISO 8601 UTC>",
     "entries": [ /* the pending objects verbatim, minus the status field */ ]
   }
   ```
5. On 2xx: rewrites those entries' `status: "pending"` → `status: "sent"` in place (re-serialize the file with updated status).
6. On non-2xx, timeout, or disabled transfer: leaves them `pending`; next session retries.

The skill does **not** call the network. Don't `curl` from inside the skill; don't read or write the `status` field after the initial write.

## Don't

- POST from the skill — the hook owns the network.
- Log success events or counts.
- Write more than one entry per `(kind, phase, agent)` per session — debounce in memory.
- Log a `repeated-ask` for clarifications the user asked for.
- Edit `status` after the initial `pending` write.
- Read `feedback.jsonl` for any reason other than appending — it isn't an input.
- Skip the consent check at the top of the run; never silently default to `enabled: true`.
- Log without a redacted summary; if the summary would leak, **skip the entry**.
- Hand-build the JSON line — always use `json.dumps`/`jq` so escaping is correct.
