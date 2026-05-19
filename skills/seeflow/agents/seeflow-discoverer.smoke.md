# seeflow-discoverer — smoke fixture

This is a **documentation** smoke test, not an executable script. It tells
maintainers how to manually exercise the `seeflow-discoverer` agent
against a local project and what a passing brief should look like.

A future iteration may wire this into an evaluation harness; for now it is
the canonical "did the prompt drift?" check.

## How to invoke

From a Claude Code session anywhere with this plugin installed:

1. `cd` into a *throwaway* checkout of this repo (the agent is read-only,
   but its CWD signal matters — the discoverer expects `projectRoot` to
   be the user's project, not the plugin repo).
2. In a fresh conversation, ask Claude to dispatch the agent. The
   launching prompt should contain the three structured inputs:

   ```
   Launch the seeflow-discoverer sub-agent with these inputs:

     userPrompt:   "show how the order pipeline works"
     projectRoot:  <absolute path to a local project with an HTTP server, event bus, queue, and workers>
     existingDemo: null

   It must return a single fenced JSON block matching the contract
   in skills/seeflow/agents/seeflow-discoverer.md and nothing else.
   ```

3. Read the agent's final message.

## What a successful brief should contain

The returned JSON must be parseable and must satisfy **every** check
below. Reviewers should treat any failure as a prompt regression.

### Structural checks

- Parses as JSON.
- Top-level keys are exactly: `userIntent`, `audienceFraming`, `scope`,
  `codePointers`, `existingDemo`.
- `scope` has exactly the keys `rootEntities` and `outOfScope`.
- `codePointers` is an array of `{ path, why }` objects; every `path`
  is relative to `projectRoot` (no leading `/`); every `why` is a
  non-empty single-line string.
- `existingDemo` is exactly `null` for this fixture (input said `null`).

### Content checks

`scope.rootEntities` should mention (in some wording — names need not be
verbatim, but the entities must be recognisable):

- The HTTP server / order endpoints (`POST /orders`, `POST /payments/charge`).
- The event bus that carries `order.created`.
- The shipments queue.
- The inventory worker.
- The shipping worker.
- The order store / state model.

`scope.outOfScope` should include at least one of the genuinely-tangential
surfaces, e.g. `GET /admin/stats`.

`codePointers` must include all six of these paths (in some order):

- `src/index.ts`
- `src/server.ts`
- `src/event-bus.ts`
- `src/queue.ts`
- `src/workers.ts`
- `src/store.ts`

Each `why` should one-line the role that file plays in the demo. Extra
pointers (e.g. `package.json`, `.seeflow/architecture.json`) are acceptable.

`userIntent` should commit to an end-to-end flow framing rather than
hedge ("maybe", "if that's what they meant"). `audienceFraming` should
mention both the engineering view and the business / outcome view (the
SeeFlow default audience).

## Red flags (treat as failed smoke)

- The final message contains prose before or after the JSON block.
- `codePointers` only lists `package.json` / `README.md` / `tsconfig.json`
  (the agent failed to find the actual code).
- `rootEntities` lists generic labels (`"backend"`, `"API"`) instead of
  named entities from the codebase.
- The agent ran a Bash command that wrote anywhere on disk or touched
  the network (review the agent transcript — any of `rm`, `mv`, `mkdir`,
  `cp` into the repo, `>` redirect, `tee`, `git fetch`, `curl`, `wget`
  is a hard fail).
- The agent returned a `playAction` or `node` list — that's the
  node-planner's job, not the discoverer's.

## When to refresh this fixture

Re-run this smoke whenever:

- `skills/seeflow/agents/seeflow-discoverer.md` is edited.
- The output contract in the agent prompt changes — also update the
  "Structural checks" list above.
