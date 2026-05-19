import { describe, expect, it } from 'bun:test';
import { EMBED_HOST, buildEmbedSnippet, buildEmbedUrl } from './build-embed-snippet.ts';

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
