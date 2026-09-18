import { isValidVideoId } from '../services/ytdlp.js';

export function metaRoute({ getVideoInfo, cache }) {
  return async (req, res) => {
    const videoId = (req.params.videoId || '').replace(/^yt:/, '');
    if (!isValidVideoId(videoId)) return res.status(404).json({ error: 'invalid video id' });
    const cacheKey = `meta:${videoId}`;
    let meta = cache.get(cacheKey);
    if (!meta) {
      let info;
      try {
        info = await getVideoInfo(videoId);
      } catch (err) {
        console.error(`[meta] failed for ${videoId}:`, String(err.message || err));
        return res.status(502).json({ error: 'yt-dlp extraction failed' });
      }
      meta = {
        id: `yt:${info.id}`,
        type: 'movie',
        name: info.title,
        poster: info.thumbnail,
        background: info.thumbnail,
        description: info.description || null,
        releaseInfo: (info.upload_date || '').slice(0, 4) || null,
        runtime: info.duration ? `${Math.max(1, Math.round(info.duration / 60))} min` : null,
        videos: [{
          id: `yt:${info.id}`,
          title: info.title,
          released: info.upload_date
            ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
            : undefined,
        }],
      };
      cache.set(cacheKey, meta);
    }
    res.json({ meta });
  };
}
