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
  assert.equal(streams[0].url, 'https://manifest.googlevideo.com/api/manifest/hls_playlist/fixture.m3u8');
  assert.match(streams[0].title, /HLS.*1080p/);
  const fmp4 = streams.filter(s => s.url.includes('/play/'));
  assert.deepEqual(fmp4.map(s => s.url), [
    'http://srv:7000/tok123/play/dQw4w9WgXcQ.mp4?height=1080',
    'http://srv:7000/tok123/play/dQw4w9WgXcQ.mp4?height=720',
  ]);
  assert.equal(streams.at(-1).url, 'https://rr1---sn-x.googlevideo.com/videoplayback?fixture=18');
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
