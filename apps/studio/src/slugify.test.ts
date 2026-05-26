import { describe, expect, it } from 'bun:test';
import { slugify } from './slugify.ts';

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with dashes', () => {
    expect(slugify('Checkout Flow')).toBe('checkout-flow');
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  spaces   here ')).toBe('spaces-here');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('---abc---')).toBe('abc');
    expect(slugify('!!!abc???')).toBe('abc');
  });

  it('collapses runs of non-alphanumeric into single dashes', () => {
    expect(slugify('a   b...c')).toBe('a-b-c');
    expect(slugify('a/b/c')).toBe('a-b-c');
  });

  it('preserves alphanumeric chars', () => {
    expect(slugify('abc123')).toBe('abc123');
    expect(slugify('Order Pipeline 42')).toBe('order-pipeline-42');
  });

  it('returns "demo" for empty/non-alphanumeric input', () => {
    expect(slugify('')).toBe('demo');
    expect(slugify('!!!')).toBe('demo');
    expect(slugify('   ')).toBe('demo');
  });
});
