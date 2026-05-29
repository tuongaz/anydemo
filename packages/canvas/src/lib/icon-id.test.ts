import { describe, expect, it } from 'bun:test';
import { formatIconId, parseIconId } from './icon-id.ts';

describe('parseIconId', () => {
  it('treats unprefixed names as Lucide', () => {
    expect(parseIconId('cloud-upload')).toEqual({ vendor: 'lucide', name: 'cloud-upload' });
    expect(parseIconId('database')).toEqual({ vendor: 'lucide', name: 'database' });
  });

  it('parses every recognized vendor prefix', () => {
    expect(parseIconId('aws:lambda')).toEqual({ vendor: 'aws', name: 'lambda' });
    expect(parseIconId('gcp:cloud-functions')).toEqual({
      vendor: 'gcp',
      name: 'cloud-functions',
    });
    expect(parseIconId('azure:functions')).toEqual({ vendor: 'azure', name: 'functions' });
    expect(parseIconId('iconify:logos:google-cloud')).toEqual({
      vendor: 'iconify',
      name: 'logos:google-cloud',
    });
    expect(parseIconId('lucide:database')).toEqual({ vendor: 'lucide', name: 'database' });
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(parseIconId('')).toBeNull();
    expect(parseIconId('   ')).toBeNull();
  });

  it('returns null for unknown vendor prefixes', () => {
    expect(parseIconId('unknown:foo')).toBeNull();
    expect(parseIconId('material:home')).toBeNull();
  });

  it('returns null when the name segment is empty', () => {
    expect(parseIconId('aws:')).toBeNull();
    expect(parseIconId('iconify:')).toBeNull();
  });
});

describe('formatIconId', () => {
  it('omits the prefix for Lucide', () => {
    expect(formatIconId({ vendor: 'lucide', name: 'database' })).toBe('database');
  });

  it('prefixes every non-Lucide vendor', () => {
    expect(formatIconId({ vendor: 'aws', name: 'lambda' })).toBe('aws:lambda');
    expect(formatIconId({ vendor: 'gcp', name: 'cloud-functions' })).toBe('gcp:cloud-functions');
    expect(formatIconId({ vendor: 'azure', name: 'functions' })).toBe('azure:functions');
    expect(formatIconId({ vendor: 'iconify', name: 'logos:google-cloud' })).toBe(
      'iconify:logos:google-cloud',
    );
  });

  it('round-trips through parse', () => {
    const inputs = [
      'cloud-upload',
      'aws:lambda',
      'gcp:cloud-functions',
      'azure:functions',
      'iconify:logos:google-cloud',
    ];
    for (const raw of inputs) {
      const parsed = parseIconId(raw);
      expect(parsed).not.toBeNull();
      if (parsed) expect(formatIconId(parsed)).toBe(raw);
    }
  });
});
