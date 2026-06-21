# Layout by flow id — `POST /api/flows/:id/layout`

## Problem

The skill calls `POST /api/layout` with the entire `flow.json` in the body, then writes the response to `style.json` on disk. Phase 3 does this twice (pre-register and post-register, defensively); Phase 5 and Phase 7 each do it once more. After registration the studio's registry already knows `<repoPath>/<flowPath>`, so re-shipping the JSON is redundant — and the skill writes `style.json` itself even though the studio knows exactly where it belongs.

## Goal

After the change:

- The skill never sends `flow.json` in a layout request.
- The skill never writes `style.json`.
- One layout call per phase, not two.

## Design

### New route

`POST /api/flows/:id/layout` — registered-flow layout. Reads `flow.json` from disk via the registry entry, computes layout, writes `style.json` atomically next to `flow.json`, and broadcasts `flow:reload` so any open canvas refreshes.

Request body (all optional):

```json
{ "options"?: { "direction": "RIGHT", "spacing": { "layer": 220, "node": 140 } } }
```

Empty body is valid — the skill always uses defaults.

Response on success: `{ "ok": true }`. The nodes/connectors are not echoed — they've already been persisted to disk.

Failure modes:

| Condition | HTTP | Body |
|---|---|---|
| Unknown flow id | 404 | `{ error: 'unknown demo' }` |
| `flow.json` missing on disk | 404 | `{ error: 'Flow file not found: <abs>' }` |
| `flow.json` not valid JSON | 400 | `{ error: 'Flow file is not valid JSON', detail }` |
| `flow.json` fails `FlowSchema` | 200 | `{ ok: false, issues }` (matches `/api/validate`) |
| Malformed request body | 400 | `{ error: 'Body must be valid JSON' }` |
| Style write failed | 500 | `{ error: 'Failed to write style file: <msg>' }` |

### Style path resolution

`style.json` lives next to `flow.json`:

```
styleAbs = join(dirname(resolveFilePath(entry.repoPath, entry.flowPath)), 'style.json')
```

No separate config field. Resolved server-side from the registry entry.

### Atomic write

Match the temp-then-rename pattern already used by `moveNodeImpl` for position PATCHes. A successful write leaves no `.tmp` straggler; a failure leaves the previous `style.json` intact.

### Reload broadcast

After a successful write, broadcast `flow:reload` on the event bus (same shape as `/api/flows/:id/reset`). The watcher will also notice the disk change, but the explicit broadcast is immediate and matches the pattern of other studio-initiated mutations.

### Implementation sketch

```ts
api.post('/flows/:id/layout', async (c) => {
  const id = c.req.param('id');
  const entry = registry.getById(id);
  if (!entry) return c.json({ error: 'unknown demo' }, 404);

  const flowAbs = resolveFilePath(entry.repoPath, entry.flowPath);
  if (!existsSync(flowAbs)) return c.json({ error: `Flow file not found: ${flowAbs}` }, 404);

  let raw: unknown;
  try { raw = JSON.parse(readFileSync(flowAbs, 'utf8')); }
  catch (err) {
    return c.json({ error: 'Flow file is not valid JSON', detail: String(err) }, 400);
  }

  const flowParse = FlowSchema.safeParse(raw);
  if (!flowParse.success) {
    return c.json({
      ok: false as const,
      issues: flowParse.error.issues.map((i) => ({
        scope: 'flow' as const,
        path: [...i.path],
        message: i.message,
        code: i.code,
      })),
    });
  }

  let options: LayoutOptions | undefined;
  const text = await c.req.text();
  if (text.length > 0) {
    try { options = (JSON.parse(text) as { options?: LayoutOptions }).options; }
    catch { return c.json({ error: 'Body must be valid JSON' }, 400); }
  }

  const flow = flowParse.data;
  const result = await computeLayout(
    flow.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      data: n.type === 'shapeNode'
        ? { shape: (n.data as { shape?: string }).shape }
        : undefined,
    })),
    flow.connectors.map((c) => ({ id: c.id, source: c.source, target: c.target })),
    options,
  );

  const styleAbs = join(dirname(flowAbs), 'style.json');
  try {
    await writeAtomic(styleAbs, JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to write style file: ${msg}` }, 500);
  }

  events?.broadcast({ type: 'flow:reload', flowId: id, payload: {} });
  return c.json({ ok: true });
});
```

The `writeAtomic` helper either already exists in `operations.ts` (extract if so) or is a 5-line tempfile-write-then-rename utility added there.

### Stateless `/api/layout` — kept

The existing `POST /api/layout` stays as-is with both shapes:

- `{ flow, options? }` — no longer used by the skill but kept for ad-hoc callers (CI lint, third-party tooling that hasn't registered the flow).
- `{ nodes, edges, options? }` — canvas Tidy button. Unchanged.

Cheap to keep; already tested; the surface-area loss from removing it would have no upside.

## Skill restructure

Three sections of `skills/seeflow/SKILL.md` touch layout. All collapse to a single one-liner.

### Phase 3 — currently lines ~141-175

Before:

```bash
write flow.json
curl POST /api/layout { flow } → write style.json
curl POST /api/validate
register
curl POST /api/layout { flow } → write style.json    # defensive second pass
```

After:

```bash
write flow.json
register                                              # validates as side-effect
curl -fsS -X POST "$STUDIO_URL/api/flows/$id/layout" \
  | jq -e '.ok' >/dev/null \
  || { echo "layout failed" >&2; exit 1; }
# optional: curl POST /api/validate for structured report
```

The "`style.json` is mandatory — never skip it" sentence becomes:

> The studio writes `style.json` to disk; the skill never touches that file directly. Manual position fields in `flow.json` are still honoured if present.

### Phase 5 — currently ~line 241

Same one-liner replacement. The `jq --slurpfile` invocation goes away. Re-layout after a splice is now:

```bash
curl -fsS -X POST "$STUDIO_URL/api/flows/$id/layout" \
  | jq -e '.ok' >/dev/null || exit 1
```

### Phase 7 — currently ~line 303

Same one-liner replacement after the final dry-run.

### `skills/seeflow/references/schema.md` — line 66

Replace:

> Positions and connector handles come from `POST /api/layout`. The skill calls this endpoint in Phase 3 and Phase 5; the response (`{ nodes, connectors }`) is written verbatim to `style.json`.

With:

> Positions and connector handles come from `POST /api/flows/:id/layout`. The studio writes `style.json` directly; the skill calls this endpoint after register, after each splice, and after the final Phase 7 dry-run.

## Tests

`apps/studio/src/api.test.ts` — new `describe('POST /api/flows/:id/layout')` block. Each case uses an in-memory registry + tmp dir + tiny seed `flow.json`.

1. **success** — register a 2-node flow, POST, assert:
   - response is `{ ok: true }` (no nodes/connectors in body)
   - `style.json` exists adjacent to `flow.json` with `{ nodes, connectors }` populated
   - SSE `flow:reload` broadcast fired (assert via `EventBus` spy)
2. **options body** — POST `{ options: { direction: 'DOWN' } }` flips axis; positions differ from default-direction baseline
3. **empty body** — POST with no body succeeds; same as default options
4. **malformed body** — POST `not-json` → 400 `Body must be valid JSON`
5. **unknown id** → 404 `unknown demo`
6. **flow file missing** — register, then `rm flow.json`, POST → 404 `Flow file not found`
7. **bad JSON on disk** — write `{` into `flow.json` → 400 `Flow file is not valid JSON`
8. **schema failure** — `flow.json` with a malformed node → 200 `{ ok: false, issues: [...] }`
9. **write failure** — inject a failing write (e.g. chmod the dir, or a writeAtomic stub) → 500 `Failed to write style file`
10. **atomic write** — assert no `.tmp` straggler after a successful write

The existing `describe('POST /api/layout')` block stays untouched.

## Migration / rollout

Single-PR change. Backend route + skill edits + tests in one commit. The stateless endpoint stays, so no third-party callers break. The skill's own pre-register layout call is removed in the same PR — no transitional code.

## Out of scope

- Canvas Tidy button — unchanged. Stateless `{ nodes, edges }` shape is intentional (DOM-measured sizes override schema sizes).
- LLM-authored position field — already removed in commit `9342491`. No further changes needed.
- `LayoutOptions` surface — same options object, same defaults. No new tuning knobs in this PR.
