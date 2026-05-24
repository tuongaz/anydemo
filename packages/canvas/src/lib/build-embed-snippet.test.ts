import { describe, expect, it } from 'bun:test';
import {
  EMBED_HOST,
  buildEmbedSnippet,
  buildEmbedUrl,
  getResolvedThemeFromDocument,
} from './build-embed-snippet.ts';

describe('buildEmbedSnippet (US-010)', () => {
  const snippet = buildEmbedSnippet('https://seeflow.dev/embed/demo-1');

  it('includes the iframe attribute literals required by the design doc', () => {
    expect(snippet).toContain('width="100%"');
    expect(snippet).toContain('height="600"');
    expect(snippet).toContain('loading="lazy"');
    expect(snippet).toContain('style="border:0"');
    expect(snippet).toContain('allow="fullscreen"');
  });

  it('puts the URL inside the iframe src attribute', () => {
    expect(snippet).toContain('src="https://seeflow.dev/embed/demo-1"');
  });

  it('HTML-attribute-escapes `&` in the URL so query strings do not break the snippet', () => {
    const out = buildEmbedSnippet('https://x.com/?a=1&b=2');
    expect(out).toContain('src="https://x.com/?a=1&amp;b=2"');
    expect(out).not.toMatch(/src="[^"]*&b=2/);
  });

  it('escapes `"` and `<` inside the URL too (only `&`, `"`, `<` per the PRD)', () => {
    const out = buildEmbedSnippet('https://x.com/"<script>');
    expect(out).toContain('&quot;');
    expect(out).toContain('&lt;script>');
    expect(out).not.toContain('"<script>');
  });
});

describe('buildEmbedUrl (US-010)', () => {
  it('returns ${EMBED_HOST}/${projectId} for plain ids', () => {
    expect(buildEmbedUrl('foo')).toBe('https://seeflow.dev/embed/foo');
  });

  it('URL-encodes characters that are unsafe in a path segment', () => {
    expect(buildEmbedUrl('foo bar')).toBe('https://seeflow.dev/embed/foo%20bar');
  });

  it('exports the canonical embed host constant', () => {
    expect(EMBED_HOST).toBe('https://seeflow.dev/embed');
  });
});

describe('buildEmbedUrl theme query param (US-009)', () => {
  it('appends ?theme=light when theme is light', () => {
    expect(buildEmbedUrl('demo', 'light')).toBe('https://seeflow.dev/embed/demo?theme=light');
  });

  it('appends ?theme=dark when theme is dark', () => {
    expect(buildEmbedUrl('demo', 'dark')).toBe('https://seeflow.dev/embed/demo?theme=dark');
  });

  it('omits the query param when theme is undefined (backwards compatible)', () => {
    expect(buildEmbedUrl('demo')).toBe('https://seeflow.dev/embed/demo');
  });

  it('preserves URL-encoding of the project id when theme is appended', () => {
    expect(buildEmbedUrl('foo bar', 'dark')).toBe('https://seeflow.dev/embed/foo%20bar?theme=dark');
  });

  it('embed snippet carries the themed URL through to the iframe src', () => {
    const out = buildEmbedSnippet(buildEmbedUrl('demo', 'dark'));
    // `&` is irrelevant here (only one query param) but the equals sign must
    // survive the attribute escape — `=` is not in the escape set.
    expect(out).toContain('src="https://seeflow.dev/embed/demo?theme=dark"');
  });
});

describe('getResolvedThemeFromDocument (US-009)', () => {
  it('returns "dark" when documentElement.classList contains "dark"', () => {
    const doc = {
      documentElement: {
        classList: { contains: (token: string) => token === 'dark' },
      },
    };
    expect(getResolvedThemeFromDocument(doc)).toBe('dark');
  });

  it('returns "light" when documentElement.classList does NOT contain "dark"', () => {
    const doc = {
      documentElement: {
        classList: { contains: (_token: string) => false },
      },
    };
    expect(getResolvedThemeFromDocument(doc)).toBe('light');
  });

  it('returns "light" when documentElement.classList contains only "light"', () => {
    const doc = {
      documentElement: {
        classList: { contains: (token: string) => token === 'light' },
      },
    };
    expect(getResolvedThemeFromDocument(doc)).toBe('light');
  });

  it('returns "light" when doc is null (SSR / no DOM)', () => {
    expect(getResolvedThemeFromDocument(null)).toBe('light');
  });

  it('returns "light" when doc is undefined (SSR / no DOM)', () => {
    expect(getResolvedThemeFromDocument()).toBe('light');
  });

  it('only treats the literal "dark" token as dark — arbitrary classes do not flip the result', () => {
    const doc = {
      documentElement: {
        classList: {
          contains: (token: string) => token === 'dark-mode-marker' || token === 'sometheme',
        },
      },
    };
    expect(getResolvedThemeFromDocument(doc)).toBe('light');
  });
});
