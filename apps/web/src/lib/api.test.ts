import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { openProjectFile, revealProjectFile } from '@/lib/api';

// US-018: pin the request/response contract for the two project-file shell-
// out helpers. Both POST to /api/projects/:id/files/<action>, send
// `{ path }`, and return `{ ok, absPath, error? }` — including the
// soft-fail (200 ok:false) and 404-missing branches that the detail panel
// translates into a copy-path-to-clipboard fallback.
type RecordedRequest = {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
};

const realFetch = globalThis.fetch;
let recorded: RecordedRequest[] = [];
let nextResponse: { status: number; body: unknown } = { status: 200, body: { ok: true } };

const installMockFetch = () => {
  recorded = [];
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers ?? {};
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [k, v] of rawHeaders) headers[k.toLowerCase()] = v;
    } else {
      for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = String(v);
    }
    const rawBody = init?.body;
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    recorded.push({ url, method: init?.method, headers, body });
    return new Response(JSON.stringify(nextResponse.body), {
      status: nextResponse.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
};

beforeEach(() => {
  installMockFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('openProjectFile (US-018)', () => {
  it('POSTs JSON to /api/projects/:id/files/open with the path body', async () => {
    nextResponse = { status: 200, body: { ok: true, absPath: '/abs/blocks/x.html' } };
    const result = await openProjectFile('project-1', 'blocks/x.html');
    expect(recorded).toHaveLength(1);
    const req = recorded[0];
    expect(req?.url).toBe('/api/projects/project-1/files/open');
    expect(req?.method).toBe('POST');
    expect(req?.headers['content-type']).toBe('application/json');
    expect(req?.body).toEqual({ path: 'blocks/x.html' });
    expect(result).toEqual({ ok: true, absPath: '/abs/blocks/x.html', error: undefined });
  });

  it('URL-encodes the projectId so slashes / spaces survive the segment cleanly', async () => {
    nextResponse = { status: 200, body: { ok: true, absPath: '/abs/x.html' } };
    await openProjectFile('project with space/and-slash', 'blocks/x.html');
    expect(recorded[0]?.url).toBe('/api/projects/project%20with%20space%2Fand-slash/files/open');
  });

  it('resolves with ok:false + absPath when the backend soft-fails (EDITOR unset / spawn fail)', async () => {
    // The backend returns 200 OK with ok:false in this branch — the spawn
    // didn't crash the request, the editor just couldn't launch. Helper must
    // surface the envelope to the caller so the UI can fall back to copying
    // absPath to the clipboard.
    nextResponse = {
      status: 200,
      body: { ok: false, absPath: '/abs/blocks/x.html', error: 'EDITOR not set' },
    };
    const result = await openProjectFile('project-1', 'blocks/x.html');
    expect(result).toEqual({
      ok: false,
      absPath: '/abs/blocks/x.html',
      error: 'EDITOR not set',
    });
  });

  it('resolves with ok:false + absPath on a 404 missing-file soft-fail', async () => {
    nextResponse = {
      status: 404,
      body: { error: 'file not found', absPath: '/abs/blocks/missing.html' },
    };
    const result = await openProjectFile('project-1', 'blocks/missing.html');
    expect(result).toEqual({
      ok: false,
      absPath: '/abs/blocks/missing.html',
      error: 'file not found',
    });
  });

  it('throws on a 400 path-validation rejection (no absPath to fall back to)', async () => {
    nextResponse = { status: 400, body: { error: 'absolute paths not allowed' } };
    await expect(openProjectFile('project-1', '/etc/passwd')).rejects.toThrow(
      'absolute paths not allowed',
    );
  });

  it('throws on a 404 unknown-project response (no absPath body)', async () => {
    nextResponse = { status: 404, body: { error: 'unknown project' } };
    await expect(openProjectFile('does-not-exist', 'blocks/x.html')).rejects.toThrow(
      'unknown project',
    );
  });
});

describe('revealProjectFile (US-018)', () => {
  it('POSTs to /api/projects/:id/files/reveal with the path body', async () => {
    nextResponse = { status: 200, body: { ok: true, absPath: '/abs/blocks/x.html' } };
    const result = await revealProjectFile('project-1', 'blocks/x.html');
    const req = recorded[0];
    expect(req?.url).toBe('/api/projects/project-1/files/reveal');
    expect(req?.method).toBe('POST');
    expect(req?.body).toEqual({ path: 'blocks/x.html' });
    expect(result.ok).toBe(true);
    expect(result.absPath).toBe('/abs/blocks/x.html');
  });

  it('mirrors the soft-fail envelope from /files/open', async () => {
    // Reveal soft-fails the same way as open — same response shape — so the
    // helper should pass through the envelope identically.
    nextResponse = {
      status: 200,
      body: { ok: false, absPath: '/abs/blocks/x.html', error: 'spawn failed' },
    };
    const result = await revealProjectFile('project-1', 'blocks/x.html');
    expect(result).toEqual({
      ok: false,
      absPath: '/abs/blocks/x.html',
      error: 'spawn failed',
    });
  });
});
