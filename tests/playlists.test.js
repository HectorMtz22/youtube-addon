import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { playlistsCatalogRoute, playlistMetaRoute } from '../src/routes/playlists.js';
import { createCache } from '../src/services/cache.js';

const fakePlaylistVideos = async (url) => ({
  title: 'My Mix',
  entries: [
    { id: 'aaaaaaaaaaa', title: 'P1', duration: 60, thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg' },
    { id: 'bbbbbbbbbbb', title: 'P2', duration: 120, thumbnail: 'https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg' },
  ],
});

function cfgApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.ytConfig = { playlists: [{ id: 'PL1234567890ab', url: 'https://www.youtube.com/playlist?list=PL1234567890ab' }] };
    req.ytConfigSegment = 'cfg-seg';
    next();
  });
  app.get('/catalog/series/yt-playlists/:extra?.json',
    playlistsCatalogRoute({ playlistVideos: fakePlaylistVideos, cache: createCache({ ttlMs: 1000 }) }));
  app.get('/meta/:type/:videoId.json',
    playlistMetaRoute({ playlistVideos: fakePlaylistVideos, cache: createCache({ ttlMs: 1000 }) }));
  return app;
}
test('playlist catalog lists configured playlists', async () => {
  const res = await request(cfgApp()).get('/catalog/series/yt-playlists.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.metas[0].id, 'ytpl:PL1234567890ab');
  assert.equal(res.body.metas[0].type, 'series');
  assert.equal(res.body.metas[0].name, 'My Mix');
});

test('no configured playlists → empty metas', async () => {
  const app = express();
  app.use((req, _res, next) => { req.ytConfig = { playlists: [] }; next(); });
  app.get('/catalog/series/yt-playlists/:extra?.json',
    playlistsCatalogRoute({ playlistVideos: fakePlaylistVideos, cache: createCache({ ttlMs: 1000 }) }));
  assert.deepEqual((await request(app).get('/catalog/series/yt-playlists.json')).body.metas, []);
});

test('playlist meta returns series meta with yt: videos and episode numbers', async () => {
  const res = await request(cfgApp()).get('/meta/series/ytpl:PL1234567890ab.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.meta.id, 'ytpl:PL1234567890ab');
  assert.equal(res.body.meta.type, 'series');
  assert.equal(res.body.meta.videos[0].id, 'yt:aaaaaaaaaaa');
  assert.equal(res.body.meta.videos[0].episode, 1);
  assert.equal(res.body.meta.videos[1].episode, 2);
});

test('unconfigured playlist id → 404', async () => {
  await request(cfgApp()).get('/meta/series/ytpl:PLunknown99999.json').expect(404);
});
