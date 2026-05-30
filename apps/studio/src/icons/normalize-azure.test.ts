import { describe, expect, it } from 'bun:test';
import { canonicalAzureName } from './normalize-azure.ts';

describe('canonicalAzureName', () => {
  it('strips the numeric "<num>-icon-service-" prefix and kebab-cases the rest', () => {
    expect(canonicalAzureName('10841-icon-service-Functions.svg')).toBe('functions');
    expect(canonicalAzureName('10840-icon-service-App-Services.svg')).toBe('app-services');
    expect(canonicalAzureName('00001-icon-service-Virtual-Machines.svg')).toBe('virtual-machines');
  });

  it('also strips a bare "icon-service-" prefix (no numeric)', () => {
    expect(canonicalAzureName('icon-service-Kubernetes-Services.svg')).toBe('kubernetes-services');
  });

  it('collapses runs of non-alphanumerics into a single dash', () => {
    expect(canonicalAzureName('10001-icon-service-Cosmos_DB.svg')).toBe('cosmos-db');
    expect(canonicalAzureName('10002-icon-service-Storage  Accounts.svg')).toBe('storage-accounts');
  });

  it('trims leading and trailing dashes', () => {
    expect(canonicalAzureName('10003-icon-service- Service Bus .svg')).toBe('service-bus');
  });

  it('falls back to plain kebab-case when no Azure prefix is present', () => {
    expect(canonicalAzureName('Some Other Icon.svg')).toBe('some-other-icon');
  });

  it('returns null for non-SVG files', () => {
    expect(canonicalAzureName('README.txt')).toBeNull();
    expect(canonicalAzureName('LICENSE')).toBeNull();
  });

  it('returns null when the kebab result is empty', () => {
    expect(canonicalAzureName('10004-icon-service-.svg')).toBeNull();
    expect(canonicalAzureName('---.svg')).toBeNull();
    expect(canonicalAzureName('.svg')).toBeNull();
  });
});
