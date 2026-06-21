# SeeFlow Skill — CLI Migration, Phase 2 (Skill rewrite) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite `skills/seeflow/` to drive the studio exclusively through the new `seeflow <subcommand>` CLI. Drop the file-authoring → validate → register dance. Compress the pipeline to 6 phases. Delete the helper-script bundle entirely — the CLI subsumes it.

**Architecture:** Three reference docs (`cli.md` new, `operations.md` rewritten, `schema.md` edited), three agent prompts updated to emit patch-shaped overlays, the top-level `SKILL.md` rewritten with the compressed pipeline, and the `skills/seeflow/scripts/` directory deleted. No code changes — all docs and agent prompts.

**Tech Stack:** Plain Markdown. Agents are pure-text contracts; the schemas inside them are JSONC examples that the orchestrator reads.

**Source of truth:** `docs/plans/2026-05-21-seeflow-skill-cli-migration-design.md` §"Skill changes".

**Hard prerequisite:** Phase 1 (`…-phase-1-cli.md`) is merged. Every CLI subcommand referenced below must be reachable as `npx -y @tuongaz/seeflow@latest <sub> …`. If Phase 1 isn't done, stop and ship Phase 1 first.

**Pre-flight (do once, before Task 1):**
- Verify Phase 1 shipped: `bun apps/studio/src/cli.ts --help | grep nodes:add-bulk` must return a line.
- Boot a studio in another terminal: `bun run dev` — keep it up while iterating; the integration smoke at the end needs it.
- Note current SKILL.md line count: `wc -l skills/seeflow/SKILL.md` — record so we can verify the rewrite stays ≤ 350 lines.

---

## Task 1: NEW `skills/seeflow/references/cli.md`

**Why:** The skill's new pipeline calls 8–10 distinct CLI subcommands. The orchestrator needs one place to look up invocation, body shape, and error modes per subcommand. Keep ≤ 200 lines (design constraint).

**Files:**
- Create: `skills/seeflow/references/cli.md`

### Step 1: Draft the file

Use this skeleton — fill each subcommand section with: one-line summary, `bash` invocation, body JSON shape (if applicable), output JSON shape, common errors.

```markdown
# CLI reference

Every flow-management operation is a `seeflow <subcommand>` invocation. The
CLI ships with the studio package — version sync is automatic. Bodies arrive
via exactly one of `--file <path>`, `--stdin`, or `--json '<inline>'`. Output
is JSON to stdout on success, plain text to stderr on failure, exit `0`/`1`.

## Discovery

- `seeflow flows:list` — list registered flows. Output: `{ok:true, flows:[…]}`.
- `seeflow flows:get <flowId>` — read a single flow. Output: `{ok:true, id, slug, name, filePath, flow, valid, error}`.

## Project lifecycle

### projects:create

Create a fresh project under `~/.seeflow/<slug>/` (or `$SEEFLOW_WORKSPACE/.seeflow/<slug>/` in Docker) and register it.

```bash
seeflow projects:create --name "Order Pipeline"
```

Output:
```json
{ "ok": true, "id": "…", "slug": "order-pipeline", "scaffolded": true }
```

Errors: `badSchema` (invalid name), `scaffoldFailed`.

### flows:register

(Backwards-compat alias of the legacy `register`.) Register a flow already on
disk. Used when the user authored a flow by hand and wants the studio to pick
it up.

…

## Node mutations

### nodes:add-bulk

POST 1-100 nodes atomically. Either all land or none.

```bash
seeflow nodes:add-bulk <flowId> --file /tmp/sf-nodes-<flowId>.json
```

Body:
```json
{ "nodes": [ {"id":"…","type":"playNode","data":{…}}, … ] }
```

Output:
```json
{ "ok": true, "nodes": [ {"id":"…"}, … ] }
```

Errors: `duplicateIdInBatch`, `idAlreadyExists`, `badSchema` (with `issues[]`).

### nodes:patch

…

## Connector mutations

…

## Layout

### flows:layout

Re-run ELK and overwrite `style.json` positions. Cheap; safe to call after any
batch of mutations.

```bash
seeflow flows:layout <flowId>
```

## Validation + e2e

### validate

Stateless schema check — no registry side effects.

```bash
seeflow validate --file flow.json [--style style.json]
```

### e2e

Replaces the old `validate-end-to-end.ts` helper.

```bash
seeflow e2e <flowId> [--skip-nodes id1,id2]
```

Drives `/api/events` SSE and `/play/:nodeId`. Output:
```json
{ "ok": true, "plays": [...], "statuses": [...], "skipped": [...] }
```

## Common error envelopes

| `kind` | HTTP | Recovery |
|---|---|---|
| `flowNotFound` | 404 | re-list, fix the id |
| `fileNotFound` | 404 | the project moved — re-register |
| `badJson` | 400 | malformed body — fix and retry |
| `badSchema` | 400 | look at `issues[]`, feed back to the producing agent |
| `duplicateIdInBatch` | 400 | dedupe your own payload |
| `idAlreadyExists` | 409 | rename or delete the existing node first |
| `writeFailed` | 500 | retry once; if it persists, the disk is unhappy |
```

Fill every elided `…` with the same micro-format. The full list is in the
design doc CLI table — keep this file ≤ 200 lines by using short examples,
one per subcommand.

### Step 2: Verify length

Run: `wc -l skills/seeflow/references/cli.md`

Expected: ≤ 200 lines. If over, tighten examples — do not split into a second file.

### Step 3: Commit

```bash
git add skills/seeflow/references/cli.md
git commit -m "docs(skill): add CLI reference"
```

---

## Task 2: EDIT `skills/seeflow/references/schema.md`

**Why:** Two things changed structurally: (1) the studio owns `style.json` end-to-end now, so the "never skip style.json" callout is stale; (2) per-node files live under `.seeflow/nodes/<nodeId>/` and `scriptPath` is relative to that anchor — the schema reference should be the one place that explains this.

**Files:**
- Modify: `skills/seeflow/references/schema.md`

### Step 1: Remove the stale style.json guidance

Run: `grep -n "never skip style\|style.json" skills/seeflow/references/schema.md`

For every match that asserts the skill must hand-author style.json: delete the line or the surrounding callout. The studio's ELK pass writes positions; the skill never authors them.

Keep mentions of style.json's *role* in the system (positions live in style.json after split) — those are still true.

### Step 2: Add a "Per-node file convention" subsection

Insert a new subsection near the top (under the schema overview, before the per-node-type breakdown):

```markdown
## Per-node file convention

Every file owned by a node lives in `<project>/.seeflow/nodes/<nodeId>/`:

```
.seeflow/
├── flow.json
├── style.json
└── nodes/
    └── <nodeId>/
        ├── detail.md          # auto-externalized from data.detail
        ├── view.html          # auto-externalized from data.html (htmlNode)
        └── scripts/
            ├── play.ts
            └── status.ts
```

`scriptPath` in `playAction` / `statusAction` is **relative to the node
folder** — no `<slug>/` prefix, no `<nodeId>/` prefix:

```json
"playAction": {
  "kind": "script",
  "interpreter": "bun",
  "scriptPath": "scripts/play.ts"
}
```

The studio's resolver prepends `.seeflow/nodes/<nodeId>/` and rejects any path
that escapes the node folder (`..`, absolute paths). Deleting the node
cascade-deletes the whole folder — there are no stranded scripts.
```

### Step 3: Update the `playAction` example

Find the existing `playAction` example block (likely under "Actions" or
"playNode"). Update its `scriptPath` to the new relative form
(`scripts/play.ts`, not `<slug>/scripts/play.ts`).

### Step 4: Sanity-grep

Run: `grep -n "scriptPath" skills/seeflow/references/schema.md`

Every match should be the new relative form. No `<slug>/scripts/…` remnants.

### Step 5: Commit

```bash
git add skills/seeflow/references/schema.md
git commit -m "docs(skill): document per-node file convention; drop style.json hand-authoring"
```

---

## Task 3: REWRITE `skills/seeflow/references/operations.md`

**Why:** The old file documents the helper scripts (`register.ts`, `validate.ts`, …). Those scripts are deleted in Task 8 — the operations reference must point at the new CLI subcommands instead. Keep the error-handling table; drop the rows that referenced deleted scripts.

**Files:**
- Modify: `skills/seeflow/references/operations.md`

### Step 1: Read the current file

Run: `cat skills/seeflow/references/operations.md`

Note which sections to preserve verbatim (error-handling table, retry caps),
which to replace (helper-scripts table), and which to delete (anything about
authoring `flow.json` directly).

### Step 2: Rewrite

Replace the helper-scripts table with a CLI subcommand table that mirrors the
table in the design doc (Phase 1 §"4. apps/studio/src/cli.ts"), plus a
per-command flag reference column. Don't duplicate `references/cli.md`'s
per-subcommand body — link to it instead:

```markdown
## CLI subcommands

Full per-subcommand reference: see `references/cli.md`. Quick lookup:

| Phase | Subcommand | Purpose |
|---|---|---|
| P3 | `projects:create` | Scaffold + register new project |
| P3 | `nodes:add-bulk` | Atomic seed of skeleton nodes |
| P3 | `connectors:add-bulk` | Atomic seed of skeleton connectors |
| P3 | `flows:layout` | Run ELK; rewrite style.json positions |
| P5 | `nodes:patch` | Attach playAction / statusAction / stateSource |
| P5 | `nodes:add-bulk` | Inject synthetic trigger nodes |
| P5 | `connectors:add-bulk` | Wire trigger nodes |
| P5 | `flows:layout` | Re-layout after Phase 5 changes |
| P6 | `e2e` | End-to-end validation via SSE |

Discovery (any phase): `flows:list`, `flows:get`.
```

### Step 3: Keep the error-handling table; prune dead rows

The existing error table is still useful. Walk every row — anything that
referenced `validate.ts`, `register.ts`, `unregister.ts`, `refresh-layout.ts`,
or `validate-end-to-end.ts` must be re-pointed at the CLI subcommand that
replaces it, or deleted if it's no longer reachable.

### Step 4: Verify length

Run: `wc -l skills/seeflow/references/operations.md`

Expected: shorter than the current version (the helper-scripts table goes
away). If it grew, audit for duplication with `cli.md`.

### Step 5: Commit

```bash
git add skills/seeflow/references/operations.md
git commit -m "docs(skill): rewrite operations.md around CLI subcommands"
```

---

## Task 4: EDIT `skills/seeflow/agents/seeflow-node-planner.md`

**Why:** Today the planner emits a free-form flow JSON. The orchestrator now feeds the planner's `nodes` and `connectors` arrays straight into `nodes:add-bulk` and `connectors:add-bulk` — the shapes must match those CLI bodies exactly.

**Files:**
- Modify: `skills/seeflow/agents/seeflow-node-planner.md`

### Step 1: Locate the existing output schema

Run: `grep -n "Output\|nodes:\|connectors:\|position\|playAction\|statusAction" skills/seeflow/agents/seeflow-node-planner.md | head -40`

The planner's output schema is documented around a code block titled
"Output" or similar.

### Step 2: Replace the output schema

The new schema:

```jsonc
{
  "name": "Order Pipeline",
  "slug": "order-pipeline",
  "nodes": [
    {
      "id": "post-orders",
      "type": "playNode",
      "data": {
        "name": "POST /orders",
        "kind": "service",
        "icon": "package",
        "stateSource": { "kind": "request" }
      }
    }
  ],
  "connectors": [
    { "id": "post-orders__inventory", "kind": "event", "source": "post-orders", "target": "inventory-service" }
  ]
}
```

Rules to document inline:
- **No `position`** at the node root — the studio's ELK layout writes it.
- **No `playAction` / `statusAction`** — those come in Phase 5 from the designers.
- **No visual fields** (border, color, …) — Phase 5 designers may patch them later if needed.
- `data.name`, `data.kind`, `data.icon`, `data.stateSource` are the only data
  keys the planner emits.

Strip every example in the file that violates these rules.

### Step 3: Verify

Run: `grep -n "position\|playAction\|statusAction" skills/seeflow/agents/seeflow-node-planner.md`

Expected: no matches in the planner's output examples (they may still appear
in *prose* explaining what the planner does NOT emit — that's fine).

### Step 4: Commit

```bash
git add skills/seeflow/agents/seeflow-node-planner.md
git commit -m "docs(agent): node-planner emits nodes:add-bulk-shaped payloads"
```

---

## Task 5: EDIT `skills/seeflow/agents/seeflow-play-designer.md` + `seeflow-status-designer.md`

**Why:** Both designers currently emit `{ nodeId, dataPatch, scriptPath, scriptBody }` with scriptPath in the legacy `<slug>/scripts/…` form. The orchestrator now writes the script file and runs `nodes:patch <flowId> <nodeId> --json '<patch>'`. The output shape must match what the orchestrator consumes.

**Files:**
- Modify: `skills/seeflow/agents/seeflow-play-designer.md`
- Modify: `skills/seeflow/agents/seeflow-status-designer.md`

### Step 1: Update `seeflow-play-designer.md`

Replace the existing `playOverlays[]` schema definition with the new triple:

```jsonc
{
  "playOverlays": [
    {
      "nodeId": "post-orders",
      "patch": {
        "description": "Receives a cart, creates an order.",
        "detail": "…long markdown…",
        "playAction": {
          "kind": "script",
          "interpreter": "bun",
          "args": ["run"],
          "scriptPath": "scripts/play.ts",
          "input": { "items": [{ "sku": "ABC", "qty": 1 }] },
          "timeoutMs": 30000
        }
      },
      "scriptFile": {
        "path": ".seeflow/nodes/post-orders/scripts/play.ts",
        "body": "#!/usr/bin/env bun\n…",
        "chmod": "755"
      },
      "validationSafe": true,
      "rationale": "Triggers the real /orders endpoint with a known-good cart."
    }
  ],
  "newTriggerNodes": [
    /* zero or more synthetic source nodes, in `nodes:add-bulk` shape (Task 4) */
  ]
}
```

Document inline that:
- `patch` is the exact body for `seeflow nodes:patch <flowId> <nodeId> --json '<patch>'`.
- `scriptFile.path` is **absolute relative to the project root** (`.seeflow/nodes/<nodeId>/scripts/<name>`) — the orchestrator passes it straight to the `Write` tool.
- `scriptFile.body` includes the shebang.
- `playAction.scriptPath` is relative to the node folder (`scripts/play.ts`) — not the project root.
- `newTriggerNodes[]` items follow Task 4's planner schema.

Delete any examples that still use the legacy `<slug>/scripts/…` scriptPath form.

### Step 2: Update `seeflow-status-designer.md`

Same change, s/playOverlays/statusOverlays/. The patch contains `statusAction` instead of `playAction`. Otherwise identical.

### Step 3: Verify

Run: `grep -n "scriptPath\|scriptBody\|dataPatch" skills/seeflow/agents/seeflow-play-designer.md skills/seeflow/agents/seeflow-status-designer.md`

Expected:
- `scriptPath` references all use the relative form (no `<slug>/`).
- `scriptBody` only appears in *removed* contexts — replaced by `scriptFile.body`.
- `dataPatch` removed entirely (the field is now `patch`).

### Step 4: Commit

```bash
git add skills/seeflow/agents/seeflow-play-designer.md skills/seeflow/agents/seeflow-status-designer.md
git commit -m "docs(agent): designers emit {patch, scriptFile} triples"
```

---

## Task 6: REWRITE `skills/seeflow/SKILL.md`

**Why:** The current SKILL.md (240 lines) embeds Phase-1 wrong/right blocks in multiple places, duplicates callouts the studio API now enforces, and documents the 8-phase flow with file-authoring + standalone validation. The rewrite compresses to 6 phases (P0+P0.5, P1, P2, P3+P3.5, P4, P5, P6) and routes every flow op through the CLI.

**Files:**
- Modify: `skills/seeflow/SKILL.md`

**Hygiene constraints (apply `superpowers:writing-skills`):**
- Description ≤ 500 chars, leads with "Use when …", lists concrete triggers.
- One canonical wrong/right block (Phase 1 parallelism), referenced from later phases.
- Cross-refs use `references/<file>.md` — no `@` force-loads.
- Target ≤ 350 lines total.

### Step 1: Confirm what's deleted vs preserved

Read the current file end-to-end (it's only 240 lines). The new pipeline narrative from the design doc:

```
P0     /health probe ‖ read WIKI.md
P1     code-analyzer ‖ system-analyzer
P2     node-planner (kicks off when code-analyzer returns; system-analyzer
       continues in background)
P3     projects:create → nodes:add-bulk → connectors:add-bulk
       → flows:layout → USER REVIEW
P3.5   dynamic gate (continue with scripts, or stop static?)
P4     play-designer ‖ status-designer
P5     write scripts to .seeflow/nodes/<nodeId>/scripts/
       + nodes:patch (per node, with playAction / statusAction)
       + inject trigger nodes via nodes:add-bulk + connectors:add-bulk
       + flows:layout
P6     e2e (was P7)
```

Preserve: Conventions table, Core rules summary, Common mistakes (pruned),
Operations refs table at the bottom.

Delete: the standalone Phase 5 validate-retry loop (the API now validates on
every write), the Phase 3 "validate → register" sequence (replaced by
`projects:create → nodes:add-bulk → connectors:add-bulk → flows:layout`), the
"never skip style.json" callout, every Phase reference to `bun "$SF/scripts/…"`.

### Step 2: Draft each phase

#### Phase 0 + 0.5 — pre-flight (parallel)

```markdown
## Phase 0 + 0.5 — pre-flight (parallel)

In a single message:

1. `curl --max-time 0.5 -fsS "$STUDIO_URL/health"`
2. Read `<project>/.seeflow/WIKI.md` if present → `wikiContext` (else `null`).
   Format: `references/wiki-format.md`.

- **200** → Phase 1.
- **!200** → tell the user the studio isn't running, warn that the first
  launch can take a minute or two while npx downloads, then:

  ```bash
  npx -y @tuongaz/seeflow@latest start
  ```

  Re-probe `/health` once. If still unreachable, surface and stop.
```

#### Phase 1 — discover (parallel)

Move the wrong/right parallelism block here as the canonical pattern. Later
phases just say "Phase 1 parallelism rule" rather than repeating.

Keep the in-line analyzer schema summaries (in/out) and the `wikiUpdates`
contract note.

#### Phase 1 → Phase 2 overlap

Preserve verbatim from the current SKILL.md (it's still accurate).

#### Phase 2 — plan nodes

Update the planner output sentence to reference Task 4's schema (no
positions, no playAction/statusAction). Cross-ref:
`agents/seeflow-node-planner.md`.

#### Phase 3 — scaffold + populate + layout + review

```markdown
## Phase 3 — scaffold, populate, layout, review

The skeleton flow lands via three CLI calls — no `flow.json` authoring.

```bash
seeflow projects:create --name "<flowName>" \
  | jq -r '.id, .slug' \
  | { read id; read slug; echo "id=$id slug=$slug"; }

# Write the planner's nodes payload to a temp file
echo '<nodesJSON>' > /tmp/sf-nodes-$id.json
seeflow nodes:add-bulk "$id" --file /tmp/sf-nodes-$id.json

echo '<connectorsJSON>' > /tmp/sf-conns-$id.json
seeflow connectors:add-bulk "$id" --file /tmp/sf-conns-$id.json

seeflow flows:layout "$id"
```

Each CLI call validates server-side (the studio re-runs ResolvedFlowSchema on
every write). A `badSchema` exit means feed the issues back to the planner and
retry — no separate validation step.

Open the canvas and ask:

```bash
URL="$STUDIO_URL/d/$slug"
(open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || start "$URL" 2>/dev/null) &
```

> Opened the canvas at `<url>`. Layout look right? Any additions, removals, or
> renames?

Changes → re-run node-planner, repeat. Approved → Phase 3.5.
```

#### Phase 3.5 — dynamic gate

Preserve from current SKILL.md.

#### Phase 4 — design Play + Status (parallel)

Preserve the parallelism note (cross-ref Phase 1 rule). Update the schemas
section to point at the new `{ nodeId, patch, scriptFile }` triple — cross-ref
`agents/seeflow-play-designer.md` and `agents/seeflow-status-designer.md`.

#### Phase 5 — patch overlays + layout

```markdown
## Phase 5 — patch overlays + layout

For each overlay returned by Phase 4:

1. Write `scriptFile.body` to `scriptFile.path` (Write tool).
2. `chmod` per `scriptFile.chmod` (default 755).
3. `seeflow nodes:patch <flowId> <nodeId> --json '<patch>'`.

If the planner emitted `newTriggerNodes`, batch them:

```bash
seeflow nodes:add-bulk "$id" --file /tmp/sf-triggers-$id.json
seeflow connectors:add-bulk "$id" --file /tmp/sf-trigger-conns-$id.json
```

Then re-layout:

```bash
seeflow flows:layout "$id"
```

**Retry budget:** per-node `nodes:patch` failure → re-dispatch *that one*
designer with the Zod issues, retry, max 3 per node. Parallelise re-dispatches
when more than one node failed (Phase 1 rule).
```

#### Phase 6 — end-to-end validation

```markdown
## Phase 6 — end-to-end validation

**Must run. Do not skip or simulate.**

```bash
seeflow e2e "$id" [--skip-nodes <id1>,<id2>]
```

Pass `--skip-nodes` when `unsafeNodeIds` from Phase 4 is non-empty (third-party
or paid actions). Skipped nodes appear in `skipped[]`, not as failures.

Output: `{ok, plays, statuses, skipped}`. Hard ceiling ~2 min.

**`ok: true`** → print
`Flow "<name>" registered as <slug>. Open: $STUDIO_URL/d/<slug>`. Done.

**`ok: false`** fix-up loop:
1. Identify failing nodes from `plays[*].error` / `statuses[*].outcome`.
2. **Parallel fix-up (Phase 1 rule):** one sub-agent per failing script,
   single message. A single agent fixing N scripts cross-contaminates.
3. Each agent gets the script path, the specific error payload, and a concrete
   fix hypothesis (`play.ts: ECONNREFUSED on :3001 — start the app first`).
4. Edit in-place, re-run Phase 6. **Max 2 retries**, then ask retry / stop.

### Polish WIKI.md with anything learned

(Preserve current wording — still accurate.)
```

#### Operations table (bottom)

Update the topic table:

```markdown
| Topic | File |
|---|---|
| CLI subcommand reference | `references/cli.md` |
| Error handling, retry caps, sub-agent table | `references/operations.md` |
| Schema, per-node file convention, action shapes | `references/schema.md` |
| Core rules | `references/core-rules.md` |
| `WIKI.md` format | `references/wiki-format.md` |
| Tech-specific best practices | `references/tech/README.md` |
| Sub-agent prompts | `agents/seeflow-*.md` |
```

Drop the `plan-format.md` row if Phase 5's plan-presentation is no longer a
distinct artifact (it likely isn't — the patch payloads are self-describing).

### Step 3: Verify line count + description

Run: `wc -l skills/seeflow/SKILL.md`

Expected: ≤ 350. If over, prune Common mistakes (keep only the ones still
applicable post-CLI migration).

Check the frontmatter `description:` is ≤ 500 chars and starts with "Use when …".

### Step 4: Sanity grep — no stale references

```bash
grep -n "bun \"\$SF/scripts/\|validate.ts\|refresh-layout.ts\|register.ts\|unregister.ts\|validate-end-to-end.ts" \
  skills/seeflow/SKILL.md
```

Expected: no matches.

```bash
grep -n "<slug>/scripts/" skills/seeflow/SKILL.md
```

Expected: no matches (scriptPath is relative to the node folder now).

### Step 5: Commit

```bash
git add skills/seeflow/SKILL.md
git commit -m "docs(skill): rewrite SKILL.md for CLI-driven pipeline"
```

---

## Task 7: DELETE `skills/seeflow/scripts/`

**Why:** Every helper is now a CLI subcommand. Leaving the directory in place invites the skill to drift back to script-driven authoring.

**Files:**
- Delete: entire `skills/seeflow/scripts/` directory (12 files including tests)

### Step 1: Confirm nothing imports from `scripts/`

```bash
grep -rn "skills/seeflow/scripts\|scripts/register\|scripts/validate\|scripts/refresh-layout\|scripts/unregister\|scripts/validate-end-to-end\|scripts/smoke\|scripts/studio-config" \
  skills/seeflow/ apps/ packages/
```

Expected: only matches are inside `skills/seeflow/scripts/` itself (mutual
imports between sibling helpers). Anything in `SKILL.md`, references,
or agents should have been cleaned up in Tasks 3-6 — if a match falls out
here, fix that file before deleting.

### Step 2: Delete

```bash
git rm -r skills/seeflow/scripts/
```

### Step 3: Re-run the sanity grep

```bash
grep -rn "skills/seeflow/scripts" skills/seeflow/
```

Expected: zero matches.

### Step 4: Commit

```bash
git commit -m "chore(skill): delete legacy scripts/ — CLI subsumes them"
```

---

## Task 8: Integration smoke — run the skill end-to-end

**Why:** Docs lie. Run the rewritten skill against a real fixture project to confirm Phase 3 → Phase 6 actually work with the new CLI surface.

### Step 1: Pick a fixture

Use the seeded `order-pipeline` example as the fixture project — copy it to a
tmp dir so the smoke doesn't pollute `~/.seeflow/`:

```bash
SMOKE=$(mktemp -d)
cp -r apps/studio/examples/order-pipeline/* "$SMOKE/"
cd "$SMOKE"
```

### Step 2: Run the skill

In Claude Code, invoke `/seeflow` with a prompt like:

> Re-generate the demo for this checkout pipeline.

Step through every phase. Each CLI call should print `{"ok":true,…}` to
stdout, exit 0. Phase 3 should open the canvas; Phase 6 should report
`ok: true`.

### Step 3: Failure-mode probe

Manually corrupt one node's data payload (set `data.kind` to an unknown
string) and re-run Phase 3 — the CLI should exit 1 with a `badSchema` error,
and the skill's retry loop should kick in.

### Step 4: Restore fixture

```bash
cd -
rm -rf "$SMOKE"
```

### Step 5: Capture learnings → WIKI.md

If the smoke surfaced any quirks (CLI flag that should default differently,
error message that's unhelpful, missing subcommand), file follow-ups — do NOT
patch them here. This phase ships the docs; CLI tweaks ship in a Phase 1
follow-up.

---

## Definition of Done (Phase 2)

- [ ] `wc -l skills/seeflow/SKILL.md` ≤ 350.
- [ ] `wc -l skills/seeflow/references/cli.md` ≤ 200.
- [ ] `grep -rn "scripts/register\|scripts/validate\|scripts/refresh-layout\|scripts/unregister\|scripts/validate-end-to-end" skills/` returns zero matches.
- [ ] `grep -rn "bun \"\$SF/scripts/" skills/` returns zero matches.
- [ ] `grep -rn "<slug>/scripts/" skills/` returns zero matches.
- [ ] `skills/seeflow/scripts/` directory is gone.
- [ ] Integration smoke (Task 8) executed end-to-end on a fixture project.
- [ ] Open follow-ups from the design doc (resetAction, MCP-mode revival, seeded example migration) tracked in their own issue or scratchpad — not blocking.

---

**Plan complete.** Both phase files saved:

- `docs/plans/2026-05-21-seeflow-skill-cli-migration-phase-1-cli.md`
- `docs/plans/2026-05-21-seeflow-skill-cli-migration-phase-2-skill.md`

Two execution options:

1. **Subagent-Driven (this session)** — fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`.
2. **Parallel Session (separate)** — open a new session with `superpowers:executing-plans`, batch execution with checkpoints.

Recommendation: ship Phase 1 first (Subagent-Driven), open Phase 2 in a fresh
session once Phase 1 lands — Phase 2 depends on the CLI being callable.
