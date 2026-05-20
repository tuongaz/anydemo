---
techId: typescript
category: language
---

# TypeScript

> **General guidance only.** Check `<project>/.seeflow/WIKI.md`
> `## Tech stack adaptations` first — project-specific helpers,
> fixtures, and conventions always win over the templates below.
> Whatever you learn this run, append back into that section so the
> next flow reuses it.

## Node modelling

- Languages don't drive node modelling; consult the tech-specific refs
  (`tech/postgres.md`, `tech/google-pubsub.md`, etc.) for resource node
  guidance.
- Interpreter wiring: prefer `playAction.interpreter: "bun"` with
  `args: ["run"]`. Fall back to `interpreter: "node", args: []` when
  the project's `packageManager` is npm/yarn/pnpm. Both have global
  `fetch`.

## Play (trigger locally)

- Use the project's existing client/SDK if grep finds one in
  `src/`; otherwise plain `fetch`.
- Read stdin: `await Bun.stdin.text()` under bun, or accumulate
  `process.stdin` chunks under node.
- Idempotency: derive a stable id from fixture; don't lean on
  `Date.now()` alone.

```ts
#!/usr/bin/env bun
// Bun: `await Bun.stdin.text()`. Under node: read process.stdin chunks.
const raw = (await Bun.stdin.text()) || "{}";
let input: Record<string, unknown> = {};
try { input = JSON.parse(raw); } catch {}
const id = (input.id as string) ?? "demo-1";

try {
  const res = await fetch("http://localhost:8080/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, total: 4200 }),
  });
  if (!res.ok) {
    console.error(`http ${res.status}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, id }));
} catch (e) {
  console.error(`play failed: ${(e as Error).message}`);
  process.exit(1);
}
```

## Status (read locally)

- Infinite `while (true)` + `await new Promise(r => setTimeout(r, 1000))`
  (works in both bun and node; `Bun.sleep` is bun-only).
- One `console.log(JSON.stringify(report))` per tick — one JSON object
  per line.
- Catch the read error, emit `state: "warn"`, keep ticking.

```ts
#!/usr/bin/env bun
type Report = { state: "ok" | "warn" | "error"; summary: string; data: unknown; ts: number };

while (true) {
  let report: Report = { state: "ok", summary: "0 orders", data: { count: 0 }, ts: Math.floor(Date.now() / 1000) };
  try {
    const res = await fetch("http://localhost:8080/orders/count");
    if (!res.ok) throw new Error(`http ${res.status}`);
    const body = (await res.json()) as { count?: number };
    const count = body.count ?? 0;
    report = { state: "ok", summary: `${count} orders`, data: { count }, ts: Math.floor(Date.now() / 1000) };
  } catch (e) {
    report = { state: "warn", summary: (e as Error).message, data: { count: 0 }, ts: Math.floor(Date.now() / 1000) };
  }
  console.log(JSON.stringify(report));
  await new Promise((r) => setTimeout(r, 1000));
}
```

## Gotchas

- Top-level `await` requires bun, or `"type": "module"` in node's
  `package.json`. Wrap in an `async function main()` if neither holds.
- `Bun.sleep` and `Bun.stdin` are bun-only. Use `setTimeout`+promise and
  the node stdin pattern when targeting node.
- Running scripts outside any `package.json` works fine with bun; older
  node versions may need `--experimental-vm-modules`.
- `console.log` is your JSON channel — route diagnostics through
  `console.error`.

## Fixture shape

```json
{ "id": "demo-1", "total": 4200 }
```
