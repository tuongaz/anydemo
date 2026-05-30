import { expect, it } from 'bun:test';
import { summarizePacks } from './list-helper.ts';

it('summarizes installed + available vendors', () => {
  const summary = summarizePacks({
    version: 1,
    packs: {
      aws: {
        vendor: 'aws',
        version: '2026-05-30',
        installedAt: 1,
        sizeBytes: 100,
        icons: { lambda: 'aws/2026-05-30/lambda.svg' },
      },
    },
  });
  expect(summary).toEqual([
    {
      vendor: 'aws',
      installed: true,
      version: '2026-05-30',
      iconCount: 1,
      sizeBytes: 100,
      iconNames: ['lambda'],
    },
    { vendor: 'gcp', installed: false },
    { vendor: 'azure', installed: false },
  ]);
});

it('returns all-uninstalled when index is empty', () => {
  const summary = summarizePacks({ version: 1, packs: {} });
  expect(summary).toEqual([
    { vendor: 'aws', installed: false },
    { vendor: 'gcp', installed: false },
    { vendor: 'azure', installed: false },
  ]);
});

it('reports iconCount and sizeBytes for every installed vendor', () => {
  const summary = summarizePacks({
    version: 1,
    packs: {
      aws: {
        vendor: 'aws',
        version: 'a',
        installedAt: 1,
        sizeBytes: 10,
        icons: { x: 'aws/a/x.svg', y: 'aws/a/y.svg' },
      },
      gcp: {
        vendor: 'gcp',
        version: 'g',
        installedAt: 2,
        sizeBytes: 20,
        icons: { z: 'gcp/g/z.svg' },
      },
    },
  });
  expect(summary).toEqual([
    {
      vendor: 'aws',
      installed: true,
      version: 'a',
      iconCount: 2,
      sizeBytes: 10,
      iconNames: ['x', 'y'],
    },
    {
      vendor: 'gcp',
      installed: true,
      version: 'g',
      iconCount: 1,
      sizeBytes: 20,
      iconNames: ['z'],
    },
    { vendor: 'azure', installed: false },
  ]);
});
