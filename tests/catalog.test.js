import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { catalogRoute } from '../src/routes/catalog.js';
import { createCache } from '../src/services/cache.js';

const fakeSearch = async (query) => [{
  id: 'dQw4w9WgXcQ',
  title: 'Test Video',
  duration: 212,
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
}];

test('search catalog returns metas with yt: prefix', async () => {
  const app = express();
  app.get('/catalog/movie/yt-search/:extra?.json',
    catalogRoute({ searchVideos: fakeSearch, cache: createCache({ ttlMs: 1000 }) }));
  const res = await request(app).get('/catalog/movie/yt-search/search=test.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.metas[0].id, 'yt:dQw4w9WgXcQ');
  assert.equal(res.body.metas[0].name, 'Test Video');
  assert.equal(res.body.metas[0].type, 'movie');
});

test('missing search param returns empty metas', async () => {
  const app = express();
  app.get('/catalog/movie/yt-search/:extra?.json',
    catalogRoute({ searchVideos: fakeSearch, cache: createCache({ ttlMs: 1000 }) }));
  const res = await request(app).get('/catalog/movie/yt-search/search=.json');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.metas, []);
});

test('upstream failure returns empty metas, not a crash', async () => {
  const app = express();
  app.get('/catalog/movie/yt-search/:extra?.json',
    catalogRoute({ searchVideos: async () => { throw new Error('boom'); }, cache: createCache({ ttlMs: 1000 }) }));
  const res = await request(app).get('/catalog/movie/yt-search/search=x.json');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.metas, []);
});

test('long query is normalized before reaching searchVideos', async () => {
  const long = 'a'.repeat(250);
  let captured;
  const app = express();
  app.get('/catalog/movie/yt-search/:extra?.json',
    catalogRoute({
      searchVideos: async (query) => { captured = query; return []; },
      cache: createCache({ ttlMs: 1000 }),
    }));
  const res = await request(app).get(`/catalog/movie/yt-search/search=${long}.json`);
  assert.equal(res.status, 200);
  assert.equal(captured.length, 200);
});
