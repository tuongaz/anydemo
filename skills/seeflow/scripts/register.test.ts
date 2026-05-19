import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, registerDemo } from './register';
import { DEFAULT_STUDIO_URL, resolveStudioUrl } from './studio-config';

const realFetch = globalThis.fetch;

interface CapturedCall {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'seeflow-register-'));
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('registerDemo (stubbed fetch)', () => {
  it('returns {id, slug} on the success path', async () => {
    const captured: CapturedCall[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init });
      return jsonResponse({ id: 'demo-123', slug: 'my-demo' }, 200);
    }) as typeof fetch;

    const result = await registerDemo({
      repoPath: '/tmp/some-repo',
      flowPath: '.seeflow/flow.json',
      name: 'My Flow',
      url: 'http://127.0.0.1:9999',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: 'demo-123', slug: 'my-demo' });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('http://127.0.0.1:9999/api/flows/register');
    expect(captured[0]?.init?.method).toBe('POST');
    const sentBody = JSON.parse((captured[0]?.init?.body as string) ?? 'null');
    expect(sentBody).toEqual({
      repoPath: '/tmp/some-repo',
      flowPath: '.seeflow/flow.json',
      name: 'My Flow',
    });
  });

  it('omits name from the payload when not provided', async () => {
    const captured: CapturedCall[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init });
      return jsonResponse({ id: 'd', slug: 's' }, 200);
    }) as typeof fetch;

    await registerDemo({
      repoPath: '/tmp/repo',
      flowPath: '.seeflow/flow.json',
      url: 'http://localhost:1234',
    });
    const sentBody = JSON.parse((captured[0]?.init?.body as string) ?? 'null');
    expect(sentBody).toEqual({ repoPath: '/tmp/repo', flowPath: '.seeflow/flow.json' });
    expect('name' in sentBody).toBe(false);
  });

  it('surfaces the response body on 400', async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        { error: 'Invalid register body', issues: [{ path: ['name'] }] },
        400,
      )) as typeof fetch;

    const result = await registerDemo({
      repoPath: '/tmp/r',
      flowPath: '.seeflow/flow.json',
      url: 'http://localhost:1234',
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: 'Invalid register body',
      issues: [{ path: ['name'] }],
    });
  });
});

describe('resolveStudioUrl', () => {
  it('falls back to the default URL when the config file is missing', () => {
    const missing = join(tmpRoot, 'definitely-not-here.json');
    expect(resolveStudioUrl(missing)).toBe(DEFAULT_STUDIO_URL);
  });

  it('falls back to the default URL when the config file is malformed', async () => {
    const path = join(tmpRoot, 'bad-config.json');
    await writeFile(path, '{ not json', 'utf8');
    expect(resolveStudioUrl(path)).toBe(DEFAULT_STUDIO_URL);
  });

  it('uses host + port from a well-formed config', async () => {
    const path = join(tmpRoot, 'good-config.json');
    await writeFile(path, JSON.stringify({ host: '127.0.0.1', port: 8765 }), 'utf8');
    expect(resolveStudioUrl(path)).toBe('http://127.0.0.1:8765');
  });
});

describe('register.ts main()', () => {
  it('exits 0 and prints {id, slug} on success', async () => {
    const repoPath = await mkdtemp(join(tmpRoot, 'project-'));
    const seeflowDir = join(repoPath, '.seeflow');
    await mkdir(seeflowDir, { recursive: true });
    await writeFile(
      join(seeflowDir, 'flow.json'),
      JSON.stringify({ version: 2, name: 'Checkout Flow', nodes: [], connectors: [] }),
      'utf8',
    );

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const sent = JSON.parse((init?.body as string) ?? 'null');
      expect(sent.name).toBe('Checkout Flow');
      expect(sent.repoPath).toBe(repoPath);
      expect(sent.flowPath).toBe('.seeflow/flow.json');
      return jsonResponse({ id: 'abc', slug: 'checkout-flow' }, 200);
    }) as typeof fetch;

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await main(['--path', repoPath, '--flow', '.seeflow/flow.json']);
      expect(code).toBe(0);
    } finally {
      process.stdout.write = origWrite;
    }
    const printed = stdoutChunks.join('').trim();
    expect(JSON.parse(printed)).toEqual({ id: 'abc', slug: 'checkout-flow' });
  });

  it('exits 1 and surfaces the response body on 400', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: 'Invalid register body' }, 400)) as typeof fetch;

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = await main(['--path', '/tmp/non-existent-repo', '--flow', '.seeflow/flow.json']);
      expect(code).toBe(1);
    } finally {
      process.stderr.write = origWrite;
    }
    const printed = stderrChunks.join('');
    expect(printed).toContain('Invalid register body');
  });

  it('exits 1 with a usage message when flags are missing', async () => {
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
