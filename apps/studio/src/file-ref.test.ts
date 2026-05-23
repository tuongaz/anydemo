import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFileRefs } from './file-ref.ts';

// Helper: writes a per-node file under <root>/nodes/<id>/<name>. Tests use this
// instead of touching the seeflow root directly because file:// refs are
// node-relative — they're only valid inside a node-shaped object.
const writeNodeFile = (root: string, nodeId: string, name: string, content: string): void => {
  mkdirSync(join(root, 'nodes', nodeId), { recursive: true });
  writeFileSync(join(root, 'nodes', nodeId, name), content);
};

const nodeWrap = (id: string, data: Record<string, unknown>) => ({
  nodes: [{ id, type: 'rectangle', data }],
});

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

  it('substitutes a node-relative file:// reference with the file contents', () => {
    writeNodeFile(root, 'node-A', 'detail.md', '# Hello world');
    const { resolved, refs } = resolveFileRefs(
      nodeWrap('node-A', { detail: 'file://detail.md' }),
      root,
    );
    expect(resolved).toEqual(nodeWrap('node-A', { detail: '# Hello world' }));
    // Watcher contract: refs are always seeflow-root-relative (nodes/<id>/<file>)
    // so live-reload subscriptions don't have to know about the short form.
    expect(refs).toEqual(['nodes/node-A/detail.md']);
  });

  it('allows nested relative paths under the node folder', () => {
    mkdirSync(join(root, 'nodes/node-A/sub'), { recursive: true });
    writeFileSync(join(root, 'nodes/node-A/sub/page.md'), 'PAGE');
    const { resolved, refs } = resolveFileRefs(
      nodeWrap('node-A', { detail: 'file://sub/page.md' }),
      root,
    );
    expect(resolved).toEqual(nodeWrap('node-A', { detail: 'PAGE' }));
    expect(refs).toEqual(['nodes/node-A/sub/page.md']);
  });

  it('resolves refs scoped to their own enclosing node', () => {
    writeNodeFile(root, 'node-A', 'detail.md', 'AAA');
    writeNodeFile(root, 'node-B', 'view.html', 'BBB');
    const { resolved, refs } = resolveFileRefs(
      {
        nodes: [
          { id: 'node-A', type: 'rectangle', data: { detail: 'file://detail.md' } },
          { id: 'node-B', type: 'html', data: { html: 'file://view.html' } },
        ],
      },
      root,
    );
    expect(resolved).toEqual({
      nodes: [
        { id: 'node-A', type: 'rectangle', data: { detail: 'AAA' } },
        { id: 'node-B', type: 'html', data: { html: 'BBB' } },
      ],
    });
    expect(refs).toEqual(['nodes/node-A/detail.md', 'nodes/node-B/view.html']);
  });

  it('recurses into arrays inside a node', () => {
    writeNodeFile(root, 'node-A', 'a.txt', 'AAA');
    writeNodeFile(root, 'node-A', 'b.txt', 'BBB');
    const { resolved, refs } = resolveFileRefs(
      nodeWrap('node-A', { tags: ['file://a.txt', 'plain', 'file://b.txt'] }),
      root,
    );
    expect(resolved).toEqual(nodeWrap('node-A', { tags: ['AAA', 'plain', 'BBB'] }));
    expect(refs).toEqual(['nodes/node-A/a.txt', 'nodes/node-A/b.txt']);
  });

  it('returns an invalid-path marker for file:// strings outside any node', () => {
    writeFileSync(join(root, 'orphan.md'), 'X');
    const { resolved, refs } = resolveFileRefs({ description: 'file://orphan.md' }, root);
    expect(resolved).toEqual({
      description: "[seeflow: invalid file:// path 'orphan.md']",
    });
    expect(refs).toEqual([]);
  });

  it('rejects the legacy long form (file://nodes/<id>/...) as a missing file', () => {
    // file://nodes/node-A/detail.md inside node-A would resolve against
    // nodes/node-A/nodes/node-A/detail.md — which doesn't exist. This is the
    // intentional break: examples + studio writers must migrate to short form.
    writeNodeFile(root, 'node-A', 'detail.md', 'AAA');
    const { resolved } = resolveFileRefs(
      nodeWrap('node-A', { detail: 'file://nodes/node-A/detail.md' }),
      root,
    );
    const detail = (resolved as { nodes: [{ data: { detail: string } }] }).nodes[0].data.detail;
    expect(detail).toMatch(/^\[seeflow: missing file/);
  });

  it('substitutes a placeholder marker when the file is missing', () => {
    const { resolved, refs } = resolveFileRefs(
      nodeWrap('node-A', { detail: 'file://missing.md' }),
      root,
    );
    expect(resolved).toEqual(
      nodeWrap('node-A', { detail: "[seeflow: missing file 'nodes/node-A/missing.md']" }),
    );
    expect(refs).toEqual([]);
  });

  it('rejects path traversal with an invalid-path marker', () => {
    const { resolved } = resolveFileRefs(
      nodeWrap('node-A', { detail: 'file://../escape.md' }),
      root,
    );
    expect(resolved).toEqual(
      nodeWrap('node-A', { detail: "[seeflow: invalid file:// path '../escape.md']" }),
    );
  });

  it('rejects absolute paths with an invalid-path marker', () => {
    const { resolved } = resolveFileRefs(
      nodeWrap('node-A', { detail: 'file:///etc/passwd' }),
      root,
    );
    expect(resolved).toEqual(
      nodeWrap('node-A', { detail: "[seeflow: invalid file:// path '/etc/passwd']" }),
    );
  });

  it('rejects symlink escapes', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'seeflow-fileref-out-'));
    try {
      writeFileSync(join(outsideDir, 'secret.md'), 'secret');
      mkdirSync(join(root, 'nodes/node-A'), { recursive: true });
      symlinkSync(join(outsideDir, 'secret.md'), join(root, 'nodes/node-A/escape.md'));
      const { resolved } = resolveFileRefs(
        nodeWrap('node-A', { detail: 'file://escape.md' }),
        root,
      );
      const detail = (resolved as { nodes: [{ data: { detail: string } }] }).nodes[0].data.detail;
      expect(detail).toMatch(/^\[seeflow: invalid file:\/\/ path/);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('returns refs sorted and de-duplicated', () => {
    writeNodeFile(root, 'node-A', 'x.txt', 'X');
    const { refs } = resolveFileRefs(
      nodeWrap('node-A', { a: 'file://x.txt', b: 'file://x.txt' }),
      root,
    );
    expect(refs).toEqual(['nodes/node-A/x.txt']);
  });
});
