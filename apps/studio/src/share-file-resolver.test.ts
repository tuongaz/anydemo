import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import { resolveNodeFile } from './share-file-resolver.ts';

const NODE_ID = 'node-abc1234567';
const REPO_POSIX = '/repo/example';

describe('resolveNodeFile — happy paths (posix)', () => {
  it('returns absPath under <repo>/<flowDir>/nodes/<id>/ for nested flow', () => {
    const res = resolveNodeFile({
      repoPath: REPO_POSIX,
      flowPath: 'flows/main/flow.json',
      nodeId: NODE_ID,
      relPath: 'image.png',
    });
    expect(res).toEqual({
      absPath: `${REPO_POSIX}/flows/main/nodes/${NODE_ID}/image.png`,
    });
  });

  it('collapses flowDir === "." to <repo>/nodes/<id>/ for repo-root flow.json', () => {
    const res = resolveNodeFile({
      repoPath: REPO_POSIX,
      flowPath: 'flow.json',
      nodeId: NODE_ID,
      relPath: 'image.png',
    });
    expect(res).toEqual({
      absPath: `${REPO_POSIX}/nodes/${NODE_ID}/image.png`,
    });
  });

  it('accepts legitimate nested relPath like subdir/foo.png', () => {
    const res = resolveNodeFile({
      repoPath: REPO_POSIX,
      flowPath: 'flows/main/flow.json',
      nodeId: NODE_ID,
      relPath: 'subdir/foo.png',
    });
    expect(res).toEqual({
      absPath: `${REPO_POSIX}/flows/main/nodes/${NODE_ID}/subdir/foo.png`,
    });
  });

  it('accepts deeply nested relPath', () => {
    const res = resolveNodeFile({
      repoPath: REPO_POSIX,
      flowPath: 'flows/main/flow.json',
      nodeId: NODE_ID,
      relPath: 'a/b/c/d.png',
    });
    expect(res).toEqual({
      absPath: `${REPO_POSIX}/flows/main/nodes/${NODE_ID}/a/b/c/d.png`,
    });
  });
});

describe('resolveNodeFile — bad nodeId formats', () => {
  const cases: Array<{ name: string; nodeId: string }> = [
    { name: 'missing node- prefix', nodeId: 'abc1234567' },
    { name: 'too short (9 chars after prefix)', nodeId: 'node-abc123456' },
    { name: 'too long (11 chars after prefix)', nodeId: 'node-abc12345678' },
    { name: 'special chars (underscore)', nodeId: 'node-abc12_4567' },
    { name: 'special chars (hyphen)', nodeId: 'node-abc-234567' },
    { name: 'special chars (dot)', nodeId: 'node-abc.234567' },
    { name: 'empty string', nodeId: '' },
    { name: 'wrong prefix', nodeId: 'comp-abc1234567' },
    { name: 'uppercase prefix', nodeId: 'NODE-abc1234567' },
  ];
  for (const { name, nodeId } of cases) {
    it(`rejects ${name} with bad-node-id`, () => {
      const res = resolveNodeFile({
        repoPath: REPO_POSIX,
        flowPath: 'flow.json',
        nodeId,
        relPath: 'image.png',
      });
      expect(res).toEqual({ error: 'bad-node-id' });
    });
  }
});

describe('resolveNodeFile — traversal rejection (posix)', () => {
  it('rejects relPath of just ".."', () => {
    const res = resolveNodeFile({
      repoPath: REPO_POSIX,
      flowPath: 'flow.json',
      nodeId: NODE_ID,
      relPath: '..',
    });
    expect(res).toEqual({ error: 'traversal' });
  });

  it('rejects ../../etc/passwd', () => {
    const res = resolveNodeFile({
      repoPath: REPO_POSIX,
      flowPath: 'flow.json',
      nodeId: NODE_ID,
      relPath: '../../etc/passwd',
    });
    expect(res).toEqual({ error: 'traversal' });
  });

  it('rejects relPath embedding .. in the middle', () => {
    const res = resolveNodeFile({
      repoPath: REPO_POSIX,
      flowPath: 'flow.json',
      nodeId: NODE_ID,
      relPath: 'subdir/../../escape.png',
    });
    expect(res).toEqual({ error: 'traversal' });
  });

  it('rejects absolute POSIX path /etc/passwd', () => {
    const res = resolveNodeFile({
      repoPath: REPO_POSIX,
      flowPath: 'flow.json',
      nodeId: NODE_ID,
      relPath: '/etc/passwd',
    });
    expect(res).toEqual({ error: 'traversal' });
  });

  it('rejects empty relPath', () => {
    const res = resolveNodeFile({
      repoPath: REPO_POSIX,
      flowPath: 'flow.json',
      nodeId: NODE_ID,
      relPath: '',
    });
    expect(res).toEqual({ error: 'traversal' });
  });

  it('rejects relPath starting with backslash', () => {
    const res = resolveNodeFile({
      repoPath: REPO_POSIX,
      flowPath: 'flow.json',
      nodeId: NODE_ID,
      relPath: '\\evil',
    });
    expect(res).toEqual({ error: 'traversal' });
  });

  it('rejects win32-absolute drive-letter path even on posix host', () => {
    const res = resolveNodeFile({
      repoPath: REPO_POSIX,
      flowPath: 'flow.json',
      nodeId: NODE_ID,
      relPath: 'C:\\evil',
    });
    expect(res).toEqual({ error: 'traversal' });
  });

  it('rejects mixed-separator escape attempt ..\\..\\evil', () => {
    const res = resolveNodeFile({
      repoPath: REPO_POSIX,
      flowPath: 'flow.json',
      nodeId: NODE_ID,
      relPath: '..\\..\\evil',
    });
    expect(res).toEqual({ error: 'traversal' });
  });
});

describe('resolveNodeFile — win32 simulation', () => {
  const REPO_WIN = 'C:\\repo\\example';

  it('uses backslash separators via path.win32 module', () => {
    const res = resolveNodeFile(
      {
        repoPath: REPO_WIN,
        flowPath: 'flows\\main\\flow.json',
        nodeId: NODE_ID,
        relPath: 'subdir\\foo.png',
      },
      path.win32,
    );
    expect(res).toEqual({
      absPath: `${REPO_WIN}\\flows\\main\\nodes\\${NODE_ID}\\subdir\\foo.png`,
    });
    // Sanity: the win32 separator is in fact a backslash.
    expect(path.win32.sep).toBe('\\');
  });

  it('rejects ../../etc/passwd under win32 path module', () => {
    const res = resolveNodeFile(
      {
        repoPath: REPO_WIN,
        flowPath: 'flow.json',
        nodeId: NODE_ID,
        relPath: '..\\..\\etc\\passwd',
      },
      path.win32,
    );
    expect(res).toEqual({ error: 'traversal' });
  });

  it('rejects drive-absolute relPath under win32 path module', () => {
    const res = resolveNodeFile(
      {
        repoPath: REPO_WIN,
        flowPath: 'flow.json',
        nodeId: NODE_ID,
        relPath: 'D:\\evil',
      },
      path.win32,
    );
    expect(res).toEqual({ error: 'traversal' });
  });

  it('collapses flowDir === "." under win32', () => {
    const res = resolveNodeFile(
      {
        repoPath: REPO_WIN,
        flowPath: 'flow.json',
        nodeId: NODE_ID,
        relPath: 'image.png',
      },
      path.win32,
    );
    expect(res).toEqual({
      absPath: `${REPO_WIN}\\nodes\\${NODE_ID}\\image.png`,
    });
  });
});
