# Phase 5 — patch overlays + layout

For each overlay returned by Phase 4 (parallelise the writes when the script bodies don't depend on each other):

1. Write `scriptFile.body` to `scriptFile.path` — anchored at `<repoPath>/flows/<flowSlug>/nodes/<nodeId>/scripts/<name>` (Write tool).
2. `chmod` per `scriptFile.chmod` (default 755).
3. Call `nodes:patch --project "$projectSlug" --flow "$flowSlug" <nodeId>` with the overlay's `patch` body. (Body shape: `$SEEFLOW help nodes:patch`.)

If the play-designer emitted `newTriggerNodes`, batch them via `flow:add-bulk --project "$projectSlug" --flow "$flowSlug"` (one call, both arrays atomic), then re-run `flows:layout --project "$projectSlug" --flow "$flowSlug"`. (Body shape: `$SEEFLOW help flow:add-bulk`.)

## Edit-case retype routing

When the Phase 2 diff against `editTarget` flags a node whose `id` already exists but whose `type` changed (e.g. a former trigger `rectangle` reshaped to a decorative `database`), route it through `nodes:patch --project "$projectSlug" --flow "$flowSlug" <nodeId> { type, ...required fields }` — **not** `nodes:delete` + `flow:add-bulk`. The patch path preserves the per-node folder under `<repoPath>/flows/<flowSlug>/nodes/<id>/`; the delete cascade destroys it. The server validates required fields for the new type after the merge (e.g. `* → image` needs `path`, `* → icon` needs `icon`, `* → html` accepts an optional `html` string); a `badSchema` exit means feed the issues to the play-designer and retry.

## Retry budget

Per-node `nodes:patch` failure → re-dispatch *that one* designer with the CLI's reported issues, retry, **max 3 per node**. Parallelise re-dispatches when more than one node failed (`../../SKILL.md` §"Parallelism is the default"). When the budget is exhausted for a node, surface (`nodes:patch retries exhausted on <kind> (N nodes)`) and stop.
