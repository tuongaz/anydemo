// Short unique identifier for nodes, connectors, flow registry entries, and
// runIds. 10 base62 chars (62^10 ≈ 8.4e17 combos) is plenty for our scale and
// keeps URLs / file paths (e.g. `blocks/<id>.html`) readable.
//
// Rejection sampling avoids the modulo bias of `byte % 62`: 256 % 62 = 8, so
// bytes 0..247 map evenly across the 62-char alphabet and 248..255 are
// re-rolled. The oversample factor (×2) makes a second round almost never
// needed in practice.

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
