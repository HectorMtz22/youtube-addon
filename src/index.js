import express from 'express';
import { manifestRoute } from './routes/manifest.js';
import { catalogRoute } from './routes/catalog.js';
import { metaRoute } from './routes/meta.js';
import { streamRoute } from './routes/stream.js';
import { playRoute } from './routes/play.js';
import { createCache } from './services/cache.js';
import { createPrefetcher } from './services/prefetch.js';
import { encodeConfig, parsePlaylistInput, decodeConfig } from './services/playlistConfig.js';
import { singleFlight } from './services/singleflight.js';
import { searchVideos, getVideoInfo, playlistVideos } from './services/ytdlp.js';
import { buildMeta } from './routes/meta.js';
import { playlistsCatalogRoute, playlistMetaRoute } from './routes/playlists.js';
import { configureRoute } from './routes/configure.js';

export function createApp({ token, deps = {} }) {
  if (typeof token !== 'string' || token.length < 20) {
    throw new Error('ADDON_TOKEN required: 20+ random chars (openssl rand -hex 16)');
  }
  const searchCache = createCache({ ttlMs: 30 * 60 * 1000 });
  const metaCache = createCache({ ttlMs: 60 * 60 * 1000 });
  const infoCache = createCache({ ttlMs: 10 * 60 * 1000 });
  const hlsCache = createCache({ ttlMs: 6 * 60 * 1000 }); // pinned HLS playlist URLs (expire sooner than extraction URLs)
  const ytdlp = {
    searchVideos: deps.searchVideos ?? searchVideos,
    playlistVideos: deps.playlistVideos ?? playlistVideos,
    // One extraction per video id no matter who asks (prefetch, meta, stream).
    getVideoInfo: singleFlight(deps.getVideoInfo ?? getVideoInfo),
  };
  const prefetch = createPrefetcher({
    getVideoInfo: ytdlp.getVideoInfo,
    metaCache,
    infoCache,
    buildMeta,
    hlsCache,
  });

  const app = express();
  app.disable('x-powered-by');
  // Always-200: no ETag/304 — some Stremio clients surface the 304
  // empty-body as a serialization error instead of using their cache.
  app.disable('etag');
  app.get('/', (_req, res) => res.json({ status: 'ok', name: 'youtube-addon' }));

  // Shared router factory: used for both the plain (unconfigured) and the
  // cfg-qualified mounts, so play URLs carry the full prefix and handlers
  // read the config from req.ytConfig.
  function buildRouter() {
    const router = express.Router();

    // Access log: one line per completed request (method, path, status, ms).
    router.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        console.log(`[access] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
      });
      next();
    });

    // JSON bodies get a trailing newline: some native HTTP stacks hand raw
    // socket buffers to hand-rolled parsers that mis-handle an EOF that lands
    // immediately after the closing brace. The newline is spec-legal and
    // harmless to compliant clients.
    router.use((req, res, next) => {
      const json = res.json.bind(res);
      res.json = (body) => res.set('Content-Type', 'application/json; charset=utf-8')
        .send(JSON.stringify(body) + '\n');
      next();
    });

    router.get('/manifest.json', manifestRoute({
      addonId: process.env.ADDON_ID || 'community.ytdlp',
      getConfig: (req) => req.ytConfig,
    }));
    // Configured playlists catalog — before the generic search catalog.
    router.get('/catalog/series/yt-playlists/:extra?.json',
      playlistsCatalogRoute({ playlistVideos: ytdlp.playlistVideos, cache: searchCache }));
    router.get('/catalog/:type/:id/:extra?.json',
      catalogRoute({ searchVideos: ytdlp.searchVideos, cache: searchCache, prefetch }));
    router.get('/meta/:type/:videoId.json',
      (req, res, next) => req.params.videoId.startsWith('ytpl:')
        ? playlistMetaRoute({ playlistVideos: ytdlp.playlistVideos, cache: searchCache })(req, res)
        : metaRoute({ getVideoInfo: ytdlp.getVideoInfo, cache: metaCache, infoCache })(req, res, next));
    router.get('/stream/:type/:videoId.json',
      streamRoute({ getVideoInfo: ytdlp.getVideoInfo, cache: infoCache, metaCache, buildMeta, hlsCache }));
    router.get('/play/:videoId.mp4', playRoute({ getVideoInfo: ytdlp.getVideoInfo }));
    router.get('/configure', configureRoute({ encodeConfig, parsePlaylistInput }));
    return router;
  }

  const auth = (req, res, next) => req.params.token === token ? next() : res.status(404).json({ error: 'not found' });

  // Unconfigured addon (no cfg segment) + configure page lives here.
  app.use('/:token', auth, (req, res, next) => { req.ytConfig = { playlists: [] }; req.ytConfigSegment = ''; next(); }, buildRouter());

  // Configured variant: /:token/cfg-<base64url>/... — cfg segment carries the
  // playlist config; invalid segments 404 so typos never silently degrade.
  app.use('/:token/:cfg', auth, (req, res, next) => {
    const raw = req.params.cfg.startsWith('cfg-') ? req.params.cfg.slice(4) : req.params.cfg;
    const config = decodeConfig(raw);
    if (!config) return res.status(404).json({ error: 'invalid config segment' });
    req.ytConfig = config;
    req.ytConfigSegment = req.params.cfg;
    next();
  }, buildRouter());

  // Error policy: never exit on per-request errors.
  app.use((err, _req, res, _next) => {
    console.error('[error]', err);
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  });
  return app;
}

process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  const token = process.env.ADDON_TOKEN;
  const port = parseInt(process.env.PORT, 10) || 7000;
  const app = createApp({ token: token ?? '' });
  app.listen(port, '0.0.0.0', () =>
    console.log(`youtube-addon listening on :${port} — install URL: http://<host>:${port}/${token}/manifest.json`));
}
