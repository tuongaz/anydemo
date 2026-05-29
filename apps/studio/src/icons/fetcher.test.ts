import { describe, expect, it } from 'bun:test';
import { fetchWithProgress } from './fetcher.ts';

function streamingResponse(chunks: Uint8Array[], init?: ResponseInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, init);
}

describe('fetchWithProgress', () => {
  it('reassembles the body in order and reports cumulative progress', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const progress: number[] = [];
    const buffer = await fetchWithProgress('https://example.test/pack.zip', {
      onProgress: (n) => progress.push(n),
      fetchFn: async () => streamingResponse(chunks),
    });
    expect(Array.from(buffer)).toEqual([1, 2, 3, 4, 5]);
    expect(progress).toEqual([3, 5]);
  });

  it('throws when the response is not ok', async () => {
    await expect(
      fetchWithProgress('https://example.test/pack.zip', {
        fetchFn: async () => new Response('nope', { status: 404, statusText: 'Not Found' }),
      }),
    ).rejects.toThrow(/404/);
  });

  it('throws when the response has no body', async () => {
    await expect(
      fetchWithProgress('https://example.test/pack.zip', {
        fetchFn: async () => {
          const res = new Response(null, { status: 204 });
          return res;
        },
      }),
    ).rejects.toThrow(/no body/);
  });

  it('works without an onProgress callback', async () => {
    const buffer = await fetchWithProgress('https://example.test/pack.zip', {
      fetchFn: async () => streamingResponse([new Uint8Array([9, 9])]),
    });
    expect(Array.from(buffer)).toEqual([9, 9]);
  });
});
