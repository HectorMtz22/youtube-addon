import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFormatPair, buildFfmpegArgs } from '../src/routes/play.js';
import fixture from './fixtures/video-info.json' with { type: 'json' };

test('pickFormatPair selects best avc1 video + mp4a audio under height cap', () => {
  const { video, audio } = pickFormatPair(fixture.formats, 720);
  assert.equal(video.format_id, '136');
  assert.equal(audio.format_id, '140');
  const { video: v1080 } = pickFormatPair(fixture.formats, 1080);
  assert.equal(v1080.format_id, '137');
});

test('pickFormatPair with only progressive formats → nulls', () => {
  const progressive = fixture.formats.filter(f => f.format_id === '18');
  const { video, audio, progressive: p } = pickFormatPair(progressive, 1080);
  assert.equal(video, null);
  assert.equal(audio, null);
  assert.equal(p.format_id, '18');
});

test('buildFfmpegArgs uses stream copy, fMP4, pipe output — no shell', () => {
  const args = buildFfmpegArgs('https://v.example/v', 'https://a.example/a');
  assert.deepEqual(args, [
    '-hide_banner', '-loglevel', 'error',
    '-i', 'https://v.example/v', '-i', 'https://a.example/a',
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'copy',
    '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4', 'pipe:1',
  ]);
});
