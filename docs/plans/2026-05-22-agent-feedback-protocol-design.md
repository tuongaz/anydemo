# Agent feedback protocol — design

**Status:** Brainstormed 2026-05-22
**Supersedes:** `2026-05-22-seeflow-feedback-design.md` (the v1 seeflow-specific
design that this generalizes)
**Scope:** new protocol doc at `~/.claude/feedback-protocol.md`; shared
storage at `~/.claude/feedback/`; refactor of `skills/seeflow/feedback.md`
as the worked adopter example. Other skills (gstack, etc.) can adopt
later without further protocol changes.

## Why

Two real failure modes slipped past v1's logger during a recent /seeflow run:

| Reported issue | Detected at | Why v1 didn't log it |
|---|---|---|
| Installed `npx @tuongaz/seeflow@latest` lacks `projects:create`, `flow:add-bulk`, `flows:layout`, `nodes:patch`, `e2e` | Phase 0 `seeflow help` parse, **before** any command was attempted | v1's `cli-error` requires a CLI invocation to have failed. The skill paused on discovery; no command, no error event. |
| Node planner emitted unknown type `resourceNode`, wrong fields `label/sublabel`, bidirectional connectors creating visual loops | Phase 3 normalization, **before** `flow:add-bulk` | v1's `validation-fail` requires server-side `ResolvedFlowSchema` rejection. The orchestrator silently patched the planner output, so no validation event fired. |

Both gaps share a root cause: v1 only logs *after* a retry budget is exhausted.
Pre-flight discoveries and silent auto-corrections — exactly the signals that
prove the skill is out of sync with its environment or its sub-agents are
drifting — are invisible.

The v2 protocol closes both gaps and generalizes the mechanism so any
Claude Code skill can adopt it.

## Goals

1. Catch friction earlier — pre-flight env mismatches, silent
   auto-corrections, mode fallbacks, user-driven plan revisions — not
   just hard failures after retry exhaustion.
2. Be **portable**: a written spec that any skill can implement without
   shared code. Each skill ships its own logger; storage and format are
   the contract.
3. Be **cheap**: fire-and-forget dispatch, no LLM cost per event, no
   orchestrator context pressure.
4. Preserve v1's redaction discipline — never write paths, code,
   prompts, hostnames, or content to disk or the wire.

## Non-goals

- A central registry / service. The protocol is file-based, peer-to-peer.
- Synchronous "did the log write succeed?" feedback to the orchestrator.
- Cross-skill kind discovery. Each skill validates its own catalog.

## Architecture

```
~/.claude/feedback/
  feedback.md         # single shared append-only store; skill: field discriminates
  consent.json        # keyed by skill; first-run prompt per skill
  feedback.lock       # flock target (created on first write)
  bin/
    log.sh            # recommended shared logger; ~150 lines bash
  seeflow/
    kinds.txt         # allowed `seeflow:*` kind extensions
  <other-skill>/
    kinds.txt
```

Single shared `feedback.md` (not per-skill) because every block has a
`skill:` field. Transfer hooks group by skill cheaply; users get one
file to inspect or delete.

## Block format

Append-only blocks separated by `---`, one blank line between blocks,
`summary` last:

```
---
ts: 2026-05-22T09:28:11Z
skill: seeflow
skillVersion: 0.1.55
phase: P3
kind: agent-output-corrected
severity: corrected
agent: seeflow-node-planner
details: type-rename resourceNode→stateNode (×3); field-rename label→name (×12); bidir-connector-strip (×5)
code:
status: pending
summary: node-planner emitted unknown types/fields; orchestrator normalized 20 issues across 12 nodes before flow:add-bulk
```

**Fields:**

| Field | Required | Values | Purpose |
|---|---|---|---|
| `ts` | yes | ISO 8601 UTC | Observation timestamp; logger injects |
| `skill` | yes | skill slug (e.g. `seeflow`) | Discriminator; logger injects (hardcoded per logger) |
| `skillVersion` | yes | semver from skill's plugin manifest | Logger reads once per session |
| `phase` | optional | skill-defined phase id (e.g. `P0`–`P6` for seeflow) | Omit when the skill has no phase model |
| `kind` | yes | core kind or `<skill>:<name>` extension | See catalog below |
| `severity` | yes | `blocker` \| `degraded` \| `corrected` \| `friction` \| `failure` | Triage axis; independent of kind |
| `agent` | conditional | sub-agent slug | Required for `agent-output-corrected` and `agent-output-unparseable`; omit otherwise |
| `details` | conditional | one-line `;`-separated breakdown | Required for `other`; optional elsewhere |
| `code` | optional | structured CLI error code | E.g. `badSchema`, `flowNotFound` |
| `status` | yes | `pending` on write; flipped to `sent` by transfer hook | Logger writes `pending`; nothing else touches it |
| `summary` | yes | one sentence | Last field; failure *shape*, not *content*; obeys redaction |

**Parser invariants** (so the transfer hook's `awk` works):
- One blank line between blocks (terminating each).
- Only `key: value` lines inside a block; no comments, no multi-line values.
- `summary` is the last line; one sentence, no newlines.
- First write to a fresh file: prepend `# Agent feedback\n\n` once.

## consent.json — keyed by skill

```json
{
  "version": 1,
  "skills": {
    "seeflow": {
      "decidedAt": "2026-05-22T09:28:11Z",
      "enabled": true,
      "modes": ["local", "transfer"],
      "anonymousId": "550e8400-e29b-41d4-a716-446655440000",
      "transferUrl": "https://seeflow.dev/api/feedback"
    },
    "gstack": {
      "decidedAt": "2026-05-23T10:00:00Z",
      "enabled": false
    }
  }
}
```

Each skill owns its slice. First-run prompt for skill X writes/updates
`skills.X` only; adding a skill never re-prompts existing ones.

`modes` values:
- `local` — append blocks locally; never POST.
- `transfer` — additionally POST to `transferUrl` at `SessionEnd`.

## Core kind catalog

| Kind | Default severity | Fires when |
|---|---|---|
| `env-tool-missing` | `blocker` | Required binary not on PATH after fallback |
| `env-capability-mismatch` | `blocker` | Tool present but lacks expected subcommands/flags |
| `env-service-unreachable` | `blocker` | Required service didn't respond after retry |
| `env-version-mismatch` | `degraded` or `blocker` | Tool/service version below stated minimum |
| `cli-error` | `failure` | Invoked CLI returned a structured error (after retry budget) |
| `validation-fail` | `failure` | Schema validation rejected an artifact (after retries) |
| `agent-output-corrected` | `corrected` | Orchestrator silently patched sub-agent output before downstream call |
| `agent-output-unparseable` | `failure` | Sub-agent returned malformed structured output (after retry) |
| `retry-exhausted` | `failure` | Any retry budget consumed without success |
| `mode-fallback` | `degraded` | Skill switched to a lesser operating mode |
| `phase-skipped` | `degraded` | A phase/step was skipped due to upstream condition |
| `plan-revision` | `friction` | User rejected the plan or asked for material changes at a gate |
| `repeated-ask` | `friction` | Same clarifying question fired twice in one session |
| `user-complaint` | `friction` | User expressed frustration or repeated a correction |
| `other` | *caller-specified* | Friction observed that doesn't fit any core kind AND isn't worth a skill-specific extension |

**`other` discipline:**
- `details` is required (not optional). Empty `details` → logger rejects.
- `severity` is required (no default).
- If the same `other` summary recurs 3+ times in maintenance review,
  promote it to a named core kind or skill-namespaced kind.

**Severity is per-event, not per-kind.** The table is the *default*; a
specific event MAY emit with a different severity when context warrants
(e.g. `env-version-mismatch` is `degraded` if a fallback exists,
`blocker` if not). Logger validates severity is one of the five values
but does not enforce a kind→severity mapping.

## Namespace extension

Skills extend the catalog under `<skill>:<name>`:

- Core kind: `^[a-z][a-z0-9-]*$` — no colon.
- Skill kind: `^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$` — exactly one colon;
  left side MUST equal the logger's hardcoded `skill` value. Cross-skill
  writes are rejected.

**Extend only when a core kind would mislead a reader.** Default to
core; reach for namespace when the *what* is genuinely skill-shaped.

**Example seeflow extensions** (declared in
`~/.claude/feedback/seeflow/kinds.txt`):

```
seeflow:e2e-fail
```

`seeflow:e2e-fail` exists because Phase 6 e2e is a runtime behavior
assertion, not a schema validation — different semantics, different
fixes. `seeflow:layout-revision` is *not* declared because
`plan-revision` already fits.

## Logger contract — recommended implementation: bash

A portable bash script lives at `~/.claude/feedback/bin/log.sh`
(install-once; shared across all skills on the machine).

**Dispatch from orchestrator:**

```bash
Bash(
  command: |
    ~/.claude/feedback/bin/log.sh \
      --skill seeflow \
      --phase P3 \
      --kind agent-output-corrected \
      --severity corrected \
      --agent seeflow-node-planner \
      --details 'type-rename resourceNode→stateNode (×3)' \
      --summary 'node-planner emitted unknown types; orchestrator normalized 20 issues across 12 nodes' \
      --forbidden-terms "$REDACT_LIST"
  run_in_background: true
  description: "log feedback"
)
```

**Fire-and-forget — the orchestrator MUST NOT:**
- `await` the Bash result.
- Read the logger's stdout/stderr.
- Gate any orchestrator step on logger completion.
- Read `feedback.md` to verify a log was written.

The Bash tool's auto-completion notification is ignored (no follow-up).

**`log.sh` behavior:**

1. Parse args. Validate `--skill`, `--kind`, `--severity`, `--summary`
   present. Validate `kind` matches core catalog or
   `~/.claude/feedback/<skill>/kinds.txt`.
2. Read `~/.claude/feedback/consent.json`. If `skills.<skill>.enabled
   !== true` → exit 0 silently.
3. Read `~/.claude/feedback/<skill>/version` (or fall back to
   `$SKILL_VERSION` env var) for `skillVersion`.
4. Re-redact `summary` and `details`: strip absolute paths, repo
   paths, and any term in `--forbidden-terms` (newline-separated list).
   If the result is empty or unchanged-but-still-leaking (heuristic:
   contains `/` or matches a path-like regex) → exit 0 silently.
5. `flock -x` on `~/.claude/feedback/feedback.lock`:
   1. `awk`-scan `feedback.md` for a block with same `(skill, phase,
      kind, agent)` and `status: pending`. If found → release flock,
      exit 0 (debounce).
   2. Append the block (Section "Block format"), injecting `ts` (now,
      ISO 8601 UTC), `skill`, `skillVersion`, `status: pending`.
   3. Release flock.
6. Exit 0.

**Concurrency:** multiple fire-and-forget invocations race on the
file; `flock` serializes the read-debounce-append. No queue, no
broker. Append throughput is millisecond-scale.

**Failures inside `log.sh`** (disk full, malformed args, redaction
yields empty summary) → exit silently. Best-effort by design; the
orchestrator never finds out, the skill's primary work continues.

## Logger contract — alternative: sub-agent

For skills that need LLM-level redaction judgment (rare), a sub-agent
implementation is permitted with the same input contract. Same name
convention: `<skill>-feedback-logger.md`. Same `flock` discipline.
Drawbacks: ~5–30s latency per dispatch, one LLM call per event,
duplicated logger logic per skill. Default to bash unless a skill has
a concrete reason.

## Redaction rules

Never write to `feedback.md` or transfer:

- Absolute or repo-relative **file paths**.
- **Project names** and **slugs**.
- **Prompt text** (the user's request) and **code snippets**.
- **Hostnames**, **usernames**, environment variable values.
- **Error messages** that contain any of the above — rephrase, don't quote.

Good: `flow:add-bulk rejected: connector.kind not in enum`
Bad: `flow:add-bulk rejected at /Users/alice/work/myapp/.seeflow/...`

Good: `play.ts ECONNREFUSED on :3001 after 2 retries`
Bad: `play.ts ECONNREFUSED hitting http://internal-api.acme.corp:3001/orders`

If `log.sh`'s post-redaction summary still leaks, skip the entry.

## Hook contract — SessionEnd transfer

A `SessionEnd` hook handles network transfer. Skills MAY ship their
own or install a community generic hook.

**Required behavior:**

1. Read `~/.claude/feedback/consent.json`.
2. For each `skill` with `enabled: true` AND `modes` contains
   `transfer`:
   1. Scan `feedback.md` for blocks with `skill: <name>` AND
      `status: pending`.
   2. POST envelope to `transferUrl`:
      ```json
      {
        "anonymousId": "550e8400-…",
        "sessionAt":   "<ISO 8601 UTC>",
        "entries": [
          { "ts":"…","skill":"…","skillVersion":"…","phase":"…","kind":"…","severity":"…","agent":"…","details":"…","code":"…","summary":"…" }
        ]
      }
      ```
   3. On 2xx: rewrite those blocks' `status: pending` → `status: sent`
      in place (single `sed` pass under the same `flock`).
   4. On non-2xx, timeout, or network error: leave them `pending`;
      next session retries.
3. MUST NOT touch blocks for skills with `enabled: false` or `modes`
   lacking `transfer`.
4. MUST NOT transform `summary` or `details` — pass through verbatim.

## Per-skill adoption checklist

Adopting the protocol requires per-skill:

1. **First-run consent prompt** — value-prop copy in the skill's
   voice; writes `skills.<name>` to `consent.json` exactly once.
   Re-runs never re-prompt.
2. **`~/.claude/feedback/<skill>/kinds.txt`** — newline-separated
   list of allowed `<skill>:*` kind extensions. Empty file is valid
   (skill uses core kinds only).
3. **`references/feedback.md` (or inline in SKILL.md)** — adopter doc
   listing:
   - First-run prompt copy.
   - `transferUrl` (or `null` for local-only).
   - Skill-specific kinds and their severity defaults.
   - Severity overrides for core kinds.
   - **Instrumentation points** — which phase/step dispatches which
     kind. This is the contract between SKILL.md and the protocol.
4. **Optional**: ship a skill-specific `SessionEnd` hook, or rely on
   the community generic one.
5. **`.claude/settings.json` allow rule** — plugin install registers
   `Bash(~/.claude/feedback/bin/log.sh:*)` in `permissions.allow` so
   per-event dispatches fire without a permission prompt mid-run.
   Users who want to opt out at the OS-tool-permission layer (in
   addition to the `consent.json` layer) can remove the rule. Without
   this rule, every instrumentation point would trigger a confirm
   prompt and the protocol would be unusable in interactive mode.

Skills do **not** ship their own `log.sh` unless they need
sub-agent-style judgment.

## Worked example — seeflow refactor

**Files changing:**

- `skills/seeflow/feedback.md` — rewritten as the adopter doc. No more
  block format / redaction / hook spec (lives in the protocol). Keeps
  only seeflow-specific instrumentation, consent copy, kinds.
- `skills/seeflow/SKILL.md` — Phase 0 grows an explicit capability
  probe step; Phase 3 normalization step explicitly emits
  `agent-output-corrected`; the Don'ts gain three new entries.
- `~/.seeflow/consent.json` migration: read once, write
  `~/.claude/feedback/consent.json` under `skills.seeflow`, then
  `mv ~/.seeflow/consent.json ~/.seeflow/consent.json.v1.bak`.
- `~/.seeflow/feedback.md` migration: one-shot script copies blocks
  to `~/.claude/feedback/feedback.md` with `skill: seeflow` injected,
  then `mv` the v1 file aside.
- `.claude-plugin/plugin.json` SessionEnd hook script updated to the
  protocol hook contract (or replaced with the generic).

**New seeflow `feedback.md` (worked example):**

```markdown
# seeflow — feedback collection

Adopts the [agent-feedback protocol](~/.claude/feedback-protocol.md).
Storage: `~/.claude/feedback/feedback.md`.
Consent: `~/.claude/feedback/consent.json` under `skills.seeflow`.
Logger: `~/.claude/feedback/bin/log.sh` (shared bash).

## First-run prompt

> Help improve /seeflow with anonymous failure feedback?
> We'd record CLI errors, retries, validation failures, and pre-flight
> mismatches — never your code, prompts, or file paths.
>
> 1. Yes, share with seeflow.dev (Recommended) — local file + anonymous
>    POST at session end.
> 2. Yes, keep on this machine — local file only, nothing leaves.
> 3. No — never collect.

Writes `skills.seeflow` in `consent.json`.

## Transfer URL

`https://seeflow.dev/api/feedback` (when `modes` contains `"transfer"`).

## Skill-specific kinds

`~/.claude/feedback/seeflow/kinds.txt`:

```
seeflow:e2e-fail
```

| Kind | Severity | Fires when |
|---|---|---|
| `seeflow:e2e-fail` | `failure` | Phase 6 returned `ok: false` after fix-up retries |

## Severity overrides

- `env-capability-mismatch` → always `blocker` (no fallback exists today).

## Instrumentation points

| Phase | Step | Kind / severity |
|---|---|---|
| P0 | After capability probe (parse `$SEEFLOW help`) | `env-capability-mismatch` / `blocker` if required subcommands missing |
| P0 | After `/health` retry | `env-service-unreachable` / `blocker` if studio still down |
| P1 | Empty-project branch chosen | `mode-fallback` / `degraded` (details: `design-only`) |
| P3 | After planner output normalization | `agent-output-corrected` / `corrected` — one entry per (agent, correction-kind) with count in `details` |
| P3 | User requested layout changes at gate | `plan-revision` / `friction` |
| P3 | Dynamic→static auto-downgrade | `mode-fallback` / `degraded` (details: `dynamic-to-static`) |
| P5 | Per-node `nodes:patch` retry exhausted | `retry-exhausted` / `failure` |
| P6 | `e2e` ok:false after fix-up | `seeflow:e2e-fail` / `failure` |
| any | Sub-agent unparseable JSON after retry | `agent-output-unparseable` / `failure` |

## Don't (orchestrator)

- Never write to `~/.claude/feedback/feedback.md` directly — dispatch
  `log.sh` via `Bash(..., run_in_background: true)`.
- Never read it — debounce lives in `log.sh`.
- Never check `consent.json` except at first-run setup.
- Never `await` the Bash dispatch.
- Never gate orchestrator logic on logger completion.
```

## Coverage check

| Original issue | Now caught by | Where |
|---|---|---|
| CLI version mismatch (subcommands missing) | `env-capability-mismatch` / `blocker` | New P0 capability-probe step in `SKILL.md` |
| Planner emitted `resourceNode`, `label/sublabel`, bidirectional connectors | `agent-output-corrected` / `corrected` — three aggregated entries (one per correction kind, with counts in `details`) | P3 normalization step, made explicit in `SKILL.md` |

Both v1 gaps closed.

## Migration from v1

One-shot migration script (run once per machine, idempotent):

1. If `~/.seeflow/consent.json` exists:
   - Read it; map to `skills.seeflow` shape; merge into
     `~/.claude/feedback/consent.json` (create if absent).
   - `mv ~/.seeflow/consent.json ~/.seeflow/consent.json.v1.bak`.
2. If `~/.seeflow/feedback.md` exists:
   - Stream blocks to `~/.claude/feedback/feedback.md`, injecting
     `skill: seeflow` and `severity: failure` (v1 had no severity
     field; failure is the safest default since v1 only logged hard
     failures).
   - `mv ~/.seeflow/feedback.md ~/.seeflow/feedback.md.v1.bak`.
3. Print "Migrated v1 feedback to ~/.claude/feedback/. Old files
   backed up with .v1.bak."

Script lives at `~/.claude/feedback/bin/migrate-v1.sh`. Invoked once
by the seeflow `SessionStart` hook on the first session post-upgrade;
no-ops if both v1 files already absent.

## Execution order

Each step independently shippable; recommended order:

1. **Protocol doc + `log.sh`** — write `~/.claude/feedback-protocol.md`
   and `~/.claude/feedback/bin/log.sh`. Standalone, no skill changes.
2. **Generic `SessionEnd` hook** — `~/.claude/feedback/bin/transfer.sh`.
   Same: standalone.
3. **seeflow adoption** — refactor `skills/seeflow/feedback.md`, add
   `seeflow/kinds.txt`, update `SKILL.md` Phase 0 + Phase 3
   instrumentation, swap consent prompt to write the new shape, ship
   the migration script.
4. **Verification** — run /seeflow against a project that triggers
   each instrumentation point; inspect `~/.claude/feedback/feedback.md`
   for the expected blocks.

## Out of scope

- A central feedback dashboard. Each skill's `transferUrl` is
  independent; analytics happen on the receiving end.
- Cross-skill kind discovery / linting. Skills validate their own
  catalog; the protocol doesn't.
- Schema evolution beyond `version: 1`. Future versions extend the
  block format with new optional fields; readers ignore unknown
  fields.
