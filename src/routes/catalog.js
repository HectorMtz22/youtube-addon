import { normalizeQuery } from '../services/ytdlp.js';

export function catalogRoute({ searchVideos, cache }) {
  return async (req, res) => {
    // Stremio requests /catalog/{type}/{id}/search={query}.json — Express 4
    // matches that with an :extra param (already percent-decoded), we strip
    // the "search=" prefix. No extra decode: a literal % in the query must
    // not throw URIError inside this async handler.
    const raw = req.params.extra || '';
    const query = normalizeQuery(raw.startsWith('search=') ? raw.slice(7) : raw);
    if (!query) return res.json({ metas: [] });
    const cacheKey = `search:${query}`;
    let metas = cache.get(cacheKey);
    if (!metas) {
      try {
        const videos = await searchVideos(query);
        metas = videos.map(v => ({
          id: `yt:${v.id}`,
          type: 'movie',
          name: v.title,
          poster: v.thumbnail,
          description: null,
        }));
        cache.set(cacheKey, metas);
      } catch (err) {
        console.error(`[catalog] search failed for "${query}":`, String(err.message || err));
        metas = [];
      }
    }
    res.json({ metas });
  };
}
