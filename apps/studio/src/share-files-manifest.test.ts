import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FlowEntry, Registry } from './registry.ts';
import { MAX_MANIFEST_ENTRIES, createFilesManifestBuilder } from './share-files-manifest.ts';

const NODE_A = 'node-aaaaaaaa11';
const NODE_B = 'node-bbbbbbbb22';

const makeRegistry = (entries: FlowEntry[]): Registry => {
  const list = () => entries.slice();
  return {
    path: '/tmp/registry.json',
    list,
    getById: (id) => entries.find((e) => e.id === id),
    getBySlug: (slug) => entries.find((e) => e.slug === slug),
    resolve: (idOrSlug) => entries.find((e) => e.id === idOrSlug || e.slug === idOrSlug),
    getByRepoPath: (p) => entries.find((e) => e.repoPath === p),
    getByRepoPathAndFlowPath: (p, f) => entries.find((e) => e.repoPath === p && e.flowPath === f),
    upsert: () => {
      throw new Error('upsert not stubbed');
    },
    remove: () => false,
    onChange: () => () => {},
    reload: () => {},
    isOwnWrite: () => false,
  };
};

const makeEntry = (repoPath: string, flowPath = 'flow.json'): FlowEntry => ({
  id: 'demo-id',
  slug: 'demo/main',
  name: 'demo',
  repoPath,
  flowPath,
  projectSlug: 'demo',
  flowSlug: 'main',
  isDefault: true,
  lastModified: 0,
  valid: true,
});

const sha16 = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16);

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'sfm-'));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('share-files-manifest', () => {
  it('returns empty entries for an empty project', async () => {
    const registry = makeRegistry([makeEntry(tmpDir)]);
    const builder = createFilesManifestBuilder({ registry });
    await builder.init();
    expect(builder.build()).toEqual({ entries: [] });
    expect(builder.size()).toBe(0);
  });

  it('returns empty entries when the registry is empty', async () => {
    const registry = makeRegistry([]);
    const builder = createFilesManifestBuilder({ registry });
    await builder.init();
    expect(builder.build()).toEqual({ entries: [] });
  });

  it('emits one entry with matching size + sha-prefix for a single image', async () => {
    const nodeDir = join(tmpDir, 'nodes', NODE_A);
    mkdirSync(nodeDir, { recursive: true });
    const bytes = randomBytes(2048);
    writeFileSync(join(nodeDir, 'logo.png'), bytes);

    const registry = makeRegistry([makeEntry(tmpDir)]);
    const builder = createFilesManifestBuilder({ registry });
    await builder.init();
    const manifest = builder.build();
    expect(manifest.entries.length).toBe(1);
    expect(manifest.entries[0]).toEqual({
      nodeId: NODE_A,
      relPath: `nodes/${NODE_A}/logo.png`,
      size: bytes.length,
      etag: sha16(bytes),
    });
  });

  it('handles nested-flow flowPath with a flowDir prefix', async () => {
    const flowBase = join(tmpDir, 'flows', 'main');
    const nodeDir = join(flowBase, 'nodes', NODE_A);
    mkdirSync(nodeDir, { recursive: true });
    const bytes = randomBytes(512);
    writeFileSync(join(nodeDir, 'cover.jpg'), bytes);

    const registry = makeRegistry([makeEntry(tmpDir, 'flows/main/flow.json')]);
    const builder = createFilesManifestBuilder({ registry });
    await builder.init();
    const manifest = builder.build();
    expect(manifest.entries).toEqual([
      {
        nodeId: NODE_A,
        relPath: `nodes/${NODE_A}/cover.jpg`,
        size: bytes.length,
        etag: sha16(bytes),
      },
    ]);
  });

  it('descends one subfolder level but not deeper', async () => {
    const nodeDir = join(tmpDir, 'nodes', NODE_A);
    const sub = join(nodeDir, 'images');
    const tooDeep = join(sub, 'nested');
    mkdirSync(tooDeep, { recursive: true });
    const top = randomBytes(8);
    const oneDeep = randomBytes(16);
    const twoDeep = randomBytes(32);
    writeFileSync(join(nodeDir, 'top.png'), top);
    writeFileSync(join(sub, 'inner.png'), oneDeep);
    writeFileSync(join(tooDeep, 'too-deep.png'), twoDeep);

    const registry = makeRegistry([makeEntry(tmpDir)]);
    const builder = createFilesManifestBuilder({ registry });
    await builder.init();
    const paths = builder
      .build()
      .entries.map((e) => e.relPath)
      .sort();
    expect(paths).toEqual([`nodes/${NODE_A}/images/inner.png`, `nodes/${NODE_A}/top.png`]);
  });

  it('skips symlinks at both depth levels', async () => {
    const nodeDir = join(tmpDir, 'nodes', NODE_A);
    mkdirSync(nodeDir, { recursive: true });
    const sub = join(nodeDir, 'sub');
    mkdirSync(sub);
    const real = randomBytes(4);
    const realPath = join(tmpDir, 'real.png');
    writeFileSync(realPath, real);
    writeFileSync(join(nodeDir, 'keep.png'), real);
    symlinkSync(realPath, join(nodeDir, 'symlink.png'));
    symlinkSync(realPath, join(sub, 'symlink2.png'));

    const registry = makeRegistry([makeEntry(tmpDir)]);
    const builder = createFilesManifestBuilder({ registry });
    await builder.init();
    const paths = builder.build().entries.map((e) => e.relPath);
    expect(paths).toEqual([`nodes/${NODE_A}/keep.png`]);
  });

  it('ignores non-node-id-shaped folders under nodes/', async () => {
    const good = join(tmpDir, 'nodes', NODE_A);
    const bad = join(tmpDir, 'nodes', 'not-a-node');
    mkdirSync(good, { recursive: true });
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(good, 'a.png'), Buffer.from('a'));
    writeFileSync(join(bad, 'b.png'), Buffer.from('b'));

    const registry = makeRegistry([makeEntry(tmpDir)]);
    const builder = createFilesManifestBuilder({ registry });
    await builder.init();
    const paths = builder.build().entries.map((e) => e.relPath);
    expect(paths).toEqual([`nodes/${NODE_A}/a.png`]);
  });

  it('truncates at MAX_MANIFEST_ENTRIES and warns', async () => {
    // Stub readdir+stat+readFile so we can manufacture > cap entries without
    // touching disk N times.
    const total = MAX_MANIFEST_ENTRIES + 5;
    const nodeName = NODE_A;
    const nodesRoot = join(tmpDir, 'nodes');
    const nodeDir = join(nodesRoot, nodeName);

    const fakeDirent = (name: string, kind: 'file' | 'dir' | 'symlink') =>
      ({
        name,
        isFile: () => kind === 'file',
        isDirectory: () => kind === 'dir',
        isSymbolicLink: () => kind === 'symlink',
      }) as never;

    const readdir = async (p: string) => {
      if (p === nodesRoot) return [fakeDirent(nodeName, 'dir')];
      if (p === nodeDir) {
        return Array.from({ length: total }, (_, i) => fakeDirent(`file-${i}.png`, 'file'));
      }
      return [];
    };
    const stat = async () => ({ size: 1 });
    const readFile = async () => Buffer.from('x');

    const registry = makeRegistry([makeEntry(tmpDir)]);
    const builder = createFilesManifestBuilder({ registry, readdir, stat, readFile });

    const warnings: unknown[] = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      await builder.init();
      const manifest = builder.build();
      expect(manifest.entries.length).toBe(MAX_MANIFEST_ENTRIES);
      expect(builder.size()).toBe(total);
      expect(warnings.length).toBeGreaterThan(0);
    } finally {
      console.warn = origWarn;
    }
  });

  it('reflects a file-uploaded broadcast via recordFileWrittenFromBytes', async () => {
    const nodeDir = join(tmpDir, 'nodes', NODE_A);
    mkdirSync(nodeDir, { recursive: true });
    const initial = randomBytes(16);
    writeFileSync(join(nodeDir, 'orig.png'), initial);

    const registry = makeRegistry([makeEntry(tmpDir)]);
    const builder = createFilesManifestBuilder({ registry });
    await builder.init();
    expect(builder.build().entries.length).toBe(1);

    const newBytes = randomBytes(64);
    const newAbs = join(nodeDir, 'fresh.png');
    builder.recordFileWrittenFromBytes({
      absPath: newAbs,
      nodeId: NODE_A,
      relPath: `nodes/${NODE_A}/fresh.png`,
      bytes: newBytes,
    });
    const after = builder.build();
    expect(after.entries.length).toBe(2);
    const fresh = after.entries.find((e) => e.relPath === `nodes/${NODE_A}/fresh.png`);
    expect(fresh).toEqual({
      nodeId: NODE_A,
      relPath: `nodes/${NODE_A}/fresh.png`,
      size: newBytes.length,
      etag: sha16(newBytes),
    });

    // Replacing the same absPath updates size+etag without duplicating.
    const replaced = randomBytes(32);
    builder.recordFileWrittenFromBytes({
      absPath: newAbs,
      nodeId: NODE_A,
      relPath: `nodes/${NODE_A}/fresh.png`,
      bytes: replaced,
    });
    const final = builder.build();
    expect(final.entries.length).toBe(2);
    const repl = final.entries.find((e) => e.relPath === `nodes/${NODE_A}/fresh.png`);
    expect(repl?.size).toBe(replaced.length);
    expect(repl?.etag).toBe(sha16(replaced));
  });

  it('drops every entry under a node directory on recordNodeRemoved', async () => {
    const aDir = join(tmpDir, 'nodes', NODE_A);
    const bDir = join(tmpDir, 'nodes', NODE_B);
    const aSub = join(aDir, 'sub');
    mkdirSync(aSub, { recursive: true });
    mkdirSync(bDir, { recursive: true });
    writeFileSync(join(aDir, 'a.png'), Buffer.from('a'));
    writeFileSync(join(aSub, 'a2.png'), Buffer.from('a2'));
    writeFileSync(join(bDir, 'b.png'), Buffer.from('b'));

    const registry = makeRegistry([makeEntry(tmpDir)]);
    const builder = createFilesManifestBuilder({ registry });
    await builder.init();
    expect(builder.build().entries.length).toBe(3);

    builder.recordNodeRemoved(aDir);
    const after = builder.build();
    expect(after.entries.length).toBe(1);
    expect(after.entries[0]?.nodeId).toBe(NODE_B);
  });
});
