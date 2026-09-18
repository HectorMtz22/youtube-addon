import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylistInput, encodeConfig, decodeConfig } from '../src/services/playlistConfig.js';

test('parsePlaylistInput handles URLs, bare ids, mixed lines', () => {
  const out = parsePlaylistInput([
    'https://www.youtube.com/playlist?list=PL1234567890ab',
    'watch?v=abc&list=RDabcdef123456&t=30',
    'PLabcdefgh1234',
    '',
    'not-a-list!!',
  ].join('\n'));
  assert.deepEqual(out, [
    { id: 'PL1234567890ab', url: 'https://www.youtube.com/playlist?list=PL1234567890ab' },
    { id: 'RDabcdef123456', url: 'https://www.youtube.com/playlist?list=RDabcdef123456' },
    { id: 'PLabcdefgh1234', url: 'https://www.youtube.com/playlist?list=PLabcdefgh1234' },
  ]);
});

test('parsePlaylistInput caps at 50 entries', () => {
  const many = Array.from({ length: 60 }, (_, i) => `PL${String(i).padStart(11, '0')}`).join('\n');
  assert.equal(parsePlaylistInput(many).length, 50);
});

test('config encode/decode roundtrip', () => {
  const cfg = { playlists: [{ id: 'PL1234567890ab', url: 'https://www.youtube.com/playlist?list=PL1234567890ab' }] };
  const seg = encodeConfig(cfg);
  assert.match(seg, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeConfig(seg), cfg);
});

test('decodeConfig rejects garbage and oversized configs', () => {
  assert.equal(decodeConfig('!!!'), null);
  assert.equal(decodeConfig(encodeConfig({ playlists: Array.from({ length: 60 }, () => ({ id: 'PL1234567890ab', url: 'u' })) })), null);
  assert.equal(decodeConfig(encodeConfig({ playlists: 'nope' })), null);
});
