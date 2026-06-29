# Phase 1 — discover (parallel)

The phase branches on `$inputClass` (set in Phase 0's input-source gate). Each branch yields a `contextBrief` with `inputClass` populated so downstream agents know how to interpret it.

## `inputClass === "code"` — launch both analyzers in parallel

**Single message, two `Task` calls.** Serial launch roughly doubles wall-clock for zero benefit. Follow the wrong/right pattern in `../../SKILL.md` § "Parallelism is the default".

- `seeflow-code-analyzer` — in: `userPrompt`, `projectRoot`, `existingDemo`, `learnContext`. Out: `inputClass: "code"`, `userIntent`, `audienceFraming`, `scope`, `codePointers`, `knownEndpoints`, `techStack`, `existingDemo`.
- `seeflow-system-analyzer` — in: `projectRoot`, `inputClass: "code"`, `learnContext`. Out: `runtimeProfile` + a `learnUpdates` payload (`localDevSetup`, `integrationTests`, `fixtures`, `factories`, `seedCommands`, `dataEntryPaths`, `gotchas`, `techAdaptations`). **Every fact the analyzer learns about how to start / set up the local environment MUST land in `learnUpdates`.**

Tools: `Read, Grep, Glob, LS, Bash` (read-only). Schemas: `../../agents/seeflow-code-analyzer.md`, `../../agents/seeflow-system-analyzer.md`, `../learn-format.md`. Unparseable output: retry that single agent once, then surface (`<agent> returned unparseable JSON after retry`) and stop. The same rule applies to every sub-agent in Phases 2 and 4.

## `inputClass === "conversation"` — orchestrator builds brief inline

Skip the code-analyzer. Build the same envelope it would have produced from the in-session conversation: extract `userIntent`, `audienceFraming`, `scope.{rootEntities,outOfScope}`, `codePointers[]` (file paths discussed with one-line `why`), `knownEndpoints[]` (any HTTP / queue / event surfaces named), `techStack[]`, `existingDemo`. Set `inputClass: "conversation"` on the brief.

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
  "existingDemo":   null,
  "runtimeProfile": null
}
```

The planner branches on `inputClass === "document"` and defaults to `component` nodes (catalog-driven UI cards) per its §"Picking node `type` by input class". The orchestrator forwards `$componentCatalog` (from the Phase 0 schema cache) so the planner can pick legal `spec.elements[].type` values.

Downstream consequences (document branch):
- **`$learnPath`:** at the Phase 3 save, the upserted flow row carries a `(document)` marker in the purpose column so the next run knows the canvas renders structured information rather than a real system's topology.

## Phase 1 → Phase 2 overlap

Applies to `inputClass === "code"` (and to `"conversation"` when the system-analyzer was launched). For `"document"` and the no-system-analyzer `"conversation"` path, the brief is complete the moment the orchestrator builds it inline — go straight to Phase 2.

For `"code"`: start `seeflow-node-planner` as soon as the code-analyzer returns — it only needs the code-analyzer's brief plus `techStack`. The system-analyzer continues in the background.

When the system-analyzer returns:

0. **Size-check the payload first.** Measure the JSON byte length. If > 16 KB (twice the agent's budget — see `../../agents/seeflow-system-analyzer.md` § "Output budget"), the analyzer drifted. Apply the per-field caps from that section before merging: truncate `gotchas[]` to 10, `fixtures[]`/`factories[]` to 8, prose fields to 400 chars, etc. Drop any inherited fact that already appears verbatim in `$learnPath` (the merger would keep it anyway). The trimmed payload is what feeds steps 1–3.
1. **Stage** `learnUpdates` in memory — DO NOT write `$learnPath` to disk yet. The disk hit is the Save in Phase 3 step 7, after the studio has registered the flow. Writing earlier risks leaving stale rows behind if the run aborts.
2. Keep `runtimeProfile` + the trimmed `learnUpdates` in memory alongside the `$learnPath` facts read at Phase 0. Phase 3's detail-backfill reads `dataEntryPaths` / `gotchas` / `techAdaptations` when synthesising node `detail.md`; the Phase 3 Save merges the full staged buffer into `$learnPath`. **Carry the *trimmed* payload — never the raw analyzer output.**
3. Stage `knownEndpoints` / `techStack` from the code-analyzer alongside the system-analyzer's updates — same staged buffer, same Save destination.

**Resolve tech refs.** Map each `techId` in the staged `techStack` (union of `$learnPath`'s existing `## Tech stack` and the analyzer updates) to `../tech/<techId>.md`. Forward those paths and the matching staged `techAdaptations` into the Phase 2 planner prompt (~3–5 refs per flow), where they inform node modelling. If the system-analyzer hasn't returned yet, forward whatever `techAdaptations` `$learnPath` already had on read; the planner produces a first draft and the user reviews in Phase 3 anyway.
