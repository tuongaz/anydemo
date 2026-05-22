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

// Public id-type vocabulary shared by the CLI (`seeflow ids`), the REST API
// (`GET /api/ids/:type/:count`), and the MCP tool (`seeflow_ids`). Internal
// prefix `conn-` stays canonical (operations.ts mints connectors as
// `conn-…`); the friendlier word `connector` is what callers pass.
export const ID_TYPES = ['node', 'connector'] as const;
export type IdType = (typeof ID_TYPES)[number];

export const ID_PREFIX_BY_TYPE: Record<IdType, string> = {
  node: 'node-',
  connector: 'conn-',
};

export const MAX_ID_COUNT = 100;

export const isIdType = (v: unknown): v is IdType =>
  typeof v === 'string' && (ID_TYPES as readonly string[]).includes(v);

export function generateIds(type: IdType, count: number): string[] {
  const prefix = ID_PREFIX_BY_TYPE[type];
  const out: string[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = `${prefix}${shortId()}`;
  return out;
}
