# `seeflow help` Agent-Detail Uplift — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `seeflow help` and `seeflow help <command>` the agent's complete CLI reference — drill-in instruction up top, calling-convention preamble, resolved JSON Schemas inlined per command, success/error envelopes, and per-command exit-code tables.

**Architecture:** Single source of truth stays `apps/studio/src/cli-manifest.ts`. Rendering is upgraded; no new files (no `CLI.md`), no new flags. The exit-code map currently buried in `cli-helpers.ts` is exported so the manifest renderer and the runtime cannot drift.

**Tech Stack:** Bun, TypeScript, Zod, `zod-to-json-schema`, Biome.

**Design source:** `docs/plans/2026-05-21-cli-help-agent-detail-design.md`.

**Conventions for the executor:**
- Bun, never Node. `bun test <file>` to run a single test file.
- After edits: `bun run format` then `bun run lint` then `bun run typecheck` then targeted tests.
- Commit after each task with the exact message shown.

---

## Task 1: Export `EXIT_CODE_BY_KIND` from `cli-helpers.ts`

**Why:** the per-command help table maps each `errorKind` to its exit code. We must read the same map the runtime uses, or the docs lie.

**Files:**
- Modify: `apps/studio/src/cli-helpers.ts` (the private `outcomeExitCode` at lines 119–132)
- Test: `apps/studio/src/cli-helpers.test.ts` (extend existing file)

**Step 1: Write the failing test**

Add to `apps/studio/src/cli-helpers.test.ts`:

```ts
import { EXIT_CODE_BY_KIND, exitCodeForKind } from './cli-helpers.ts';

describe('EXIT_CODE_BY_KIND', () => {
  it('maps every documented outcome kind to its exit code', () => {
    expect(EXIT_CODE_BY_KIND).toEqual({
      badSchema: 2,
      badJson: 2,
      notFound: 3,
      flowNotFound: 3,
      fileNotFound: 3,
      unknownNode: 3,
      unknownConnector: 3,
      duplicateIdInBatch: 4,
      idAlreadyExists: 4,
      writeFailed: 5,
      sdkWriteFailed: 5,
      scaffoldFailed: 5,
    });
  });

  it('exitCodeForKind falls back to 1 for unknown kinds', () => {
    expect(exitCodeForKind('mysteryFailure')).toBe(1);
  });

  it('exitCodeForKind returns the mapped code for known kinds', () => {
    expect(exitCodeForKind('badSchema')).toBe(2);
    expect(exitCodeForKind('flowNotFound')).toBe(3);
    expect(exitCodeForKind('writeFailed')).toBe(5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test apps/studio/src/cli-helpers.test.ts`
Expected: FAIL — `EXIT_CODE_BY_KIND` and `exitCodeForKind` not exported.

**Step 3: Implement**

In `apps/studio/src/cli-helpers.ts`, replace the private `outcomeExitCode` with an exported constant + helper, and keep `printOutcome` working:

```ts
export const EXIT_CODE_BY_KIND: Record<string, number> = {
  badSchema: 2,
  badJson: 2,
  notFound: 3,
  flowNotFound: 3,
  fileNotFound: 3,
  unknownNode: 3,
  unknownConnector: 3,
  duplicateIdInBatch: 4,
  idAlreadyExists: 4,
  writeFailed: 5,
  sdkWriteFailed: 5,
  scaffoldFailed: 5,
};

export function exitCodeForKind(kind: string): number {
  return EXIT_CODE_BY_KIND[kind] ?? 1;
}
```

Then update `printOutcome` (line 86) to call `exitCodeForKind(outcome.kind)` instead of the deleted local `outcomeExitCode`.

**Step 4: Run tests**

Run: `bun test apps/studio/src/cli-helpers.test.ts`
Expected: PASS.

Run: `bun test` (full suite — `printOutcome` callers must still behave).
Expected: PASS.

**Step 5: Lint + typecheck + commit**

```bash
bun run format
bun run lint
bun run typecheck
git add apps/studio/src/cli-helpers.ts apps/studio/src/cli-helpers.test.ts
git commit -m "refactor(cli): export EXIT_CODE_BY_KIND so help can read runtime mapping"
```

---

## Task 2: Add `outputKind` to manifest entries

**Why:** `start` / `stop` print plain text, `flows:play` / `e2e` stream events. The detailed-help renderer needs to switch on this — without it, help would lie about envelopes the command does not emit. Default is `'json'` so every other command is unchanged.

**Files:**
- Modify: `apps/studio/src/cli-manifest.ts` (interface `CommandManifestEntry`, entries for `start`, `stop`, `flows:play`, `e2e`)
- Test: `apps/studio/src/cli-manifest.test.ts`

**Step 1: Write the failing test**

Add to `apps/studio/src/cli-manifest.test.ts` inside `describe('COMMAND_MANIFEST')`:

```ts
it('labels lifecycle commands with outputKind: "text"', () => {
  const start = COMMAND_MANIFEST.find((e) => e.name === 'start');
  const stop = COMMAND_MANIFEST.find((e) => e.name === 'stop');
  expect(start?.outputKind).toBe('text');
  expect(stop?.outputKind).toBe('text');
});

it('labels live SSE commands with outputKind: "stream"', () => {
  const play = COMMAND_MANIFEST.find((e) => e.name === 'flows:play');
  const e2e = COMMAND_MANIFEST.find((e) => e.name === 'e2e');
  expect(play?.outputKind).toBe('stream');
  expect(e2e?.outputKind).toBe('stream');
});

it('every other command defaults outputKind to "json" (or leaves it undefined)', () => {
  const textOrStream = new Set(['start', 'stop', 'flows:play', 'e2e']);
  for (const entry of COMMAND_MANIFEST) {
    if (textOrStream.has(entry.name)) continue;
    expect(entry.outputKind ?? 'json').toBe('json');
  }
});
```

**Step 2: Run to verify failure**

Run: `bun test apps/studio/src/cli-manifest.test.ts`
Expected: FAIL — `outputKind` not a property; entries don't carry it.

**Step 3: Implement**

In `apps/studio/src/cli-manifest.ts`:

1. Extend the interface:

```ts
export type CommandOutputKind = 'json' | 'text' | 'stream';

export interface CommandManifestEntry {
  // ... existing fields ...
  /** Shape of stdout. Default 'json' (envelope {ok:true,...}). 'text' for
   *  human-readable lifecycle output. 'stream' for SSE-driven runs. */
  outputKind?: CommandOutputKind;
  // ... existing fields continue ...
}
```

2. On the `start` entry, add `outputKind: 'text'`.
3. On the `stop` entry, add `outputKind: 'text'`.
4. On the `flows:play` entry, add `outputKind: 'stream'`.
5. On the `e2e` entry, add `outputKind: 'stream'`.

**Step 4: Run tests**

Run: `bun test apps/studio/src/cli-manifest.test.ts`
Expected: PASS, including the existing tests in that file.

**Step 5: Commit**

```bash
bun run format
bun run typecheck
git add apps/studio/src/cli-manifest.ts apps/studio/src/cli-manifest.test.ts
git commit -m "feat(cli): tag manifest entries with outputKind (text|stream|json)"
```

---

## Task 3: `renderCommandList()` — drill-in instruction + calling-convention preamble

**Why:** The first thing an agent sees from `seeflow help` should be how to get more detail. Then a short, reusable calling convention. Then the category list (already there).

**Files:**
- Modify: `apps/studio/src/cli-manifest.ts` — `renderCommandList()` (lines 622–655)
- Test: `apps/studio/src/cli-manifest.test.ts`

**Step 1: Write the failing test**

In `describe('renderCommandList')`:

```ts
it('opens with the drill-in instruction before anything else', () => {
  const out = renderCommandList();
  const lines = out.split('\n').filter((l) => l.trim().length > 0);
  // Drill-in line must appear before the first category header.
  const firstCategoryIdx = lines.findIndex((l) => l.startsWith('## '));
  const drillInIdx = lines.findIndex((l) =>
    l.includes('seeflow help <command>'),
  );
  expect(drillInIdx).toBeGreaterThanOrEqual(0);
  expect(drillInIdx).toBeLessThan(firstCategoryIdx);
});

it('includes a calling-convention preamble', () => {
  const out = renderCommandList();
  expect(out).toContain('Calling convention');
  // body delivery modes
  expect(out).toContain('--json');
  expect(out).toContain('--file');
  expect(out).toContain('--stdin');
  // success envelope
  expect(out).toContain('"ok": true');
  // error envelope
  expect(out).toContain('"error"');
  expect(out).toContain('"code"');
  // exit-code map (sample entries)
  expect(out).toMatch(/badSchema.*exit 2/);
  expect(out).toMatch(/flowNotFound.*exit 3/);
});

it('still lists every command after the preamble', () => {
  const out = renderCommandList();
  for (const entry of COMMAND_MANIFEST) {
    expect(out).toContain(entry.name);
  }
});
```

**Step 2: Run to verify failure**

Run: `bun test apps/studio/src/cli-manifest.test.ts -t renderCommandList`
Expected: FAIL on the new assertions.

**Step 3: Implement**

In `apps/studio/src/cli-manifest.ts`, import the exit-code map:

```ts
import { EXIT_CODE_BY_KIND } from './cli-helpers.ts';
```

Rewrite the top of `renderCommandList()` so output is, in order:

1. Header line: `seeflow — local studio for file-defined interactive demos`
2. Blank line
3. **Drill-in instruction line** (top — the user explicitly required this):
   `Run \`seeflow help <command>\` for full detail on any command below.`
   `Run \`seeflow help --json\` for the machine-readable manifest.`
4. Blank line
5. `## Calling convention` section (preamble):
   - One line on body delivery: `Body-bearing commands accept JSON via exactly one of: --json '<inline>' | --file <path> | --stdin`.
   - One line on success: `On success: stdout = {"ok": true, ...payload}; exit 0.`
   - One line on error: `On error: stderr = {"error": "<msg>", "code": "<kind>"}; non-zero exit.`
   - Then the exit-code map, generated from `EXIT_CODE_BY_KIND`, grouped by code (2/3/4/5/1), e.g.:
     ```
     Exit codes:
       2 — badSchema, badJson
       3 — notFound, flowNotFound, fileNotFound, unknownNode, unknownConnector
       4 — duplicateIdInBatch, idAlreadyExists
       5 — writeFailed, sdkWriteFailed, scaffoldFailed
       1 — anything else
     ```
6. Blank line
7. The existing category-grouped list (unchanged).
8. Drop the redundant final two lines about `seeflow help <command>` / `--json` (already shown at top).

A small helper inside the file keeps it readable:

```ts
function renderExitCodeTable(): string {
  const groups = new Map<number, string[]>();
  for (const [kind, code] of Object.entries(EXIT_CODE_BY_KIND)) {
    const arr = groups.get(code) ?? [];
    arr.push(kind);
    groups.set(code, arr);
  }
  const lines: string[] = ['Exit codes:'];
  for (const code of [2, 3, 4, 5]) {
    const kinds = groups.get(code);
    if (!kinds) continue;
    lines.push(`  ${code} — ${kinds.join(', ')}`);
  }
  lines.push('  1 — anything else');
  return lines.join('\n');
}
```

**Step 4: Run tests**

Run: `bun test apps/studio/src/cli-manifest.test.ts`
Expected: PASS (new + existing).

Run: `bun test skills/seeflow-wiki/test/help-parity.test.ts`
Expected: PASS (preamble doesn't disturb subcommand names in output).

**Step 5: Smoke-check the output**

Run: `/Users/tuongaz/dev/seeflow/apps/studio/bin/seeflow help | head -40`
Expected: the drill-in line appears in the first few non-blank lines; the calling-convention block appears before `## lifecycle`.

**Step 6: Commit**

```bash
bun run format
bun run lint
bun run typecheck
git add apps/studio/src/cli-manifest.ts apps/studio/src/cli-manifest.test.ts
git commit -m "feat(cli): seeflow help opens with drill-in + calling convention"
```

---

## Task 4: `renderCommandHelp()` — new layout for JSON-output commands

**Why:** This is the agent's primary reference for any single command. Today's output omits the resolved JSON Schema and the exit-code table. After this task, body-bearing JSON commands render the full Section 1 design.

**Files:**
- Modify: `apps/studio/src/cli-manifest.ts` — `renderCommandHelp()` (lines 567–620), `resolveSchemaRef()` is already there.
- Test: `apps/studio/src/cli-manifest.test.ts`

**Step 1: Write the failing tests**

Replace the existing minimal `renderCommandHelp` block with a richer set:

```ts
describe('renderCommandHelp', () => {
  it('throws for an unknown command', () => {
    expect(() => renderCommandHelp('nope:nope')).toThrow();
  });

  it('renders a body-bearing JSON command with all sections (nodes:add)', () => {
    const out = renderCommandHelp('nodes:add');
    expect(out).toMatch(/^# nodes:add/m);
    expect(out).toContain('## Synopsis');
    expect(out).toContain('## Arguments');
    expect(out).toContain('## Flags');
    expect(out).toContain('## Input (body)');
    // resolved JSON Schema must be present — look for a JSON object shape
    expect(out).toContain('"type": "object"');
    expect(out).toContain('"properties"');
    // example body
    expect(out).toContain('Example body');
    expect(out).toContain('"stateNode"');
    // output envelope
    expect(out).toContain('## Output');
    expect(out).toContain('"ok": true');
    expect(out).toContain('"error"');
    expect(out).toContain('"code"');
    // per-command exit-code table
    expect(out).toMatch(/flowNotFound.*exit 3/);
    expect(out).toMatch(/badSchema.*exit 2/);
    expect(out).toMatch(/writeFailed.*exit 5/);
    // examples + requires-studio
    expect(out).toContain('## Examples');
    expect(out).toContain('Requires studio running: no');
  });

  it('omits the Input section for commands with no body (flows:get)', () => {
    const out = renderCommandHelp('flows:get');
    expect(out).not.toContain('## Input (body)');
    expect(out).toContain('## Arguments');
    expect(out).toContain('## Output');
  });

  it('inlines the JSON Schema for body commands whose schemaRef resolves', () => {
    const out = renderCommandHelp('nodes:patch');
    expect(out).toContain('## Input (body)');
    // schemaRef NodePatchBody resolves via zod-to-json-schema
    expect(out).toContain('"type": "object"');
  });
});
```

**Step 2: Run to verify failure**

Run: `bun test apps/studio/src/cli-manifest.test.ts -t renderCommandHelp`
Expected: FAIL — current renderer doesn't emit `## Input (body)`, the schema isn't inlined, the exit-code table is missing.

**Step 3: Implement**

Rewrite `renderCommandHelp(name)` to produce the layout below. Body section uses the existing `resolveSchemaRef`; when there's no `schemaRef` but a `body.example` exists, show only the example. Output section branches on `outputKind` (this task implements the `'json'` / default branch only — Tasks 5 & 6 fill in `'text'` and `'stream'`):

```ts
export function renderCommandHelp(name: string): string {
  const entry = COMMAND_MANIFEST.find((e) => e.name === name);
  if (!entry) throw new Error(`Unknown command: ${name}`);

  const lines: string[] = [];
  lines.push(`# ${entry.name}`, '');
  lines.push(entry.description, '');

  lines.push('## Synopsis', `  ${entry.synopsis}`, '');

  if (entry.args.length > 0) {
    lines.push('## Arguments');
    for (const a of entry.args) {
      const req = a.required ? '(required)' : '(optional)';
      lines.push(`  <${a.name}>  ${req} — ${a.description}`);
    }
    lines.push('');
  }

  if (entry.flags.length > 0) {
    lines.push('## Flags');
    for (const f of entry.flags) {
      const value = f.valuePlaceholder ? ` ${f.valuePlaceholder}` : '';
      const req = f.required ? '(required)' : '(optional)';
      lines.push(`  --${f.name}${value}  ${req} — ${f.description}`);
    }
    lines.push('');
  }

  if (entry.body) {
    lines.push('## Input (body)');
    if (entry.body.schemaRef) {
      const schema = resolveSchemaRef(entry.body.schemaRef);
      if (schema !== undefined) {
        lines.push('Schema (JSON Schema, resolved from Zod):', '');
        lines.push(indent(JSON.stringify(schema, null, 2), '    '));
        lines.push('');
      }
    }
    if (entry.body.example !== undefined) {
      lines.push('Example body:', '');
      lines.push(indent(JSON.stringify(entry.body.example, null, 2), '    '));
      lines.push('');
    }
  }

  lines.push('## Output');
  lines.push(...renderOutputSection(entry));
  lines.push('');

  if (entry.examples.length > 0) {
    lines.push('## Examples');
    for (const ex of entry.examples) lines.push(`  ${ex}`);
    lines.push('');
  }

  lines.push(`Requires studio running: ${entry.requiresStudio ? 'yes' : 'no'}`);
  return lines.join('\n');
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((l) => `${prefix}${l}`)
    .join('\n');
}

function renderOutputSection(entry: CommandManifestEntry): string[] {
  const kind = entry.outputKind ?? 'json';
  if (kind === 'text') return renderOutputText(entry);
  if (kind === 'stream') return renderOutputStream(entry);
  return renderOutputJson(entry);
}

function renderOutputJson(entry: CommandManifestEntry): string[] {
  const out: string[] = [];
  out.push('On success (stdout, exit 0):', '');
  if (entry.outputs.okExample !== undefined) {
    const merged = { ok: true, ...(entry.outputs.okExample as object) };
    out.push(indent(JSON.stringify(merged, null, 2), '    '));
  } else {
    out.push('    { "ok": true }');
  }
  out.push('');
  out.push('On error (stderr, non-zero exit):', '');
  out.push('    { "error": "<message>", "code": "<kind>" }', '');
  const kinds = entry.outputs.errorKinds ?? [];
  if (kinds.length > 0) {
    out.push('Error kinds for this command:');
    for (const k of kinds) out.push(`  ${k}  → exit ${exitCodeForKind(k)}`);
  }
  return out;
}

// Tasks 5 & 6 will implement these; stub for now:
function renderOutputText(_entry: CommandManifestEntry): string[] {
  return ['Prints human-readable status to stdout.', 'Exit 0 on success, non-zero on failure.'];
}
function renderOutputStream(_entry: CommandManifestEntry): string[] {
  return ['Streams progress events to stdout until completion.', 'Exit 0 on success, non-zero on failure.'];
}
```

Add the import at the top of `cli-manifest.ts` for `exitCodeForKind` from `./cli-helpers.ts` (alongside `EXIT_CODE_BY_KIND` from Task 3).

**Step 4: Run tests**

Run: `bun test apps/studio/src/cli-manifest.test.ts`
Expected: PASS — JSON-command tests pass; lifecycle / SSE entries still render (via stubs) so existing parity tests don't regress.

Run: `bun test`
Expected: PASS — full suite.

**Step 5: Smoke-check**

Run: `/Users/tuongaz/dev/seeflow/apps/studio/bin/seeflow help nodes:add`
Expected: matches the rendering example in the design doc (Section 1).

**Step 6: Commit**

```bash
bun run format
bun run lint
bun run typecheck
git add apps/studio/src/cli-manifest.ts apps/studio/src/cli-manifest.test.ts
git commit -m "feat(cli): help <command> inlines JSON Schema and exit-code table"
```

---

## Task 5: Text-output variant for `start` / `stop`

**Why:** `start` and `stop` print human strings, not JSON envelopes. The renderer must not advertise an envelope the command doesn't deliver.

**Files:**
- Modify: `apps/studio/src/cli-manifest.ts` — `renderOutputText`
- Test: `apps/studio/src/cli-manifest.test.ts`

**Step 1: Failing test**

```ts
describe('renderCommandHelp — text output', () => {
  it('does NOT advertise a JSON envelope for start', () => {
    const out = renderCommandHelp('start');
    expect(out).toContain('## Output');
    expect(out).toContain('human-readable');
    expect(out).not.toContain('"ok": true'); // no JSON envelope claim
    // Real example lines from cli.ts
    expect(out).toMatch(/SeeFlow Studio (listening|started)/);
  });

  it('does NOT advertise a JSON envelope for stop', () => {
    const out = renderCommandHelp('stop');
    expect(out).not.toContain('"ok": true');
    expect(out).toMatch(/Stopped studio|No studio running/);
  });
});
```

**Step 2: Run to verify failure**

Run: `bun test apps/studio/src/cli-manifest.test.ts -t "text output"`
Expected: FAIL — the stub doesn't include the example strings.

**Step 3: Implement**

Replace `renderOutputText` so it prints the literal status lines the commands actually emit:

```ts
function renderOutputText(entry: CommandManifestEntry): string[] {
  const out: string[] = [];
  out.push('Prints human-readable status to stdout (no JSON envelope).');
  out.push('Exit 0 on success, non-zero on failure.', '');
  if (entry.name === 'start') {
    out.push('Example stdout:');
    out.push('  SeeFlow Studio listening on http://localhost:4321');
    out.push('  SeeFlow Studio started in background on http://localhost:4321 (pid 12345)');
  } else if (entry.name === 'stop') {
    out.push('Example stdout:');
    out.push('  Stopped studio (pid 12345).');
    out.push('  No studio running (no pid file at ~/.seeflow/seeflow.pid).');
  }
  return out;
}
```

(Hardcoding the two known commands is the YAGNI move — there are only two text-output commands, both lifecycle. If a third appears we generalise then.)

**Step 4: Run tests**

Run: `bun test apps/studio/src/cli-manifest.test.ts`
Expected: PASS.

**Step 5: Smoke-check**

Run: `apps/studio/bin/seeflow help start`
Expected: no `"ok": true` line; example stdout lines present.

**Step 6: Commit**

```bash
bun run format
bun run typecheck
git add apps/studio/src/cli-manifest.ts apps/studio/src/cli-manifest.test.ts
git commit -m "feat(cli): help start|stop documents real text output, not a JSON envelope"
```

---

## Task 6: Stream-output variant for `flows:play` / `e2e`

**Why:** These commands stream progress until the run completes. Today the manifest has empty `outputs: {}` for both — the agent has no guidance at all.

**Files:**
- Modify: `apps/studio/src/cli-manifest.ts` — `renderOutputStream`
- Test: `apps/studio/src/cli-manifest.test.ts`

**Step 1: Failing test**

```ts
describe('renderCommandHelp — stream output', () => {
  it('documents SSE-style streaming for flows:play', () => {
    const out = renderCommandHelp('flows:play');
    expect(out).toContain('## Output');
    expect(out).toContain('Streams');
    expect(out).toContain('Requires studio running: yes');
  });

  it('documents streaming for e2e', () => {
    const out = renderCommandHelp('e2e');
    expect(out).toContain('Streams');
    expect(out).toContain('Requires studio running: yes');
  });
});
```

**Step 2: Run to verify failure**

Run: `bun test apps/studio/src/cli-manifest.test.ts -t "stream output"`
Expected: PASS or FAIL depending on the stub from Task 4. If it already passes (stub says "Streams progress events..."), tighten the assertions in the test until they fail, then refine the implementation. The intent is to make sure the renderer explicitly says streaming + non-zero exit on failure + requires studio.

**Step 3: Implement**

```ts
function renderOutputStream(entry: CommandManifestEntry): string[] {
  const out: string[] = [];
  out.push('Streams progress events to stdout until the run completes.');
  out.push('Exit 0 on success, non-zero on failure.');
  if (entry.name === 'flows:play') {
    out.push('');
    out.push('Triggers the node\'s play action and prints status updates as the studio drives it.');
  } else if (entry.name === 'e2e') {
    out.push('');
    out.push('Walks every node in topological order, prints per-node status, exits non-zero on the first failure.');
  }
  return out;
}
```

**Step 4: Run tests**

Run: `bun test apps/studio/src/cli-manifest.test.ts`
Expected: PASS.

**Step 5: Smoke-check**

Run: `apps/studio/bin/seeflow help flows:play`
Run: `apps/studio/bin/seeflow help e2e`
Expected: streaming language present; no false JSON-envelope claim.

**Step 6: Commit**

```bash
bun run format
bun run typecheck
git add apps/studio/src/cli-manifest.ts apps/studio/src/cli-manifest.test.ts
git commit -m "feat(cli): help flows:play|e2e documents streaming output"
```

---

## Task 7: Integration sanity + parity sweep

**Why:** Catch any drift the previous tasks introduced before claiming done.

**Files:** none modified unless something breaks.

**Step 1: Run the full test suite**

Run: `bun test`
Expected: PASS (all suites including `skills/seeflow-wiki/test/help-parity.test.ts`).

**Step 2: Manually exercise `seeflow help`**

Run each of these and eyeball the output against the design doc Section 1 (concrete rendering example):

```bash
apps/studio/bin/seeflow help
apps/studio/bin/seeflow help nodes:add
apps/studio/bin/seeflow help flows:get
apps/studio/bin/seeflow help start
apps/studio/bin/seeflow help flows:play
apps/studio/bin/seeflow help --json | jq '.commands | length'
```

Confirm:
- `seeflow help` opens with the drill-in line and calling-convention preamble.
- `nodes:add` shows the resolved JSON Schema and the per-command exit-code table.
- `flows:get` has no `## Input (body)` section.
- `start` has no `"ok": true` line.
- `flows:play` says "Streams" and "Requires studio running: yes".
- `--json | jq '.commands | length'` returns the correct count (27 at time of writing).

**Step 3: Lint + typecheck a final time**

```bash
bun run format
bun run lint
bun run typecheck
```

**Step 4: If everything passes, no commit needed (no file changes).**

If smoke-check turned up anything (typos, formatting), fix on the affected file and commit:

```bash
git add apps/studio/src/cli-manifest.ts
git commit -m "fix(cli): cleanup help rendering edge cases"
```

---

## Done criteria

- `seeflow help` first non-blank line tells the agent to use `seeflow help <command>`.
- `seeflow help <command>` for any body-bearing JSON command shows: synopsis, args, flags (json/file/stdin where applicable), `## Input (body)` with the resolved JSON Schema, an example body, `## Output` with the success envelope, error envelope, and a per-command exit-code table, examples, and the requires-studio line.
- `start` / `stop` help shows text-output language, no JSON envelope claim.
- `flows:play` / `e2e` help shows streaming-output language, no JSON envelope claim.
- `EXIT_CODE_BY_KIND` is exported from `cli-helpers.ts` and used by both the runtime (`printOutcome`) and the renderer (`renderOutputJson`, `renderCommandList`).
- `bun test` is green. `bun run lint` and `bun run typecheck` are clean.
- No new files committed (no `CLI.md`). No new CLI flags.
