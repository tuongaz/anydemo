// Codemod: prefix Tailwind utility classes inside string literals with `sf-`.
//
// Walks .ts/.tsx files matching the glob given on argv[2]. Strips line and
// block comments before scanning so unbalanced quotes inside prose
// can't make a string literal swallow the next comment. Then rewrites every
// matched-quote string literal whose tokens look like Tailwind utilities.
//
// To be considered Tailwind, a string must have at least 2 whitespace-separated
// tokens AND every token must either be in TAILWIND_PLAIN_WORDS or start with a
// known Tailwind utility prefix (TAILWIND_PREFIXES). This rejects single-token
// import paths, prose, and hyphenated proper nouns.

import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { argv } from 'node:process';

const TARGET = argv[2];
if (!TARGET) {
  console.error('Usage: bun packages/canvas/scripts/prefix-tailwind.mjs <glob>');
  process.exit(1);
}

const KNOWN_NON_TAILWIND = new Set([
  'seeflow-canvas-root',
  'seeflow-no-scrollbar',
  'animate-ping-fast',
  'seeflow-node-pulse',
  'inline-edit-shake',
  'inline-edit-empty',
  'seeflow-connector-endpoint-dot',
  'seeflow-connecting',
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
  'flex', 'grid', 'block', 'inline', 'hidden', 'table', 'contents',
  'group', 'peer', 'truncate', 'italic', 'antialiased',
  'rounded', 'border', 'ring', 'shadow',
  'absolute', 'relative', 'fixed', 'sticky', 'static',
  'uppercase', 'lowercase', 'capitalize',
  'underline', 'transition', 'transform',
  'isolate', 'visible', 'invisible', 'container',
]);

const TAILWIND_PREFIXES = [
  'bg', 'text', 'font', 'leading', 'tracking', 'indent', 'list', 'decoration',
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe',
  'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me',
  'gap', 'space',
  'h', 'w', 'min', 'max', 'size',
  'top', 'right', 'bottom', 'left', 'inset', 'z', 'order',
  'rounded', 'border', 'divide', 'outline', 'ring',
  'shadow', 'opacity', 'blur', 'brightness', 'contrast',
  'grayscale', 'invert', 'saturate', 'sepia', 'hue',
  'backdrop', 'mix-blend', 'bg-blend',
  'transition', 'duration', 'ease', 'delay', 'animate',
  'translate', 'rotate', 'scale', 'skew', 'origin', 'transform',
  'cursor', 'select', 'resize', 'scroll', 'touch', 'user-select',
  'pointer-events', 'whitespace', 'overflow', 'overscroll',
  'fill', 'stroke',
  'inline-flex', 'inline-grid', 'inline-block',
  'flex', 'grid', 'col', 'row', 'place', 'justify', 'items', 'content', 'self',
  'aspect', 'columns', 'break',
  'hidden', 'visible', 'invisible',
  'isolation', 'isolate',
  'sr-only', 'not-sr-only',
  'caret', 'accent',
  'object',
  'shrink', 'grow', 'basis',
  'truncate', 'line-clamp',
  'underline', 'overline', 'no-underline', 'line-through',
  'italic', 'not-italic',
  'antialiased', 'subpixel-antialiased',
  'normal-nums', 'tabular-nums', 'ordinal',
  'uppercase', 'lowercase', 'capitalize', 'normal-case',
  'will-change',
  'appearance',
  'placeholder',
];

const PREFIX_PATTERN = new RegExp(
  `^(?:${TAILWIND_PREFIXES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:-|$|\\[)`,
);

function isTailwindToken(token) {
  if (!token || token.startsWith('sf-')) return false;
  if (KNOWN_NON_TAILWIND.has(token)) return false;
  const colonIdx = token.lastIndexOf(':');
  let base = colonIdx === -1 ? token : token.slice(colonIdx + 1);
  if (base.startsWith('-')) base = base.slice(1);
  if (!base) return false;
  if (TAILWIND_PLAIN_WORDS.has(base)) return true;
  if (base.includes('[')) {
    return PREFIX_PATTERN.test(base);
  }
  return PREFIX_PATTERN.test(base);
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

// Replace line/block comments with whitespace of matching length so source
// offsets are preserved when we later splice edits into the original.
function stripComments(src) {
  let i = 0;
  const out = [];
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      out.push(' '); out.push(' ');
      i += 2;
      while (i < src.length && src[i] !== '\n') {
        out.push(' ');
        i++;
      }
    } else if (ch === '/' && next === '*') {
      out.push(' '); out.push(' ');
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < src.length) {
        out.push(' '); out.push(' ');
        i += 2;
      }
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out.push(ch);
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) {
          out.push(src[i]); out.push(src[i + 1]);
          i += 2;
        } else {
          out.push(src[i]);
          i++;
        }
      }
      if (i < src.length) {
        out.push(src[i]);
        i++;
      }
    } else {
      out.push(ch);
      i++;
    }
  }
  return out.join('');
}

const STRING_LITERAL_RE = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

function transformFile(path) {
  const src = readFileSync(path, 'utf8');
  const stripped = stripComments(src);
  const edits = [];
  STRING_LITERAL_RE.lastIndex = 0;
  let m;
  while ((m = STRING_LITERAL_RE.exec(stripped)) !== null) {
    const body = m[2];
    if (body.includes('\n')) continue;
    const tokens = body.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;
    if (!tokens.every(isTailwindToken)) continue;
    const start = m.index + 1;
    const end = start + body.length;
    const replaced = prefixString(body);
    if (replaced !== body) edits.push({ start, end, replaced });
  }
  if (edits.length === 0) return false;
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.replaced + out.slice(e.end);
  }
  writeFileSync(path, out);
  return true;
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
