# Feedback collection

The skill records its own failures to `~/.seeflow/feedback.md` so the next iteration can fix them. User opt-in. Optionally relayed to `seeflow.dev`. **The skill only writes locally — a `SessionEnd` hook handles the network call.**

## Consent — silent check, top of every invocation

Before doing anything else, read `~/.seeflow/consent.json` silently.

- **File missing** → run the first-run prompt (below), then write the file before continuing.
- **`feedback.enabled === false`** → no logging this session. Carry on with the user's request.
- **`feedback.enabled === true`** → log qualifying failures per "When to log" below.

Never re-prompt if `consent.json` already exists. Users who change their mind edit the file by hand.

### First-run prompt

Use `AskUserQuestion`:

> **Help improve /seeflow with anonymous failure feedback?**
> We'd record CLI errors, retries, and validation failures — never your code, prompts, or file paths.
>
> 1. **Yes, share with seeflow.dev** *(Recommended)* — `~/.seeflow/feedback.md` plus an anonymous POST at session end.
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

Append a block to `~/.seeflow/feedback.md` for each of these. Don't log success, timing, or usage stats — only failures and friction.

| `kind` | Trigger |
|---|---|
| `cli-error` | `seeflow` CLI call returned a structured error (`badSchema`, `flowNotFound`, `unknownNode`, `fileNotFound`, …). |
| `validation-fail` | Phase 4/5 patch rejected by `ResolvedFlowSchema` server-side. |
| `retry-exhausted` | A retry budget was exhausted (Phase 5 per-node `nodes:patch`, Phase 6 fix-up loop, sub-agent unparseable-output retry). |
| `e2e-fail` | Phase 6 returned `ok: false` after the retry loop. |
| `subagent-fail` | A sub-agent returned unparseable JSON after the single retry. |
| `user-complaint` | User explicitly expressed frustration, repeated a correction, or rejected the skill's choice. |
| `repeated-ask` | The skill asked the user the same clarifying question twice in a single session. |

Don't log:

- Single-attempt failures that the retry loop will recover from. Wait until the retry budget is gone.
- Anything the user explicitly OKs ("yes that's fine, retry").
- CLI calls that succeed.
- Anything that would require including file paths, code, or prompt text in the summary.

## Block format

`~/.seeflow/feedback.md` is append-only. Each entry is a block separated by `---`:

```
---
ts: 2026-05-22T09:28:11Z
skill: seeflow
skillVersion: 0.1.55
phase: P3
kind: cli-error
code: badSchema
status: pending
summary: flow:add-bulk rejected: connector.kind not in enum
```

Fields:

- `ts` — ISO 8601 UTC, the moment the failure was observed.
- `skill` — `seeflow` or `seeflow-lookup`.
- `skillVersion` — value of `version` in `.claude-plugin/plugin.json`.
- `phase` — `P0`–`P6` for `seeflow`; omit for `seeflow-lookup`.
- `kind` — one of the values in the table above.
- `code` — structured CLI error code (`badSchema`, `flowNotFound`, …) if applicable; omit otherwise.
- `status` — always write `pending`. The `SessionEnd` hook flips this to `sent` after a successful POST. Don't touch it again.
- `summary` — one line. Failure *shape*, not failure *content*. See redaction rules.

Block conventions (so the hook's `awk` parser works):

- Exactly one blank line between blocks (terminating each block).
- Only `key: value` lines inside a block — no comments, no multi-line values.
- `summary` last; one sentence, no newlines.
- First file write: prepend `# SeeFlow feedback\n\n` once, then the first `---`.

## Redaction — never write to disk or transfer

- Absolute or repo-relative **file paths**.
- **Project names** and **slugs**.
- **Prompt text** (the user's request) and **code snippets**.
- **Hostnames**, **usernames**, environment variable values.
- **Error messages** that contain any of the above — rephrase, don't quote.

Good summary: `flow:add-bulk rejected: connector.kind not in enum`
Bad summary: `flow:add-bulk rejected at /Users/alice/work/myapp/.seeflow/orders-pipeline/flow.json`

Good summary: `play.ts ECONNREFUSED on :3001 after 2 retries`
Bad summary: `play.ts ECONNREFUSED hitting http://internal-api.acme.corp:3001/orders`

If you can't write a clean summary without leaking, **skip the entry**.

## Hook handoff

The `SessionEnd` hook (`hooks/seeflow-session-end.sh`, registered in `.claude-plugin/plugin.json`) handles transfer:

1. Reads `~/.seeflow/consent.json`.
2. If `feedback.enabled !== true` or `modes` lacks `"transfer"` → exit silently.
3. Collects every block with `status: pending`.
4. POSTs an envelope to `https://seeflow.dev/api/feedback`:
   ```json
   {
     "anonymousId": "550e8400-…",
     "sessionAt":   "<ISO 8601 UTC>",
     "entries": [
       { "ts":"…","skill":"…","skillVersion":"…","phase":"…","kind":"…","code":"…","summary":"…" }
     ]
   }
   ```
5. On 2xx: rewrites those blocks' `status: pending` → `status: sent` in place.
6. On non-2xx, timeout, or disabled transfer: leaves them `pending`; next session retries.

The skill does **not** call the network. Don't `curl` from inside the skill; don't read or write the `status` field after the initial write.

## Don't

- POST from the skill — the hook owns the network.
- Log success events or counts.
- Write more than one block per failure (debounce within the session).
- Log a `repeated-ask` for clarifications the user asked for.
- Edit `status` after the initial `pending` write.
- Read `feedback.md` for any reason other than appending — it isn't an input.
