// Codemod: prefix Tailwind utility classes inside string literals with `sf-`.
// Walks .ts/.tsx files matching the glob given on argv[2] and rewrites every
// quoted string literal whose tokens look like Tailwind utilities.
//
// Conservative on plain-word utilities (uses an allowlist). Skips already
// prefixed tokens, known non-Tailwind class names (xyflow / project-scoped),
// and anything that doesn't fit the prefix-value / variant-prefix / arbitrary
// shape.

import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { argv } from 'node:process';

const TARGET = argv[2];
if (!TARGET) {
  console.error('Usage: bun packages/canvas/scripts/prefix-tailwind.mjs <glob>');
  process.exit(1);
}

const KNOWN_NON_TAILWIND = new Set([
  // Project-scoped class names
  'seeflow-canvas-root',
  'seeflow-no-scrollbar',
  'animate-ping-fast',
  'seeflow-node-pulse',
  'inline-edit-shake',
  'inline-edit-empty',
  'seeflow-connector-endpoint-dot',
  'seeflow-connecting',
  // xyflow class names
  'react-flow',
  'react-flow__node',
  'react-flow__node-group',
  'react-flow__node-group-label',
  'react-flow__handle',
  'react-flow__edge',
  'react-flow__edge-path',
  'react-flow__edgeupdater',
  'react-flow__edgelabel-renderer',
  'react-flow__connection-path',
  'react-flow__controls',
  'react-flow__controls-button',
  'react-flow__pane',
  'react-flow__viewport',
  'react-flow__nodes',
  'react-flow__edges',
  'react-flow__nodesselection-rect',
  'react-flow__resize-control',
]);

const TAILWIND_PLAIN_WORDS = new Set([
  'flex', 'inline-flex', 'grid', 'inline-grid', 'block', 'inline', 'inline-block',
  'hidden', 'table', 'contents', 'flow-root', 'list-item',
  'group', 'peer', 'sr-only', 'not-sr-only',
  'truncate', 'italic', 'not-italic', 'antialiased', 'subpixel-antialiased',
  'rounded', 'border', 'ring', 'shadow',
  'absolute', 'relative', 'fixed', 'sticky', 'static',
  'overflow-hidden', 'overflow-auto', 'overflow-visible', 'overflow-scroll',
  'cursor-pointer', 'cursor-default', 'cursor-text', 'cursor-not-allowed',
  'select-none', 'select-text', 'select-all', 'select-auto',
  'pointer-events-none', 'pointer-events-auto',
  'whitespace-nowrap', 'whitespace-pre', 'whitespace-normal',
  'uppercase', 'lowercase', 'capitalize', 'normal-case',
  'underline', 'line-through', 'no-underline',
  'transition', 'transform',
  'outline-none',
  'isolate', 'isolation-auto',
]);

const TAILWIND_PREFIX_PATTERN = /^[a-z]+(-[a-z0-9]+)*$/i;

function isTailwindToken(token) {
  if (!token || token.startsWith('sf-')) return false;
  if (KNOWN_NON_TAILWIND.has(token)) return false;
  const parts = token.split(':');
  const base = parts[parts.length - 1];
  const stripped = base.startsWith('-') ? base.slice(1) : base;
  if (stripped.includes('[')) {
    const head = stripped.slice(0, stripped.indexOf('['));
    return /^-?[a-z]+(-[a-z]+)*-?$/i.test(head);
  }
  if (TAILWIND_PLAIN_WORDS.has(stripped)) return true;
  return TAILWIND_PREFIX_PATTERN.test(stripped) && stripped.includes('-');
}

function prefixToken(token) {
  if (!isTailwindToken(token)) return token;
  const colonIdx = token.lastIndexOf(':');
  if (colonIdx === -1) {
    return token.startsWith('-') ? `-sf${token}` : `sf-${token}`;
  }
  const variants = token.slice(0, colonIdx);
  const base = token.slice(colonIdx + 1);
  const prefixed = base.startsWith('-') ? `-sf${base}` : `sf-${base}`;
  return `${variants}:${prefixed}`;
}

function prefixString(s) {
  return s
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : prefixToken(part)))
    .join('');
}

const STRING_LITERAL_RE = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

function transformFile(path) {
  const src = readFileSync(path, 'utf8');
  const out = src.replace(STRING_LITERAL_RE, (full, quote, body) => {
    const tokens = body.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return full;
    if (!tokens.some(isTailwindToken)) return full;
    const replaced = prefixString(body);
    return `${quote}${replaced}${quote}`;
  });
  if (out !== src) writeFileSync(path, out);
  return out !== src;
}

const files = globSync(TARGET);
let changed = 0;
for (const f of files) {
  if (transformFile(f)) {
    console.log(`  prefixed: ${f}`);
    changed++;
  }
}
console.log(`done — ${changed}/${files.length} files modified`);
