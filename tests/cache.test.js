import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../src/services/cache.js';

test('set/get roundtrip and miss', () => {
  const c = createCache({ ttlMs: 1000 });
  c.set('a', { x: 1 });
  assert.deepEqual(c.get('a'), { x: 1 });
  assert.equal(c.get('missing'), undefined);
});

test('expired entries return undefined and are evicted', async () => {
  const c = createCache({ ttlMs: 20 });
  c.set('a', 1);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(c.get('a'), undefined);
  assert.equal(c.size, 0);
});

test('set overwrites value and refreshes ttl', async () => {
  const c = createCache({ ttlMs: 1000 });
  c.set('a', 1);
  c.set('a', 2);
  assert.equal(c.get('a'), 2);
  assert.equal(c.size, 1);
});
