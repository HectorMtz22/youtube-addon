import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { isValidVideoId, getVideoInfo } from '../services/ytdlp.js';

export function pickFormatPair(formats, height = 1080) {
  const video = formats
    .filter(f => (f.vcodec || '').startsWith('avc1') && f.acodec === 'none' && (f.height || 0) <= height)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0] || null;
  const audio = formats
    .filter(f => f.vcodec === 'none' && (f.acodec || '').startsWith('mp4a'))
    .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0] || null;
  const progressive = formats.find(f => f.format_id === '18' && f.url) || null;
  return { video, audio, progressive };
}

export function buildFfmpegArgs(videoUrl, audioUrl) {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-i', videoUrl, '-i', audioUrl,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'copy',
    '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4', 'pipe:1',
  ];
}

export function playRoute({ getVideoInfo } = {}) {
  return async (req, res) => {
    const videoId = req.params.videoId;
    if (!isValidVideoId(videoId)) return res.status(404).json({ error: 'invalid video id' });
    // Clients probe stream URLs with HEAD — answer instantly instead of
    // running a full extraction for a body that will never be sent.
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'none');
      return res.status(200).end();
    }
    const height = Math.min(Math.max(parseInt(req.query.height, 10) || 1080, 360), 1080);
    let info;
    try {
      info = await getVideoInfo(videoId);
    } catch (err) {
      console.error(`[play] extraction failed for ${videoId}:`, String(err.message || err));
      return res.status(502).json({ error: 'yt-dlp extraction failed' });
    }
    const { video, audio, progressive } = pickFormatPair(info.formats || [], height);
    if ((!video || !audio) && progressive) {
      return res.redirect(302, progressive.url);
    }
    if (!video || !audio) return res.status(404).json({ error: 'no muxable formats' });

    res.setHeader('Content-Type', 'video/mp4');
    const ff = spawn('ffmpeg', buildFfmpegArgs(video.url, audio.url), { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
    // Spec §7: never exit on per-request errors — an ENOENT here (ffmpeg
    // missing) would otherwise surface as an uncaughtException.
    ff.on('error', err => {
      console.error('[play] spawn failed:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'ffmpeg spawn failed' });
      else res.end();
    });
    pipeline(ff.stdout, res).catch(err => console.error('[play] stream pipe error:', err.message));
    res.on('close', () => ff.kill('SIGKILL'));
    ff.on('close', code => {
      if (code !== 0 && !res.writableEnded) {
        console.error(`[play] ffmpeg exited ${code} for ${videoId}: ${stderr.slice(-500)}`);
        if (!res.headersSent) res.status(502).json({ error: 'ffmpeg failed' });
        else res.end();
      }
    });
  };
}
