# Script-based playAction + long-running statusAction

Date: 2026-05-14
Status: Design

## Summary

Replace the HTTP-only `playAction` with a script-based action: the Play button
spawns a local script (any language: Node / Go / Python / shell) and reports
its result over the existing SSE pipeline. Add a parallel long-running
`statusAction` field that fans out on every Play click — every node carrying a
status script runs concurrently and streams structured status reports back to
the UI for display on the node and in the sidebar.

The change is **schema-breaking** for `playAction`. `resetAction` is
unaffected. Existing example demos that declare HTTP play actions will fail
schema validation; one (`examples/todo-demo-target`) is migrated as a smoke
test, the rest are left to error until manually fixed.

## Goals

- Author can hand-edit `demo.json` to attach a script to a Play node.
- Scripts can be written in any language the project already uses.
- Status nodes auto-run on Play click and stream structured updates back.
- No new UI for *authoring* (scripts are added by editing the JSON). The UI
  *renders* status results on the node and in the sidebar.

## Non-goals

- A skill / wizard that generates scripts for users.
- Authoring status scripts via the canvas.
- Bidirectional communication (UI → running status script).
- Sandboxing — scripts run with the studio's full privileges.

## Locked decisions

1. **`playAction` is script-only.** The HTTP variant is removed. `resetAction`
   keeps the existing `HttpActionSchema` independently.
2. **JSON-on-stdout, exit code is status.** Exit 0 → `node:done` with parsed
   stdout as `body`. Exit ≠ 0 → `node:error` with the last stderr line.
3. **Per-script interpreter as `command`-equivalent fields.** Schema shape:
   `{ kind: 'script', interpreter, args?: string[], scriptPath, input?, timeoutMs? }`.
   Studio spawns `<interpreter> <...args> <scriptPath>` with `cwd: <project>`.
4. **Path safety:** `scriptPath` must be a clean relative path under
   `<project>/.seeflow/` (same refine as `imageNode.path`). `interpreter` and
   `args` are opaque (free-form, naturally resolved against `$PATH`).
5. **Script input:** env vars (`SEEFLOW_DEMO_ID`, `SEEFLOW_NODE_ID`,
   `SEEFLOW_RUN_ID`) plus optional `input` JSON written to stdin and closed.
6. **Timeout:** `timeoutMs` default 30s (max 600_000). `SIGTERM`, 2s grace,
   `SIGKILL`. Timeout becomes `node:error` with message
   `'script timed out after Nms'`.
7. **Status scripts are long-running.** Optional `statusAction` field on both
   `playNode` and `stateNode`, same script shape minus `input` / `timeoutMs`,
   plus `maxLifetimeMs` (default 1h hard cap).
8. **Fan-out rule:** any Play click starts *every* status-equipped node's
   script in parallel — no graph walk. Subsequent Play clicks kill the
   previous batch (SIGTERM → 2s → SIGKILL) and respawn fresh.
9. **Status report contract:** each line of stdout from a status script is a
   JSON object: `{ state: 'ok'|'warn'|'error'|'pending', summary?, detail?,
   data?, ts? }`. Malformed lines are logged and skipped.
10. **Existing examples:** `examples/todo-demo-target` is migrated as the
    smoke-test demo; `checkout-demo` and `order-pipeline` are left to error
    until manually fixed (out of scope).

## Schema changes — `apps/studio/src/schema.ts`

```ts
// Existing — unchanged, now used only by resetAction.
const HttpActionSchema = z.object({
  kind: z.literal('http'),
  method: HttpMethodSchema,
  url: z.string().min(1),
  body: z.unknown().optional(),
  bodySchema: z.unknown().optional(),
});

// New — replaces the old PlayActionSchema alias.
const ScriptActionSchema = z.object({
  kind: z.literal('script'),
  interpreter: z.string().min(1),
  args: z.array(z.string()).optional(),
  scriptPath: z.string().min(1).refine(isCleanRelativePath, {
    message: 'scriptPath must be a relative path under .seeflow/ (no absolute / traversal)',
  }),
  input: z.unknown().optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});
const PlayActionSchema = ScriptActionSchema;

// New — parallel to PlayActionSchema, no input/timeoutMs, plus maxLifetimeMs.
const StatusActionSchema = z.object({
  kind: z.literal('script'),
  interpreter: z.string().min(1),
  args: z.array(z.string()).optional(),
  scriptPath: z.string().min(1).refine(isCleanRelativePath, { ... }),
  maxLifetimeMs: z.number().int().positive().max(3_600_000).optional(),
});

// Node-data updates:
const PlayNodeDataSchema = NodeDataBaseSchema.extend({
  playAction: PlayActionSchema,
  statusAction: StatusActionSchema.optional(),  // NEW
});

const StateNodeDataSchema = NodeDataBaseSchema.extend({
  playAction: PlayActionSchema.optional(),
  statusAction: StatusActionSchema.optional(),  // NEW
});

// Status report schema (validated per-line at runtime by the proxy).
export const StatusReportSchema = z.object({
  state: z.enum(['ok', 'warn', 'error', 'pending']),
  summary: z.string().max(120).optional(),
  detail: z.string().max(2000).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  ts: z.number().int().positive().optional(),
});
```

Exported types:

- `PlayAction` now resolves to the script shape (breaks consumers reading
  `.url` / `.method` — intended).
- New: `StatusAction`, `StatusReport`.

## Runtime — `apps/studio/src/proxy.ts`

Rewrite `runPlay()` to spawn a process instead of fetching. Inject a
`ProcessSpawner` seam for tests (separate from `shellout.ts`'s fire-and-forget
spawner: this one needs stdin/stdout/stderr/exit-code/kill).

```ts
export interface ProcessSpawner {
  spawn(opts: {
    cmd: string[];
    cwd: string;
    env: Record<string, string>;
    stdin: 'pipe' | 'ignore';
  }): SpawnHandle;
}

export interface SpawnHandle {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  stdin?: WritableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}
```

`runPlay()` flow:

1. Re-validate `scriptPath` via the existing `resolveProjectFile` helper.
   Reject symlink escapes at runtime.
2. Broadcast `node:running` with `{ nodeId, runId, interpreter, scriptPath }`.
3. Spawn `[interpreter, ...args, absScriptPath]` with project `cwd` and
   `SEEFLOW_DEMO_ID/NODE_ID/RUN_ID` env vars.
4. If `input` present: `JSON.stringify(input)` to stdin, close stdin.
5. Concurrently read stdout and stderr into buffers (avoid pipe-buffer
   deadlock under large outputs).
6. Race `proc.exited` vs `timeoutMs` (default 30_000). Timeout →
   `kill('SIGTERM')`, 2s grace, `kill('SIGKILL')`, broadcast `node:error`.
7. Exit 0 → parse stdout as JSON if it looks like JSON, else raw string.
   Broadcast `node:done` with `{ status: 200, body }`. Return `PlayResult`.
8. Exit ≠ 0 → last non-empty line of stderr (truncated to 500 chars) becomes
   `node:error` `message`.

### Status runner — new file `apps/studio/src/status-runner.ts`

```ts
export interface StatusRunner {
  /** Re-spawn all statusAction scripts for the given demo. Kills any previous
   *  batch first. Idempotent. Returns immediately; scripts run in background. */
  restart(demoId: string): Promise<void>;
  /** Kill all status scripts for the demo (no respawn). */
  stop(demoId: string): Promise<void>;
  /** Kill all status scripts for every demo. Used at studio shutdown. */
  stopAll(): Promise<void>;
}
```

Held as a singleton in `ApiOptions` alongside the existing `events`, `watcher`,
`spawner`. Internally keeps a `Map<demoId, SpawnHandle[]>` of live processes.
`restart` reads `demo.json`, finds every node with a `statusAction`, kills the
previous batch (parallel `SIGTERM` → 2s → `SIGKILL`), and spawns fresh.

For each running status script, the runner:

- Reads stdout as a stream of newline-delimited JSON objects.
- For each line: parse → `StatusReportSchema.safeParse`. If valid, broadcast
  `{ type: 'node:status', demoId, payload: { nodeId, ...report, ts: report.ts ?? Date.now() } }`.
  If invalid, log and skip.
- On `proc.exited`: if non-zero, broadcast a final `node:status` with
  `state: 'error'` and `summary: 'status script exited with code N'`.
- Enforces `maxLifetimeMs` (default 3_600_000): kill on timeout.

### Event bus — `apps/studio/src/events.ts`

Add `'node:status'` to the event type union. No payload changes to existing
events.

## API surface — `apps/studio/src/api.ts`

The `POST /api/demos/:id/play/:nodeId` handler:

1. Existing: re-read demo from disk, validate, find node.
2. Existing: 400 if node has no `playAction`.
3. **New:** call `statusRunner.restart(demoId)` *before* spawning the play
   script. Fire-and-forget — don't await beyond the spawn fanout. Failures to
   spawn individual status scripts log but don't fail the play call.
4. Existing: await `runPlay()` for the play node and return its `PlayResult`.

New error branch for the play path: `400` when the play `scriptPath` escapes
`<project>/.seeflow/` (mirrors existing path-escape responses).

No new endpoints. Status reports flow exclusively over the existing
`GET /api/events?demoId=...` SSE stream as `node:status` events.

## Web — `apps/web/`

### Event hook

The existing event hook (whatever subscribes to SSE per-demo) gains handling
for `node:status`. It maintains a per-node map of "latest status":

```ts
type NodeStatusMap = Record<string /* nodeId */, StatusReport & { ts: number }>;
```

Update on every `node:status` event; latest wins.

### Node render

`play-node.tsx` and `state-node.tsx` each gain a small status badge below the
existing header when the per-node map has an entry:

- A colored dot keyed off `state`:
  - `ok` → green
  - `warn` → amber
  - `error` → red
  - `pending` → slate
- Truncated `summary` (max ~40 chars on canvas, ellipsized via CSS).
- No badge rendered when no status report has arrived yet.

### Sidebar

When a node with status is selected, the sidebar gains a "Status" section
above the existing detail area:

- State badge (matching dot color).
- Full `summary`.
- `detail` rendered as **plain text** (line breaks preserved, no markdown).
- `data` rendered as a two-column key/value table. Values rendered with
  `JSON.stringify(v)` for non-string types — flat objects work; nested
  structures show as JSON.
- "Last updated: 12s ago" relative timestamp from `ts`.

## Tests

### New / rewritten

- `apps/studio/src/proxy.test.ts` (rewritten): JSON stdout → `body`; non-JSON
  stdout → raw string; exit ≠ 0 → `node:error` with last stderr line; timeout
  → SIGTERM + SIGKILL escalation; stdin input written and closed; env vars
  injected; symlink-escape rejection.
- `apps/studio/src/status-runner.test.ts` (new): line-by-line parsing;
  malformed line skip; kill-and-respawn on `restart()`; `maxLifetimeMs` cap;
  multiple demos isolated.
- `apps/studio/src/api.test.ts` (extended): Play click triggers play +
  fans out status scripts; second Play kills previous status batch;
  invalid `scriptPath` → 400.
- `apps/studio/src/schema.test.ts` (extended): valid `playAction` /
  `statusAction` parse; absolute / `..` path rejected; `StatusReportSchema`
  validation.
- `apps/web/` event hook test (extended): `node:status` updates per-node
  status map; latest wins.

### Example migration

`examples/todo-demo-target` is migrated to exercise **both** script types so
the example doubles as smoke coverage for the full feature.

**Play script — `examples/todo-demo-target/.seeflow/scripts/play.ts`** (new,
~15 lines). Reads `input` from stdin (or defaults to a fixed todo payload),
performs the demo's "add todo" action (e.g., appends to a JSON file under
`.seeflow/state/todos.json` or POSTs to the running target if present),
prints `{ ok: true, todoId, demoId: process.env.SEEFLOW_DEMO_ID }` to stdout,
exits 0.

**Status script — `examples/todo-demo-target/.seeflow/scripts/status.ts`**
(new, ~25 lines). Long-running loop that polls the same state every ~1s and
prints one `StatusReport` JSON line per tick:

```ts
// pseudo
while (true) {
  const todos = readTodos();  // from .seeflow/state/todos.json
  const pending = todos.filter(t => !t.done).length;
  console.log(JSON.stringify({
    state: pending === 0 ? 'ok' : 'pending',
    summary: `${pending} pending / ${todos.length} total`,
    detail: todos.slice(0, 5).map(t => `- [${t.done ? 'x' : ' '}] ${t.text}`).join('\n'),
    data: { pending, total: todos.length, completed: todos.length - pending },
    ts: Date.now(),
  }));
  await Bun.sleep(1000);
}
```

**`examples/todo-demo-target/.seeflow/demo.json`** (edited):
- Swap the HTTP `playAction` on the existing play node for
  `{ kind: 'script', interpreter: 'bun', args: ['run'], scriptPath: 'scripts/play.ts' }`.
- Add a `statusAction` to a state node (or the same play node) referencing
  `scripts/status.ts` with the same `interpreter` / `args` shape, plus an
  optional `maxLifetimeMs: 600000` (10 min).

The state node receiving the status updates renders the badge + summary on
canvas; clicking it opens the sidebar with the `detail` (first 5 todos) and
`data` table (pending / total / completed counts). This makes the example
exercise: spawn / JSON-on-stdout / SSE round-trip / line-by-line status
streaming / kill-and-respawn on subsequent Play clicks / node + sidebar
rendering — all in one demo.

## Risks / open items

1. **`Bun.spawn` stdin / stdout buffer race.** Writing to stdin while not
   reading stdout can deadlock if stdout fills. Mitigation: stream-pump
   stdout and stderr concurrently into buffers; only `await proc.exited`
   after stdin write+close has resolved.
2. **Windows interpreters.** Resolution via `$PATH` works for `bun`, `node`,
   `python`, `go`. Test fakes cover the contract, not real OS shells.
3. **Skill / diagram generator still emits HTTP playAction.** Out of scope
   here. Flag for follow-up so `skills/diagram/` stops generating invalid
   demos.
4. **No graceful kill on browser disconnect.** Status scripts keep running
   even when no canvas is connected. Acceptable for v1 — Play click batches
   them, demo reload kills them, studio shutdown kills them.
5. **Multiple browsers / canvases.** Concurrent Play clicks from two browsers
   race; whichever runs last kills the previous batch. Acceptable.
6. **Status script output rate.** A chatty script that prints 1000s of status
   reports per second floods the SSE channel. No backpressure or coalescing
   in v1 — author's responsibility to throttle.

## Implementation order

1. Schema changes + schema tests (red → green; rest of the world still
   compiles against types but breaks at runtime).
2. `ProcessSpawner` interface + default Bun implementation + new proxy
   tests.
3. Rewrite `runPlay()` against the new spawner; existing tests fail and are
   rewritten.
4. `StatusRunner` + tests.
5. Wire `statusRunner.restart()` into the `/play/:nodeId` handler; extend
   API tests.
6. `node:status` event type + SSE bus extension.
7. Web event hook + node render + sidebar.
8. Migrate `examples/todo-demo-target` as smoke test.
9. README + CLAUDE.md doc updates.
