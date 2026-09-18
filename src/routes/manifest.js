export function manifestRoute({ addonId = 'community.ytdlp' }) {
  return (_req, res) => {
    res.json({
      id: addonId,
      version: '1.0.0',
      name: 'YouTube (yt-dlp)',
      description: 'Ad-free YouTube search & playback via yt-dlp. Self-hosted.',
      resources: ['catalog', 'meta', 'stream'],
      types: ['movie'],
      catalogs: [{
        type: 'movie',
        id: 'yt-search',
        name: 'YouTube Search',
        extra: [{ name: 'search', isRequired: true }],
      }],
      idPrefixes: ['yt:'],
      behaviorHints: { p2p: false, configurable: false },
    });
  };
}
