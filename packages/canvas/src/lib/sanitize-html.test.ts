import { describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';

// Install a happy-dom Window's DOMParser on globalThis BEFORE the helper is
// imported so its `typeof DOMParser` check resolves to the browser-like impl.
// Bun's runtime does not ship a DOMParser; happy-dom provides the realistic
// HTML parser surface (TreeWalker, Element.attributes, removeAttribute, ...).
const window = new Window();
(globalThis as { DOMParser?: unknown }).DOMParser = window.DOMParser;

const { sanitizeHtml } = await import('./sanitize-html.ts');

describe('sanitizeHtml (US-013) — dangerous element stripping', () => {
  it('removes <script> elements and their contents', () => {
    const out = sanitizeHtml('<p>hello</p><script>alert(1)</script><p>world</p>');
    expect(out).toBe('<p>hello</p><p>world</p>');
  });

  it('removes <style> elements and their contents', () => {
    const out = sanitizeHtml('<p>before</p><style>.x{color:red}</style><p>after</p>');
    expect(out).toBe('<p>before</p><p>after</p>');
  });

  it('removes <iframe>, <object>, <embed>, <link> elements', () => {
    const out = sanitizeHtml(
      '<p>a</p><iframe src="x"></iframe><object data="y"></object><embed src="z"><link rel="stylesheet" href="w.css"><p>b</p>',
    );
    expect(out).toBe('<p>a</p><p>b</p>');
  });

  it('removes the entire subtree of a dangerous element', () => {
    const out = sanitizeHtml(
      '<iframe><p>inside iframe</p><span>nested</span></iframe><p>outside</p>',
    );
    expect(out).toBe('<p>outside</p>');
  });

  it('removes multiple sibling and nested dangerous elements', () => {
    const out = sanitizeHtml(
      '<div><script>1</script><p>safe<script>2</script></p><style>x</style></div>',
    );
    expect(out).toBe('<div><p>safe</p></div>');
  });

  it('treats uppercase and mixed-case dangerous tags the same', () => {
    const out = sanitizeHtml('<SCRIPT>x</SCRIPT><IfRaMe></IfRaMe><p>ok</p>');
    expect(out).toBe('<p>ok</p>');
  });
});

describe('sanitizeHtml (US-013) — event-handler attribute stripping', () => {
  it('strips a single on* attribute', () => {
    const out = sanitizeHtml('<button onclick="alert(1)">click</button>');
    expect(out).toBe('<button>click</button>');
  });

  it('strips every on* attribute, leaving safe attributes', () => {
    const out = sanitizeHtml(
      '<a href="/safe" onclick="x" onmouseover="y" class="btn" onfocus="z">link</a>',
    );
    expect(out).toBe('<a href="/safe" class="btn">link</a>');
  });

  it('strips on* attributes case-insensitively', () => {
    const out = sanitizeHtml('<div OnClick="bad" ONMOUSEOVER="bad">x</div>');
    expect(out).toBe('<div>x</div>');
  });

  it('does not strip attributes that merely start with the letters "on"-something', () => {
    // Attribute names like `online` would technically match a naive `/^on/`
    // regex too — that is by design and matches the AC ("strip all on*=").
    // The check here exists so future tighter rules (e.g. exact-known-event
    // list) would require a deliberate test update.
    const out = sanitizeHtml('<div online="true" data-on-foo="ok">x</div>');
    expect(out).toBe('<div data-on-foo="ok">x</div>');
  });
});

describe('sanitizeHtml (US-013) — javascript: URL stripping', () => {
  it('removes javascript: href on anchor', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).toBe('<a>click</a>');
  });

  it('removes javascript: src on img', () => {
    const out = sanitizeHtml('<img src="javascript:void(0)" alt="x">');
    expect(out).toBe('<img alt="x">');
  });

  it('removes javascript: URLs case-insensitively', () => {
    const out = sanitizeHtml('<a href="JaVaScRiPt:alert(1)">x</a>');
    expect(out).toBe('<a>x</a>');
  });

  it('removes javascript: URLs with leading whitespace', () => {
    const out = sanitizeHtml('<a href="   javascript:alert(1)">x</a>');
    expect(out).toBe('<a>x</a>');
  });

  it('preserves safe http/https/relative URLs', () => {
    const out = sanitizeHtml(
      '<a href="https://example.com">a</a><a href="/path">b</a><a href="#hash">c</a>',
    );
    expect(out).toBe(
      '<a href="https://example.com">a</a><a href="/path">b</a><a href="#hash">c</a>',
    );
  });

  it('only inspects href/src — javascript: in other attrs is left alone', () => {
    // Authors sometimes embed code snippets in `title` / `alt`. The sanitizer
    // only inspects the AC-listed attrs.
    const out = sanitizeHtml('<a href="/safe" title="javascript:not-a-url">x</a>');
    expect(out).toBe('<a href="/safe" title="javascript:not-a-url">x</a>');
  });
});

describe('sanitizeHtml (US-013) — purity and round-trips', () => {
  it('is pure: same input always produces the same output', () => {
    const input =
      '<div class="p-4 bg-slate-100"><p class="text-lg font-semibold">Hello <span>world</span></p></div>';
    const first = sanitizeHtml(input);
    const second = sanitizeHtml(input);
    const third = sanitizeHtml(input);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('does not mutate the input string', () => {
    const input = '<p onclick="x">hi</p>';
    const snapshot = input.slice();
    sanitizeHtml(input);
    expect(input).toBe(snapshot);
  });

  it('preserves a realistic Tailwind block round-trip', () => {
    const tailwindBlock =
      '<div class="rounded-lg border p-6 shadow-sm"><h2 class="text-xl font-bold mb-2">Edit me</h2><p class="text-sm text-slate-500">blocks/abc.html</p></div>';
    const out = sanitizeHtml(tailwindBlock);
    expect(out).toBe(tailwindBlock);
  });
});

describe('sanitizeHtml (US-013) — SSR safety', () => {
  it('returns "" when DOMParser is unavailable', () => {
    const stash = (globalThis as { DOMParser?: unknown }).DOMParser;
    (globalThis as { DOMParser?: unknown }).DOMParser = undefined;
    try {
      // sanitizeHtml reads `typeof DOMParser` at call time (not module load),
      // so flipping the global mid-test exercises the SSR guard directly.
      expect(sanitizeHtml('<p>anything</p>')).toBe('');
    } finally {
      (globalThis as { DOMParser?: unknown }).DOMParser = stash;
    }
  });
});
