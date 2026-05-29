import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withVendorLock } from './lock.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sf-icons-lock-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('serializes concurrent installs of the same vendor', async () => {
  const lockPath = join(dir, 'aws.lock');
  const order: string[] = [];
  const a = withVendorLock(lockPath, async () => {
    order.push('a-start');
    await Bun.sleep(20);
    order.push('a-end');
  });
  const b = withVendorLock(lockPath, async () => {
    order.push('b-start');
    order.push('b-end');
  });
  await Promise.all([a, b]);
  expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
});

it('does not block on a different lock path', async () => {
  const order: string[] = [];
  const a = withVendorLock(join(dir, 'aws.lock'), async () => {
    order.push('a-start');
    await Bun.sleep(20);
    order.push('a-end');
  });
  const b = withVendorLock(join(dir, 'gcp.lock'), async () => {
    order.push('b-start');
    order.push('b-end');
  });
  await Promise.all([a, b]);
  expect(order).toEqual(['a-start', 'b-start', 'b-end', 'a-end']);
});

it('continues the queue after the prior task throws', async () => {
  const lockPath = join(dir, 'aws.lock');
  const order: string[] = [];
  const a = withVendorLock(lockPath, async () => {
    order.push('a');
    throw new Error('boom');
  }).catch(() => undefined);
  const b = withVendorLock(lockPath, async () => {
    order.push('b');
  });
  await Promise.all([a, b]);
  expect(order).toEqual(['a', 'b']);
});

it('returns the function value', async () => {
  const result = await withVendorLock(join(dir, 'aws.lock'), async () => 42);
  expect(result).toBe(42);
});
