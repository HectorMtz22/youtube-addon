import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/index.js';

const deps = {
  searchVideos: async () => [{ id: 'aaaaaaaaaaa', title: 'T', duration: 60, thumbnail: 'x' }],
  getVideoInfo: async () => ({
    id: 'aaaaaaaaaaa',
    title: 'T',
    formats: [
      { format_id: '96', protocol: 'm3u8_native', manifest_url: 'https://manifest.example/hls.m3u8', vcodec: 'avc1.640028', acodec: 'mp4a.40.2', height: 1080 },
      { format_id: '137', protocol: 'https', vcodec: 'avc1.640028', acodec: 'none', height: 1080, url: 'https://video.example/137' },
      { format_id: '140', protocol: 'https', vcodec: 'none', acodec: 'mp4a.40.2', url: 'https://audio.example/140' },
      { format_id: '18', protocol: 'https', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, url: 'https://video.example/18' },
    ],
  }),
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
  const fmp4 = st.body.streams.find(s => s.url.includes('/play/'));
  assert.ok(fmp4, 'expected an fMP4 remux stream entry');
  const playUrl = new URL(fmp4.url);
  assert.equal(playUrl.protocol, 'http:');
  assert.equal(playUrl.hostname, '127.0.0.1');
  assert.equal(playUrl.pathname.startsWith('/tok1234567890abcdefgh/play/'), true,
    `play URL must carry the token prefix, got: ${fmp4.url}`);
});
