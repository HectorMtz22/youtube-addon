import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidVideoId, normalizeQuery, searchVideos, runYtDlp } from '../src/services/ytdlp.js';

test('isValidVideoId', () => {
  assert.equal(isValidVideoId('dQw4w9WgXcQ'), true);
  assert.equal(isValidVideoId('-abc123_-45'), true);
  assert.equal(isValidVideoId('short'), false);
  assert.equal(isValidVideoId('toolongvideoid!!'), false);
  assert.equal(isValidVideoId('-flag dQw4w9W'), false); // 12 chars / bad chars
  assert.equal(isValidVideoId(''), false);
});

test('normalizeQuery', () => {
  assert.equal(normalizeQuery('  hello   world  '), 'hello world');
  assert.equal(normalizeQuery('a'.repeat(250)), 'a'.repeat(200));
  assert.equal(normalizeQuery('   '), null);
  assert.equal(normalizeQuery(null), null);
});

test('searchVideos shells out with argument array (no shell)', async () => {
  const calls = [];
  const fakeRun = async (args) => { calls.push(args); return [
    JSON.stringify({ id: 'aaaaaaaaaaa', title: 'V1', duration: 61 }),
    JSON.stringify({ id: 'bbbbbbbbbbb', title: 'V2', duration: 120 }),
  ].join('\n'); };
  const out = await searchVideos('test query', { run: fakeRun });
  assert.equal(calls[0].at(-1), 'ytsearch20:test query');
  assert.ok(calls[0].every(a => typeof a === 'string')); // argument array, no shell string
  assert.equal(out[0].id, 'aaaaaaaaaaa');
  assert.equal(out[0].thumbnail, 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
  assert.equal(out[1].title, 'V2');
});

test('runYtDlp wraps execFile and rejects on nonzero exit', async () => {
  await assert.rejects(() => runYtDlp(['--version-nope'], { bin: 'false' }));
});
