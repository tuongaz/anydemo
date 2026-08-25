import { describe, expect, it } from 'bun:test';
import { fileUrl } from './file-url.ts';

describe('fileUrl', () => {
  it('defaults to the relative studio route', () => {
    expect(fileUrl('checkout', 'assets/hero.png')).toBe(
      '/api/projects/checkout/files/assets/hero.png',
    );
  });

  it('honours an absolute baseUrl', () => {
    // The MCP App iframe runs at `Origin: null`, so a relative src would
    // resolve against the HOST page instead of the studio. The host pins an
    // absolute prefix built from widgetState.backendUrl.
    expect(fileUrl('checkout', 'assets/hero.png', 'http://127.0.0.1:54321/api/projects')).toBe(
      'http://127.0.0.1:54321/api/projects/checkout/files/assets/hero.png',
    );
  });

  it('strips trailing slashes off baseUrl', () => {
    expect(fileUrl('p', 'a.png', 'http://h:1/api/projects///')).toBe(
      'http://h:1/api/projects/p/files/a.png',
    );
  });

  it('encodes the project id but keeps path separators', () => {
    expect(fileUrl('my project', 'blocks/a b/c.html')).toBe(
      '/api/projects/my%20project/files/blocks/a%20b/c.html',
    );
  });
});
