export interface FetchWithProgressOptions {
  onProgress?: (receivedBytes: number) => void;
  fetchFn?: (url: string) => Promise<Response>;
}

export async function fetchWithProgress(
  url: string,
  opts: FetchWithProgressOptions = {},
): Promise<Buffer> {
  const fetchFn = opts.fetchFn ?? ((u: string) => fetch(u));
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error(`fetch ${url} returned no body`);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.byteLength;
    opts.onProgress?.(received);
  }
  return Buffer.concat(chunks);
}
