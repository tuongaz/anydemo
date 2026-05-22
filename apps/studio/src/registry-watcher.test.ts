import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventBus } from './events.ts';
import { REGISTRY_CHANNEL, createRegistryWatcher } from './registry-watcher.ts';
import { createRegistry } from './registry.ts';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('createRegistryWatcher', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reg-watcher-'));
    path = join(dir, 'registry.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('broadcasts registry:reload when an external write modifies the file', async () => {
    const registry = createRegistry({ path });
    const events = createEventBus();
    const watcher = createRegistryWatcher({ registry, events, debounceMs: 25 });
    watcher.start();

    let observed = 0;
    const unsub = events.subscribe(REGISTRY_CHANNEL, (e) => {
      if (e.type === 'registry:reload') observed += 1;
    });

    writeFileSync(
      path,
      JSON.stringify(
        [
          {
            id: 'a',
            slug: 'a',
            name: 'a',
            repoPath: '/tmp/a',
            flowPath: 'flow.json',
            lastModified: 0,
            valid: true,
          },
        ],
        null,
        2,
      ),
    );

    await wait(300);
    expect(observed).toBeGreaterThanOrEqual(1);
    expect(registry.list().length).toBe(1);

    unsub();
    watcher.close();
  });

  it('suppresses the echo of an in-process upsert', async () => {
    const registry = createRegistry({ path });
    const events = createEventBus();
    const watcher = createRegistryWatcher({ registry, events, debounceMs: 25 });
    watcher.start();

    let observed = 0;
    const unsub = events.subscribe(REGISTRY_CHANNEL, () => {
      observed += 1;
    });

    registry.upsert({
      name: 'b',
      repoPath: '/tmp/b',
      flowPath: 'flow.json',
    });

    await wait(300);
    expect(observed).toBe(0);

    unsub();
    watcher.close();
  });

  it('detects external writes even when the file did not exist at start', async () => {
    expect(existsSync(path)).toBe(false);
    const registry = createRegistry({ path });
    const events = createEventBus();
    const watcher = createRegistryWatcher({ registry, events, debounceMs: 25 });
    watcher.start();

    let observed = 0;
    const unsub = events.subscribe(REGISTRY_CHANNEL, () => {
      observed += 1;
    });

    writeFileSync(
      path,
      JSON.stringify(
        [
          {
            id: 'a',
            slug: 'a',
            name: 'a',
            repoPath: '/tmp/a',
            flowPath: 'flow.json',
            lastModified: 0,
            valid: true,
          },
        ],
        null,
        2,
      ),
    );

    await wait(300);
    expect(observed).toBeGreaterThanOrEqual(1);

    unsub();
    watcher.close();
  });
});
