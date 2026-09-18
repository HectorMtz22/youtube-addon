// Background prefetch: warm meta/info caches after a catalog response so
// detail-page and stream requests respond from cache instead of a 2-3s
// synchronous yt-dlp run (client request timeouts truncate those responses).
export function createPrefetcher({ getVideoInfo, metaCache, infoCache, buildMeta, concurrency = 3, limit = 8 }) {
  let running = false;

  return function prefetch(ids) {
    const queue = ids.slice(0, limit).filter(id => !infoCache.get(`info:${id}`));
    if (!queue.length || running) return;
    running = true;

    (async () => {
      for (let i = 0; i < queue.length; i += concurrency) {
        const batch = queue.slice(i, i + concurrency);
        await Promise.allSettled(batch.map(async id => {
          try {
            const info = await getVideoInfo(id);
            infoCache.set(`info:${id}`, info);
            metaCache.set(`meta:${id}`, buildMeta(info));
          } catch (err) {
            console.error(`[prefetch] failed for ${id}:`, String(err.message || err).slice(0, 200));
          }
        }));
      }
    })().finally(() => { running = false; });
  };
}
