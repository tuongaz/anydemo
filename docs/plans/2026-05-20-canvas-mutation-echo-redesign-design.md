# Canvas mutation echo — eliminate redundant network + reparse on every edit

## Problem

A single user gesture (e.g. moving one node) triggers three backend round trips and a double reparse on the server:

1. `PATCH /api/flows/:id/nodes/:nodeId/position` — the actual write (intended).
2. `GET /api/flows/:id` — re-fetches the whole flow detail, even though the SSE event that triggered the refetch already carried the new snapshot in its payload.
3. `GET /api/flows` — re-fetches the demos list, which cannot have changed from a position edit.

On the server, every mutation reparses `flow.json` twice: once explicitly (`watcher.reparse(flowId)` at the end of `moveNodeImpl`), and once again via the fs watcher's debounce timer firing on the same write.

## Scope

This design covers **Layer A** only — network calls and own-write echo. The follow-up "Layer B" work (granular SSE patches + per-node store subscription so moving one node only re-renders that node) is intentionally deferred to a separate phase.

## Goals

After the change:

- A node move costs **1** backend call (the PATCH) and **1** reparse.
- External file edits (editor save, git pull, plugin write) still trigger a `flow:reload` SSE event with the new snapshot.
- The optimistic-override / `pruneAgainst` / undo machinery is unchanged.
- The demos list refresh moves from "every mutation" to "only when it could have changed" (mount, hello-reconnect, project create, project unregister).

## Architecture today

**Write path (client → server):**

1. User drags → `onNodePositionChange` writes an optimistic override (visible instantly).
2. Client PATCHes `/api/flows/:id/nodes/:nodeId/position`.
3. `moveNodeImpl` writes `flow.json` atomically, calls `watcher.reparse(flowId)` (`apps/studio/src/operations.ts:1008`).
4. Server returns `{ok, position}` — minimal ack.

**Echo path (server → client):**

5. fs watcher fires on the same write (debounced), reparses + re-validates the file — second reparse for the same write.
6. Watcher broadcasts `flow:reload` with the **full snapshot** in `payload.flow` (`apps/studio/src/watcher.ts:350`).
7. Client's `useStudioEvents` fires `onReload` → `refreshDetail()` + `refreshDemos()` (`apps/web/src/App.tsx:39-45`) — ignores the snapshot it just received.
8. Two GETs return; `setDetail(newFlow)` replaces the whole `detail` object.
9. Optimistic override is dropped by `pruneAgainst`.

## Design

### Server — centralize broadcasting + own-write dedupe

**New watcher entry point.** Add to `FlowWatcher`:

```ts
notifyWritten(flowId: string, snap: FlowSnapshot, fileContent: string): void
```

Internally the watcher keeps a small ring buffer of last-written hashes per flow (4 deep is enough headroom for back-to-back writes):

```ts
const lastWrittenHashes = new Map<string, string[]>(); // flowId → ring of up to 4 blake3 hashes
```

`notifyWritten` does two things:

1. Hashes `fileContent` (blake3) and pushes onto the ring for `flowId`.
2. Broadcasts `flow:reload` directly from `snap` — no file re-read, no re-validate, no debounce wait.

**fs-watcher callback becomes external-edit-only.** The existing debounce path (`apps/studio/src/watcher.ts:386-390`) changes to:

```ts
handle.debounceTimer = setTimeout(() => {
  handle.debounceTimer = null;
  const content = readFileSync(filePath, 'utf-8');
  if (lastWrittenHashes.get(flowId)?.includes(blake3(content))) return; // self-write echo
  const snap = parseAndMerge(content, ...);
  if (snap) broadcastReload(flowId, snap);
}, debounceMs);
```

Self-writes are suppressed; external edits broadcast as before.

### Server — mutation impls produce the snap inline

`mutateMergedFlow` already parses and validates the post-mutation flow to write it. Extend its return shape so callers get the validated snapshot and the serialized content back:

```ts
return { kind: 'ok', snap, content };
```

Every mutation impl — `moveNodeImpl`, `patchNodeImpl`, `patchConnectorImpl`, create/delete impls, the layout impl, sticky-on-create flows — replaces its current `watcher.reparse(flowId)` call with:

```ts
deps.watcher?.notifyWritten(flowId, snap, content);
```

`reparse` survives for hello/initial-mount paths; the explicit post-write `reparse` is removed.

**Net effect:** 1 reparse per write (was 2), 1 SSE event per write (path now direct, no debounce wait).

### Client — split the SSE callback

`useStudioEvents` currently fires the same `onReload` on `hello` and `flow:reload`. Split them — they carry different semantics.

```ts
interface UseStudioEventsOptions {
  onHello?: () => void;
  onFlowReload?: (payload: FlowReloadPayload) => void;
  onEvent?: (event: StudioEvent) => void;
}

type FlowReloadPayload =
  | { valid: true; flow: ResolvedFlow }
  | { valid: false; error: string };
```

`onHello` is a catch-up signal (refetch). `onFlowReload` is a push of new state (apply).

### Client — `useDemoData` exposes `applyDetail`

```ts
return { detail, loading, error, refresh, applyDetail };
```

`applyDetail(detail)` is `setDetail(detail)` exposed for SSE-driven updates. `refresh()` stays for initial mount + hello-reconnect.

### Client — `App.tsx` rewire

```ts
const { demos, refresh: refreshFlows } = useDemos();
const { detail, loading, refresh: refreshDetail, applyDetail } = useDemoData(flowId);

const onHello = useCallback(() => {
  resetNodeStatuses();
  refreshDetail();
  refreshFlows();
}, [refreshDetail, refreshFlows, resetNodeStatuses]);

const onFlowReload = useCallback((payload: FlowReloadPayload) => {
  if (!flowId) return;
  applyDetail(
    payload.valid
      ? { id: flowId, valid: true, flow: payload.flow }
      : { id: flowId, valid: false, error: payload.error },
  );
}, [flowId, applyDetail]);

useStudioEvents(flowId, { onHello, onFlowReload, onEvent });
```

`refreshFlows()` no longer runs on every mutation. It stays in: initial mount (inside `useDemos`), `onHello`, project create (`onProjectCreated`), and project unregister (`onProjectUnregistered`).

### Net behavior for a node move

- 1 PATCH out.
- 1 SSE `flow:reload` event in, carrying the new snapshot.
- 0 GETs.
- 1 server reparse (the one inside `mutateMergedFlow` that was already happening).
- Optimistic override → `pruneAgainst` flow is unchanged.

## Edge cases

**Two writes A then B in rapid succession.** Both `notifyWritten` calls broadcast immediately; both hashes are in the ring. The fs callback fires once (debounced) on the file containing B → matches → suppressed. Two broadcasts, correct.

**External save during in-flight PATCH.** PATCH lands, hash X recorded, broadcast fires. Editor saves different content. fs callback hashes the editor's content → no match in ring → broadcasts external state. Optimistic override gets pruned against external state. Last write wins; file is source of truth — unchanged from today.

**SSE disconnect mid-drag.** Override stays pinned (PATCH succeeded; no echo arrived). Reconnect → `hello` → `refreshDetail()` catches up → `pruneAgainst` drops the override. Unchanged from today.

**`notifyWritten` called but fs callback never fires.** Fine — broadcast already happened from the direct path.

**fs callback fires without a matching `notifyWritten`.** Treated as external — harmless extra broadcast that just re-pushes the current state.

## Test plan

Additions:

- `apps/studio/src/watcher.test.ts` — `notifyWritten` broadcasts; fs callback with matching hash is suppressed; non-matching hash broadcasts; ring buffer holds last 4 hashes.
- `apps/studio/src/operations.test.ts` — each mutation impl (`moveNodeImpl`, `patchNodeImpl`, `patchConnectorImpl`, node create/delete, connector create/delete) returns the snap and calls `notifyWritten`.
- `apps/web/src/hooks/use-studio-events.test.ts` — `flow:reload` payload threads to `onFlowReload`; `hello` fires `onHello`; reconnect fires `onHello`.
- `apps/web/src/hooks/use-demo-data.test.ts` — `applyDetail` updates `detail` without calling `fetchFlowDetail`.

Update any existing test asserting a GET on `flow:reload` to instead assert the payload is consumed.

## Rollout

Single PR. No flag — local studio, single deployment surface. Order of commits inside the PR:

1. Watcher: add `notifyWritten` + hash dedupe, keep `reparse` as a thin alias.
2. `mutateMergedFlow`: extend return shape to include `snap` + `content`.
3. Mutation impls: switch from `reparse` to `notifyWritten`.
4. Client: split `onReload` into `onHello` + `onFlowReload`, add `applyDetail`.
5. Remove the explicit-reparse path from mutation impls (now unused).

## Out of scope (Layer B follow-up)

- Granular SSE patches (`flow:node-moved` etc.) so a single field change doesn't ship a full snapshot.
- Normalized client store + per-node subscription so moving node A doesn't re-render node B.
- This file is intentionally not blocked on Layer B — Layer A is a prerequisite for the cleanest version of Layer B anyway.
