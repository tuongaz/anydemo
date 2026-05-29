import { describe, expect, it } from 'bun:test';
import { canonicalAwsName } from './normalize-aws.ts';

describe('canonicalAwsName', () => {
  it('strips Arch_ and AWS-/Amazon- prefixes and size suffix', () => {
    expect(canonicalAwsName('Arch_AWS-Lambda_64.svg')).toBe('lambda');
    expect(canonicalAwsName('Arch_Amazon-S3_64.svg')).toBe('s3');
    expect(canonicalAwsName('Arch_Amazon-EC2_64.svg')).toBe('ec2');
  });

  it('handles category icons', () => {
    expect(canonicalAwsName('Arch-Category_Compute_64.svg')).toBe('compute');
  });

  it('lowercases and kebabs multi-word service names', () => {
    expect(canonicalAwsName('Arch_AWS-Step-Functions_64.svg')).toBe('step-functions');
    expect(canonicalAwsName('Arch_Amazon-API-Gateway_64.svg')).toBe('api-gateway');
  });

  it('returns null for non-SVG files', () => {
    expect(canonicalAwsName('README.txt')).toBeNull();
  });
});
