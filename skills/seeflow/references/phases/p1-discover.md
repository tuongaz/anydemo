# Phase 1 — discover (parallel)

The phase branches on `$inputClass` (set in Phase 0's input-source gate). The `code`, `conversation` and `document` branches each yield a `contextBrief` with `inputClass` populated so downstream agents know how to interpret it. The `pr` branch yields no `contextBrief` — it produces a review model instead, and the node-planner is skipped.

## `inputClass === "code"` — launch both analyzers in parallel

**Single message, two `Task` calls.** Serial launch roughly doubles wall-clock for zero benefit. Follow the wrong/right pattern in `../../SKILL.md` § "Parallelism is the default".

- `seeflow-code-analyzer` — in: `userPrompt`, `projectRoot`, `existingFlow`, `learnContext`. Out: `inputClass: "code"`, `userIntent`, `audienceFraming`, `scope`, `codePointers`, `knownEndpoints`, `techStack`, `existingFlow`.
- `seeflow-system-analyzer` — in: `projectRoot`, `inputClass: "code"`, `learnContext`. Out: `runtimeProfile` + a `learnUpdates` payload (`localDevSetup`, `integrationTests`, `fixtures`, `factories`, `seedCommands`, `dataEntryPaths`, `gotchas`, `techAdaptations`). **Every fact the analyzer learns about how to start / set up the local environment MUST land in `learnUpdates`.**

Tools: `Read, Grep, Glob, LS, Bash` (read-only). Schemas: `../../agents/seeflow-code-analyzer.md`, `../../agents/seeflow-system-analyzer.md`, `../learn-format.md`. Unparseable output: retry that single agent once, then surface (`<agent> returned unparseable JSON after retry`) and stop. The same rule applies to every sub-agent in Phases 2 and 4.

## `inputClass === "conversation"` — orchestrator builds brief inline

Skip the code-analyzer. Build the same envelope it would have produced from the in-session conversation: extract `userIntent`, `audienceFraming`, `scope.{rootEntities,outOfScope}`, `codePointers[]` (file paths discussed with one-line `why`), `knownEndpoints[]` (any HTTP / queue / event surfaces named), `techStack[]`, `existingFlow`. Set `inputClass: "conversation"` on the brief.

System-analyzer still runs when the flow touches a runtime AND the conversation hasn't already covered dev setup. Skip it (no Task call) when the conversation already named the dev command, ports, fixtures — those facts come into the brief from `$learnPath` and the conversation directly. When skipped, set `runtimeProfile: null` on the brief.

## `inputClass === "document"` — skip both analyzers

Build the brief inline from the user's prompt + any document text in the conversation:

```json
{
  "inputClass":     "document",
  "userIntent":     "<paraphrase of what the document depicts>",
  "audienceFraming":"information-display — the canvas IS the document",
  "scope":          { "rootEntities": [<sections / topics from the document>], "outOfScope": [] },
  "codePointers":   [],
  "knownEndpoints": [],
  "techStack":      [],
  "existingFlow":   null,
  "runtimeProfile": null
}
```

The planner branches on `inputClass === "document"` and defaults to `component` nodes (catalog-driven UI cards) per its §"Picking node `type` by input class". The orchestrator forwards `$componentCatalog` (from the Phase 0 schema cache) so the planner can pick legal `spec.elements[].type` values.

Downstream consequences (document branch):
- **`$learnPath`:** at the Phase 3 save, the upserted flow row carries a `(document)` marker in the purpose column so the next run knows the canvas renders structured information rather than a real system's topology.

## `inputClass === "pr"` — fetch the pull request, then hand it over

The orchestrator does the fetching. The analyzer stays offline, like its siblings.

1. **Resolve the reference.** Accept a full PR URL, `owner/repo#123`, or a bare
   `#123` / `123` when `$PWD` is inside a checkout. Anything else: ask once for a
   PR link rather than guessing.
2. **Set the scratch dir, then fetch — without reading.** No project exists yet on
   this branch, so the usual `$repoPath/flows/$flowSlug/.tmp/` definition of
   `$SEEFLOW_TMP` cannot resolve. Set it once, here, and keep it for the whole run:
   Phase 3 does **not** re-point it at the project, because the analyzer has already
   written `review-model.json` there and the writers read it by absolute path.

   Capture two scalars as you go. They are the only pull-request data the
   orchestrator itself ever holds — reading `number` and the `owner/repo` is not
   reading the diff, and everything else in `pr.json` stays unread. Never read
   `pr.json` or `pr.diff` into your own context; they exist for the analyzer.

   ```bash
   # One scratch dir for the whole run. Do not re-point it in Phase 3.
   SEEFLOW_TMP="$PWD/.seeflow/.pr-tmp"
   mkdir -p "$SEEFLOW_TMP"

   # The only two PR scalars the orchestrator holds.
   prNumber=$(gh pr view <ref> --json number --jq '.number')
   prRepo=$(gh pr view <ref> --json url --jq '.url | capture("github.com/(?<r>[^/]+/[^/]+)/pull").r')

   # Metadata + diff, straight to disk.
   gh pr view <ref> --json number,title,body,author,url,state,isDraft,headRepositoryOwner,headRepository,baseRefName,headRefName,headRefOid,baseRefOid,files,additions,deletions,changedFiles,commits > "$SEEFLOW_TMP/pr.json"
   gh pr diff <ref> > "$SEEFLOW_TMP/pr.diff"

   # Cap the diff at 400 KB and record the cut, so the analyzer can be honest about it.
   if [ "$(wc -c < "$SEEFLOW_TMP/pr.diff")" -gt 400000 ]; then
     head -c 400000 "$SEEFLOW_TMP/pr.diff" > "$SEEFLOW_TMP/pr.diff.cut" && mv "$SEEFLOW_TMP/pr.diff.cut" "$SEEFLOW_TMP/pr.diff"
     jq '. + {truncatedAtBytes: 400000}' "$SEEFLOW_TMP/pr.json" > "$SEEFLOW_TMP/pr.json.tmp" && mv "$SEEFLOW_TMP/pr.json.tmp" "$SEEFLOW_TMP/pr.json"
   fi

   # The real merge base, stamped into the metadata as mergeBaseOid.
   mergeBase=$(gh api "repos/$prRepo/compare/$(jq -r .baseRefOid "$SEEFLOW_TMP/pr.json")...$(jq -r .headRefOid "$SEEFLOW_TMP/pr.json")" --jq '.merge_base_commit.sha')
   jq --arg mb "$mergeBase" '. + {mergeBaseOid: $mb}' "$SEEFLOW_TMP/pr.json" > "$SEEFLOW_TMP/pr.json.tmp" && mv "$SEEFLOW_TMP/pr.json.tmp" "$SEEFLOW_TMP/pr.json"
   ```

   `gh pr diff` is a merge-base diff, so nothing the base branch gained since the
   fork point is attributed to this pull request. `baseRefOid` is the base branch's
   **tip today**, which is not what that diff is against — that is why the merge base
   is fetched separately and stamped in as `mergeBaseOid`. The model's `pr.baseSha`
   is `mergeBaseOid`, never `baseRefOid`; every removed-file blob link is built from
   it, and a link built from the tip shows a reviewer a file the pull request never
   forked from. A URL or `owner/repo#n` resolves from any directory, so running
   inside an unrelated repo is safe.
3. **Decide `$repoRoot`.** If `git -C "$PWD" rev-parse --show-toplevel` succeeds
   AND its `origin` remote names the same `owner/repo` as `$prRepo`, that toplevel is
   `$repoRoot` — the analyzer may read unchanged neighbour files from it. Otherwise
   `$repoRoot` is `null` and the analyzer works from the diff alone. Never check out
   the PR branch, never fetch, never touch the user's working tree.
4. **Launch `seeflow-pr-analyzer`** with exactly these parameters, named exactly this
   way — the agent contract says anything absent from the launching prompt does not
   exist:

   | Parameter | Value |
   |---|---|
   | `prMetaPath` | `$SEEFLOW_TMP/pr.json` |
   | `prDiffPath` | `$SEEFLOW_TMP/pr.diff` |
   | `repoRoot` | the absolute toplevel from step 3, or `null` |
   | `outPath` | `$SEEFLOW_TMP/review-model.json` |
   | `modelContract` | the **absolute** path to the skill's `references/pr/review-model.md` — resolve it from the skill directory you loaded; never pass a relative path, the agent has only `Read` and no cwd control |
   | `learnContext` | the usual `$learnPath` excerpt |

   One agent, one pass — this is the only reasoning call over the diff.
5. **Validate before you fan out.** Four writers rendering one broken model make four
   broken flows. Check the file the analyzer claims to have written, then its
   envelope, in one Bash call:

   ```bash
   MODEL="$SEEFLOW_TMP/review-model.json" bun -e '
   const fs = require("node:fs");
   const p = [];
   const chk = (c, w) => { if (!c) p.push(w); };
   const path = process.env.MODEL;
   if (!fs.existsSync(path)) { console.log("model file missing: " + path); process.exit(0); }
   let m;
   try { m = JSON.parse(fs.readFileSync(path, "utf8")); }
   catch (e) { console.log("model is not valid JSON: " + e.message); process.exit(0); }
   const E = new Set((m.elements || []).map((e) => e.id));
   const R = new Set((m.relations || []).map((r) => r.id));
   const L = new Set((m.lanes || []).map((l) => l.id));
   for (const e of m.elements || []) chk(L.has(e.lane), `element ${e.id}: undeclared lane ${e.lane}`);
   for (const r of m.relations || []) { chk(E.has(r.from), `relation ${r.id}: from ${r.from}`); chk(E.has(r.to), `relation ${r.id}: to ${r.to}`); }
   const seen = new Set();
   const walk = (v) => { chk(!seen.has(v.id), `duplicate view id ${v.id}`); seen.add(v.id);
     for (const i of v.scope.elements || []) chk(E.has(i), `view ${v.id}: element ${i}`);
     for (const i of v.scope.relations || []) chk(R.has(i), `view ${v.id}: relation ${i}`);
     (v.children || []).forEach(walk); };
   (m.views || []).forEach(walk);
   for (const s of m.sequence?.messages || []) {
     chk(m.sequence.participants.includes(s.from), `msg ${s.id}: from`);
     chk(m.sequence.participants.includes(s.to), `msg ${s.id}: to`);
     chk((s.kind === "self") === (s.from === s.to), `msg ${s.id}: self/kind mismatch`); }
   for (const s of m.walkthrough || []) for (const f of s.focus || []) chk(E.has(f) || R.has(f), `step ${s.id}: focus ${f}`);
   const allow = new Set(["title","summary","chips","pr","lanes","elements","relations","views","sequence","walkthrough","notes"]);
   for (const k of Object.keys(m)) chk(allow.has(k), `unknown top-level key ${k}`);
   chk((m.elements || []).length <= 60, "over 60 elements");
   chk((m.relations || []).length <= 90, "over 90 relations");
   console.log(p.length ? p.join("\n") : "MODEL OK")'
   ```

   Then check the envelope by hand: `flowPlan` is non-empty, its **first** entry is
   `kind: "main"`, every `kind: "view"` entry carries a `viewId`, and no entry uses
   the reserved words `main` / `sequence` / `tour` as a slug for the wrong kind.

   Anything other than `MODEL OK`, or any envelope fault, goes back to
   `seeflow-pr-analyzer` in **exactly one** re-dispatch that quotes the failing lines
   verbatim and says "fix only what is named — do not restructure what validated". A
   second failure stops the run and reports the lines to the user. Never dispatch a
   writer against a model you know is broken; an unknown top-level key is a
   rejection, not something to render around.
6. **Keep its envelope.** The returned `flowPlan` is the authoritative flow list for
   Phase 3. Slugs are not free: `kind: "main"` ⇒ `main`, `kind: "sequence"` ⇒
   `sequence`, `kind: "tour"` ⇒ `tour`, verbatim — the tour's `stage` field and
   `main`'s nav strip target them by name. Only `kind: "view"` entries carry a
   derived slug, and each one also carries an explicit `viewId` (the slug derivation
   is not invertible, so the id must be passed through). There is no `contextBrief`
   on this branch and the node-planner never runs: `seeflow-pr-flow-writer` replaces
   it, because the review model already carries the graph.

Downstream consequences: the `$learnPath` row for each created flow carries a
`(pr-review)` marker, and Phase 3 skips `flows:layout` entirely (see
`p3-scaffold.md` §"Phase 3 on the `pr` branch").

## Phase 1 → Phase 2 overlap

Applies to `inputClass === "code"` (and to `"conversation"` when the system-analyzer was launched). For `"document"` and the no-system-analyzer `"conversation"` path, the brief is complete the moment the orchestrator builds it inline — go straight to Phase 2.

For `"code"`: start `seeflow-node-planner` as soon as the code-analyzer returns — it only needs the code-analyzer's brief plus `techStack`. The system-analyzer continues in the background.

When the system-analyzer returns:

0. **Size-check the payload first.** Measure the JSON byte length. If > 16 KB (twice the agent's budget — see `../../agents/seeflow-system-analyzer.md` § "Output budget"), the analyzer drifted. Apply the per-field caps from that section before merging: truncate `gotchas[]` to 10, `fixtures[]`/`factories[]` to 8, prose fields to 400 chars, etc. Drop any inherited fact that already appears verbatim in `$learnPath` (the merger would keep it anyway). The trimmed payload is what feeds steps 1–3.
1. **Stage** `learnUpdates` in memory — DO NOT write `$learnPath` to disk yet. The disk hit is the Save in Phase 3 step 7, after the studio has registered the flow. Writing earlier risks leaving stale rows behind if the run aborts.
2. Keep `runtimeProfile` + the trimmed `learnUpdates` in memory alongside the `$learnPath` facts read at Phase 0. Phase 3's detail-backfill reads `dataEntryPaths` / `gotchas` / `techAdaptations` when synthesising node `detail.md`; the Phase 3 Save merges the full staged buffer into `$learnPath`. **Carry the *trimmed* payload — never the raw analyzer output.**
3. Stage `knownEndpoints` / `techStack` from the code-analyzer alongside the system-analyzer's updates — same staged buffer, same Save destination.

**Resolve tech refs.** Map each `techId` in the staged `techStack` (union of `$learnPath`'s existing `## Tech stack` and the analyzer updates) to `../tech/<techId>.md`. Forward those paths and the matching staged `techAdaptations` into the Phase 2 planner prompt (~3–5 refs per flow), where they inform node modelling. If the system-analyzer hasn't returned yet, forward whatever `techAdaptations` `$learnPath` already had on read; the planner produces a first draft and the user reviews in Phase 3 anyway.
