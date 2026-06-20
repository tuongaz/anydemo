import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { __clearFileSrcCache, resolveFileSrc } from './file-src-resolver.ts';

// The resolver calls apiFetch, which in tests (NullAuthProvider → no token)
// is a plain `fetch` passthrough. So we stub the global `fetch` rather than
// mocking the api-client module — module mocks leak across test files in the
// same process and would break api-client's own tests.

let fetchCalls = 0;
let nextStatus = 200;
const origFetch = globalThis.fetch;
globalThis.fetch = (async (_input: string | URL | Request) => {
  fetchCalls += 1;
  return {
    ok: nextStatus >= 200 && nextStatus < 300,
    status: nextStatus,
    blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  } as unknown as Response;
}) as typeof fetch;

// Node's URL class has no createObjectURL — patch the two statics and restore
// them after so we don't clobber the global URL for other test files.
let objId = 0;
const revoked: string[] = [];
const urlCtor = globalThis.URL as unknown as {
  createObjectURL?: (b: Blob) => string;
  revokeObjectURL?: (u: string) => void;
};
const origCreate = urlCtor.createObjectURL;
const origRevoke = urlCtor.revokeObjectURL;
urlCtor.createObjectURL = () => `blob:test-${++objId}`;
urlCtor.revokeObjectURL = (u: string) => {
  revoked.push(u);
};

afterAll(() => {
  globalThis.fetch = origFetch;
  urlCtor.createObjectURL = origCreate;
  urlCtor.revokeObjectURL = origRevoke;
});

beforeEach(() => {
  fetchCalls = 0;
  nextStatus = 200;
  revoked.length = 0;
  __clearFileSrcCache();
});

describe('resolveFileSrc', () => {
  it('fetches the asset and returns a blob URL', async () => {
    const src = await resolveFileSrc('/api/projects/p1/files/a.png');
    expect(src.startsWith('blob:')).toBe(true);
    expect(fetchCalls).toBe(1);
  });

  it('caches the blob URL so a second call within the TTL does not refetch', async () => {
    const first = await resolveFileSrc('/api/projects/p1/files/a.png');
    const second = await resolveFileSrc('/api/projects/p1/files/a.png');
    expect(second).toBe(first);
    expect(fetchCalls).toBe(1);
  });

  it('dedupes concurrent calls for the same url onto one fetch', async () => {
    const [a, b] = await Promise.all([
      resolveFileSrc('/api/projects/p1/files/a.png'),
      resolveFileSrc('/api/projects/p1/files/a.png'),
    ]);
    expect(a).toBe(b);
    expect(fetchCalls).toBe(1);
  });

  it('throws on a non-ok response and does not cache the failure', async () => {
    nextStatus = 500;
    await expect(resolveFileSrc('/api/projects/p1/files/a.png')).rejects.toThrow();
    // A later success refetches (the failed entry was cleared).
    nextStatus = 200;
    const src = await resolveFileSrc('/api/projects/p1/files/a.png');
    expect(src.startsWith('blob:')).toBe(true);
    expect(fetchCalls).toBe(2);
  });

  it('revokes cached blob URLs on clear', async () => {
    const src = await resolveFileSrc('/api/projects/p1/files/a.png');
    __clearFileSrcCache();
    expect(revoked).toContain(src);
  });
});
