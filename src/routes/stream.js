import { isValidVideoId, getVideoInfo } from '../services/ytdlp.js';

export function buildStreams(info, playBaseUrl) {
  const id = info.id;
  const formats = info.formats || [];
  const streams = [];
  const hls = formats
    .filter(f => f.manifest_url && (f.protocol || '').startsWith('m3u8') && (f.vcodec || '').startsWith('avc1'))
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
  if (hls) {
    streams.push({
      title: `HLS ${hls.height || '?'}p — seek & PiP`,
      name: `HLS ${hls.height || '?'}p`,
      url: hls.manifest_url,
      behaviorHints: { notWebReady: false },
    });
  }
  for (const h of [1080, 720]) {
    if (formats.some(f => (f.vcodec || '').startsWith('avc1') && f.acodec === 'none' && f.height === h)
        && formats.some(f => f.vcodec === 'none' && (f.acodec || '').startsWith('mp4a'))) {
      streams.push({
        title: `${h}p (remux)`,
        name: `${h}p`,
        url: `${playBaseUrl}play/${id}.mp4?height=${h}`,
        behaviorHints: { notWebReady: false },
      });
    }
  }
  const p18 = formats.find(f => f.format_id === '18');
  if (p18 && p18.url) {
    streams.push({
      title: '360p (direct)',
      name: '360p',
      url: p18.url,
      behaviorHints: { notWebReady: false },
    });
  }
  return streams;
}

export function streamRoute({ getVideoInfo, cache }) {
  return async (req, res) => {
    const videoId = (req.params.videoId || '').replace(/^yt:/, '');
    if (!isValidVideoId(videoId)) return res.status(404).json({ error: 'invalid video id' });
    const cacheKey = `streams:${videoId}`;
    let streams = cache.get(cacheKey);
    if (!streams) {
      let info;
      try {
        info = await getVideoInfo(videoId);
      } catch (err) {
        console.error(`[stream] extraction failed for ${videoId}:`, String(err.message || err));
        return res.status(502).json({ error: 'yt-dlp extraction failed' });
      }
      const playBaseUrl = `${req.protocol}://${req.headers.host}${req.baseUrl || ''}/`;
      streams = buildStreams(info, playBaseUrl);
      cache.set(cacheKey, streams);
    }
    res.json({ streams });
  };
}
