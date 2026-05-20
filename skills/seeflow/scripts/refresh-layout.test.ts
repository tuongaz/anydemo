import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { main, refreshLayout } from './refresh-layout';

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

beforeAll(() => {
  globalThis.fetch = realFetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('refreshLayout (stubbed fetch)', () => {
  it('POSTs to /api/flows/<id>/layout and reports ok on {ok:true}', async () => {
    const captured: CapturedCall[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init });
      return jsonResponse({ ok: true }, 200);
    }) as typeof fetch;

    const result = await refreshLayout({ flowId: 'abc123', url: 'http://localhost:1234' });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe('http://localhost:1234/api/flows/abc123/layout');
    expect(captured[0]?.init?.method).toBe('POST');
  });

  it('reports !ok when HTTP succeeds but body is {ok:false}', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ ok: false, error: 'ELK failed' }, 200)) as typeof fetch;

    const result = await refreshLayout({ flowId: 'abc', url: 'http://localhost:1234' });
    expect(result.ok).toBe(false);
  });

  it('reports !ok on 4xx', async () => {
    globalThis.fetch = (async () => jsonResponse({ error: 'no such flow' }, 404)) as typeof fetch;

    const result = await refreshLayout({ flowId: 'missing', url: 'http://localhost:1234' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });
});

describe('refresh-layout.ts main()', () => {
  it('exits 0 and prints the body on success', async () => {
    globalThis.fetch = (async () => jsonResponse({ ok: true }, 200)) as typeof fetch;

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await main(['flow-abc']);
      expect(code).toBe(0);
    } finally {
      process.stdout.write = origWrite;
    }
    const printed = stdoutChunks.join('').trim();
    expect(JSON.parse(printed)).toEqual({ ok: true });
  });

  it('accepts --id flag form', async () => {
    globalThis.fetch = (async () => jsonResponse({ ok: true }, 200)) as typeof fetch;
    const code = await main(['--id', 'flow-xyz']);
    expect(code).toBe(0);
  });

  it('exits 1 with a usage message when id is missing', async () => {
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

  it('exits 1 and surfaces the error on layout failure', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ ok: false, error: 'boom' }, 500)) as typeof fetch;

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = await main(['failing-flow']);
      expect(code).toBe(1);
    } finally {
      process.stderr.write = origWrite;
    }
    expect(stderrChunks.join('')).toContain('layout failed');
    expect(stderrChunks.join('')).toContain('failing-flow');
  });
});
