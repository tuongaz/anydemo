import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type StudioEvent, createEventBus } from './events.ts';
import { createRegistry } from './registry.ts';
import { createWatcher } from './watcher.ts';

const VALID_DEMO = {
  version: 2,
  name: 'Watch Me',
  nodes: [
    {
      id: 'a',
      type: 'playNode',
      data: {
        name: 'A',
        kind: 'svc',
        stateSource: { kind: 'request' },
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
      },
    },
  ],
  connectors: [],
};

const tmpRepo = (demo: unknown = VALID_DEMO) => {
  const dir = mkdtempSync(join(tmpdir(), 'watcher-repo-'));
  mkdirSync(join(dir, '.seeflow'));
  writeFileSync(join(dir, '.seeflow', 'flow.json'), JSON.stringify(demo));
  return dir;
};

const tmpRegistryPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'watcher-reg-'));
  return join(dir, 'registry.json');
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createWatcher', () => {
  it('seeds a valid snapshot when watch() starts on a parseable file', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({
      name: 'Watch Me',
      repoPath,
      flowPath: '.seeflow/flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    const snap = watcher.snapshot(entry.id);
    expect(snap).not.toBeNull();
    expect(snap?.valid).toBe(true);
    expect(snap?.flow?.name).toBe('Watch Me');
    expect(snap?.error).toBeNull();
    watcher.closeAll();
  });

  it('broadcasts flow:reload with valid:true on parse, valid:false on bad JSON', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({
      name: 'Watch Me',
      repoPath,
      flowPath: '.seeflow/flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 20 });

    const received: StudioEvent[] = [];
    events.subscribe(entry.id, (e) => received.push(e));

    watcher.watch(entry.id);

    // Force a write that should land after the watcher is up.
    await wait(50);
    writeFileSync(join(repoPath, '.seeflow', 'flow.json'), '{ not: json }');
    await wait(150);

    const last = received.at(-1);
    expect(last?.type).toBe('flow:reload');
    expect((last?.payload as { valid: boolean }).valid).toBe(false);
    expect((last?.payload as { error: string }).error).toContain('Invalid JSON');

    // Repair the file. Should flip back to valid:true and broadcast a new event.
    writeFileSync(join(repoPath, '.seeflow', 'flow.json'), JSON.stringify(VALID_DEMO));
    await wait(150);

    const finalEvent = received.at(-1);
    expect((finalEvent?.payload as { valid: boolean }).valid).toBe(true);
    watcher.closeAll();
  });

  it('keeps the last-good demo on snapshot when current parse is invalid', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({
      name: 'Watch Me',
      repoPath,
      flowPath: '.seeflow/flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    const good = watcher.snapshot(entry.id);
    expect(good?.valid).toBe(true);

    writeFileSync(join(repoPath, '.seeflow', 'flow.json'), 'oops');
    const reparsed = watcher.reparse(entry.id);
    expect(reparsed?.valid).toBe(false);
    expect(reparsed?.flow?.name).toBe('Watch Me');
    watcher.closeAll();
  });

  it('reports schema validation errors with usable path detail', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    // Missing top-level `name` field.
    const repoPath = tmpRepo({ ...VALID_DEMO, name: undefined });
    const entry = reg.upsert({
      name: 'Watch Me',
      repoPath,
      flowPath: '.seeflow/flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    const snap = watcher.snapshot(entry.id);
    expect(snap?.valid).toBe(false);
    expect(snap?.error).toContain('Flow schema validation failed');
    expect(snap?.error).toContain('name');
    watcher.closeAll();
  });

  it('unwatch() clears the snapshot and stops further events', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({
      name: 'Watch Me',
      repoPath,
      flowPath: '.seeflow/flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    let count = 0;
    events.subscribe(entry.id, () => {
      count++;
    });

    watcher.watch(entry.id);
    expect(watcher.snapshot(entry.id)).not.toBeNull();

    watcher.unwatch(entry.id);
    expect(watcher.snapshot(entry.id)).toBeNull();

    writeFileSync(join(repoPath, '.seeflow', 'flow.json'), JSON.stringify(VALID_DEMO));
    await wait(80);
    expect(count).toBe(0);
    watcher.closeAll();
  });

  // ---------------------------------------------------------------------------
  // US-002: referenced-file watch set + `file:changed` SSE broadcast
  // ---------------------------------------------------------------------------

  // Build a demo with one playNode that also carries a forward-compatible
  // `htmlPath` on its data (Zod strips the key from the parsed Flow, but
  // collectReferencedPaths reads the raw JSON pre-strip).
  const demoWithHtmlPath = (htmlPath: string) => ({
    version: 2,
    name: 'Watch Files',
    nodes: [
      {
        id: 'h1',
        type: 'playNode',
        data: {
          name: 'A',
          kind: 'svc',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
          htmlPath,
        },
      },
    ],
    connectors: [],
  });

  const demoWithImagePath = (imgPath: string) => ({
    version: 2,
    name: 'Watch Files',
    nodes: [
      {
        id: 'img1',
        type: 'playNode',
        data: {
          name: 'I',
          kind: 'svc',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
          path: imgPath,
        },
      },
    ],
    connectors: [],
  });

  it('emits file:changed when an htmlNode-referenced file is edited', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo(demoWithHtmlPath('blocks/h1.html'));
    mkdirSync(join(repoPath, '.seeflow', 'blocks'));
    const htmlPath = join(repoPath, '.seeflow', 'blocks', 'h1.html');
    writeFileSync(htmlPath, '<div>v1</div>');

    const entry = reg.upsert({
      name: 'Watch Files',
      repoPath,
      flowPath: '.seeflow/flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 20 });

    const fileEvents: StudioEvent[] = [];
    events.subscribe(entry.id, (e) => {
      if (e.type === 'file:changed') fileEvents.push(e);
    });

    watcher.watch(entry.id);
    expect(watcher.referencedPaths(entry.id)).toEqual(['blocks/h1.html']);

    await wait(30);
    writeFileSync(htmlPath, '<div>v2</div>');
    await wait(150);

    expect(fileEvents.length).toBeGreaterThanOrEqual(1);
    const payload = fileEvents.at(-1)?.payload as { path: string };
    expect(payload.path).toBe('blocks/h1.html');
    watcher.closeAll();
  });

  it('emits file:changed when an imageNode-referenced path file is edited', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo(demoWithImagePath('assets/logo.png'));
    mkdirSync(join(repoPath, '.seeflow', 'assets'));
    const imgPath = join(repoPath, '.seeflow', 'assets', 'logo.png');
    writeFileSync(imgPath, 'placeholder-v1');

    const entry = reg.upsert({
      name: 'Watch Files',
      repoPath,
      flowPath: '.seeflow/flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 20 });

    const fileEvents: StudioEvent[] = [];
    events.subscribe(entry.id, (e) => {
      if (e.type === 'file:changed') fileEvents.push(e);
    });

    watcher.watch(entry.id);
    expect(watcher.referencedPaths(entry.id)).toEqual(['assets/logo.png']);

    await wait(30);
    writeFileSync(imgPath, 'placeholder-v2');
    await wait(150);

    const payload = fileEvents.at(-1)?.payload as { path: string };
    expect(payload?.path).toBe('assets/logo.png');
    watcher.closeAll();
  });

  it('adds newly-referenced paths to the watch set on demo edit', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({
      name: 'Watch Files',
      repoPath,
      flowPath: '.seeflow/flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    expect(watcher.referencedPaths(entry.id)).toEqual([]);

    mkdirSync(join(repoPath, '.seeflow', 'blocks'));
    writeFileSync(join(repoPath, '.seeflow', 'blocks', 'h1.html'), '<div>v1</div>');
    writeFileSync(
      join(repoPath, '.seeflow', 'flow.json'),
      JSON.stringify(demoWithHtmlPath('blocks/h1.html')),
    );
    await wait(120);

    expect(watcher.referencedPaths(entry.id)).toEqual(['blocks/h1.html']);
    watcher.closeAll();
  });

  it('removes paths from the watch set when a referencing node is removed', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo(demoWithHtmlPath('blocks/h1.html'));
    mkdirSync(join(repoPath, '.seeflow', 'blocks'));
    const htmlPath = join(repoPath, '.seeflow', 'blocks', 'h1.html');
    writeFileSync(htmlPath, '<div>v1</div>');

    const entry = reg.upsert({
      name: 'Watch Files',
      repoPath,
      flowPath: '.seeflow/flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    const fileEvents: StudioEvent[] = [];
    events.subscribe(entry.id, (e) => {
      if (e.type === 'file:changed') fileEvents.push(e);
    });

    watcher.watch(entry.id);
    expect(watcher.referencedPaths(entry.id)).toEqual(['blocks/h1.html']);

    // Drop the referencing node from the demo via a write to flow.json.
    writeFileSync(join(repoPath, '.seeflow', 'flow.json'), JSON.stringify(VALID_DEMO));
    await wait(120);
    expect(watcher.referencedPaths(entry.id)).toEqual([]);

    fileEvents.length = 0;
    writeFileSync(htmlPath, '<div>v2</div>');
    await wait(120);
    expect(fileEvents.length).toBe(0);
    watcher.closeAll();
  });

  it('ignores absolute paths, traversal, and data: URLs', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo({
      ...VALID_DEMO,
      nodes: [
        {
          id: 'abs',
          type: 'playNode',
          data: {
            name: 'A',
            kind: 'svc',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
            htmlPath: '/etc/passwd',
          },
        },
        {
          id: 'trav',
          type: 'playNode',
          data: {
            name: 'B',
            kind: 'svc',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
            htmlPath: '../secrets.html',
          },
        },
        {
          id: 'data',
          type: 'playNode',
          data: {
            name: 'C',
            kind: 'svc',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
            path: 'data:image/png;base64,iVBORw0KGgo=',
          },
        },
      ],
    });
    const entry = reg.upsert({
      name: 'Watch Files',
      repoPath,
      flowPath: '.seeflow/flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    expect(watcher.referencedPaths(entry.id)).toEqual([]);
    watcher.closeAll();
  });

  // -------------------------------------------------------------------------
  // file:// refs resolve against `<project>/.seeflow/` (per skill spec), so a
  // nested-slug layout — flow at `<repo>/.seeflow/<slug>/flow.json` — can
  // reference files via `file://<slug>/details/foo.md`. Regression test for the
  // bug where the resolver looked one directory too deep and reported every
  // subfolder ref as missing.
  // -------------------------------------------------------------------------
  it('resolves file:// refs against .seeflow root for nested-slug layouts', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = mkdtempSync(join(tmpdir(), 'watcher-nested-'));
    mkdirSync(join(repoPath, '.seeflow', 'crn-retained', 'details'), { recursive: true });
    writeFileSync(
      join(repoPath, '.seeflow', 'crn-retained', 'details', 'data.md'),
      '# Resolved content',
    );

    const nestedDemo = {
      version: 2,
      name: 'Nested Flow',
      nodes: [
        {
          id: 'n1',
          type: 'playNode',
          data: {
            name: 'N',
            kind: 'svc',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
            detail: 'file://crn-retained/details/data.md',
          },
        },
      ],
      connectors: [],
    };
    writeFileSync(
      join(repoPath, '.seeflow', 'crn-retained', 'flow.json'),
      JSON.stringify(nestedDemo),
    );

    const entry = reg.upsert({
      name: 'Nested Flow',
      repoPath,
      flowPath: '.seeflow/crn-retained/flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 20 });

    watcher.watch(entry.id);
    const snap = watcher.snapshot(entry.id);
    expect(snap?.valid).toBe(true);
    const detail = (snap?.flow?.nodes[0]?.data as { detail?: string } | undefined)?.detail;
    expect(detail).toBe('# Resolved content');

    const fileEvents: StudioEvent[] = [];
    events.subscribe(entry.id, (e) => {
      if (e.type === 'file:changed') fileEvents.push(e);
    });

    await wait(30);
    writeFileSync(
      join(repoPath, '.seeflow', 'crn-retained', 'details', 'data.md'),
      '# Resolved content v2',
    );
    await wait(150);

    expect(fileEvents.length).toBeGreaterThanOrEqual(1);
    const payload = fileEvents.at(-1)?.payload as { path: string };
    expect(payload.path).toBe('crn-retained/details/data.md');
    watcher.closeAll();
  });
});
