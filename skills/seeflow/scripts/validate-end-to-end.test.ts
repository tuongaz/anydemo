import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { main, validateEndToEnd } from './validate-end-to-end';

const realFetch = globalThis.fetch;

beforeAll(() => {
  // no-op; assignments happen per-test
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

interface SseSpec {
  event: string;
  data: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(events: SseSpec[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        const data = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
        controller.enqueue(encoder.encode(`event: ${e.event}\ndata: ${data}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

interface DemoFixtureOptions {
  nodes: Array<{
    id: string;
    type: 'playNode' | 'stateNode';
    data: { playAction?: Record<string, unknown>; statusAction?: Record<string, unknown> };
  }>;
}

function demoFixture(opts: DemoFixtureOptions): unknown {
  return {
    id: 'demo-1',
    slug: 'fixture',
    name: 'fixture',
    filePath: '/tmp/fixture/.seeflow/seeflow.json',
    valid: true,
    error: null,
    demo: {
      version: 1,
      name: 'fixture',
      nodes: opts.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: { x: 0, y: 0 },
        data: { name: n.id, kind: 'service', stateSource: { kind: 'request' }, ...n.data },
      })),
      connectors: [],
    },
  };
}

const BASE_URL = 'http://stub.local';

function installFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe('validateEndToEnd', () => {
  it('ok-path with one play + one status passes', async () => {
    installFetch(async (url) => {
      if (url === `${BASE_URL}/api/flows/demo-1`) {
        return jsonResponse(
          demoFixture({
            nodes: [
              {
                id: 'p1',
                type: 'playNode',
                data: {
                  playAction: {
                    kind: 'script',
                    interpreter: 'bun',
                    scriptPath: 'play/p1.ts',
                  },
                  statusAction: {
                    kind: 'script',
                    interpreter: 'bun',
                    scriptPath: 'status/p1.ts',
                  },
                },
              },
            ],
          }),
        );
      }
      if (url === `${BASE_URL}/api/flows/demo-1/play/p1`) {
        return jsonResponse({ runId: 'run-1', status: 200, body: { ok: true } });
      }
      if (url === `${BASE_URL}/api/events?flowId=demo-1`) {
        return sseResponse([
          { event: 'hello', data: { flowId: 'demo-1' } },
          {
            event: 'node:status',
            data: { nodeId: 'p1', state: 'ok', summary: 'tick 1', ts: 1234 },
          },
        ]);
      }
      return jsonResponse({ error: 'unexpected url' }, 500);
    });

    const report = await validateEndToEnd({
      flowId: 'demo-1',
      url: BASE_URL,
      statusWaitMs: 500,
    });

    expect(report.ok).toBe(true);
    expect(report.plays).toHaveLength(1);
    expect(report.plays[0]).toEqual({
      nodeId: 'p1',
      outcome: 'ok',
      runId: 'run-1',
      body: { runId: 'run-1', status: 200, body: { ok: true } },
    });
    expect(report.statuses).toHaveLength(1);
    expect(report.statuses[0]?.nodeId).toBe('p1');
    expect(report.statuses[0]?.outcome).toBe('ok');
    expect(report.statuses[0]?.firstReport).toEqual({
      state: 'ok',
      summary: 'tick 1',
      detail: undefined,
      ts: 1234,
    });
    expect(report.skipped).toEqual([]);
  });

  it("play returning {error:'...'} marks that play failed", async () => {
    installFetch(async (url) => {
      if (url === `${BASE_URL}/api/flows/demo-1`) {
        return jsonResponse(
          demoFixture({
            nodes: [
              {
                id: 'p1',
                type: 'playNode',
                data: {
                  playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'play/p1.ts' },
                },
              },
            ],
          }),
        );
      }
      if (url === `${BASE_URL}/api/flows/demo-1/play/p1`) {
        return jsonResponse({
          runId: 'run-x',
          error: 'script exited with code 1',
        });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const report = await validateEndToEnd({
      flowId: 'demo-1',
      url: BASE_URL,
      statusWaitMs: 100,
    });

    expect(report.ok).toBe(false);
    expect(report.plays).toHaveLength(1);
    expect(report.plays[0]?.outcome).toBe('failed');
    expect(report.plays[0]?.runId).toBe('run-x');
    expect(report.plays[0]?.body).toEqual({
      runId: 'run-x',
      error: 'script exited with code 1',
    });
    expect(report.statuses).toEqual([]);
  });

  it('status timeout marks that status failed', async () => {
    installFetch(async (url) => {
      if (url === `${BASE_URL}/api/flows/demo-1`) {
        return jsonResponse(
          demoFixture({
            nodes: [
              {
                id: 'p1',
                type: 'playNode',
                data: {
                  playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'play/p1.ts' },
                  statusAction: {
                    kind: 'script',
                    interpreter: 'bun',
                    scriptPath: 'status/p1.ts',
                  },
                },
              },
            ],
          }),
        );
      }
      if (url === `${BASE_URL}/api/flows/demo-1/play/p1`) {
        return jsonResponse({ runId: 'run-1', status: 200, body: { ok: true } });
      }
      if (url === `${BASE_URL}/api/events?flowId=demo-1`) {
        // hello only — never sends a node:status event for p1
        return sseResponse([{ event: 'hello', data: { flowId: 'demo-1' } }]);
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const report = await validateEndToEnd({
      flowId: 'demo-1',
      url: BASE_URL,
      statusWaitMs: 100,
    });

    expect(report.ok).toBe(false);
    expect(report.plays[0]?.outcome).toBe('ok');
    expect(report.statuses).toHaveLength(1);
    expect(report.statuses[0]?.outcome).toBe('failed');
    expect(report.statuses[0]?.error).toBeDefined();
  });

  it('validationSafe:false skips the play', async () => {
    let playRequested = 0;
    installFetch(async (url) => {
      if (url === `${BASE_URL}/api/flows/demo-1`) {
        return jsonResponse(
          demoFixture({
            nodes: [
              {
                id: 'p-unsafe',
                type: 'playNode',
                data: {
                  playAction: {
                    kind: 'script',
                    interpreter: 'bun',
                    scriptPath: 'play/unsafe.ts',
                    validationSafe: false,
                  },
                },
              },
              {
                id: 'p-safe',
                type: 'playNode',
                data: {
                  playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'play/safe.ts' },
                },
              },
            ],
          }),
        );
      }
      if (url.startsWith(`${BASE_URL}/api/flows/demo-1/play/`)) {
        playRequested += 1;
        return jsonResponse({ runId: 'r', status: 200, body: { ok: true } });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const report = await validateEndToEnd({
      flowId: 'demo-1',
      url: BASE_URL,
      statusWaitMs: 100,
    });

    expect(report.ok).toBe(true);
    expect(playRequested).toBe(1);
    expect(report.plays).toHaveLength(1);
    expect(report.plays[0]?.nodeId).toBe('p-safe');
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]).toEqual({
      nodeId: 'p-unsafe',
      reason: 'playAction.validationSafe is false',
    });
  });

  it('marks failure when GET /api/flows returns valid:false', async () => {
    installFetch(async (url) => {
      if (url === `${BASE_URL}/api/flows/demo-1`) {
        return jsonResponse({
          id: 'demo-1',
          valid: false,
          error: 'nodes.0.data.name: too short',
          demo: null,
        });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const report = await validateEndToEnd({
      flowId: 'demo-1',
      url: BASE_URL,
      statusWaitMs: 100,
    });

    expect(report.ok).toBe(false);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]?.nodeId).toBe('<demo>');
    expect(report.skipped[0]?.reason).toContain('not valid');
  });

  it('marks failure when GET /api/flows returns a non-2xx status', async () => {
    installFetch(async (url) => {
      if (url === `${BASE_URL}/api/flows/missing`) {
        return jsonResponse({ error: 'not found' }, 404);
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });
    const report = await validateEndToEnd({
      flowId: 'missing',
      url: BASE_URL,
      statusWaitMs: 100,
    });
    expect(report.ok).toBe(false);
    expect(report.skipped[0]?.reason).toContain('404');
  });

  it('ignores node:status events for unrelated nodeIds', async () => {
    installFetch(async (url) => {
      if (url === `${BASE_URL}/api/flows/demo-1`) {
        return jsonResponse(
          demoFixture({
            nodes: [
              {
                id: 'p1',
                type: 'playNode',
                data: {
                  playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'p.ts' },
                  statusAction: { kind: 'script', interpreter: 'bun', scriptPath: 's.ts' },
                },
              },
            ],
          }),
        );
      }
      if (url === `${BASE_URL}/api/flows/demo-1/play/p1`) {
        return jsonResponse({ runId: 'r', status: 200, body: {} });
      }
      if (url === `${BASE_URL}/api/events?flowId=demo-1`) {
        return sseResponse([
          { event: 'hello', data: { flowId: 'demo-1' } },
          { event: 'node:status', data: { nodeId: 'other-node', state: 'ok' } },
          { event: 'node:status', data: { nodeId: 'p1', state: 'error', summary: 'fail' } },
          { event: 'node:status', data: { nodeId: 'p1', state: 'pending', summary: 'pending' } },
        ]);
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const report = await validateEndToEnd({
      flowId: 'demo-1',
      url: BASE_URL,
      statusWaitMs: 500,
    });

    // first non-error report (pending) should pass the status check
    expect(report.statuses).toHaveLength(1);
    expect(report.statuses[0]?.outcome).toBe('ok');
    expect(report.statuses[0]?.firstReport?.state).toBe('pending');
  });
});

describe('validate-end-to-end main()', () => {
  it('exits 0 and prints the report JSON on success', async () => {
    installFetch(async (url) => {
      if (url.endsWith('/api/flows/demo-1')) {
        return jsonResponse(
          demoFixture({
            nodes: [
              {
                id: 'p1',
                type: 'playNode',
                data: {
                  playAction: { kind: 'script', interpreter: 'bun', scriptPath: 'p.ts' },
                },
              },
            ],
          }),
        );
      }
      if (url.endsWith('/api/flows/demo-1/play/p1')) {
        return jsonResponse({ runId: 'r-1', status: 200, body: { ok: true } });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(['demo-1']);
      expect(code).toBe(0);
    } finally {
      process.stdout.write = origWrite;
    }
    const printed = stdoutChunks.join('').trim();
    const report = JSON.parse(printed);
    expect(report.ok).toBe(true);
    expect(report.plays).toHaveLength(1);
    expect(report.plays[0].outcome).toBe('ok');
  });

  it('exits 1 and prints usage when flowId is missing', async () => {
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
