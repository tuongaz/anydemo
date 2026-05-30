import { describe, expect, it } from 'bun:test';
import { Database } from 'lucide-react';
import { resolveIcon } from './icon-resolve.ts';

describe('resolveIcon', () => {
  it('returns a Lucide component for a bundled name', () => {
    const res = resolveIcon('database', { studioBaseUrl: 'http://localhost:4321' });
    expect(res).toEqual({ kind: 'lucide', component: Database });
  });

  it('returns an SVG URL for vendor-prefixed names', () => {
    const res = resolveIcon('aws:lambda', { studioBaseUrl: 'http://localhost:4321' });
    expect(res).toEqual({
      kind: 'svg-url',
      url: 'http://localhost:4321/api/icons/aws/lambda.svg',
    });
  });

  it('returns an iconify identifier for iconify-prefixed names', () => {
    const res = resolveIcon('iconify:logos:google-cloud', { studioBaseUrl: 'x' });
    expect(res).toEqual({ kind: 'iconify', identifier: 'logos:google-cloud' });
  });

  it('returns null for empty input', () => {
    expect(resolveIcon('', { studioBaseUrl: 'x' })).toBeNull();
  });

  it('returns null for unknown Lucide names', () => {
    expect(resolveIcon('lucide:not-a-real-icon-xyz', { studioBaseUrl: 'x' })).toBeNull();
  });

  it('returns SVG URLs for gcp + azure', () => {
    expect(resolveIcon('gcp:cloud-functions', { studioBaseUrl: 'http://x' })).toEqual({
      kind: 'svg-url',
      url: 'http://x/api/icons/gcp/cloud-functions.svg',
    });
    expect(resolveIcon('azure:functions', { studioBaseUrl: 'http://x' })).toEqual({
      kind: 'svg-url',
      url: 'http://x/api/icons/azure/functions.svg',
    });
  });
});
