import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, validateFlow } from './validate';

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
  tmpRoot = await mkdtemp(join(tmpdir(), 'seeflow-validate-'));
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('validateFlow (stubbed fetch)', () => {
  it('POSTs {flow} when style is absent', async () => {
    const captured: CapturedCall[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const result = await validateFlow({
      flow: { version: 2, name: 'X', nodes: [], connectors: [] },
      url: 'http://localhost:1234',
    });

    expect(result.ok).toBe(true);
    expect(captured[0]?.url).toBe('http://localhost:1234/api/validate');
    const sent = JSON.parse((captured[0]?.init?.body as string) ?? 'null');
    expect(sent).toEqual({ flow: { version: 2, name: 'X', nodes: [], connectors: [] } });
    expect('style' in sent).toBe(false);
  });

  it('POSTs {flow, style} when style is provided', async () => {
    const captured: CapturedCall[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init });
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    await validateFlow({
      flow: { x: 1 },
      style: { y: 2 },
      url: 'http://localhost:1234',
    });
    const sent = JSON.parse((captured[0]?.init?.body as string) ?? 'null');
    expect(sent).toEqual({ flow: { x: 1 }, style: { y: 2 } });
  });

  it('surfaces issues array when validation fails', async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        { ok: false, issues: [{ path: ['nodes', 0, 'id'], message: 'required' }] },
        200,
      )) as typeof fetch;

    const result = await validateFlow({ flow: {}, url: 'http://localhost:1234' });
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
  });
});

describe('validate.ts main()', () => {
  it('exits 0 on validation success', async () => {
    const flowPath = join(tmpRoot, 'flow-ok.json');
    await writeFile(
      flowPath,
      JSON.stringify({ version: 2, name: 'A', nodes: [], connectors: [] }),
      'utf8',
    );
    globalThis.fetch = (async () => jsonResponse({ ok: true })) as typeof fetch;
    const code = await main(['--flow', flowPath]);
    expect(code).toBe(0);
  });

  it('exits 1 and prints issues on validation failure', async () => {
    const flowPath = join(tmpRoot, 'flow-bad.json');
    await writeFile(flowPath, JSON.stringify({ broken: true }), 'utf8');
    globalThis.fetch = (async () =>
      jsonResponse(
        { ok: false, issues: [{ path: ['version'], message: 'required' }] },
        200,
      )) as typeof fetch;

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = await main(['--flow', flowPath]);
      expect(code).toBe(1);
    } finally {
      process.stderr.write = origWrite;
    }
    const out = stderrChunks.join('');
    expect(out).toContain('version');
    expect(out).toContain('required');
  });

  it('passes style file when --style is provided', async () => {
    const flowPath = join(tmpRoot, 'flow-s.json');
    const stylePath = join(tmpRoot, 'style-s.json');
    await writeFile(flowPath, JSON.stringify({ a: 1 }), 'utf8');
    await writeFile(stylePath, JSON.stringify({ b: 2 }), 'utf8');

    let received: unknown;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      received = JSON.parse((init?.body as string) ?? 'null');
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const code = await main(['--flow', flowPath, '--style', stylePath]);
    expect(code).toBe(0);
    expect(received).toEqual({ flow: { a: 1 }, style: { b: 2 } });
  });

  it('exits 1 with usage when --flow is missing', async () => {
    const code = await main([]);
    expect(code).toBe(1);
  });

  it('exits 1 when flow file does not exist', async () => {
    const code = await main(['--flow', join(tmpRoot, 'missing.json')]);
    expect(code).toBe(1);
  });
});
