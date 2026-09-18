import { isValidVideoId, getVideoInfo } from '../services/ytdlp.js';

export function buildStreams(info, playBaseUrl) {
  const id = info.id;
  const formats = info.formats || [];
  const streams = [];
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

// Behind a reverse proxy the original host/proto arrive in X-Forwarded-*
// headers; use them so play URLs carry the client-facing (public) address
// instead of the internal one. First entry = client-facing host.
export function requestBaseUrl(req) {
  const fwdHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const fwdProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const host = fwdHost || req.headers.host || '';
  const proto = fwdProto || req.protocol;
  return `${proto}://${host}${req.baseUrl || ''}/`;
}

export function streamRoute({ getVideoInfo, cache, metaCache, buildMeta }) {
  return async (req, res) => {
    const videoId = (req.params.videoId || '').replace(/^yt:/, '');
    if (!isValidVideoId(videoId)) return res.status(404).json({ error: 'invalid video id' });
    // Cache stores the raw yt-dlp info; the ladder is rebuilt per request so
    // play URLs always match the current client-facing host. Cache hits are
    // instant (populated by the prefetcher right after a search).
    let info = cache.get(`info:${videoId}`);
    if (!info) {
      try {
        info = await getVideoInfo(videoId);
        cache.set(`info:${videoId}`, info);
        metaCache?.set(`meta:${videoId}`, buildMeta(info));
      } catch (err) {
        console.error(`[stream] extraction failed for ${videoId}:`, String(err.message || err));
        return res.status(502).json({ error: 'yt-dlp extraction failed' });
      }
    }
    res.json({ streams: buildStreams(info, requestBaseUrl(req)) });
  };
}
