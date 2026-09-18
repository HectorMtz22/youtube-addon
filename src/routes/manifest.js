export function manifestRoute({ addonId = 'community.ytdlp', getConfig } = {}) {
  return (req, res) => {
    const config = getConfig?.(req) ?? { playlists: [] };
    const catalogs = [{
      type: 'movie',
      id: 'yt-search',
      name: 'YouTube Search',
      extra: [{ name: 'search', isRequired: true }],
    }];
    if (config.playlists?.length) {
      catalogs.push({
        type: 'series',
        id: 'yt-playlists',
        name: 'YouTube Playlists',
        extra: [{ name: 'skip', isRequired: false }],
      });
    }
    res.json({
      id: addonId,
      version: '1.1.0',
      name: 'YouTube (yt-dlp)',
      description: 'Ad-free YouTube search & playback via yt-dlp. Self-hosted.' +
        (config.playlists?.length ? ` ${config.playlists.length} playlist(s) configured.` : ' Configure playlists at /configure.'),
      resources: ['catalog', 'meta', 'stream'],
      types: ['movie', 'series'],
      catalogs,
      idPrefixes: ['yt:', 'ytpl:'],
      behaviorHints: { p2p: false, configurable: true },
    });
  };
}
