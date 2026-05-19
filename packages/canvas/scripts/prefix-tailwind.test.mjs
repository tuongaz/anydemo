// Tests for the v4 `sf:` prefix codemod. Run with `bun test`.
//
// NOTE on v4 ordering: Tailwind v4 with `@import "tailwindcss" prefix(sf);`
// emits classes in PREFIX-FIRST form. The whole token — variants chain plus
// utility base plus any `-` / `!` modifiers — is preserved verbatim and `sf:`
// is prepended to the front. So:
//   v3:                       v4 (this codemod's output):
//   `sf-flex`                 `sf:flex`
//   `hover:sf-bg-card`        `sf:hover:bg-card`
//   `data-[state=open]:sf-x`  `sf:data-[state=open]:x`
//
// The PRD US-002 acceptance criteria asks for prefix-AFTER-variant ordering
// (e.g. `hover:sf:bg-card`). That is incorrect for Tailwind v4 and the
// upgrade tool itself produces prefix-first output (recorded in
// progress.txt's Codebase Patterns). These tests assert the v4-correct
// prefix-first form.

import { describe, expect, it } from 'bun:test';
import {
  isTailwindToken,
  prefixString,
  prefixToken,
  stripLegacySfDash,
  transformSource,
} from './prefix-tailwind.mjs';

describe('prefixToken — v4 prefix-first ordering', () => {
  it('prepends sf: to a bare utility', () => {
    expect(prefixToken('flex')).toBe('sf:flex');
    expect(prefixToken('p-2')).toBe('sf:p-2');
    expect(prefixToken('bg-card')).toBe('sf:bg-card');
  });

  it('preserves variant chains and prepends sf: at the front', () => {
    expect(prefixToken('hover:bg-card')).toBe('sf:hover:bg-card');
    expect(prefixToken('dark:text-foreground')).toBe('sf:dark:text-foreground');
    expect(prefixToken('focus-visible:ring-2')).toBe('sf:focus-visible:ring-2');
  });

  it('preserves data-attribute variants verbatim', () => {
    expect(prefixToken('data-[state=open]:animate-in')).toBe('sf:data-[state=open]:animate-in');
    expect(prefixToken('data-[side=bottom]:slide-in-from-top-2')).toBe(
      'sf:data-[side=bottom]:slide-in-from-top-2',
    );
  });

  it('preserves `!` important modifier on the base', () => {
    expect(prefixToken('!opacity-100')).toBe('sf:!opacity-100');
    expect(prefixToken('hover:!opacity-100')).toBe('sf:hover:!opacity-100');
  });

  it('preserves `-` negative modifier on the base', () => {
    expect(prefixToken('-mx-1')).toBe('sf:-mx-1');
    expect(prefixToken('-top-2')).toBe('sf:-top-2');
  });

  it('migrates v3 legacy `sf-` splices to v4 `sf:`', () => {
    expect(prefixToken('sf-flex')).toBe('sf:flex');
    expect(prefixToken('hover:sf-bg-card')).toBe('sf:hover:bg-card');
    expect(prefixToken('data-[state=open]:sf-animate-in')).toBe('sf:data-[state=open]:animate-in');
    expect(prefixToken('!sf-flex')).toBe('sf:!flex');
    expect(prefixToken('-sf-mx-4')).toBe('sf:-mx-4');
  });

  it('is idempotent — second pass yields the same output', () => {
    const inputs = [
      'flex',
      'hover:bg-card',
      'data-[state=open]:animate-in',
      '!opacity-100',
      '-mx-1',
      'sf-flex',
      'hover:sf-bg-card',
      'data-[state=open]:sf-animate-in',
    ];
    for (const input of inputs) {
      const once = prefixToken(input);
      const twice = prefixToken(once);
      expect(twice).toBe(once);
    }
  });

  it('leaves non-Tailwind tokens alone', () => {
    expect(prefixToken('seeflow-canvas-root')).toBe('seeflow-canvas-root');
    expect(prefixToken('react-flow__node')).toBe('react-flow__node');
    expect(prefixToken('animate-ping-fast')).toBe('animate-ping-fast');
  });
});

describe('isTailwindToken', () => {
  it('detects bare utilities', () => {
    expect(isTailwindToken('flex')).toBe(true);
    expect(isTailwindToken('p-2')).toBe(true);
    expect(isTailwindToken('bg-card')).toBe(true);
  });

  it('detects v4 sf:-prefixed tokens as Tailwind', () => {
    expect(isTailwindToken('sf:flex')).toBe(true);
    expect(isTailwindToken('sf:hover:bg-card')).toBe(true);
    expect(isTailwindToken('sf:data-[state=open]:animate-in')).toBe(true);
  });

  it('detects v3 legacy sf--prefixed tokens as Tailwind', () => {
    expect(isTailwindToken('sf-flex')).toBe(true);
    expect(isTailwindToken('hover:sf-bg-card')).toBe(true);
  });

  it('rejects known non-Tailwind class names', () => {
    expect(isTailwindToken('seeflow-canvas-root')).toBe(false);
    expect(isTailwindToken('react-flow__node')).toBe(false);
    expect(isTailwindToken('animate-ping-fast')).toBe(false);
  });
});

describe('stripLegacySfDash', () => {
  it('strips `sf-` from bare tokens', () => {
    expect(stripLegacySfDash('sf-flex')).toBe('flex');
  });

  it('strips `sf-` from after a variant chain', () => {
    expect(stripLegacySfDash('hover:sf-bg-card')).toBe('hover:bg-card');
    expect(stripLegacySfDash('data-[state=open]:sf-animate-in')).toBe(
      'data-[state=open]:animate-in',
    );
  });

  it('strips `!sf-` keeping the `!` modifier', () => {
    expect(stripLegacySfDash('!sf-opacity-100')).toBe('!opacity-100');
  });

  it('strips `-sf-` keeping the negative modifier', () => {
    expect(stripLegacySfDash('-sf-mx-4')).toBe('-mx-4');
  });

  it('leaves tokens without sf- splice unchanged', () => {
    expect(stripLegacySfDash('flex')).toBe('flex');
    expect(stripLegacySfDash('hover:bg-card')).toBe('hover:bg-card');
  });
});

describe('prefixString — whole class-list transform', () => {
  it('prefixes each token in a space-separated list', () => {
    expect(prefixString('flex p-2 bg-card')).toBe('sf:flex sf:p-2 sf:bg-card');
  });

  it('preserves whitespace between tokens', () => {
    expect(prefixString('flex   p-2')).toBe('sf:flex   sf:p-2');
  });

  it('is idempotent on a fully-prefixed list', () => {
    const input = 'sf:flex sf:p-2 sf:bg-card';
    expect(prefixString(input)).toBe(input);
  });
});

describe('transformSource — string-literal scanning', () => {
  it('rewrites a className with two or more Tailwind tokens', () => {
    const src = `const cls = 'flex p-2 bg-card';`;
    expect(transformSource(src)).toBe(`const cls = 'sf:flex sf:p-2 sf:bg-card';`);
  });

  it('skips string literals that are not class lists', () => {
    const src = `import foo from './bar';\nconst msg = 'hello world';`;
    expect(transformSource(src)).toBe(src);
  });

  it('is idempotent on fully-prefixed source', () => {
    const src = `const cls = 'sf:flex sf:p-2 sf:bg-card';`;
    expect(transformSource(src)).toBe(src);
    expect(transformSource(transformSource(src))).toBe(src);
  });

  it('migrates a v3-style legacy literal in one pass', () => {
    const src = `const cls = 'hover:sf-bg-card data-[state=open]:sf-animate-in';`;
    const expected = `const cls = 'sf:hover:bg-card sf:data-[state=open]:animate-in';`;
    expect(transformSource(src)).toBe(expected);
    // Second pass: no change.
    expect(transformSource(expected)).toBe(expected);
  });
});
