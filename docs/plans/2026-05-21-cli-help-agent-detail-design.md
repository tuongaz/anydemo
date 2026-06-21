# Detailed `seeflow help` for AI agents — design

**Date:** 2026-05-21
**Status:** Validated via brainstorm; ready for implementation plan.

## Problem

AI agents consuming the SeeFlow CLI need a complete, machine-trustworthy
reference for every command: how to pass input, what the success envelope
looks like, what error codes can come back, and what exit codes those map
to.

Today `seeflow help <command>` prints a useful synopsis but **does not
inline the resolved JSON Schema for the request body** and **does not
document the success / error envelope or exit codes**. Agents are forced
to fall back to `seeflow help --json` (the full manifest) and to read
`cli-helpers.ts` to learn the envelope. That is wasted tokens and a
silent coupling.

## Goal

Make `seeflow help` and `seeflow help <command>` the agent's complete
CLI reference. The manifest in `apps/studio/src/cli-manifest.ts` stays
the single source of truth — there is no committed `CLI.md`, no regen
script, no parity test against a generated file.

## Non-goals (YAGNI)

- **No Zod output schemas.** The `okExample` literal plus the `errorKinds`
  vocabulary is the contract. Adding Zod for every CLI return shape is
  significant work for marginal agent benefit, and inferring a schema
  from a single example value lies about optionality and alternates.
- **No `seeflow help --md` flag and no committed `CLI.md`.** Progressive
  disclosure beats a monolithic doc: agents pay the token cost only for
  the commands they actually need, and there is no second copy to drift.
- **No restructuring of `cli-manifest.ts` entries.** Fields already
  capture everything needed; only the rendering changes.

## Approach

Two-tier progressive disclosure, matching how `gh`, `git`, `kubectl`, and
Claude Code skills work:

1. **`seeflow help`** — the cheap index. The very first line of output
   tells the agent how to drill in: `Run \`seeflow help <command>\` for
   detail on any command below.` Then a short "Calling convention"
   preamble (~15 lines) teaches the agent, once, how to invoke any
   command: body delivery modes (`--json` / `--file` / `--stdin`),
   the success envelope (`{ ok: true, ...payload }` on stdout, exit 0),
   the error envelope (`{ error, code }` on stderr, non-zero exit), and
   the exit-code map. The category-grouped one-liner list follows.

   The drill-in line MUST appear at the top, not the bottom — agents
   stop reading early when they have what they need, and the most
   important next-action is "get more detail for the command I picked".

2. **`seeflow help <command>`** — the detailed page. Upgrade the
   per-command output to a proper markdown document with these sections:
   `# <name>` · description · `## Synopsis` · `## Arguments` · `## Flags`
   · `## Input (body)` (resolved JSON Schema **inlined**, plus a
   concrete example body) · `## Output` (success envelope + concrete
   `okExample`, then error envelope + the list of `errorKinds` this
   command can emit, each paired with its exit code) · `## Examples` ·
   `Requires studio running: yes|no`.

Commands without a body skip `## Input (body)`. Lifecycle commands that
print non-JSON text (`start`, `stop`) get `## Output (text)` and show
the literal lines.

## Concrete rendering example

`seeflow help nodes:add` would render:

```markdown
# nodes:add

Add a single node to a flow. Body is the node object (auto-id if omitted).

## Synopsis
  seeflow nodes:add <flowId> [--json <JSON> | --file <path> | --stdin]

## Arguments
  <flowId>  (required) — Flow id or slug

## Flags
  --json <JSON>   Inline JSON body
  --file <path>   Read JSON body from file
  --stdin         Read JSON body from stdin
  (provide exactly one)

## Input (body)
Schema (JSON Schema, resolved from Zod):

    { "type": "object",
      "properties": { ... full Zod-derived shape ... },
      "required": [ ... ] }

Example body:

    { "type": "stateNode",
      "data": { "name": "hello", "kind": "state",
                "stateSource": { "kind": "request" } } }

## Output

On success (stdout, exit 0):

    { "ok": true, "id": "node-abc" }

On error (stderr, non-zero exit):

    { "error": "<message>", "code": "<kind>" }

Error kinds for this command:
  flowNotFound      → exit 3
  fileNotFound      → exit 3
  badJson           → exit 2
  badSchema         → exit 2
  idAlreadyExists   → exit 4
  writeFailed       → exit 5

## Examples
  seeflow nodes:add abc12345 --json '{"type":"shapeNode","data":{"shape":"rectangle"}}'
  seeflow nodes:add abc12345 --file node.json
  cat node.json | seeflow nodes:add abc12345 --stdin

Requires studio running: no
```

## Architecture

- **`apps/studio/src/cli-manifest.ts`** — owns `COMMAND_MANIFEST`,
  `resolveSchemaRef`, `renderCommandList`, `renderCommandHelp`,
  `renderManifestJson`.
  - `renderCommandList()`: prepend a "Calling convention" preamble.
  - `renderCommandHelp(name)`: rewrite to emit the new markdown layout
    with the resolved JSON Schema inlined and the per-command exit-code
    table generated from a shared kind→exit map.

- **`apps/studio/src/cli-helpers.ts`** — already owns the runtime
  exit-code mapping in the private `outcomeExitCode` helper. Export it
  (or a sibling `EXIT_CODE_BY_KIND` map) so the manifest renderer and
  the runtime cannot drift. This is the single integration point.

- **No new files.** No `CLI.md`. No new flags.

## Source-of-truth integrity

The renderer reads two things at runtime: `COMMAND_MANIFEST` (already
the source of truth) and the exported exit-code map from
`cli-helpers.ts`. There is no second copy of any of this; help output
is computed, not committed.

The existing `cli-manifest.test.ts` keeps each manifest entry honest;
existing `help-parity.test.ts` (in `skills/seeflow-wiki/`) keeps the
skill's command references aligned with `seeflow help`. We will add a
small unit test covering the new help-rendering branches: presence of
the JSON Schema block, presence of the exit-code table, and the
preamble in the index.

## Risks & open questions

- **Schema verbosity.** Pretty-printed `zod-to-json-schema` output can
  be wide. Mitigation: keep the existing 2-space indent; do not collapse;
  agents handle it fine, humans skim. If a single command's schema
  exceeds ~150 lines we revisit.
- **Lifecycle commands' non-JSON output.** `start`/`stop` print human
  strings, not envelopes. Handled by an `## Output (text)` variant in
  the renderer, gated by a per-entry hint (or by `requiresStudio` +
  category=lifecycle heuristic — TBD in the plan).
- **`flows:play` / `e2e`.** These return SSE-driven results, not a
  single JSON envelope. The detailed help should call this out explicitly
  rather than claim a stdout envelope it does not deliver.
