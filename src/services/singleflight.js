// Coalesce concurrent calls for the same id into one in-flight promise:
// avoids duplicate yt-dlp extractions when prefetch and a client request
// race for the same video.
export function singleFlight(fn) {
  const inflight = new Map();
  return (id) => {
    if (inflight.has(id)) return inflight.get(id);
    const p = Promise.resolve()
      .then(() => fn(id))
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  };
}
