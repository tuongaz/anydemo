import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, unregisterDemo } from './unregister';

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'seeflow-unregister-'));
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('unregisterDemo (stubbed fetch)', () => {
  it('issues DELETE to /api/flows/:id and returns ok on 200', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? 'GET';
      return jsonResponse({ ok: true }, 200);
    }) as typeof fetch;

    const result = await unregisterDemo({ id: 'demo-123', url: 'http://localhost:4321' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(capturedUrl).toBe('http://localhost:4321/api/flows/demo-123');
    expect(capturedMethod).toBe('DELETE');
  });

  it('surfaces the body on a 404', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ ok: false, error: 'not found' }, 404)) as typeof fetch;

    const result = await unregisterDemo({ id: 'no-such', url: 'http://localhost:4321' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ ok: false, error: 'not found' });
  });
});

describe('unregister.ts main()', () => {
  it('exits 0 on the success path', async () => {
    globalThis.fetch = (async () => jsonResponse({ ok: true }, 200)) as typeof fetch;
    const code = await main(['--id', 'demo-abc']);
    expect(code).toBe(0);
  });

  it('exits non-zero and writes the response body to stderr on a 404', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ ok: false, error: 'not found' }, 404)) as typeof fetch;

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = await main(['--id', 'missing-id']);
      expect(code).not.toBe(0);
    } finally {
      process.stderr.write = origWrite;
    }
    const printed = stderrChunks.join('');
    expect(printed).toContain('not found');
  });

  it('exits 1 with a usage message when --id is missing', async () => {
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = await main([]);
      expect(code).toBe(1);
    } finally {
      process.stderr.write = origWrite;
    }
    expect(stderrChunks.join('')).toContain('Usage:');
  });
});
