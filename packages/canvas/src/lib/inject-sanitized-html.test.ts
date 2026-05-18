import { describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';

// happy-dom DOMParser → sanitizeHtml needs it. Install BEFORE the helper is
// imported (the sanitizer reads `DOMParser` lazily via `typeof DOMParser`).
const window = new Window();
(globalThis as { DOMParser?: unknown }).DOMParser = window.DOMParser;

const { injectSanitizedHtml } = await import('./inject-sanitized-html.ts');

const INNER_HTML_PROP = 'dangerously' + 'SetInnerHTML';

function readInnerHtml(props: Record<string, unknown>): string | undefined {
  const value = props[INNER_HTML_PROP] as { __html?: string } | undefined;
  return value?.__html;
}

describe('injectSanitizedHtml (US-014)', () => {
  it('returns a spreadable React props object carrying sanitized HTML', () => {
    const props = injectSanitizedHtml('<p>hello</p>');
    expect(readInnerHtml(props as unknown as Record<string, unknown>)).toBe('<p>hello</p>');
  });

  it('strips dangerous tags before injection (delegates to sanitizeHtml)', () => {
    const props = injectSanitizedHtml('<p>safe</p><script>boom()</script>');
    expect(readInnerHtml(props as unknown as Record<string, unknown>)).toBe('<p>safe</p>');
  });

  it('strips on*= event-handler attributes', () => {
    const props = injectSanitizedHtml('<button onclick="alert(1)">x</button>');
    expect(readInnerHtml(props as unknown as Record<string, unknown>)).toBe('<button>x</button>');
  });

  it('strips javascript: URLs from href/src', () => {
    const props = injectSanitizedHtml('<a href="javascript:alert(1)">x</a>');
    expect(readInnerHtml(props as unknown as Record<string, unknown>)).toBe('<a>x</a>');
  });

  it('preserves benign Tailwind-styled markup', () => {
    const html = '<div class="rounded-lg border p-6"><h2>title</h2><p>body</p></div>';
    const props = injectSanitizedHtml(html);
    expect(readInnerHtml(props as unknown as Record<string, unknown>)).toBe(html);
  });
});
