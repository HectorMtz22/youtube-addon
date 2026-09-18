import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { manifestRoute } from '../src/routes/manifest.js';

function app() {
  const app = express();
  app.get('/manifest.json', manifestRoute({ addonId: 'community.ytdlp' }));
  return app;
}

test('serves a valid Stremio manifest', async () => {
  const res = await request(app()).get('/manifest.json').expect(200);
  assert.equal(res.body.id, 'community.ytdlp');
  assert.deepEqual(res.body.types, ['movie']);
  assert.deepEqual(res.body.idPrefixes, ['yt:']);
  assert.deepEqual(res.body.resources, ['catalog', 'meta', 'stream']);
  assert.equal(res.body.catalogs[0].id, 'yt-search');
  assert.equal(res.body.catalogs[0].extra[0].name, 'search');
});
