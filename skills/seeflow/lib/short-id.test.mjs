import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortId } from './short-id.mjs';

test('returns 10 chars by default', () => {
  assert.equal(shortId().length, 10);
});

test('honours the requested length', () => {
  assert.equal(shortId(1).length, 1);
  assert.equal(shortId(32).length, 32);
});

test('only emits base62 characters', () => {
  const id = shortId(1000);
  assert.match(id, /^[A-Za-z0-9]+$/);
});

test('does not collide across a large batch', () => {
  const ids = new Set();
  for (let i = 0; i < 10_000; i++) ids.add(shortId());
  assert.equal(ids.size, 10_000);
});
