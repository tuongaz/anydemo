import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFileRefs } from './file-ref.ts';

describe('resolveFileRefs', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seeflow-fileref-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the input unchanged when no file:// refs present', () => {
    const { resolved, refs } = resolveFileRefs({ foo: 'bar', n: 1 }, root);
    expect(resolved).toEqual({ foo: 'bar', n: 1 });
    expect(refs).toEqual([]);
  });

  it('substitutes a file:// reference with the file contents', () => {
    mkdirSync(join(root, 'details'));
    writeFileSync(join(root, 'details/foo.md'), '# Hello world');
    const { resolved, refs } = resolveFileRefs(
      { data: { detail: 'file://details/foo.md' } },
      root,
    );
    expect(resolved).toEqual({ data: { detail: '# Hello world' } });
    expect(refs).toEqual(['details/foo.md']);
  });

  it('recurses into arrays and nested objects', () => {
    writeFileSync(join(root, 'a.txt'), 'AAA');
    writeFileSync(join(root, 'b.txt'), 'BBB');
    const { resolved, refs } = resolveFileRefs(
      { nodes: [{ data: { detail: 'file://a.txt', tags: ['file://b.txt', 'plain'] } }] },
      root,
    );
    expect(resolved).toEqual({
      nodes: [{ data: { detail: 'AAA', tags: ['BBB', 'plain'] } }],
    });
    expect(refs).toEqual(['a.txt', 'b.txt']);
  });

  it('substitutes a placeholder marker when the file is missing', () => {
    const { resolved, refs } = resolveFileRefs(
      { data: { detail: 'file://missing.md' } },
      root,
    );
    expect(resolved).toEqual({ data: { detail: "[seeflow: missing file 'missing.md']" } });
    expect(refs).toEqual([]);
  });

  it('rejects path traversal with an invalid-path marker', () => {
    const { resolved } = resolveFileRefs(
      { data: { detail: 'file://../escape.md' } },
      root,
    );
    expect(resolved).toEqual({
      data: { detail: "[seeflow: invalid file:// path '../escape.md']" },
    });
  });

  it('rejects absolute paths with an invalid-path marker', () => {
    const { resolved } = resolveFileRefs(
      { data: { detail: 'file:///etc/passwd' } },
      root,
    );
    expect(resolved).toEqual({
      data: { detail: "[seeflow: invalid file:// path '/etc/passwd']" },
    });
  });

  it('rejects symlink escapes', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'seeflow-fileref-out-'));
    try {
      writeFileSync(join(outsideDir, 'secret.md'), 'secret');
      mkdirSync(join(root, 'sub'));
      symlinkSync(join(outsideDir, 'secret.md'), join(root, 'sub/escape.md'));
      const { resolved } = resolveFileRefs(
        { data: { detail: 'file://sub/escape.md' } },
        root,
      );
      const detail = (resolved as { data: { detail: string } }).data.detail;
      expect(detail).toMatch(/^\[seeflow: invalid file:\/\/ path/);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('returns refs sorted and de-duplicated', () => {
    writeFileSync(join(root, 'x.txt'), 'X');
    const { refs } = resolveFileRefs(
      { a: 'file://x.txt', b: 'file://x.txt' },
      root,
    );
    expect(refs).toEqual(['x.txt']);
  });
});
