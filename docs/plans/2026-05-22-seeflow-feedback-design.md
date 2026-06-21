# SeeFlow feedback collection — design

**Status:** Approved 2026-05-22
**Scope:** `skills/seeflow/`, `skills/seeflow-lookup/`, `.claude-plugin/plugin.json`, new hook script

## Goal

Let `/seeflow` and `/seeflow-lookup` learn from their mistakes. Record skill failures (CLI errors, validation rejects, retry exhaustion, e2e failures, user complaints) so the next iteration of each skill can fix them. User opt-in; no PII; optionally transferred to `seeflow.dev` for cross-user pattern detection.

## Storage

```
~/.seeflow/
  consent.json     # write-once user decision
  feedback.md      # append-only, block-per-entry, each block carries a status
```

### consent.json

Agree shape:

```json
{
  "version": 1,
  "decidedAt": "2026-05-22T09:30:00Z",
  "feedback": {
    "enabled": true,
    "modes": ["local", "transfer"],
    "anonymousId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

Disagree shape:

```json
{
  "version": 1,
  "decidedAt": "2026-05-22T09:30:00Z",
  "feedback": { "enabled": false }
}
```

- `version` — schema version; bump on breaking changes.
- `decidedAt` — when the user made the choice (ISO 8601 UTC).
- `feedback.enabled` — master switch.
- `feedback.modes` — non-empty subset of `["local", "transfer"]` when enabled. Omitted when disabled.
- `feedback.anonymousId` — UUID v4 generated at consent time, only used in transfer envelopes. Omitted when disabled or local-only.

### feedback.md

One block per entry, separated by `---`. Each block is `key: value` lines:

```
# SeeFlow feedback

---
ts: 2026-05-22T09:28:11Z
skill: seeflow
skillVersion: 0.1.55
phase: P3
kind: cli-error
code: badSchema
status: pending
summary: nodes:add-bulk rejected: connector.kind not in enum

---
ts: 2026-05-22T09:29:42Z
skill: seeflow
skillVersion: 0.1.55
phase: P6
kind: e2e-fail
status: pending
summary: play.ts ECONNREFUSED on :3001 after 2 retries
```

Fields:

- `ts` — ISO 8601 UTC.
- `skill` — `seeflow` or `seeflow-lookup`.
- `skillVersion` — plugin version from `.claude-plugin/plugin.json`.
- `phase` — `P0`–`P6` for `seeflow`; omitted for `seeflow-lookup`.
- `kind` — one of `cli-error · validation-fail · retry-exhausted · e2e-fail · subagent-fail · user-complaint · repeated-ask`.
- `code` — structured error code (`badSchema`, `flowNotFound`, …) when available; omitted otherwise.
- `status` — `pending` (newly written) or `sent` (POST 2xx confirmed). Hook flips `pending → sent` in place.
- `summary` — one line describing the failure shape; no PII, redacted.

## Redaction rules

Never write to `feedback.md` or to the transfer envelope:

- File paths (absolute or repo-relative)
- Project names or slugs
- Prompt text or code snippets
- Hostnames, usernames, env values
- Error messages containing any of the above (rephrase first)

`summary` is one sentence describing the failure *shape*, not the failure *content*.

## First-run prompt

Triggered when `~/.seeflow/consent.json` is absent at the top of a skill invocation. Uses `AskUserQuestion`:

> **Help improve /seeflow with anonymous failure feedback?**
> We'd record CLI errors, retries, and validation failures — never your code, prompts, or file paths.
>
> 1. Yes, share with seeflow.dev *(Recommended)* → `modes: ["local","transfer"]`
> 2. Yes, keep on this machine → `modes: ["local"]`
> 3. No → `enabled: false`

After the answer is captured the skill writes `consent.json` (creating `~/.seeflow/` if absent) and proceeds with the user's request. The file is write-once in v1 — users who change their mind edit the file by hand.

## Transfer mechanism

A `SessionEnd` hook (bash + `curl` + `awk`) runs at Claude Code session close.

1. Read `~/.seeflow/consent.json`. Exit 0 if missing, `enabled !== true`, or `modes` lacks `"transfer"`.
2. Scan `feedback.md` for blocks with `status: pending`.
3. If none → exit 0.
4. Build the envelope:
   ```json
   {
     "anonymousId": "550e8400-…",
     "sessionAt":   "2026-05-22T09:30:00Z",
     "entries": [
       { "ts":"…","skill":"…","skillVersion":"…","phase":"…","kind":"…","code":"…","summary":"…" }
     ]
   }
   ```
5. POST to `https://seeflow.dev/api/feedback` with `--max-time 3`, silent on failure (`&>/dev/null`).
6. On 2xx: rewrite those blocks' `status: pending` → `status: sent` in place.
7. On non-2xx or timeout: leave them `pending`; next `SessionEnd` retries.

Registered in `.claude-plugin/plugin.json`:

```json
"hooks": {
  "SessionEnd": "./hooks/seeflow-session-end.sh"
}
```

Hook script lives at `<plugin-root>/hooks/seeflow-session-end.sh` (new file, executable).

## What the skills do

Both `/seeflow` and `/seeflow-lookup`:

1. **Top of skill** (prepended ahead of `/seeflow`'s existing Phase 0): silently check `~/.seeflow/consent.json`.
   - Absent → run the first-run prompt, write `consent.json`.
   - Present + `enabled === false` → feedback logging off for this session.
   - Present + `enabled === true` → feedback logging on for the rest of the session.
2. **On qualifying failures**: append a block to `~/.seeflow/feedback.md` with `status: pending`, following the redaction rules. The hook handles transfer.

Canonical agent-facing doc lives at `skills/seeflow/feedback.md`. `skills/seeflow-lookup/SKILL.md` references it cross-skill — same pattern the lookup skill already uses for `../seeflow/references/schema.md`.

## Files to change

| Path | Change |
|---|---|
| `skills/seeflow/feedback.md` | **new** — canonical feedback doc (consent, format, kinds, redaction, hook contract) |
| `skills/seeflow/SKILL.md` | prepend consent step before Phase 0; add Operations-table row referencing `feedback.md` |
| `skills/seeflow-lookup/SKILL.md` | add consent step; reference `../seeflow/feedback.md` |
| `hooks/seeflow-session-end.sh` | **new** — bash hook: reads consent, finds `status: pending` blocks, POSTs, flips to `sent` |
| `.claude-plugin/plugin.json` | add `"hooks": { "SessionEnd": "./hooks/seeflow-session-end.sh" }` |

The server endpoint at `POST https://seeflow.dev/api/feedback` is out of scope for this design — built separately to match the envelope above.

## Non-goals (v1)

- Re-prompting after `consent.json` exists.
- Per-skill granular consent (one master switch covers both skills).
- Queueing across separate machines or Claude Code installs.
- A sanitisation library — skill instructions enforce redaction by convention.
- Telemetry beyond failure events (no timing, no success counts, no usage stats).

## Open questions for implementation

- UUID generation in pure bash for `anonymousId` — prefer `uuidgen` (macOS + Linux), fall back to `/proc/sys/kernel/random/uuid`.
- `awk`-friendly block parsing assumes each block contains only key:value lines plus a trailing blank line — confirm the writer produces that shape exactly.
- Verify the `SessionEnd` hook event is available in the user's Claude Code version before relying on it for the transfer trigger.
