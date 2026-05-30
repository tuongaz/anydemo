import { describe, expect, it } from 'bun:test';
import { canonicalGcpName } from './normalize-gcp.ts';

describe('canonicalGcpName', () => {
  it('kebab-cases multi-word names with spaces', () => {
    expect(canonicalGcpName('Cloud Functions.svg')).toBe('cloud-functions');
    expect(canonicalGcpName('Cloud Run.svg')).toBe('cloud-run');
    expect(canonicalGcpName('BigQuery.svg')).toBe('bigquery');
  });

  it('collapses runs of non-alphanumerics into a single dash', () => {
    expect(canonicalGcpName('Cloud  Spanner.svg')).toBe('cloud-spanner');
    expect(canonicalGcpName('Cloud_SQL.svg')).toBe('cloud-sql');
    expect(canonicalGcpName('Pub/Sub.svg')).toBe('pub-sub');
  });

  it('trims leading and trailing dashes', () => {
    expect(canonicalGcpName(' Cloud Storage .svg')).toBe('cloud-storage');
  });

  it('returns null for non-SVG files', () => {
    expect(canonicalGcpName('README.txt')).toBeNull();
    expect(canonicalGcpName('LICENSE')).toBeNull();
  });

  it('returns null when the kebab result is empty', () => {
    expect(canonicalGcpName('---.svg')).toBeNull();
    expect(canonicalGcpName('.svg')).toBeNull();
  });
});
