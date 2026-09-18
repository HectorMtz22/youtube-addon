import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import express from 'express';
import { buildStreams, streamRoute } from '../src/routes/stream.js';
import { createCache } from '../src/services/cache.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/video-info.json', import.meta.url)));

test('ladder: HLS first, then fMP4 for 1080p and 720p, then 360p', () => {
  const streams = buildStreams(fixture, `http://srv:7000/tok123/`);
  const hlsEntry = streams.find(x => x.url.includes('m3u8'));
  assert.match(hlsEntry.title, /HLS.*1080p/);
  // Reordered so Stremio's default stream choice lands on HLS (empirical:
  // Stremio did not pick the first entry; testing last-position default).
  assert.deepEqual(streams.map(s => s.url), [
    'http://srv:7000/tok123/play/dQw4w9WgXcQ.mp4?height=1080',
    'http://srv:7000/tok123/play/dQw4w9WgXcQ.mp4?height=720',
    'https://manifest.googlevideo.com/api/manifest/hls_playlist/fixture.m3u8',
    'https://rr1---sn-x.googlevideo.com/videoplayback?fixture=18',
  ]);
});

test('ladder when no HLS formats: no HLS entry, fMP4 still present', () => {
  const noHls = { ...fixture, formats: fixture.formats.filter(f => f.protocol !== 'm3u8_native') };
  const streams = buildStreams(noHls, 'http://srv:7000/tok123/');
  assert.ok(!streams.some(s => s.url.includes('m3u8')));
  assert.ok(streams.some(s => s.url.includes('/play/')));
});

test('stream route returns streams and validates the id', async () => {
  const app = express();
  app.get('/stream/:videoId.json', streamRoute({
    getVideoInfo: async () => fixture,
    cache: createCache({ ttlMs: 1000 }),
  }));
  const res = await request(app).get('/stream/yt:dQw4w9WgXcQ.json');
  assert.equal(res.status, 200);
  assert.ok(res.body.streams.length >= 3);
  await request(app).get('/stream/yt:bad!!.json').expect(404);
  const failing = express();
  failing.get('/stream/:videoId.json', streamRoute({
    getVideoInfo: async () => { throw new Error('boom'); },
    cache: createCache({ ttlMs: 1000 }),
  }));
  await request(failing).get('/stream/yt:dQw4w9WgXcQ.json').expect(502);
});

test('play URLs honor X-Forwarded-Host/Proto when behind a proxy', async () => {
  const app = express();
  app.get('/stream/:videoId.json', streamRoute({
    getVideoInfo: async () => fixture,
    cache: createCache({ ttlMs: 1000 }),
  }));
  const res = await request(app)
    .get('/stream/yt:dQw4w9WgXcQ.json')
    .set('x-forwarded-host', 'addon.mau.codes')
    .set('x-forwarded-proto', 'https');
  assert.deepEqual(
    res.body.streams.filter(s => s.url.includes('/play/')).map(s => s.url),
    [
      'https://addon.mau.codes/play/dQw4w9WgXcQ.mp4?height=1080',
      'https://addon.mau.codes/play/dQw4w9WgXcQ.mp4?height=720',
    ],
  );
});

test('multi-value X-Forwarded-Host uses the first (client-facing) entry', async () => {
  const app = express();
  app.get('/stream/:videoId.json', streamRoute({
    getVideoInfo: async () => fixture,
    cache: createCache({ ttlMs: 1000 }),
  }));
  const res = await request(app)
    .get('/stream/yt:dQw4w9WgXcQ.json')
    .set('x-forwarded-host', 'addon.mau.codes, internal-proxy')
    .set('x-forwarded-proto', 'https');
  const fmp4 = res.body.streams.find(s => s.url.includes('/play/'));
  assert.ok(fmp4.url.startsWith('https://addon.mau.codes/'));
});

test('without forwarded headers, play URLs use the request host', async () => {
  const app = express();
  app.get('/stream/:videoId.json', streamRoute({
    getVideoInfo: async () => fixture,
    cache: createCache({ ttlMs: 1000 }),
  }));
  const res = await request(app)
    .get('/stream/yt:dQw4w9WgXcQ.json')
    .set('host', '192.168.0.5:7000');
  const fmp4 = res.body.streams.find(s => s.url.includes('/play/'));
  assert.match(fmp4.url, /^http:\/\/192\.168\.0\.5:7000\/play\//);
});
