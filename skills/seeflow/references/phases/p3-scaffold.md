# Phase 3 — scaffold, populate, layout, review

The skeleton flow lands via seven steps, in order. No `flow.json` authoring by hand — `projects:create` writes the empty envelope. Run `$SEEFLOW help <command>` for each subcommand's body shape and flags.

## 1. Scaffold + register inside the project via `projects:create`

This is the entry point for a new project: the CLI writes the empty `flow.json` at `<repoPath>/flow.json` (project root) and registers it in one shot.

### Existing-flow gate — check before the CLI write

Test `test -f "$repoPath/flow.json"`. If the file exists (or `projects:create` later returns `alreadyExists` exit code 4 because the pre-check raced), STOP and ask via `AskUserQuestion` — **never silently overwrite, never silently fall back**:

> A SeeFlow flow is already registered at this path. What do you want to do?
>
> 1. **Open the existing flow** *(Recommended)* — skip creation; run `$SEEFLOW register --path "$repoPath"` to re-attach the existing envelope, surface `$STUDIO_URL/d/<slug>`, then stop. If the user wanted to inspect rather than edit, hand off to `/seeflow-lookup`.
> 2. **Create a new flow with a different name** — ask the user for a new flow name, recompute `$repoPath = $PWD/.seeflow/<new-slug>`, then retry this step (Phase 1/2 only rerun if the user's intent also changed).
> 3. **Overwrite the existing flow** — destructive. Confirm once more, then `$SEEFLOW flows:delete --path "$repoPath"` (and `rm -rf "$repoPath"` for any sidecar leftovers), then retry this step.

Gate clear → forward the planner-supplied `name` (and `description` if the planner provided one):

```bash
$SEEFLOW projects:create --path "$repoPath" --name "$plannerName" [--description "$plannerDescription"]
```

The studio writes the envelope, adds a registry entry under `~/.seeflow/registry.json`, and returns `{ id, slug }` (slug is derived from `name`). **Capture `id` from the response and use it (not `slug`) for every follow-up CLI call below** — several commands document slug support in `help` but the server only resolves by id today. **Registration is a precondition for opening the canvas:** the `$STUDIO_URL/d/<slug>` route only works after this step succeeds — never surface the canvas URL before this step.

If `projects:create` returns `alreadyExists` (code 4) after the pre-check passed (filesystem race), loop back to the gate above and let the user decide — do not auto-fall-back. Do not hardcode the envelope shape from memory; to inspect what `projects:create` writes, run `$SEEFLOW schema flow`.

## 2. Normalize the planner output

Strip `rationales` (keep them in memory for the review prompt below), then for the planner's designated trigger node (the one whose `data.playAction` is set even as a placeholder), inject the minimum `playAction` payload the contract requires so the server accepts the batch. Use `$schemaCache.action` and `$schemaCache.node` (Phase 0) to look up the `PlayAction` shape's required keys — do not hardcode the shape from memory. Pick the interpreter from `runtimeProfile.primaryLanguage` (falling back to `bun`) and point `scriptPath` at `scripts/play.ts`. The Phase 4 play-designer overwrites the placeholder with the real action via `nodes:patch`. The script file does not need to exist yet — Phase 5 writes it, Phase 6 runs it. **Skip this normalisation entirely for `inputClass === "document"` flows** — document flows usually carry no trigger, and the planner deliberately omits `playAction` per its input-class rules.

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

Every input class, every dynamic gate outcome; the static path used to ship with blank `nodes/<id>/detail.md` because Phase 4–5 were skipped. Walk the planner's `nodes[]` (post-id-rewrite). For each non-decorative node — `rectangle`, `database`, `queue`, `cloud`, `server`, `user` (skip `sticky`, `text`, `icon`, `ellipse`, `image`, `component`, `html`; those carry content in other fields) — check whether `data.detail` was set in the planner output:

- **Present** — already externalised by `flow:add-bulk` to `nodes/<id>/detail.md`. Nothing to do.
- **Missing or empty** — synthesise 1–3 short markdown paragraphs from `data.name` + `data.description` + the matching `rationales[id]` + any relevant `codePointers[].why`. Push via `nodes:patch <flowId> <nodeId> --json '{"data":{"detail":"<markdown>"}}'`. The studio writes `nodes/<id>/detail.md` and stores a `file://` ref.

Parallelise the patches across nodes — single message, N Bash calls. This is the static-flow safety net described in `../../agents/seeflow-node-planner.md` § "Semantic requirements".

## 6. `flows:layout`

Run ELK and write `style.json`.

## 7. Silent LEARN.md write #1

First disk hit for `$learnPath`. Merges staged `learnUpdates` from Phase 1 → 2 overlap AND upserts the "Flows already created" row by `slug`. Full merge contract, field list, and ~6 KB cap rule live in `../learn-format.md` § "Lifecycle" + § "Merging rules". Run quietly — do **not** narrate to the user. Create `$PWD/.seeflow/` if missing.

---

Each call validates server-side. A `badSchema` exit means feed the issues back to the planner and retry — no separate validation step.

## User review + dynamic gate

Open the canvas, surface the planner's `rationales` per node — prefix each with `<data.name> (<canonical id>):` so the human sees a readable anchor despite the opaque id (`POST /orders (node-Ab12cd34Ef): Single HTTP service — internal routes are implementation detail.`) — and ask **one combined question** (layout review + dynamic gate in a single round-trip — two consecutive waits is interrogation):

```bash
URL="$STUDIO_URL/d/$slug"
(open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || start "$URL" 2>/dev/null) &
```

> Opened the canvas at `<url>`. Two quick questions:
> 1. **Layout** — any additions, removals, or renames?
> 2. **Dynamic or static** — continue with Play scripts + Status probes so the
>    canvas reacts to your running system, or stop with the static layout?

**Wait once.** Parse both answers from the reply.

- **Layout changes requested** → re-run node-planner with the feedback, repeat the combined ask. The dynamic answer (if given) is remembered but not acted on until the layout is approved.
- **Layout approved + dynamic** → Phase 4. If the system-analyzer is still running, await it now; Phase 4 designers need its `runtimeProfile`, fixtures, data-entry paths, and tech adaptations.
- **Layout approved + static** → **Silent LEARN.md write #2** (merge contract in `p6-validation.md` § "Silent LEARN.md write #2"), then print `Flow "<name>" registered as <slug> (static). Open: $STUDIO_URL/d/<slug>` and stop.
- **Dynamic answer unclear or absent** → default to static (dynamic writes executable scripts; opt-in).

(`inputClass === "document"` defaults to static here without re-asking — document flows have no runtime to react to. Same applies to the no-source-tree case folded into the document branch.)
