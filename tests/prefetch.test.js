import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrefetcher } from '../src/services/prefetch.js';
import { createCache } from '../src/services/cache.js';

const fakeInfo = (id) => ({ id, title: `T-${id}`, duration: 60, upload_date: '20260101', thumbnail: 'x' });

test('prefetch warms info and meta caches', async () => {
  const metaCache = createCache({ ttlMs: 1000 });
  const infoCache = createCache({ ttlMs: 1000 });
  const prefetch = createPrefetcher({
    getVideoInfo: async (id) => fakeInfo(id),
    metaCache, infoCache,
    buildMeta: (info) => ({ id: `yt:${info.id}`, name: info.title }),
  });
  prefetch(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(infoCache.get('info:aaaaaaaaaaa'), fakeInfo('aaaaaaaaaaa'));
  assert.equal(metaCache.get('meta:bbbbbbbbbbb').name, 'T-bbbbbbbbbbb');
});

test('prefetch skips already-cached ids and swallows failures', async () => {
  const metaCache = createCache({ ttlMs: 1000 });
  const infoCache = createCache({ ttlMs: 1000 });
  let calls = 0;
  const prefetch = createPrefetcher({
    getVideoInfo: async (id) => { calls++; if (id === 'ccccccccccc') throw new Error('boom'); return fakeInfo(id); },
    metaCache, infoCache,
    buildMeta: () => ({}),
  });
  infoCache.set('info:aaaaaaaaaaa', 'prewarmed');
  prefetch(['aaaaaaaaaaa', 'ccccccccccc']);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls, 1); // only the uncached id fetched; the failure swallowed
});

test('prefetch caps the number of ids', async () => {
  const metaCache = createCache({ ttlMs: 1000 });
  const infoCache = createCache({ ttlMs: 1000 });
  const ids = Array.from({ length: 20 }, (_, i) => `id${String(i).padStart(2, '0')}xxx`);
  let calls = 0;
  const prefetch = createPrefetcher({
    getVideoInfo: async () => { calls++; return fakeInfo('aaaaaaaaaaa'); },
    metaCache, infoCache,
    buildMeta: () => ({}),
    limit: 3,
  });
  prefetch(ids);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls, 3);
});
