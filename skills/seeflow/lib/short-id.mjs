#!/usr/bin/env node
// Canonical id generator for the seeflow skill. Mirrors
// apps/studio/src/short-id.ts so skill-minted ids match the shape every
// other producer in the studio (canvas, nodes:add-bulk auto-assign, the
// upload endpoint's regex). Same alphabet (62 base62 chars), same default
// length (10), same rejection sampling.
//
// Usage (called from the orchestrator's Bash):
//   node skills/seeflow/lib/short-id.mjs <count> [prefix]
// Prints `count` ids, one per line. If `prefix` is given it is prepended
// to each id (typically `node-` or `conn-`).
//
// `.mjs` is unambiguous ESM regardless of any enclosing package.json — the
// skill runs from arbitrary user projects, so we don't get to rely on the
// host's module resolution.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UNBIASED_MAX = 248;

export function shortId(len = 10) {
  let out = '';
  const buf = new Uint8Array(len * 2);
  while (out.length < len) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < len; i++) {
      const b = buf[i];
      if (b < UNBIASED_MAX) out += ALPHABET[b % 62];
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const count = Number.parseInt(process.argv[2] ?? '1', 10);
  const prefix = process.argv[3] ?? '';
  if (!Number.isFinite(count) || count < 1) {
    process.stderr.write('Usage: short-id.mjs <count> [prefix]\n');
    process.exit(2);
  }
  for (let i = 0; i < count; i++) process.stdout.write(`${prefix}${shortId()}\n`);
}
