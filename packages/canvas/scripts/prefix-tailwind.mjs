// Codemod: prepend the Tailwind v4 namespace prefix `sf:` to utility classes
// inside string literals.
//
// Walks .ts/.tsx files matching the glob given on argv[2]. Strips line and
// block comments before scanning so unbalanced quotes inside prose can't make a
// string literal swallow the next comment. Then rewrites every matched-quote
// string literal whose tokens look like Tailwind utilities.
//
// Tailwind v4 with `@import "tailwindcss" prefix(sf);` emits class names in
// PREFIX-FIRST ordering: `sf:hover:bg-card`, `sf:data-[state=open]:animate-in`,
// `sf:-mx-1`, `sf:!opacity-100`. The whole token (variants + base, including
// any `-` / `!` modifiers) is preserved verbatim; only `sf:` is prepended.
//
// The script is idempotent: tokens already starting with `sf:` are returned
// unchanged. Legacy v3 leftovers (`sf-flex`, `hover:sf-bg-card`, `!sf-flex`,
// `-sf-mx-4`) are normalised by stripping the `sf-` splice and then prepending
// the v4 `sf:` prefix.
//
// To be considered Tailwind, a string must have at least 2 whitespace-separated
// tokens AND every token must either be in TAILWIND_PLAIN_WORDS or start with a
// known Tailwind utility prefix (TAILWIND_PREFIXES). This rejects single-token
// import paths, prose, and hyphenated proper nouns.

import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';

const KNOWN_NON_TAILWIND = new Set([
  'seeflow-canvas-root',
  'seeflow-no-scrollbar',
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
  'flex',
  'grid',
  'block',
  'inline',
  'hidden',
  'table',
  'contents',
  'group',
  'peer',
  'truncate',
  'italic',
  'antialiased',
  'rounded',
  'border',
  'ring',
  'shadow',
  'absolute',
  'relative',
  'fixed',
  'sticky',
  'static',
  'uppercase',
  'lowercase',
  'capitalize',
  'underline',
  'transition',
  'transform',
  'isolate',
  'visible',
  'invisible',
  'container',
]);

const TAILWIND_PREFIXES = [
  'bg',
  'text',
  'font',
  'leading',
  'tracking',
  'indent',
  'list',
  'decoration',
  'p',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'ps',
  'pe',
  'm',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'ms',
  'me',
  'gap',
  'space',
  'h',
  'w',
  'min',
  'max',
  'size',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'z',
  'order',
  'rounded',
  'border',
  'divide',
  'outline',
  'ring',
  'shadow',
  'opacity',
  'blur',
  'brightness',
  'contrast',
  'grayscale',
  'invert',
  'saturate',
  'sepia',
  'hue',
  'backdrop',
  'mix-blend',
  'bg-blend',
  'transition',
  'duration',
  'ease',
  'delay',
  'animate',
  'translate',
  'rotate',
  'scale',
  'skew',
  'origin',
  'transform',
  'cursor',
  'select',
  'resize',
  'scroll',
  'touch',
  'user-select',
  'pointer-events',
  'whitespace',
  'overflow',
  'overscroll',
  'fill',
  'stroke',
  'inline-flex',
  'inline-grid',
  'inline-block',
  'flex',
  'grid',
  'col',
  'row',
  'place',
  'justify',
  'items',
  'content',
  'self',
  'aspect',
  'columns',
  'break',
  'hidden',
  'visible',
  'invisible',
  'isolation',
  'isolate',
  'sr-only',
  'not-sr-only',
  'caret',
  'accent',
  'object',
  'shrink',
  'grow',
  'basis',
  'truncate',
  'line-clamp',
  'underline',
  'overline',
  'no-underline',
  'line-through',
  'italic',
  'not-italic',
  'antialiased',
  'subpixel-antialiased',
  'normal-nums',
  'tabular-nums',
  'ordinal',
  'uppercase',
  'lowercase',
  'capitalize',
  'normal-case',
  'will-change',
  'appearance',
  'placeholder',
  // Animation utilities used by tailwindcss-animate.
  'slide',
  'fade',
  'zoom',
  'spin',
  'ping',
  'pulse',
  'bounce',
  // Filter utilities.
  'drop-shadow',
];

const PREFIX_PATTERN = new RegExp(
  `^(?:${TAILWIND_PREFIXES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:-|$|\\[)`,
);

// Strip any v3 legacy `sf-` splice from a token's base, leaving the underlying
// utility intact. Variants (`hover:`, `data-[state=*]:`, ...) and the `!` /
// `-` modifier signs are preserved.
export function stripLegacySfDash(token) {
  const colonIdx = token.lastIndexOf(':');
  const variants = colonIdx === -1 ? '' : token.slice(0, colonIdx + 1);
  let base = colonIdx === -1 ? token : token.slice(colonIdx + 1);
  if (base.startsWith('!sf-')) base = `!${base.slice(4)}`;
  else if (base.startsWith('-sf-')) base = `-${base.slice(4)}`;
  else if (base.startsWith('sf-')) base = base.slice(3);
  return variants + base;
}

export function isTailwindToken(token) {
  if (!token) return false;
  if (KNOWN_NON_TAILWIND.has(token)) return false;
  // Normalise: strip v4 `sf:` prefix and any v3 `sf-` splice so we can inspect
  // the underlying utility base.
  let normalized = token.startsWith('sf:') ? token.slice(3) : token;
  normalized = stripLegacySfDash(normalized);
  const colonIdx = normalized.lastIndexOf(':');
  let base = colonIdx === -1 ? normalized : normalized.slice(colonIdx + 1);
  if (base.startsWith('-')) base = base.slice(1);
  if (base.startsWith('!')) base = base.slice(1);
  if (!base) return false;
  if (TAILWIND_PLAIN_WORDS.has(base)) return true;
  return PREFIX_PATTERN.test(base);
}

// Prepend the v4 `sf:` namespace prefix to a token. Idempotent: tokens already
// starting with `sf:` are returned unchanged. Legacy v3 `sf-` splices are
// normalised before the prefix is prepended.
export function prefixToken(token) {
  if (token.startsWith('sf:')) return token;
  if (!isTailwindToken(token)) return token;
  return `sf:${stripLegacySfDash(token)}`;
}

export function prefixString(s) {
  return s
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : prefixToken(part)))
    .join('');
}

// Replace line/block comments with whitespace of matching length so source
// offsets are preserved when we later splice edits into the original.
export function stripComments(src) {
  let i = 0;
  const out = [];
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      out.push(' ');
      out.push(' ');
      i += 2;
      while (i < src.length && src[i] !== '\n') {
        out.push(' ');
        i++;
      }
    } else if (ch === '/' && next === '*') {
      out.push(' ');
      out.push(' ');
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < src.length) {
        out.push(' ');
        out.push(' ');
        i += 2;
      }
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out.push(ch);
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) {
          out.push(src[i]);
          out.push(src[i + 1]);
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

export function transformSource(src) {
  const stripped = stripComments(src);
  const edits = [];
  STRING_LITERAL_RE.lastIndex = 0;
  for (;;) {
    const m = STRING_LITERAL_RE.exec(stripped);
    if (m === null) break;
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
  if (edits.length === 0) return src;
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.replaced + out.slice(e.end);
  }
  return out;
}

export function transformFile(path) {
  const src = readFileSync(path, 'utf8');
  const out = transformSource(src);
  if (out === src) return false;
  writeFileSync(path, out);
  return true;
}

if (import.meta.main) {
  const TARGET = argv[2];
  if (!TARGET) {
    console.error('Usage: bun packages/canvas/scripts/prefix-tailwind.mjs <glob>');
    process.exit(1);
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
}
