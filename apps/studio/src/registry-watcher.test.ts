import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
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
      projectSlug: 'b',
      flowSlug: 'main',
      isDefault: true,
    });

    await wait(300);
    expect(observed).toBe(0);

    unsub();
    watcher.close();
  });
});
