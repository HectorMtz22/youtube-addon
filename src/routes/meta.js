import { isValidVideoId } from '../services/ytdlp.js';

export function buildMeta(info) {
  return {
    id: `yt:${info.id}`,
    type: 'movie',
    name: info.title,
    poster: info.thumbnail,
    background: info.thumbnail,
    // Description removed for now: large payloads were breaking some
    // clients at the detail-page fetch (investigating; see meta tests).
    description: null,
    releaseInfo: (info.upload_date || '').slice(0, 4) || null,
    // Cinemeta includes top-level `released` (ISO date) — Stremio's core
    // detail-page model expects it; missing it breaks meta parsing there.
    released: info.upload_date
      ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
      : null,
    runtime: info.duration ? `${Math.max(1, Math.round(info.duration / 60))} min` : null,
    videos: [{
      id: `yt:${info.id}`,
      title: info.title,
      released: info.upload_date
        ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
        : undefined,
    }],
  };
}

export function metaRoute({ getVideoInfo, cache, infoCache }) {
  return async (req, res) => {
    const videoId = (req.params.videoId || '').replace(/^yt:/, '');
    if (!isValidVideoId(videoId)) return res.status(404).json({ error: 'invalid video id' });
    const cacheKey = `meta:${videoId}`;
    let meta = cache.get(cacheKey);
    if (!meta) {
      // Prefetch may have already stored the raw info — build meta from it
      // (instant) before falling back to a synchronous yt-dlp run.
      let info = infoCache ? infoCache.get(`info:${videoId}`) : undefined;
      if (!info) {
        try {
          info = await getVideoInfo(videoId);
          infoCache?.set(`info:${videoId}`, info);
        } catch (err) {
          console.error(`[meta] failed for ${videoId}:`, String(err.message || err));
          return res.status(502).json({ error: 'yt-dlp extraction failed' });
        }
      }
      meta = buildMeta(info);
      cache.set(cacheKey, meta);
    }
    res.json({ meta });
  };
}
