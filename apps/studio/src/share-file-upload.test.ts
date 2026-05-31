import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FlowEntry, Registry } from './registry.ts';
import type { Envelope } from './share-envelope.ts';
import { type FileUploadAuditEntry, createFileUploadHandler } from './share-file-upload.ts';

const NODE_ID = 'node-abc1234567';
const PEER = { peerId: 'peer-1', displayName: 'Alice' };
const PEER_CONN = 'conn-peer-1';
const SESSION_ID = 'session-test-1';

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

const intentEnvelope = (
  reqId: string,
  filename: string,
  size: number,
  sha256: string,
  extras?: Record<string, unknown>,
): Envelope => ({
  v: 1,
  type: 'file-upload-intent',
  from: PEER_CONN,
  id: reqId,
  payload: {
    reqId,
    filename,
    size,
    contentType: 'image/png',
    nodeId: NODE_ID,
    sha256,
    ...(extras ?? {}),
  },
});

const bytesEnvelope = (
  reqId: string,
  seq: number,
  total: number,
  chunk: Buffer,
  sha256: string,
  eof: boolean,
): Envelope => ({
  v: 1,
  type: 'file-bytes',
  from: PEER_CONN,
  id: reqId,
  payload: {
    reqId,
    seq,
    total,
    base64: chunk.toString('base64'),
    sha256,
    eof,
  },
});

const doneEnvelope = (reqId: string, key: string, sha256: string, getUrl: string): Envelope => ({
  v: 1,
  type: 'file-upload-done',
  from: PEER_CONN,
  id: reqId,
  payload: { reqId, key, sha256, getUrl },
});

interface Harness {
  tmpDir: string;
  nodeDir: string;
  sends: Envelope[];
  audits: { sessionId: string; entry: FileUploadAuditEntry }[];
  handler: ReturnType<typeof createFileUploadHandler>;
  cleanup: () => void;
}

const makeHarness = (opts?: {
  fetchFn?: typeof fetch;
  now?: () => number;
  sessionId?: string | null;
}): Harness => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'sfu-'));
  const nodeDir = join(tmpDir, 'nodes', NODE_ID);
  mkdirSync(nodeDir, { recursive: true });
  const sends: Envelope[] = [];
  const audits: { sessionId: string; entry: FileUploadAuditEntry }[] = [];
  const handler = createFileUploadHandler({
    registry: makeRegistry([makeEntry(tmpDir)]),
    broadcast: (env) => sends.push(env),
    getSessionId: () => (opts?.sessionId === undefined ? SESSION_ID : opts.sessionId),
    appendAudit: (sessionId, entry) => audits.push({ sessionId, entry }),
    fetchFn: opts?.fetchFn,
    now: opts?.now,
  });
  return {
    tmpDir,
    nodeDir,
    sends,
    audits,
    handler,
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
  };
};

describe('createFileUploadHandler — ws path', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.cleanup());

  it('round-trips a single-chunk upload + writes atomically + broadcasts node-patched', async () => {
    const bytes = randomBytes(2048);
    const sha = createHash('sha256').update(bytes).digest('hex');
    await h.handler.handleIntent(intentEnvelope('req-1', 'foo.png', bytes.length, sha), PEER);

    expect(h.sends).toHaveLength(1);
    const intentReply = h.sends[0];
    expect(intentReply?.type).toBe('rpc-result');
    expect(intentReply?.to).toBe(PEER_CONN);
    const intentPayload = intentReply?.payload as { ok: boolean; result?: { via: string } };
    expect(intentPayload.ok).toBe(true);
    expect(intentPayload.result?.via).toBe('ws');
    expect(h.handler.inflightCount(PEER_CONN)).toBe(1);

    h.sends.length = 0;
    await h.handler.handleBytes(bytesEnvelope('req-1', 0, 1, bytes, sha, true), PEER);

    expect(h.handler.inflightCount(PEER_CONN)).toBe(0);
    const absPath = join(h.nodeDir, 'foo.png');
    expect(existsSync(absPath)).toBe(true);
    expect(readFileSync(absPath).equals(bytes)).toBe(true);

    const patch = h.sends.find((e) => e.type === 'node-patched');
    expect(patch?.to).toBe('all');
    const patchPayload = patch?.payload as {
      flowId: string;
      op: string;
      diff: { nodeId: string; data: { path: string } };
    };
    expect(patchPayload.flowId).toBe('demo-id');
    expect(patchPayload.op).toBe('file-upload');
    expect(patchPayload.diff.nodeId).toBe(NODE_ID);
    expect(patchPayload.diff.data.path).toBe(`nodes/${NODE_ID}/foo.png`);

    const ok = h.sends.find((e) => e.type === 'rpc-result');
    const okPayload = ok?.payload as { ok: boolean };
    expect(okPayload.ok).toBe(true);

    expect(h.audits).toHaveLength(1);
    const audit = h.audits[0];
    expect(audit?.sessionId).toBe(SESSION_ID);
    expect(audit?.entry.op).toBe('file-upload');
    expect(audit?.entry.peerId).toBe(PEER.peerId);
    expect(audit?.entry.nodeId).toBe(NODE_ID);
    expect(audit?.entry.filename).toBe('foo.png');
    expect(audit?.entry.size).toBe(bytes.length);
    expect(audit?.entry.sha256).toBe(sha);
    expect(audit?.entry.accept).toBe(true);
  });

  it('round-trips a 3-chunk upload + sha256 verifies', async () => {
    const a = randomBytes(800);
    const b = randomBytes(800);
    const c = randomBytes(400);
    const full = Buffer.concat([a, b, c]);
    const sha = createHash('sha256').update(full).digest('hex');

    await h.handler.handleIntent(intentEnvelope('req-x', 'multi.png', full.length, sha), PEER);
    h.sends.length = 0;

    await h.handler.handleBytes(bytesEnvelope('req-x', 0, 3, a, sha, false), PEER);
    await h.handler.handleBytes(bytesEnvelope('req-x', 1, 3, b, sha, false), PEER);
    await h.handler.handleBytes(bytesEnvelope('req-x', 2, 3, c, sha, true), PEER);

    expect(readFileSync(join(h.nodeDir, 'multi.png')).equals(full)).toBe(true);
    const ok = h.sends.find(
      (e) =>
        e.type === 'rpc-result' &&
        typeof e.payload === 'object' &&
        (e.payload as { ok?: boolean }).ok === true,
    );
    expect(ok).toBeDefined();
    expect(h.handler.inflightCount(PEER_CONN)).toBe(0);
  });

  it('rejects sha256 mismatch + does not write file + does not broadcast', async () => {
    const bytes = randomBytes(1024);
    const wrongSha = createHash('sha256').update(Buffer.from('different')).digest('hex');

    await h.handler.handleIntent(
      intentEnvelope('req-bad-sha', 'bad.png', bytes.length, wrongSha),
      PEER,
    );
    h.sends.length = 0;
    h.audits.length = 0;

    await h.handler.handleBytes(bytesEnvelope('req-bad-sha', 0, 1, bytes, wrongSha, true), PEER);

    expect(existsSync(join(h.nodeDir, 'bad.png'))).toBe(false);
    expect(h.sends.find((e) => e.type === 'node-patched')).toBeUndefined();
    const reply = h.sends.find((e) => e.type === 'rpc-result');
    const payload = reply?.payload as { ok: boolean; reason?: string };
    expect(payload.ok).toBe(false);
    expect(payload.reason).toBe('integrity');
    expect(h.audits[0]?.entry.accept).toBe(false);
    expect(h.audits[0]?.entry.reason).toBe('integrity');
    expect(h.handler.inflightCount(PEER_CONN)).toBe(0);
  });
});

describe('createFileUploadHandler — intent guards', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.cleanup());

  it('rejects size > 100 MB at intent stage', async () => {
    const sha = createHash('sha256').update(Buffer.from('x')).digest('hex');
    const oversize = 100 * 1024 * 1024 + 1;
    await h.handler.handleIntent(intentEnvelope('req-big', 'big.png', oversize, sha), PEER);
    const reply = h.sends[0];
    const payload = reply?.payload as { ok: boolean; reason?: string };
    expect(payload.ok).toBe(false);
    expect(payload.reason).toBe('too-large');
    expect(h.handler.inflightCount(PEER_CONN)).toBe(0);
  });

  it('rejects extension not in allowlist', async () => {
    const sha = createHash('sha256').update(Buffer.from('x')).digest('hex');
    await h.handler.handleIntent(intentEnvelope('req-exe', 'evil.exe', 1024, sha), PEER);
    const reply = h.sends[0];
    const payload = reply?.payload as { ok: boolean; reason?: string };
    expect(payload.ok).toBe(false);
    expect(payload.reason).toBe('extension-not-allowed');
    expect(h.handler.inflightCount(PEER_CONN)).toBe(0);
  });

  it('rejects traversal filename with reason: path-invalid', async () => {
    const sha = createHash('sha256').update(Buffer.from('x')).digest('hex');
    await h.handler.handleIntent(intentEnvelope('req-trav', '../../escape.png', 1024, sha), PEER);
    const reply = h.sends[0];
    const payload = reply?.payload as { ok: boolean; reason?: string };
    expect(payload.ok).toBe(false);
    expect(payload.reason).toBe('path-invalid');
    expect(h.handler.inflightCount(PEER_CONN)).toBe(0);
  });

  it('honours relay-amended payload.upload via', async () => {
    const sha = createHash('sha256').update(Buffer.from('x')).digest('hex');
    await h.handler.handleIntent(
      intentEnvelope('req-s3', 'big.png', 1024, sha, {
        upload: { via: 's3', key: 'foo/bar.png', putUrl: 'https://example.com/put' },
      }),
      PEER,
    );
    const reply = h.sends[0];
    const payload = reply?.payload as {
      ok: boolean;
      result?: { via: string; key?: string; putUrl?: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.result?.via).toBe('s3');
    expect(payload.result?.key).toBe('foo/bar.png');
    expect(payload.result?.putUrl).toBe('https://example.com/put');
  });

  it('rejects malformed payload with reason: bad-payload', async () => {
    await h.handler.handleIntent(
      { v: 1, type: 'file-upload-intent', from: PEER_CONN, payload: { reqId: 'req-bad' } },
      PEER,
    );
    const reply = h.sends[0];
    const payload = reply?.payload as { ok: boolean; reason?: string };
    expect(payload.ok).toBe(false);
    expect(payload.reason).toBe('bad-payload');
  });
});

describe('createFileUploadHandler — s3 path', () => {
  let h: Harness;
  let fetched: string[];
  let stagedBytes: Buffer;
  let stagedSha: string;

  beforeEach(() => {
    stagedBytes = randomBytes(400 * 1024);
    stagedSha = createHash('sha256').update(stagedBytes).digest('hex');
    fetched = [];
    h = makeHarness({
      fetchFn: (async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        fetched.push(url);
        return new Response(stagedBytes, { status: 200 }) as unknown as Response;
      }) as typeof fetch,
    });
  });
  afterEach(() => h.cleanup());

  it('fetches the relay get URL, verifies sha256, writes atomically, then acks ok', async () => {
    await h.handler.handleIntent(
      intentEnvelope('req-s3', 'asset.png', stagedBytes.length, stagedSha, {
        upload: {
          via: 's3',
          key: `${SESSION_ID}/req-s3/slug-asset.png`,
          putUrl: 'https://staging.example.com/put',
        },
      }),
      PEER,
    );
    h.sends.length = 0;

    await h.handler.handleDone(
      doneEnvelope(
        'req-s3',
        `${SESSION_ID}/req-s3/slug-asset.png`,
        stagedSha,
        'https://staging.example.com/get',
      ),
      PEER,
    );

    expect(fetched).toEqual(['https://staging.example.com/get']);
    const absPath = join(h.nodeDir, 'asset.png');
    expect(existsSync(absPath)).toBe(true);
    expect(readFileSync(absPath).equals(stagedBytes)).toBe(true);
    const patch = h.sends.find((e) => e.type === 'node-patched');
    expect(patch).toBeDefined();
    const ok = h.sends.find(
      (e) =>
        e.type === 'rpc-result' &&
        typeof e.payload === 'object' &&
        (e.payload as { ok?: boolean }).ok === true,
    );
    expect(ok).toBeDefined();
    expect(h.audits.some((a) => a.entry.accept === true)).toBe(true);
    expect(h.handler.inflightCount(PEER_CONN)).toBe(0);
  });
});

describe('createFileUploadHandler — rate limit', () => {
  it('rejects file-bytes once a peer exceeds 5 MB / 60 s', async () => {
    let nowMs = 1_000_000;
    const h = makeHarness({ now: () => nowMs });
    try {
      const chunkBytes = randomBytes(2 * 1024 * 1024);
      const sha = createHash('sha256')
        .update(Buffer.concat([chunkBytes, chunkBytes]))
        .digest('hex');
      await h.handler.handleIntent(
        intentEnvelope('req-rl', 'rl.png', chunkBytes.length * 2, sha),
        PEER,
      );
      h.sends.length = 0;
      // First 2 MB chunk: fits.
      await h.handler.handleBytes(bytesEnvelope('req-rl', 0, 2, chunkBytes, sha, false), PEER);
      // Second 2 MB chunk: total 4 MB, still fits.
      await h.handler.handleBytes(bytesEnvelope('req-rl', 1, 2, chunkBytes, sha, false), PEER);
      expect(h.handler.windowBytes(PEER_CONN)).toBe(chunkBytes.length * 2);
      // Third 2 MB chunk on a new intent: total would be 6 MB > 5 MB cap.
      const extra = randomBytes(2 * 1024 * 1024);
      const sha2 = createHash('sha256').update(extra).digest('hex');
      await h.handler.handleIntent(intentEnvelope('req-rl2', 'rl2.png', extra.length, sha2), PEER);
      h.sends.length = 0;
      await h.handler.handleBytes(bytesEnvelope('req-rl2', 0, 1, extra, sha2, true), PEER);
      const reply = h.sends.find((e) => e.type === 'rpc-result');
      const payload = reply?.payload as { ok: boolean; reason?: string };
      expect(payload.ok).toBe(false);
      expect(payload.reason).toBe('rate-limited');
      // Advance past the window: a fresh upload now succeeds.
      nowMs += 61_000;
      const fresh = randomBytes(1024);
      const freshSha = createHash('sha256').update(fresh).digest('hex');
      h.sends.length = 0;
      await h.handler.handleIntent(
        intentEnvelope('req-fresh', 'fresh.png', fresh.length, freshSha),
        PEER,
      );
      await h.handler.handleBytes(bytesEnvelope('req-fresh', 0, 1, fresh, freshSha, true), PEER);
      const okReply = h.sends.find(
        (e) =>
          e.type === 'rpc-result' &&
          typeof e.payload === 'object' &&
          (e.payload as { ok?: boolean }).ok === true,
      );
      expect(okReply).toBeDefined();
    } finally {
      h.cleanup();
    }
  });
});
