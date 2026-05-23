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
      type: 'rectangle',
      data: {
        name: 'A',
        stateSource: { kind: 'request' },
        playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
      },
    },
  ],
  connectors: [],
};

const tmpRepo = (demo: unknown = VALID_DEMO) => {
  const dir = mkdtempSync(join(tmpdir(), 'watcher-repo-'));
  writeFileSync(join(dir, 'flow.json'), JSON.stringify(demo));
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
      flowPath: 'flow.json',
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
      flowPath: 'flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 20 });

    const received: StudioEvent[] = [];
    events.subscribe(entry.id, (e) => received.push(e));

    watcher.watch(entry.id);

    // Force a write that should land after the watcher is up.
    await wait(50);
    writeFileSync(join(repoPath, 'flow.json'), '{ not: json }');
    await wait(150);

    const last = received.at(-1);
    expect(last?.type).toBe('flow:reload');
    expect((last?.payload as { valid: boolean }).valid).toBe(false);
    expect((last?.payload as { error: string }).error).toContain('Invalid JSON');

    // Repair the file. Should flip back to valid:true and broadcast a new event.
    writeFileSync(join(repoPath, 'flow.json'), JSON.stringify(VALID_DEMO));
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
      flowPath: 'flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    const good = watcher.snapshot(entry.id);
    expect(good?.valid).toBe(true);

    writeFileSync(join(repoPath, 'flow.json'), 'oops');
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
      flowPath: 'flow.json',
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
      flowPath: 'flow.json',
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

    writeFileSync(join(repoPath, 'flow.json'), JSON.stringify(VALID_DEMO));
    await wait(80);
    expect(count).toBe(0);
    watcher.closeAll();
  });

  // ---------------------------------------------------------------------------
  // US-002: referenced-file watch set + `file:changed` SSE broadcast
  // ---------------------------------------------------------------------------

  // Build a demo with one rectangle that also carries a forward-compatible
  // `path` on its data (image-style path, the only field
  // collectReferencedPaths still cares about — html content rides on the
  // file:// resolver now).
  const demoWithImagePath = (imgPath: string) => ({
    version: 2,
    name: 'Watch Files',
    nodes: [
      {
        id: 'img1',
        type: 'rectangle',
        data: {
          name: 'I',
          stateSource: { kind: 'request' },
          playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
          path: imgPath,
        },
      },
    ],
    connectors: [],
  });

  it('emits file:changed when an image-referenced path file is edited', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo(demoWithImagePath('assets/logo.png'));
    mkdirSync(join(repoPath, 'assets'));
    const imgPath = join(repoPath, 'assets', 'logo.png');
    writeFileSync(imgPath, 'placeholder-v1');

    const entry = reg.upsert({
      name: 'Watch Files',
      repoPath,
      flowPath: 'flow.json',
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
      flowPath: 'flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    expect(watcher.referencedPaths(entry.id)).toEqual([]);

    mkdirSync(join(repoPath, 'assets'));
    writeFileSync(join(repoPath, 'assets', 'logo.png'), 'placeholder');
    writeFileSync(
      join(repoPath, 'flow.json'),
      JSON.stringify(demoWithImagePath('assets/logo.png')),
    );
    await wait(120);

    expect(watcher.referencedPaths(entry.id)).toEqual(['assets/logo.png']);
    watcher.closeAll();
  });

  it('removes paths from the watch set when a referencing node is removed', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo(demoWithImagePath('assets/logo.png'));
    mkdirSync(join(repoPath, 'assets'));
    const imgPath = join(repoPath, 'assets', 'logo.png');
    writeFileSync(imgPath, 'placeholder-v1');

    const entry = reg.upsert({
      name: 'Watch Files',
      repoPath,
      flowPath: 'flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    const fileEvents: StudioEvent[] = [];
    events.subscribe(entry.id, (e) => {
      if (e.type === 'file:changed') fileEvents.push(e);
    });

    watcher.watch(entry.id);
    expect(watcher.referencedPaths(entry.id)).toEqual(['assets/logo.png']);

    // Drop the referencing node from the demo via a write to flow.json.
    writeFileSync(join(repoPath, 'flow.json'), JSON.stringify(VALID_DEMO));
    await wait(120);
    expect(watcher.referencedPaths(entry.id)).toEqual([]);

    fileEvents.length = 0;
    writeFileSync(imgPath, 'placeholder-v2');
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
          type: 'rectangle',
          data: {
            name: 'A',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
            path: '/etc/passwd',
          },
        },
        {
          id: 'trav',
          type: 'rectangle',
          data: {
            name: 'B',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
            path: '../secrets.png',
          },
        },
        {
          id: 'data',
          type: 'rectangle',
          data: {
            name: 'C',
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
      flowPath: 'flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    expect(watcher.referencedPaths(entry.id)).toEqual([]);
    watcher.closeAll();
  });

  // -------------------------------------------------------------------------
  // file:// refs are node-relative: `file://detail.md` inside node-id `n1`
  // resolves under `<projectRoot>/nodes/n1/detail.md`. Regression test for
  // the node-relative ref contract.
  // -------------------------------------------------------------------------
  it('resolves node-relative file:// refs', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = mkdtempSync(join(tmpdir(), 'watcher-nested-'));
    mkdirSync(join(repoPath, 'nodes', 'n1'), { recursive: true });
    writeFileSync(join(repoPath, 'nodes', 'n1', 'detail.md'), '# Resolved content');

    const nestedDemo = {
      version: 2,
      name: 'Nested Flow',
      nodes: [
        {
          id: 'n1',
          type: 'rectangle',
          data: {
            name: 'N',
            stateSource: { kind: 'request' },
            playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'scripts/play.ts' },
            detail: 'file://detail.md',
          },
        },
      ],
      connectors: [],
    };
    writeFileSync(join(repoPath, 'flow.json'), JSON.stringify(nestedDemo));

    const entry = reg.upsert({
      name: 'Nested Flow',
      repoPath,
      flowPath: 'flow.json',
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
    writeFileSync(join(repoPath, 'nodes', 'n1', 'detail.md'), '# Resolved content v2');
    await wait(150);

    expect(fileEvents.length).toBeGreaterThanOrEqual(1);
    const payload = fileEvents.at(-1)?.payload as { path: string };
    expect(payload.path).toBe('nodes/n1/detail.md');
    watcher.closeAll();
  });

  it('notifyWritten broadcasts flow:reload directly from the supplied snap', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({
      name: 'Watch Me',
      repoPath,
      flowPath: 'flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 20 });

    const received: StudioEvent[] = [];
    events.subscribe(entry.id, (e) => {
      if (e.type === 'flow:reload') received.push(e);
    });

    watcher.watch(entry.id);
    // Drop the seed broadcast(s) from startWatch so we can inspect notifyWritten alone.
    received.length = 0;

    const snap = watcher.snapshot(entry.id);
    expect(snap?.valid).toBe(true);
    const flow = snap?.flow;
    expect(flow).not.toBeNull();
    if (!flow) throw new Error('expected flow');

    watcher.notifyWritten(
      entry.id,
      { flow, valid: true, error: null, filePath: snap?.filePath ?? '', parsedAt: Date.now() },
      JSON.stringify(VALID_DEMO),
      '',
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('flow:reload');
    expect((received[0]?.payload as { valid: boolean }).valid).toBe(true);
    watcher.closeAll();
  });

  it('suppresses the fs-watcher echo when on-disk content matches a recent notifyWritten', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({
      name: 'Watch Me',
      repoPath,
      flowPath: 'flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 20 });

    const received: StudioEvent[] = [];
    events.subscribe(entry.id, (e) => {
      if (e.type === 'flow:reload') received.push(e);
    });

    watcher.watch(entry.id);
    await wait(50);
    received.length = 0;

    // Simulate a server-side write: change the file AND record the hash via notifyWritten.
    const nextDemo = { ...VALID_DEMO, name: 'Renamed' };
    const nextContent = JSON.stringify(nextDemo);
    writeFileSync(join(repoPath, 'flow.json'), nextContent);
    const snap = watcher.reparse(entry.id);
    expect(snap?.valid).toBe(true);
    if (!snap) throw new Error('expected snap');
    watcher.notifyWritten(entry.id, snap, nextContent, '');

    // notifyWritten broadcast counts as one event; the fs-watcher debounce that
    // follows should be suppressed because the on-disk content hash matches.
    await wait(150);
    expect(received).toHaveLength(1);
    watcher.closeAll();
  });

  it('still broadcasts when the fs-watcher echo content does NOT match any recent self-write', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({
      name: 'Watch Me',
      repoPath,
      flowPath: 'flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 20 });

    const received: StudioEvent[] = [];
    events.subscribe(entry.id, (e) => {
      if (e.type === 'flow:reload') received.push(e);
    });

    watcher.watch(entry.id);
    await wait(50);

    // Server says "I wrote A" but the on-disk content is actually B (e.g. the
    // user saved over it from their editor between our write and the fs
    // callback). The fs-watcher echo must NOT be suppressed.
    const serverContent = JSON.stringify({ ...VALID_DEMO, name: 'Server' });
    const snap = watcher.snapshot(entry.id);
    if (!snap) throw new Error('expected snap');
    watcher.notifyWritten(entry.id, snap, serverContent, '');
    received.length = 0;

    const externalContent = JSON.stringify({ ...VALID_DEMO, name: 'External' });
    writeFileSync(join(repoPath, 'flow.json'), externalContent);
    await wait(150);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const last = received.at(-1);
    expect((last?.payload as { valid: boolean; flow: { name: string } }).flow.name).toBe(
      'External',
    );
    watcher.closeAll();
  });

  // ---------------------------------------------------------------------------
  // US-006 / T-004: component node spec sidecar inlining via readMergedFlow.
  // ---------------------------------------------------------------------------

  const componentFlow = {
    version: 2,
    name: 'Component Flow',
    nodes: [{ id: 'c1', type: 'component', data: {} }],
    connectors: [],
  };

  const componentSpec = {
    root: 'root',
    elements: {
      root: { type: 'Text', props: { text: 'hello' } },
    },
  };

  it('inlines nodes/<id>/spec.json into data.spec for component nodes', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo(componentFlow);
    mkdirSync(join(repoPath, 'nodes', 'c1'), { recursive: true });
    writeFileSync(join(repoPath, 'nodes', 'c1', 'spec.json'), JSON.stringify(componentSpec));

    const entry = reg.upsert({
      name: 'Component Flow',
      repoPath,
      flowPath: 'flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    const snap = watcher.snapshot(entry.id);
    expect(snap?.valid).toBe(true);
    expect(snap?.error).toBeNull();
    const node = snap?.flow?.nodes[0];
    if (node?.type !== 'component') throw new Error('expected component node');
    expect(node.data.spec.root).toBe('root');
    expect(node.data.spec.elements.root?.type).toBe('Text');
    watcher.closeAll();
  });

  it('surfaces a missing spec.json as a validation error with the node-spec path', () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo(componentFlow);

    const entry = reg.upsert({
      name: 'Component Flow',
      repoPath,
      flowPath: 'flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 10 });

    watcher.watch(entry.id);
    const snap = watcher.snapshot(entry.id);
    expect(snap?.valid).toBe(false);
    expect(snap?.error).toMatch(/nodes\/c1\/data\/spec/);
    watcher.closeAll();
  });

  it('hash ring holds the last 4 self-writes so back-to-back writes still suppress', async () => {
    const reg = createRegistry({ path: tmpRegistryPath() });
    const repoPath = tmpRepo();
    const entry = reg.upsert({
      name: 'Watch Me',
      repoPath,
      flowPath: 'flow.json',
    });
    const events = createEventBus();
    const watcher = createWatcher({ registry: reg, events, debounceMs: 20 });

    const received: StudioEvent[] = [];
    events.subscribe(entry.id, (e) => {
      if (e.type === 'flow:reload') received.push(e);
    });

    watcher.watch(entry.id);
    await wait(50);
    received.length = 0;

    // Four back-to-back writes — each gets recorded; each fs echo gets suppressed.
    for (let i = 0; i < 4; i++) {
      const content = JSON.stringify({ ...VALID_DEMO, name: `v${i}` });
      writeFileSync(join(repoPath, 'flow.json'), content);
      const snap = watcher.reparse(entry.id);
      if (!snap) throw new Error('expected snap');
      watcher.notifyWritten(entry.id, snap, content, '');
    }

    await wait(150);
    // Exactly the 4 notifyWritten broadcasts; the fs-watcher debounce coalesces
    // the file changes into at most one callback, which then sees the latest
    // hash in the ring and suppresses.
    expect(received).toHaveLength(4);
    watcher.closeAll();
  });
});
