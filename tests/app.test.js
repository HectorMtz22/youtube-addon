import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/index.js';

const deps = {
  searchVideos: async () => [{ id: 'aaaaaaaaaaa', title: 'T', duration: 60, thumbnail: 'x' }],
  getVideoInfo: async () => ({ id: 'aaaaaaaaaaa', title: 'T', formats: [] }),
};

test('requires a token at creation', () => {
  assert.throws(() => createApp({ token: '' }), /ADDON_TOKEN/);
  assert.throws(() => createApp({ token: 'short' }), /ADDON_TOKEN/);
});

test('correct token reaches routes; wrong token 404s', async () => {
  const app = createApp({ token: 'tok1234567890abcdefgh', deps });
  const ok = await request(app).get('/tok1234567890abcdefgh/manifest.json');
  assert.equal(ok.status, 200);
  const no = await request(app).get('/wrong/manifest.json');
  assert.equal(no.status, 404);
  const none = await request(app).get('/manifest.json');
  assert.equal(none.status, 404);
});

test('full happy path: catalog → meta → stream through the token prefix', async () => {
  const app = createApp({ token: 'tok1234567890abcdefgh', deps });
  const cat = await request(app).get('/tok1234567890abcdefgh/catalog/movie/yt-search/search=q.json');
  assert.equal(cat.body.metas[0].id, 'yt:aaaaaaaaaaa');
  const meta = await request(app).get('/tok1234567890abcdefgh/meta/movie/yt:aaaaaaaaaaa.json');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.meta.videos[0].id, 'yt:aaaaaaaaaaa');
  const st = await request(app).get('/tok1234567890abcdefgh/stream/movie/yt:aaaaaaaaaaa.json');
  assert.equal(st.status, 200);
  assert.ok('streams' in st.body);
});
