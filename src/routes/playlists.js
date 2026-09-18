// Playlist catalogs: configured playlists (and later account playlists)
// surface as a 'series' catalog whose metas are the playlists themselves;
// clicking one loads a meta with videos[] for the episode-style queue.
const DEFAULT_POSTER = 'https://i.ytimg.com/vi/placeholder/hqdefault.jpg';

export function playlistsCatalogRoute({ playlistVideos, cache }) {
  return async (req, res) => {
    const playlists = req.ytConfig?.playlists ?? [];
    if (!playlists.length) return res.json({ metas: [] });
    const cacheKey = `plcat:${req.ytConfigSegment}`;
    let metas = cache.get(cacheKey);
    if (!metas) {
      metas = [];
      for (const pl of playlists) {
        try {
          const { title, entries } = await playlistVideos(pl.url);
          if (!entries.length) continue;
          metas.push({
            id: `ytpl:${pl.id}`,
            type: 'series',
            name: title || pl.id,
            poster: entries[0].thumbnail,
            description: null,
          });
        } catch (err) {
          console.error(`[playlists] failed for ${pl.id}:`, String(err.message || err).slice(0, 200));
        }
      }
      cache.set(cacheKey, metas);
    }
    res.json({ metas });
  };
}

export function playlistMetaRoute({ playlistVideos, cache }) {
  return async (req, res) => {
    const plId = (req.params.videoId || '').replace(/^ytpl:/, '');
    const playlists = req.ytConfig?.playlists ?? [];
    const pl = playlists.find(p => p.id === plId);
    if (!pl) return res.status(404).json({ error: 'playlist not configured' });
    const cacheKey = `ytplmeta:${plId}`;
    let meta = cache.get(cacheKey);
    if (!meta) {
      let result;
      try {
        result = await playlistVideos(pl.url);
      } catch (err) {
        console.error(`[playlists] meta failed for ${plId}:`, String(err.message || err).slice(0, 200));
        return res.status(502).json({ error: 'yt-dlp playlist extraction failed' });
      }
      if (!result.entries.length) return res.status(502).json({ error: 'playlist empty or unavailable' });
      meta = {
        id: `ytpl:${plId}`,
        type: 'series',
        name: result.title || plId,
        poster: result.entries[0].thumbnail,
        background: result.entries[0].thumbnail,
        description: null,
        releaseInfo: null,
        videos: result.entries.map((v, i) => ({
          id: `yt:${v.id}`,
          title: v.title,
          released: undefined,
          season: 1,
          episode: i + 1,
        })),
      };
      cache.set(cacheKey, meta);
    }
    res.json({ meta });
  };
}
