import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FlowEntry, Registry } from './registry.ts';
import type { Envelope } from './share-envelope.ts';
import {
  type PutToS3,
  type RequestUploadIntent,
  contentTypeFor,
  createFileRequestHandler,
} from './share-file-request.ts';

const NODE_ID = 'node-abc1234567';

const makeRegistry = (entries: FlowEntry[]): Registry => {
  const list = () => entries.slice();
  return {
    path: '/tmp/registry.json',
    list,
    getById: (id) => entries.find((e) => e.id === id),
    getBySlug: (slug) => entries.find((e) => e.slug === slug),
    resolve: (idOrSlug) => entries.find((e) => e.id === idOrSlug || e.slug === idOrSlug),
    getByRepoPath: (repoPath) => entries.find((e) => e.repoPath === repoPath),
    getByRepoPathAndFlowPath: (repoPath, flowPath) =>
      entries.find((e) => e.repoPath === repoPath && e.flowPath === flowPath),
    upsert: () => {
      throw new Error('upsert not stubbed');
    },
    remove: () => false,
    onChange: () => () => {},
    reload: () => {},
    isOwnWrite: () => false,
  };
};

const makeEntry = (repoPath: string): FlowEntry => ({
  id: 'demo-id',
  slug: 'demo/main',
  name: 'demo',
  repoPath,
  flowPath: 'flow.json',
  projectSlug: 'demo',
  flowSlug: 'main',
  isDefault: true,
  lastModified: 0,
  valid: true,
});

describe('contentTypeFor', () => {
  it('maps the allowlist extensions', () => {
    expect(contentTypeFor('image.png')).toBe('image/png');
    expect(contentTypeFor('image.JPG')).toBe('image/jpeg');
    expect(contentTypeFor('photo.jpeg')).toBe('image/jpeg');
    expect(contentTypeFor('hero.webp')).toBe('image/webp');
    expect(contentTypeFor('icon.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('anim.gif')).toBe('image/gif');
    expect(contentTypeFor('readme.md')).toBe('text/markdown');
    expect(contentTypeFor('notes.txt')).toBe('text/plain');
    expect(contentTypeFor('data.json')).toBe('application/json');
    expect(contentTypeFor('index.html')).toBe('text/html');
  });

  it('falls back to application/octet-stream for unknown extensions', () => {
    expect(contentTypeFor('bin.unknown')).toBe('application/octet-stream');
    expect(contentTypeFor('no-extension')).toBe('application/octet-stream');
  });
});

describe('createFileRequestHandler — inline path (<=256 KB)', () => {
  let tmpDir: string;
  let nodeDir: string;
  let sends: Envelope[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sfr-inline-'));
    nodeDir = join(tmpDir, 'nodes', NODE_ID);
    mkdirSync(nodeDir, { recursive: true });
    sends = [];
  });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  const makeHandler = () =>
    createFileRequestHandler({
      registry: makeRegistry([makeEntry(tmpDir)]),
      broadcast: (env) => sends.push(env),
    });

  it('round-trips bytes inline with matching sha256', async () => {
    const bytes = Buffer.from('hello world');
    writeFileSync(join(nodeDir, 'greeting.txt'), bytes);
    const expected = createHash('sha256').update(bytes).digest('hex');

    await makeHandler().handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-1', nodeId: NODE_ID, relPath: 'greeting.txt' },
    });

    expect(sends).toHaveLength(1);
    const reply = sends[0];
    expect(reply?.type).toBe('file-bytes');
    expect(reply?.to).toBe('conn-peer-1');
    const payload = reply?.payload as {
      reqId: string;
      seq: number;
      total: number;
      base64: string;
      contentType?: string;
      sha256: string;
      eof: boolean;
    };
    expect(payload.reqId).toBe('req-1');
    expect(payload.seq).toBe(0);
    expect(payload.total).toBe(1);
    expect(payload.eof).toBe(true);
    expect(payload.contentType).toBe('text/plain');
    expect(payload.sha256).toBe(expected);
    expect(Buffer.from(payload.base64, 'base64').toString('utf8')).toBe('hello world');
  });

  it('boundary at exactly 256 KB still goes inline', async () => {
    const bytes = randomBytes(256 * 1024);
    writeFileSync(join(nodeDir, 'edge.bin'), bytes);

    await makeHandler().handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-boundary', nodeId: NODE_ID, relPath: 'edge.bin' },
    });

    expect(sends).toHaveLength(1);
    expect(sends[0]?.type).toBe('file-bytes');
    const payload = sends[0]?.payload as { base64: string; sha256: string };
    expect(Buffer.from(payload.base64, 'base64').length).toBe(256 * 1024);
    expect(payload.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('uses application/octet-stream for unknown extensions', async () => {
    const bytes = Buffer.from('opaque payload');
    writeFileSync(join(nodeDir, 'mystery.bin'), bytes);

    await makeHandler().handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-bin', nodeId: NODE_ID, relPath: 'mystery.bin' },
    });

    const payload = sends[0]?.payload as { contentType?: string };
    expect(payload.contentType).toBe('application/octet-stream');
  });

  it('resolves nested relPath under the node folder', async () => {
    mkdirSync(join(nodeDir, 'sub'), { recursive: true });
    writeFileSync(join(nodeDir, 'sub', 'inner.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await makeHandler().handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-nested', nodeId: NODE_ID, relPath: 'sub/inner.png' },
    });

    expect(sends).toHaveLength(1);
    const payload = sends[0]?.payload as { contentType?: string };
    expect(payload.contentType).toBe('image/png');
  });
});

describe('createFileRequestHandler — error paths', () => {
  let tmpDir: string;
  let nodeDir: string;
  let sends: Envelope[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sfr-err-'));
    nodeDir = join(tmpDir, 'nodes', NODE_ID);
    mkdirSync(nodeDir, { recursive: true });
    sends = [];
  });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  const makeHandler = () =>
    createFileRequestHandler({
      registry: makeRegistry([makeEntry(tmpDir)]),
      broadcast: (env) => sends.push(env),
    });

  it('replies with not-found when the relPath does not exist', async () => {
    await makeHandler().handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-missing', nodeId: NODE_ID, relPath: 'nope.png' },
    });

    expect(sends).toHaveLength(2);
    expect(sends[0]?.type).toBe('file-bytes');
    expect((sends[0]?.payload as { eof: boolean; sha256: string }).eof).toBe(true);
    expect((sends[0]?.payload as { sha256: string }).sha256).toBe('');
    expect(sends[1]?.type).toBe('rpc-result');
    expect(sends[1]?.id).toBe('req-missing');
    expect(sends[1]?.payload).toEqual({ ok: false, reason: 'not-found' });
  });

  it('rejects traversal attempts via ..', async () => {
    writeFileSync(join(tmpDir, 'secret.txt'), 'top-secret');
    await makeHandler().handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-trav', nodeId: NODE_ID, relPath: '../secret.txt' },
    });

    expect(sends).toHaveLength(2);
    expect((sends[1]?.payload as { reason: string }).reason).toBe('traversal');
  });

  it('rejects absolute relPath', async () => {
    await makeHandler().handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-abs', nodeId: NODE_ID, relPath: '/etc/passwd' },
    });
    expect((sends[1]?.payload as { reason: string }).reason).toBe('traversal');
  });

  it('rejects malformed nodeId', async () => {
    await makeHandler().handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-bad-id', nodeId: 'not-a-node', relPath: 'foo.png' },
    });
    expect((sends[1]?.payload as { reason: string }).reason).toBe('bad-node-id');
  });

  it('rejects payload that fails Zod parse', async () => {
    await makeHandler().handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      // missing reqId; relPath has wrong type
      payload: { nodeId: NODE_ID, relPath: 42 },
    });
    expect(sends).toHaveLength(2);
    expect((sends[1]?.payload as { reason: string }).reason).toBe('bad-payload');
  });

  it('replies not-found when the registry has zero entries', async () => {
    const handler = createFileRequestHandler({
      registry: makeRegistry([]),
      broadcast: (env) => sends.push(env),
    });
    await handler.handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-empty', nodeId: NODE_ID, relPath: 'image.png' },
    });
    expect((sends[1]?.payload as { reason: string }).reason).toBe('not-found');
  });

  it('surfaces read-failed when fs throws', async () => {
    const handler = createFileRequestHandler({
      registry: makeRegistry([makeEntry(tmpDir)]),
      broadcast: (env) => sends.push(env),
      // Mark the file present so we pass the existence probe, then throw on read.
      fileExists: async () => true,
      readFile: async () => {
        throw new Error('boom');
      },
    });
    await handler.handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-read-fail', nodeId: NODE_ID, relPath: 'image.png' },
    });
    expect((sends[1]?.payload as { reason: string }).reason).toBe('read-failed');
  });
});

describe('createFileRequestHandler — oversize S3 path', () => {
  let tmpDir: string;
  let nodeDir: string;
  let sends: Envelope[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sfr-s3-'));
    nodeDir = join(tmpDir, 'nodes', NODE_ID);
    mkdirSync(nodeDir, { recursive: true });
    sends = [];
  });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('PUTs bytes to staging then replies with file-redirect', async () => {
    const bytes = randomBytes(256 * 1024 + 1);
    writeFileSync(join(nodeDir, 'big.png'), bytes);
    const expectedSha = createHash('sha256').update(bytes).digest('hex');

    const intentCalls: Parameters<RequestUploadIntent>[] = [];
    const requestUploadIntent: RequestUploadIntent = async (p) => {
      intentCalls.push([p]);
      return {
        putUrl: 'https://staging.example/put?sig=1',
        getUrl: 'https://staging.example/get?sig=2',
        expiresAt: 1700000000,
        key: 'sess/req-big/abc-big.png',
      };
    };
    const putCalls: Array<{ url: string; size: number; contentType: string }> = [];
    const putToS3: PutToS3 = async (url, bytesIn, contentType) => {
      putCalls.push({ url, size: bytesIn.length, contentType });
      return { ok: true, status: 200 };
    };

    const handler = createFileRequestHandler({
      registry: makeRegistry([makeEntry(tmpDir)]),
      broadcast: (env) => sends.push(env),
      requestUploadIntent,
      putToS3,
    });

    await handler.handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-big', nodeId: NODE_ID, relPath: 'big.png' },
    });

    expect(intentCalls).toHaveLength(1);
    expect(intentCalls[0]?.[0]).toEqual({
      reqId: 'req-big',
      filename: 'big.png',
      size: bytes.length,
      contentType: 'image/png',
      sha256: expectedSha,
      nodeId: NODE_ID,
      role: 'host-serve',
    });
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]).toEqual({
      url: 'https://staging.example/put?sig=1',
      size: bytes.length,
      contentType: 'image/png',
    });

    expect(sends).toHaveLength(1);
    expect(sends[0]?.type).toBe('file-redirect');
    expect(sends[0]?.to).toBe('conn-peer-1');
    expect(sends[0]?.payload).toEqual({
      reqId: 'req-big',
      getUrl: 'https://staging.example/get?sig=2',
      sha256: expectedSha,
      expiresAt: 1700000000,
    });
  });

  it('replies put-status-<n> when S3 PUT returns non-2xx', async () => {
    const bytes = randomBytes(256 * 1024 + 1);
    writeFileSync(join(nodeDir, 'big.png'), bytes);

    const handler = createFileRequestHandler({
      registry: makeRegistry([makeEntry(tmpDir)]),
      broadcast: (env) => sends.push(env),
      requestUploadIntent: async () => ({
        putUrl: 'https://staging.example/put',
        getUrl: 'https://staging.example/get',
        expiresAt: 1,
        key: 'k',
      }),
      putToS3: async () => ({ ok: false, status: 503 }),
    });

    await handler.handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-fail', nodeId: NODE_ID, relPath: 'big.png' },
    });

    expect(sends).toHaveLength(2);
    expect((sends[1]?.payload as { reason: string }).reason).toBe('put-status-503');
  });

  it('replies intent-failed when the relay refuses to mint a presigned URL', async () => {
    const bytes = randomBytes(256 * 1024 + 1);
    writeFileSync(join(nodeDir, 'big.png'), bytes);

    const handler = createFileRequestHandler({
      registry: makeRegistry([makeEntry(tmpDir)]),
      broadcast: (env) => sends.push(env),
      requestUploadIntent: async () => {
        throw new Error('relay-down');
      },
      putToS3: async () => ({ ok: true, status: 200 }),
    });

    await handler.handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-intent', nodeId: NODE_ID, relPath: 'big.png' },
    });

    expect((sends[1]?.payload as { reason: string }).reason).toBe('intent-failed');
  });

  it('falls back to chunked WS when oversize and S3 deps are unconfigured', async () => {
    // Two-chunk file: 256KB + 1 byte → ceil(2) chunks at the 256KB boundary.
    const bytes = randomBytes(256 * 1024 + 1);
    writeFileSync(join(nodeDir, 'big.png'), bytes);

    const handler = createFileRequestHandler({
      registry: makeRegistry([makeEntry(tmpDir)]),
      broadcast: (env) => sends.push(env),
    });

    await handler.handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-cfg', nodeId: NODE_ID, relPath: 'big.png' },
    });

    // Every emitted envelope is a file-bytes chunk; the peer's reassembler is
    // size-agnostic so the only contract the host owes is consistent total +
    // eof on the last chunk.
    expect(sends.length).toBeGreaterThan(1);
    const chunks = sends.map(
      (e) =>
        e.payload as {
          reqId: string;
          seq: number;
          total: number;
          base64: string;
          sha256: string;
          eof: boolean;
        },
    );
    expect(chunks[0]?.total).toBe(2);
    expect(chunks[0]?.eof).toBe(false);
    expect(chunks[1]?.eof).toBe(true);
    // Reassembled bytes must round-trip identically.
    const assembled = Buffer.concat(chunks.map((c) => Buffer.from(c.base64, 'base64')));
    expect(assembled.equals(bytes)).toBe(true);
  });

  it('rejects oversize with too-large when bytes exceed the WS chunk cap', async () => {
    // 10 MB cap + 1 byte → no S3, no WS → too-large.
    const bytes = randomBytes(10 * 1024 * 1024 + 1);
    writeFileSync(join(nodeDir, 'huge.png'), bytes);

    const handler = createFileRequestHandler({
      registry: makeRegistry([makeEntry(tmpDir)]),
      broadcast: (env) => sends.push(env),
    });

    await handler.handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-huge', nodeId: NODE_ID, relPath: 'huge.png' },
    });

    expect((sends[1]?.payload as { reason: string }).reason).toBe('too-large');
  });
});

describe('createFileRequestHandler — concurrency rate-limit', () => {
  let tmpDir: string;
  let nodeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sfr-rl-'));
    nodeDir = join(tmpDir, 'nodes', NODE_ID);
    mkdirSync(nodeDir, { recursive: true });
    writeFileSync(join(nodeDir, 'image.png'), Buffer.from('x'));
  });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('rejects the 31st in-flight request with too-many-in-flight', async () => {
    const sends: Envelope[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const handler = createFileRequestHandler({
      registry: makeRegistry([makeEntry(tmpDir)]),
      broadcast: (env) => sends.push(env),
      // Hold every read until we release the gate so 30 stay in-flight.
      readFile: async () => {
        await gate;
        return Buffer.from('x');
      },
    });

    const requests: Promise<void>[] = [];
    for (let i = 0; i < 30; i += 1) {
      requests.push(
        handler.handle({
          v: 1,
          type: 'file-request',
          from: 'conn-peer-1',
          payload: { reqId: `req-${i}`, nodeId: NODE_ID, relPath: 'image.png' },
        }),
      );
    }
    // Let the handlers reach their await point and increment the counter
    // before issuing the 31st.
    await new Promise((r) => setTimeout(r, 0));
    expect(handler.inflightCount('conn-peer-1')).toBe(30);

    await handler.handle({
      v: 1,
      type: 'file-request',
      from: 'conn-peer-1',
      payload: { reqId: 'req-overflow', nodeId: NODE_ID, relPath: 'image.png' },
    });

    // First two sends should be the overflow rejection pair.
    expect(sends.length).toBeGreaterThanOrEqual(2);
    const overflowRpc = sends.find((e) => e.type === 'rpc-result' && e.id === 'req-overflow');
    expect(overflowRpc?.payload).toEqual({ ok: false, reason: 'too-many-in-flight' });

    release();
    await Promise.all(requests);
    expect(handler.inflightCount('conn-peer-1')).toBe(0);
  });
});
