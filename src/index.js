import express from 'express';
import { manifestRoute } from './routes/manifest.js';
import { catalogRoute } from './routes/catalog.js';
import { metaRoute } from './routes/meta.js';
import { streamRoute } from './routes/stream.js';
import { playRoute } from './routes/play.js';
import { createCache } from './services/cache.js';
import { searchVideos, getVideoInfo } from './services/ytdlp.js';

export function createApp({ token, deps = {} }) {
  if (typeof token !== 'string' || token.length < 20) {
    throw new Error('ADDON_TOKEN required: 20+ random chars (openssl rand -hex 16)');
  }
  const searchCache = createCache({ ttlMs: 30 * 60 * 1000 });
  const metaCache = createCache({ ttlMs: 60 * 60 * 1000 });
  const streamCache = createCache({ ttlMs: 10 * 60 * 1000 });
  const ytdlp = {
    searchVideos: deps.searchVideos ?? searchVideos,
    getVideoInfo: deps.getVideoInfo ?? getVideoInfo,
  };

  const app = express();
  app.disable('x-powered-by');
  app.get('/', (_req, res) => res.json({ status: 'ok', name: 'youtube-addon' }));

  // Mount everything under /:token via a Router so handlers see
  // req.baseUrl = /<token> and play URLs automatically carry the token.
  const router = express.Router();
  router.get('/manifest.json', manifestRoute({ addonId: process.env.ADDON_ID || 'community.ytdlp' }));
  router.get('/catalog/:type/:id/:extra?.json',
    catalogRoute({ searchVideos: ytdlp.searchVideos, cache: searchCache }));
  router.get('/meta/:type/:videoId.json',
    metaRoute({ getVideoInfo: ytdlp.getVideoInfo, cache: metaCache }));
  router.get('/stream/:type/:videoId.json',
    streamRoute({ getVideoInfo: ytdlp.getVideoInfo, cache: streamCache }));
  router.get('/play/:videoId.mp4', playRoute({ getVideoInfo: ytdlp.getVideoInfo }));

  app.use('/:token',
    (req, res, next) => req.params.token === token ? next() : res.status(404).json({ error: 'not found' }),
    router);

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
