# Phase 3 — scaffold, populate, layout, review

The skeleton flow lands via seven steps, in order. No `seeflow.json` or `flow.json` authoring by hand — `projects:create` writes BOTH the manifest and the first flow envelope in one shot. Run `$SEEFLOW help <command>` for each subcommand's body shape and flags.

## 1. Scaffold + register inside the project via `projects:create`

This is the entry point for a new project: the CLI writes both `<repoPath>/seeflow.json` (manifest with a single `flows[]` entry `{ id: 'main', name: 'Main' }`) AND `<repoPath>/flows/main/flow.json` (empty envelope) in one shot, then registers every declared flow.

### Existing-project gate — check before the CLI write

Test `test -f "$repoPath/seeflow.json"`. If the manifest exists (or `projects:create` later returns `alreadyExists` exit code 4 because the pre-check raced), STOP and ask via `AskUserQuestion` — **never silently overwrite, never silently fall back**:

> A SeeFlow project is already registered at this path. What do you want to do?
>
> 1. **Open the existing project** *(Recommended)* — skip creation; run `$SEEFLOW register --path "$repoPath"` to re-scan the manifest and re-attach every declared flow, surface `$STUDIO_URL/projects/<projectSlug>/flows/<defaultFlowSlug>`, then stop. If the user wanted to inspect rather than edit, hand off to `/seeflow-lookup`.
> 2. **Create a new project with a different name** — ask the user for a new project name, recompute `$repoPath = $PWD/.seeflow/<new-slug>`, then retry this step (Phase 1/2 only rerun if the user's intent also changed).
> 3. **Overwrite the existing project** — destructive. Confirm once more, then `rm -rf "$repoPath"` and retry this step.

**No legacy fallback.** A bare `<repoPath>/flow.json` at the project root is *not* a valid SeeFlow project anymore — the scanner returns `legacy-root-flow` and refuses to register it. If you find one from an older skill run, surface that explicitly to the user and ask for permission to migrate it into the new `flows/main/` layout before continuing.

Gate clear → forward the planner-supplied `name` (and `description` if the planner provided one):

```bash
$SEEFLOW projects:create --path "$repoPath" --name "$plannerName" [--description "$plannerDescription"]
```

The studio writes both files, adds the project's flow entries to `~/.seeflow/registry.json`, and returns `{ ok: true, id, slug }` where `slug` is the **combined** `"<projectSlug>/<flowSlug>"` (e.g. `{"ok":true,"id":"HRXWjP4SJF","slug":"order-pipeline/main"}`). There is no `projectSlug`, `flowSlug`, or `entries[]` field — split the `slug` yourself: **`$projectSlug = slug.split('/')[0]`, `$flowSlug = slug.split('/')[1]`** (a fresh `projects:create` always yields `flowSlug: 'main'`). These are the addressing inputs (`--project $projectSlug --flow $flowSlug`) for every follow-up CLI call below. The studio derives `projectSlug` as `slugify(--name)`, which may **not** match the planner's `slug` field (e.g. planner `slug: "tms-schedulers-checkpoint"` but `--name "…Checkpoint Mechanism"` → `projectSlug: "tms-schedulers-checkpoint-mechanism"`). When they differ, **discard the planner's slug** and use the response value — if you carry the planner's slug forward, `flow:add-bulk` and `flows:layout` fail with `projectNotFound`. **Registration is a precondition for opening the canvas:** the `$STUDIO_URL/projects/<projectSlug>/flows/<flowSlug>` route only works after this step succeeds — never surface the canvas URL before this step.

If `projects:create` returns `alreadyExists` (code 4) after the pre-check passed (filesystem race), loop back to the gate above and let the user decide — do not auto-fall-back. Do not hardcode the envelope shape from memory; to inspect what `projects:create` writes, run `$SEEFLOW schema flow`. Subsequent flows in the same project use `flows:create --project $projectSlug --flow <flowSlug> --name <name>` — not `projects:create` again.

## 2. Normalize the planner output

Strip `rationales` (keep them in memory for the review prompt below). The remaining `nodes` / `connectors` arrays are forwarded as-is to `flow:add-bulk` after the id rewrite in step 3 — the planner already conformed them to `$SEEFLOW schema node` / `connector`. If any node carries a key the contract rejects (a leaked connector-only field, an adjacent-domain key), strip it here before the batch.

## 3. Mint canonical ids

Planner ids are descriptive (`checkout-api`, `c-order-server-event-bus`); the studio's id producers (canvas, server auto-assign, the upload endpoint regex) use `node-<10 base62>` / `conn-<10 base62>`. Rewrite at the boundary so flow.json matches. Use the CLI — it shares the exact alphabet and rejection-sampling logic with every other id producer in the studio:

```bash
mapfile -t nodeIds < <($SEEFLOW ids node "${#nodes[@]}")
mapfile -t connIds < <($SEEFLOW ids connector "${#connectors[@]}")
```

For each `nodes[i].id` that already matches `^node-[A-Za-z0-9]{10}$` (edit-case reuse from `editTarget`), keep it; only mint new canonical ids for net-new nodes. Build a `descriptiveId → canonicalId` map and rewrite:

- `nodes[].id`
- `connectors[].id`, `connectors[].source`, `connectors[].target`
- `rationales` keys (kept in memory for the review prompt)

**`user-to-system-rectangle` retype rule.** If the planner shipped `type:'user'` for a node whose `data.name` is clearly a software system (`Web UI`, `Mobile App`, `Browser`, `SPA`, `Desktop Client`, `CLI`, `SDK`, anything ending in `Client`/`App`/`UI`/`Frontend`/`Service`), silently retype to `rectangle` with `data.icon` inferred from the name (`monitor` for web/UI/frontend, `smartphone` for mobile, `terminal` for CLI, `plug` for SDK/Client). Keep `type:'user'` only when `data.name` is a human role (`Customer`, `Support Agent`, `Reviewer`, `Approver`, `Operator`). The Phase 3 canvas review surfaces the result to the user — the correction is visible.

## 4. `flow:add-bulk`

Atomic seed of nodes + connectors in one transactional write. Forward the normalized + id-rewritten `nodes` and `connectors` arrays as `{ nodes, connectors }`. Connectors may reference nodes from the same call — the server validates the merged graph as a whole, so a dangling source/target or a malformed node rolls back **both** arrays together. No two-phase commit to reason about; no orphan nodes if connectors fail.

## 5. Detail backfill — runs unconditionally

Every input class. Walk the planner's `nodes[]` (post-id-rewrite). For each non-decorative node — `rectangle`, `database`, `queue`, `cloud`, `server`, `user` (skip `sticky`, `text`, `icon`, `ellipse`, `image`, `component`, `html`; those carry content in other fields) — check whether `data.detail` was set in the planner output:

- **Present** — already externalised by `flow:add-bulk` to `nodes/<id>/detail.md`. Nothing to do.
- **Missing or empty** — synthesise 1–3 short markdown paragraphs from `data.name` + `data.description` + the matching `rationales[id]` + any relevant `codePointers[].why` (and the staged `dataEntryPaths` / `techAdaptations` from the Phase 1 → 2 overlap when they sharpen the prose). Push via `nodes:patch --project "$projectSlug" --flow "$flowSlug" <nodeId> --json '{"data":{"detail":"<markdown>"}}'`. The studio writes `<repoPath>/flows/<flowSlug>/nodes/<id>/detail.md` and stores a `file://` ref.

Parallelise the patches across nodes — single message, N Bash calls. This is the detail safety net described in `../../agents/seeflow-node-planner.md` § "Semantic requirements".

## 6. `flows:layout`

Run ELK and write `style.json`:

```bash
$SEEFLOW flows:layout --project "$projectSlug" --flow "$flowSlug"
```

## 7. Silent LEARN.md write

The single disk hit for `$learnPath` per run. Merges staged `learnUpdates` from Phase 1 → 2 overlap AND upserts the "Flows already created" row by `<projectSlug>/<flowSlug>` with today's date + a one-line purpose. Full merge contract, field list, and ~6 KB cap rule live in `../learn-format.md` § "Lifecycle" + § "Merging rules". Run quietly — do **not** narrate to the user. Create `$PWD/.seeflow/` if missing.

If the user review below applies layout edits, re-run this write afterward (idempotent upsert by `<projectSlug>/<flowSlug>`) so any new fact the edits surfaced lands too.

---

Each call validates server-side. A `badSchema` exit means feed the issues back to the planner and retry — no separate validation step.

## User review

Open the canvas, surface the planner's `rationales` per node — prefix each with `<data.name> (<canonical id>):` so the human sees a readable anchor despite the opaque id (`POST /orders (node-Ab12cd34Ef): Single HTTP service — internal routes are implementation detail.`) — and ask **one question** about the layout:

```bash
URL="$STUDIO_URL/projects/$projectSlug/flows/$flowSlug"
(open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || start "$URL" 2>/dev/null) &
```

> Opened the canvas at `<url>`. Any additions, removals, or renames?

**Wait once.** Parse the answer from the reply.

- **No changes** → finalise (below).
- **Layout changes requested** → branch on how scoped the change is:
  - **Small, fully-specified edit** (the user names exactly what to add / rename / drop — "add two component nodes for X and Y", "rename `orders-db` to `orders-db-write`", "remove the cache node") and the overall intent is unchanged → **apply it directly**, no planner round-trip. New nodes/connectors via `flow:add-bulk` (mint ids with `$SEEFLOW ids` first, run detail-backfill on any new non-decorative node), field edits via `nodes:patch`, removals via `nodes:delete`; then re-run `flows:layout`. Re-surface the canvas, then finalise. The planner exists to turn an open-ended brief into a graph, not to relay a two-node tweak the user already spelled out.
  - **Substantive change** (new or shifted intent, structural rethink, vague feedback that needs modelling judgment — "make it look more like our actual pipeline", "this is missing the whole billing side") → re-run node-planner with the feedback, re-run steps 4–6, re-surface the canvas and repeat this review.

### Finalise

Once the layout is approved (with or without edits): re-run the **Silent LEARN.md write** (step 7) if any edits were applied, then print `Flow "<name>" registered as <projectSlug>/<flowSlug>. Open: $STUDIO_URL/projects/<projectSlug>/flows/<flowSlug>`, then `rm -rf "$SEEFLOW_TMP"` to clear flow-local scratch. Done.

## Phase 3 on the `pr` branch

> Everything above describes the default (`code` / `conversation` / `document`) path.
> Ignore it when `$inputClass === "pr"` and follow this section instead.

The seven steps above assume one flow authored by the node-planner. A PR review
creates a small project of linked flows instead. `$prNumber` and `$prRepo` come from
Phase 1 step 2; `$SEEFLOW_TMP` is the value Phase 1 set and is not re-pointed here.
Run this sequence:

1. **Pick the path.** Inside a checkout of the PR's repo (`$repoRoot` non-null):
   `$repoPath = $repoRoot/.seeflow/pr-$prNumber`. Otherwise ask once, offering
   `$PWD/.seeflow/<repo-name>-pr-$prNumber` as the default (`<repo-name>` is the
   second segment of `$prRepo`). If the user declines or gives no path, stop with one
   line — `no project path for PR $prNumber; nothing written` — and do not fall back
   to `$PWD` or a temp directory. Nothing has been created at this point, so there is
   nothing to unwind.
2. **Replace, don't merge.** A re-run always rebuilds from the current state of the
   pull request. If `$repoPath/seeflow.json` exists: preserve
   `$repoPath/pr-review.overrides.json` and `$repoPath/pr-review-notes.md` if either
   exists — they are the only files this feature never regenerates — then resolve the
   existing registry slug with `$SEEFLOW projects:list` (match the entry whose
   `repoPath` is `$repoPath`) into `$oldSlug`, read `seeflow.json`'s `flows[]`, run
   `flows:delete --project "$oldSlug" --flow <id>` for every flow except the
   manifest's `defaultFlow`, then `rm -rf "$repoPath"` and restore the two preserved
   files afterwards. `flows:delete` returns 409 `last-flow` on the project default —
   that one registry row is left behind on purpose, and step 3's `projects:create` at
   the same path re-registers over it. Say in one line that you are replacing it, that
   the canvas itself is rebuilt so hand edits do not survive, and that
   `pr-review.overrides.json` is where a correction goes to stick. Do not ask.
3. **Create the project.** `projects:create --path "$repoPath" --name "PR $prNumber — $prRepo"`.
   Reassign `$projectSlug` from the response slug's first segment, as always.
4. **Create the other flows.** For every entry in `flowPlan` after the first,
   `flows:create --project "$projectSlug" --flow <slug> --name "<title>"`. At most
   six flows; `main` always exists from step 3, and it is always `flowPlan[0]`. The
   slugs `main`, `sequence` and `tour` are reserved words used verbatim for those
   kinds — never derive them.
5. **Write them in parallel.** One message, one `seeflow-pr-flow-writer` per flow.
   Pass exactly these parameter names — they are the names the agent contract
   declares, and a writer handed `$SEEFLOW` or `$SEEFLOW_TMP` under any other name
   sees no CLI and no scratch dir and must abort:

   | Parameter | Value |
   |---|---|
   | `modelPath` | `$SEEFLOW_TMP/review-model.json` |
   | `mappingContract` | the **absolute** path to the skill's `references/pr/flow-mapping.md` — resolve it from the skill directory you loaded; never a relative path |
   | `projectSlug` | `$projectSlug` |
   | `flowSlug` | this entry's `slug` |
   | `flowKind` | this entry's `kind` |
   | `viewId` | this entry's `viewId` — **views only**, omitted for every other kind |
   | `flowPlan` | the whole plan, so a writer can resolve a link target |
   | `seeflowBin` | the resolved `$SEEFLOW` invocation, verbatim |
   | `tmpDir` | `$SEEFLOW_TMP` |

   Serial dispatch here costs the run its wall-clock for nothing. Every writer derives
   its node and connector ids from the model per `flow-mapping.md` §1 — no writer
   calls `$SEEFLOW ids` on this branch, because that mints random ids and two writers
   would then name the same card differently.
6. **Never lay out.** `flows:layout` rewrites `style.json` with positions only,
   discarding every size and colour the writers authored and throwing the lane
   bands into a junk column. The writers author geometry; there is nothing to tidy.
7. **Check the returns.** Any writer reporting `ok: false`, or a non-zero
   `selfCheck.duplicatePositions`, `selfCheck.cardsOutsideBand` or
   `selfCheck.danglingConnectors`, gets one re-dispatch with the problem named.
   Surface a writer's `modelProblems` to the user rather than silently rendering
   around them.
8. **Save and finish.** Silent `$learnPath` write, one row per created flow marked
   `(pr-review)`, then the final line: the canvas URL for `tour` when a tour was
   emitted and for `main` otherwise, the full flow list, and one sentence on where to
   start reading. A reviewer who is going to open one thing opens the tour; the map is
   where they go next, not first. Then `rm -rf "$SEEFLOW_TMP"` — the writers have
   already read `review-model.json`. On a failed run, leave it: it is the debugging
   trail.
