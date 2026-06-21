import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXTERNALIZED_NODE_FIELDS,
  nodeFileAbsPath,
  nodeFileRef,
  nodeFileRelPath,
  purgeNodeDir,
  removeNodeDir,
  restoreNodeDir,
  writeNodeFile,
} from './node-files.ts';

describe('node-files path helpers', () => {
  it('builds rel path under nodes/<id>/<fileName>', () => {
    expect(nodeFileRelPath('node-abc', 'detail.md')).toBe('nodes/node-abc/detail.md');
  });
  it('builds node-relative file:// ref (just the filename)', () => {
    expect(nodeFileRef('node-abc', 'view.html')).toBe('file://view.html');
  });
  it('builds absolute path under the flow folder when flowDir is set', () => {
    expect(nodeFileAbsPath('/repo', 'flows/main', 'node-abc', 'detail.md')).toBe(
      '/repo/flows/main/nodes/node-abc/detail.md',
    );
  });
  it('collapses to the project root when flowDir is empty', () => {
    expect(nodeFileAbsPath('/repo', '', 'node-abc', 'detail.md')).toBe(
      '/repo/nodes/node-abc/detail.md',
    );
  });
  it('collapses to the project root when flowDir is "."', () => {
    expect(nodeFileAbsPath('/repo', '.', 'node-abc', 'detail.md')).toBe(
      '/repo/nodes/node-abc/detail.md',
    );
  });
  it('exposes a spec with at least detail.md', () => {
    expect(
      EXTERNALIZED_NODE_FIELDS.some((e) => e.field === 'detail' && e.fileName === 'detail.md'),
    ).toBe(true);
  });
  it('exposes detail and html entries', () => {
    const fields = EXTERNALIZED_NODE_FIELDS.map((e) => e.field);
    expect(fields).toContain('detail');
    expect(fields).toContain('html');
  });
});

describe('writeNodeFile / removeNodeDir', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'node-files-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes content atomically, creating parent dirs', () => {
    const abs = nodeFileAbsPath(root, '', 'node-x', 'detail.md');
    writeNodeFile(abs, 'hello');
    expect(readFileSync(abs, 'utf8')).toBe('hello');
  });

  it('writes empty string when content is empty', () => {
    const abs = nodeFileAbsPath(root, '', 'node-x', 'detail.md');
    writeNodeFile(abs, '');
    expect(readFileSync(abs, 'utf8')).toBe('');
  });

  it('removeNodeDir deletes the node folder and contents', () => {
    const abs = nodeFileAbsPath(root, '', 'node-x', 'detail.md');
    writeNodeFile(abs, 'x');
    removeNodeDir(root, '', 'node-x');
    expect(existsSync(abs)).toBe(false);
    expect(existsSync(join(root, 'nodes', 'node-x'))).toBe(false);
  });

  it('removeNodeDir is idempotent on missing folder', () => {
    expect(() => removeNodeDir(root, '', 'node-missing')).not.toThrow();
  });

  it('removeNodeDir leaves sibling node folders intact', () => {
    writeNodeFile(nodeFileAbsPath(root, '', 'node-a', 'detail.md'), 'a');
    writeNodeFile(nodeFileAbsPath(root, '', 'node-b', 'detail.md'), 'b');
    removeNodeDir(root, '', 'node-a');
    expect(existsSync(nodeFileAbsPath(root, '', 'node-a', 'detail.md'))).toBe(false);
    expect(readFileSync(nodeFileAbsPath(root, '', 'node-b', 'detail.md'), 'utf8')).toBe('b');
  });

  it('removeNodeDir anchored under flowDir leaves cousin flow nodes intact', () => {
    writeNodeFile(nodeFileAbsPath(root, 'flows/main', 'node-a', 'detail.md'), 'a');
    writeNodeFile(nodeFileAbsPath(root, 'flows/retry', 'node-a', 'detail.md'), 'b');
    removeNodeDir(root, 'flows/main', 'node-a');
    expect(existsSync(nodeFileAbsPath(root, 'flows/main', 'node-a', 'detail.md'))).toBe(false);
    expect(readFileSync(nodeFileAbsPath(root, 'flows/retry', 'node-a', 'detail.md'), 'utf8')).toBe(
      'b',
    );
  });
});

// The delete→undo data-loss fix: removeNodeDir tombstones the folder (instead
// of hard-deleting) so restoreNodeDir can bring its files back when the undo of
// a node delete recreates the node with the same id.
describe('removeNodeDir / restoreNodeDir reversibility', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'node-files-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('restores a soft-deleted node folder with its contents intact', () => {
    const abs = nodeFileAbsPath(root, '', 'node-x', 'cover.png');
    writeNodeFile(abs, 'IMG');
    removeNodeDir(root, '', 'node-x');
    expect(existsSync(abs)).toBe(false);
    expect(restoreNodeDir(root, '', 'node-x')).toBe(true);
    expect(readFileSync(abs, 'utf8')).toBe('IMG');
  });

  it('restoreNodeDir returns false when there is no tombstone', () => {
    expect(restoreNodeDir(root, '', 'never-existed')).toBe(false);
  });

  it('restoreNodeDir is a no-op when the live folder already exists', () => {
    writeNodeFile(nodeFileAbsPath(root, '', 'node-x', 'a.png'), 'live');
    expect(restoreNodeDir(root, '', 'node-x')).toBe(false);
    expect(readFileSync(nodeFileAbsPath(root, '', 'node-x', 'a.png'), 'utf8')).toBe('live');
  });

  it('restores the newest tombstone after repeated delete/recreate cycles', () => {
    const abs = nodeFileAbsPath(root, '', 'node-x', 'cover.png');
    writeNodeFile(abs, 'first');
    removeNodeDir(root, '', 'node-x');
    restoreNodeDir(root, '', 'node-x');
    writeNodeFile(abs, 'second');
    removeNodeDir(root, '', 'node-x');
    expect(restoreNodeDir(root, '', 'node-x')).toBe(true);
    expect(readFileSync(abs, 'utf8')).toBe('second');
  });

  it('purgeNodeDir hard-deletes without leaving a tombstone to restore', () => {
    writeNodeFile(nodeFileAbsPath(root, '', 'node-x', 'cover.png'), 'IMG');
    purgeNodeDir(root, '', 'node-x');
    expect(restoreNodeDir(root, '', 'node-x')).toBe(false);
  });
});
