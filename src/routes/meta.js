import { isValidVideoId } from '../services/ytdlp.js';

// Instant detail-page source: YouTube's own oEmbed endpoint (no extraction,
// ~200ms). Streams still need full yt-dlp extraction — warmed in background.
async function fetchOembed(videoId) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`oembed HTTP ${res.status}`);
  const d = await res.json();
  return {
    id: `yt:${videoId}`,
    type: 'movie',
    name: d.title,
    poster: d.thumbnail_url,
    background: d.thumbnail_url,
    description: null,
    releaseInfo: null,
    released: null,
    runtime: null,
    videos: [{ id: `yt:${videoId}`, title: d.title }],
  };
}

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

export function metaRoute({ getVideoInfo, cache, infoCache, prefetch, oembed = fetchOembed }) {
  return async (req, res) => {
    const videoId = (req.params.videoId || '').replace(/^yt:/, '');
    if (!isValidVideoId(videoId)) return res.status(404).json({ error: 'invalid video id' });
    const cacheKey = `meta:${videoId}`;
    let meta = cache.get(cacheKey);
    if (!meta) {
      // Fast path 1: prefetch already extracted it — build from cached info.
      let info = infoCache ? infoCache.get(`info:${videoId}`) : undefined;
      if (info) {
        meta = buildMeta(info);
        cache.set(cacheKey, meta);
      } else {
        // Fast path 2: oEmbed (~200ms) — NEVER block the detail page on a
        // 2-3s yt-dlp run (native Stremio clients abort before that).
        try {
          meta = await oembed(videoId);
        } catch (err) {
          console.error(`[meta] oembed failed for ${videoId}:`, String(err.message || err));
          meta = null;
        }
        if (meta) {
          cache.set(cacheKey, meta);
        } else {
          let extracted;
          try {
            extracted = await getVideoInfo(videoId);
          } catch (err) {
            console.error(`[meta] failed for ${videoId}:`, String(err.message || err));
            return res.status(502).json({ error: 'yt-dlp extraction failed' });
          }
          infoCache?.set(`info:${videoId}`, extracted);
          meta = buildMeta(extracted);
          cache.set(cacheKey, meta);
        }
        // Warm the stream cache for this video in the background.
        prefetch?.([videoId]);
      }
    }
    res.json({ meta });
  };
}
