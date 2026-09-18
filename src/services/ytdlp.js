import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export function isValidVideoId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}

export function normalizeQuery(q) {
  if (typeof q !== 'string') return null;
  const s = q.replace(/\s+/g, ' ').trim().slice(0, 200);
  return s.length ? s : null;
}

// Optional poToken provider (bgutil): when POT_PROVIDER_URL is set, every
// yt-dlp run asks the provider for a proof-of-origin token. If the provider
// is unreachable the plugin fails open — extraction continues without it.
export function potArgs() {
  const url = process.env.POT_PROVIDER_URL;
  return url ? ['--extractor-args', `youtubepot-bgutilhttp:base_url=${url}`] : [];
}

export async function runYtDlp(args, { timeoutMs = 90000, bin = 'yt-dlp' } = {}) {
  const { stdout } = await execFileP(bin, [...potArgs(), ...args], {
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

export async function searchVideos(query, { limit = 20, run = runYtDlp } = {}) {
  const out = await run(['--flat-playlist', '--dump-json', '--no-warnings', `ytsearch${limit}:${query}`]);
  return out
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const v = JSON.parse(line);
      return {
        id: v.id,
        title: v.title,
        duration: v.duration ?? null,
        thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      };
    });
}

export async function playlistVideos(url, { run = runYtDlp, limit = 200 } = {}) {
  // -J --flat-playlist returns the playlist object: { title, entries: [...] }
  const out = await run(['-J', '--flat-playlist', '--no-warnings', `--playlist-items=1-${limit}`, url]);
  const playlist = JSON.parse(out);
  const entries = (playlist.entries || [])
    .map(v => ({
      id: v.id,
      title: v.title,
      duration: v.duration ?? null,
      thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    }))
    .filter(v => isValidVideoId(v.id));
  return { title: playlist.title ?? null, entries };
}

export async function getVideoInfo(videoId, { run = runYtDlp } = {}) {
  if (!isValidVideoId(videoId)) throw new Error('invalid video id');
  return JSON.parse(await run(['-J', '--no-warnings', `https://www.youtube.com/watch?v=${videoId}`]));
}
