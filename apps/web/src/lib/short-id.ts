// Browser twin of apps/studio/src/short-id.ts — same alphabet, same length,
// same rejection-sampling rule so canvas-generated IDs are indistinguishable
// from studio-generated ones on the wire.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UNBIASED_MAX = 248; // floor(256 / 62) * 62

export function shortId(len = 10): string {
  let out = '';
  const buf = new Uint8Array(len * 2);
  while (out.length < len) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < len; i++) {
      const b = buf[i] as number;
      if (b < UNBIASED_MAX) out += ALPHABET[b % 62];
    }
  }
  return out;
}
