# stateSource schema guidance

**Date:** 2026-05-25
**Status:** Design approved, ready for implementation

## Problem

`stateSource` is declared in `apps/studio/src/schema.ts` and emitted by `seeflow schema node`, but the AI agent that authors `flow.json` files never sets it. Inspecting the CLI output reveals why: the JSON Schema carries no descriptions. The AI sees `{ anyOf: [{ kind: 'request' }, { kind: 'event' }] }` with no hint of meaning, no pairing rule with `statusAction`, and no signal for when to choose `request` vs `event`. Combined with the field being optional, omission is the path of least resistance.

The fix is not to change the schema's shape — `stateSource` already models the intent correctly. The fix is to make the schema *teach* the AI how to use the field, in the JSON output itself.

## Goal

Every time the AI inspects `seeflow schema node`, it should see enough description to decide:

1. Whether to set `stateSource` on a given node.
2. Which `kind` to choose.
3. How the field pairs with `statusAction`.

No runtime behavior changes. No new fields. Only descriptive metadata that propagates through `zod-to-json-schema`.

## Surfaces

Three places carry the description payload, each answering a different question.

### 1. `StateSourceSchema` (the union itself) — `apps/studio/src/schema.ts`

`.describe()` on the union answers "what is this field?".

> Declares how this node's live state is sourced. Pair with `statusAction` so observers can tell at a glance whether the node's status is polled or pushed.

### 2. Each variant — `apps/studio/src/schema.ts`

`.describe()` on each member answers "what does this value mean?".

- `{ kind: 'request' }` →
  > Poll-based state: `statusAction` samples an endpoint on an interval (REST GET, healthcheck, DB query). Use for services you can probe.
- `{ kind: 'event' }` →
  > Push-based state: `statusAction` subscribes to a stream (SSE, webhook, queue topic). Use for message buses, async pipelines, anything that *announces* state changes.

### 3. The optional wrapper at the call site — `NodeCapabilitiesShape`, `apps/studio/src/schema.ts`

`.describe()` on the optional-wrapped property answers "should I set this?". This is what surfaces at the property location in every node variant's JSON Schema.

> Set this on any node that has a `statusAction`. Choose `request` for poll-based sources, `event` for push-based sources. Omit on decorative nodes (sticky, label-only text) and on action nodes whose only behavior is `playAction`.

### 4. Cross-field invariants — `apps/studio/src/schema-catalog.ts` `notes` array

JSON Schema property descriptions can't easily express cross-field rules. Two new note strings:

1. `"stateSource SHOULD be set on every node that has a statusAction — kind:'request' for poll-based (REST, healthcheck, DB query), kind:'event' for push-based (SSE, webhook, queue, message bus)."`
2. `"stateSource may also be set without a statusAction on representational/architecture diagrams to signal data-flow intent (poll vs push) without wiring a runtime probe."`

## Non-goals

- Not enriching `stateSource` with URLs, intervals, event names, or topics. Those already live on edges (`url`, `eventName`, `queueName`, `method`) — duplicating them on nodes would create drift.
- Not making `stateSource` required when `statusAction` is present. Soft guidance ("SHOULD") is sufficient; hard enforcement would break existing demo flows and is too rigid for representational use.
- Not changing canvas runtime behavior. `stateSource` remains informational v1 metadata.
- Not touching `skills/seeflow/references/schema.md` in this change. The schema is the single source of truth; the AI reads `seeflow schema` first.

## Verification

1. `bun run --cwd apps/studio seeflow schema node` includes `description` strings on `stateSource`, both variants, and at the call-site property.
2. The two new notes appear in the `notes` array.
3. `bun run typecheck` and `bun run lint` clean.
4. Existing schema tests pass; add one assertion that the emitted JSON Schema for any node carries a non-empty `data.properties.stateSource.description`.

## Files touched

- `apps/studio/src/schema.ts` — add `.describe()` calls.
- `apps/studio/src/schema-catalog.ts` — append two notes.
- One schema test (location TBD during implementation) — assert description presence.
