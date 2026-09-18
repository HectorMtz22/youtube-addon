import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { metaRoute } from '../src/routes/meta.js';
import { createCache } from '../src/services/cache.js';

const fakeInfo = {
  id: 'dQw4w9WgXcQ',
  title: 'Test Video',
  description: 'A description',
  duration: 212,
  upload_date: '20260101',
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
};

test('meta returns Stremio meta object', async () => {
  const app = express();
  app.get('/meta/movie/:videoId.json',
    metaRoute({ getVideoInfo: async () => fakeInfo, cache: createCache({ ttlMs: 1000 }) }));
  const res = await request(app).get('/meta/movie/yt:dQw4w9WgXcQ.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.meta.id, 'yt:dQw4w9WgXcQ');
  assert.equal(res.body.meta.name, 'Test Video');
  assert.equal(res.body.meta.videos[0].id, 'yt:dQw4w9WgXcQ');
  assert.equal(res.body.meta.releaseInfo, '2026');
  assert.equal(res.body.meta.runtime, '4 min');
});

test('invalid video id → 404', async () => {
  const app = express();
  app.get('/meta/movie/:videoId.json',
    metaRoute({ getVideoInfo: async () => fakeInfo, cache: createCache({ ttlMs: 1000 }) }));
  await request(app).get('/meta/movie/yt:bad-id!!.json').expect(404);
});

test('upstream failure → 502', async () => {
  const app = express();
  app.get('/meta/movie/:videoId.json',
    metaRoute({ getVideoInfo: async () => { throw new Error('boom'); }, cache: createCache({ ttlMs: 1000 }) }));
  const res = await request(app).get('/meta/movie/yt:dQw4w9WgXcQ.json');
  assert.equal(res.status, 502);
});

test('long descriptions are truncated in the meta payload', async () => {
  const longInfo = { ...fakeInfo, description: 'x'.repeat(5000) };
  const app = express();
  app.get('/meta/movie/:videoId.json',
    metaRoute({ getVideoInfo: async () => longInfo, cache: createCache({ ttlMs: 1000 }) }));
  const res = await request(app).get('/meta/movie/yt:dQw4w9WgXcQ.json');
  assert.equal(res.body.meta.description, null);
});
