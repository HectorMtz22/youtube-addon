# yt-dlp Stremio Addon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A minimal, self-hosted Stremio addon that provides ad-free YouTube search + playback in Stremio on iOS, via yt-dlp extraction with an HLS-first playback ladder.

**Architecture:** Single stateless Node.js/Express process in a Docker container, shelling out to a pinned yt-dlp binary (and ffmpeg only for the fMP4 fallback path). All routes sit under a `/{token}/` path prefix. Stremio streams HLS manifests directly from `googlevideo.com`; the server proxies nothing on the happy path.

**Tech Stack:** Node 22 (ESM), Express, `node:test` + supertest, yt-dlp (pinned, SHA256-verified), ffmpeg (stream-copy only), Docker.

**Spec:** `docs/superpowers/specs/2026-09-17-yt-dlp-stremio-addon-design.md`

## Global Constraints

- Node 22, `"type": "module"` (ESM) everywhere
- Runtime dependency: `express` only. Dev dependency: `supertest`. Nothing else.
- No shell invocation anywhere — `execFile`/`spawn` with argument arrays only
- Video IDs validated with `/^[A-Za-z0-9_-]{11}$/` before any use
- yt-dlp invoked with a 90-second timeout on every run (`execFile` `timeout` option)
- No cookies, ever. No disk state. No default `ADDON_TOKEN`.
- Outbound network at runtime: `youtube.com`/`googlevideo.com` only (via yt-dlp)
- Cache TTLs: search 30 min, meta 1 h, stream 10 min
- Test runner: `node --test` (built-in), files named `*.test.js` under `tests/`
- Every task ends in a commit; TDD — failing test before implementation

---

### Task 1: POC gate — verify HLS extraction works today

**Files:**
- Create: `poc/extract-check.sh`
- Create: `docs/superpowers/plans/poc-result.md` (verdict record)

**Interfaces:**
- Consumes: yt-dlp installed locally (`brew install yt-dlp` if missing)
- Produces: written verdict that decides the ladder's top rung in Task 9 (HLS-first vs fMP4-first)

- [ ] **Step 1: Write the POC script**

```bash
#!/usr/bin/env bash
# Usage: poc/extract-check.sh <youtube video id or url>
set -euo pipefail
TARGET="${1:?usage: poc/extract-check.sh <video-id-or-url>}"
yt-dlp --no-warnings -J "$TARGET" | python3 -c '
import json, sys
info = json.load(sys.stdin)
formats = info.get("formats", [])
hls = [f for f in formats
       if f.get("manifest_url") and "m3u8" in (f.get("protocol") or "")
       and (f.get("vcodec") or "").startswith("avc1")]
if not hls:
    print("NO HLS FORMATS FOUND")
    sys.exit(2)
best = max(hls, key=lambda f: f.get("height") or 0)
print(json.dumps({
    "video_id": info.get("id"),
    "title": info.get("title"),
    "hls_height": best.get("height"),
    "hls_manifest_url": best.get("manifest_url"),
}, indent=2))
'
```

- [ ] **Step 2: Install yt-dlp locally if missing and run the POC**

```bash
command -v yt-dlp || brew install yt-dlp
chmod +x poc/extract-check.sh
./poc/extract-check.sh dQw4w9WgXcQ
```

Expected: JSON with `hls_height` ≥ 720 and a `https://manifest.googlevideo.com/...m3u8` URL. Exit code 2 means no HLS formats today.

- [ ] **Step 3: Verify the manifest plays from a different IP (the iPhone test)**

Manual step, documented in the script output: copy `hls_manifest_url`, open on the iPhone (Safari / VLC app) while on cellular or VPN — a *different IP* than the machine that ran extraction. If it plays: HLS is IP-portable and the ladder top is confirmed. If it 403s: record that; ladder top becomes fMP4.

- [ ] **Step 4: Record the verdict**

Create `docs/superpowers/plans/poc-result.md` containing: date, yt-dlp version (`yt-dlp --version`), HLS height found, whether playback from a different IP worked, and the resulting ladder decision (HLS-first or fMP4-first). Commit both files.

- [ ] **Step 5: Commit**

```bash
git add poc/extract-check.sh docs/superpowers/plans/poc-result.md
git commit -m "test: POC — verify yt-dlp HLS extraction and cross-IP playback"
```

---

### Task 2: Project scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`
- Test: `tests/smoke.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` harness (node --test); `express` installed; `.env.example` with required vars

- [ ] **Step 1: Create package.json**

```json
{
  "name": "youtube-addon",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test tests/",
    "start": "node src/index.js"
  },
  "dependencies": { "express": "^4.19.0" },
  "devDependencies": { "supertest": "^7.0.0" }
}
```

- [ ] **Step 2: Create .gitignore and .env.example**

`.gitignore`:
```
node_modules/
.env
```

`.env.example`:
```
PORT=7000
ADDON_ID=community.ytdlp
ADDON_TOKEN=  # required — generate with: openssl rand -hex 16
```

- [ ] **Step 3: Install and write the smoke test**

```bash
npm install
```

`tests/smoke.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test harness runs and express is importable', async () => {
  const express = (await import('express')).default;
  assert.equal(typeof express, 'function');
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example tests/smoke.test.js
git commit -m "chore: scaffold ESM project with node:test harness"
```

---

### Task 3: TTL cache service

**Files:**
- Create: `src/services/cache.js`
- Test: `tests/cache.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `createCache({ ttlMs }) → { get(key), set(key, value), size }` — used by Tasks 6–8

- [ ] **Step 1: Write the failing test**

`tests/cache.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../src/services/cache.js';

test('set/get roundtrip and miss', () => {
  const c = createCache({ ttlMs: 1000 });
  c.set('a', { x: 1 });
  assert.deepEqual(c.get('a'), { x: 1 });
  assert.equal(c.get('missing'), undefined);
});

test('expired entries return undefined and are evicted', async () => {
  const c = createCache({ ttlMs: 20 });
  c.set('a', 1);
  await new Promise(r => setTimeout(r, 40));
  assert.equal(c.get('a'), undefined);
  assert.equal(c.size, 0);
});

test('set overwrites value and refreshes ttl', async () => {
  const c = createCache({ ttlMs: 1000 });
  c.set('a', 1);
  c.set('a', 2);
  assert.equal(c.get('a'), 2);
  assert.equal(c.size, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/services/cache.js'`

- [ ] **Step 3: Implement**

`src/services/cache.js`:
```js
export function createCache({ ttlMs }) {
  const map = new Map();
  return {
    set(key, value) {
      map.set(key, { value, expires: Date.now() + ttlMs });
    },
    get(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (Date.now() >= entry.expires) {
        map.delete(key);
        return undefined;
      }
      return entry.value;
    },
    get size() {
      return map.size;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/cache.js tests/cache.test.js
git commit -m "feat: TTL cache service"
```

---

### Task 4: yt-dlp service (validation + runner + search)

**Files:**
- Create: `src/services/ytdlp.js`
- Test: `tests/ytdlp.test.js`

**Interfaces:**
- Consumes: system `yt-dlp` binary (only through `execFile`, injectable for tests)
- Produces:
  - `isValidVideoId(id) → boolean`
  - `normalizeQuery(q) → string | null` (trimmed, whitespace-collapsed, max 200 chars, null if empty)
  - `runYtDlp(args, { timeoutMs = 90000 }) → Promise<string>` (raw stdout)
  - `searchVideos(query, { limit = 20 }) → Promise<Array<{ id, title, thumbnail, duration }>>`
  - `getVideoInfo(videoId) → Promise<object>` (raw yt-dlp `-J` JSON)

- [ ] **Step 1: Write the failing test**

`tests/ytdlp.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidVideoId, normalizeQuery, searchVideos, runYtDlp } from '../src/services/ytdlp.js';

test('isValidVideoId', () => {
  assert.equal(isValidVideoId('dQw4w9WgXcQ'), true);
  assert.equal(isValidVideoId('-abc123_-45'), true);
  assert.equal(isValidVideoId('short'), false);
  assert.equal(isValidVideoId('toolongvideoid!!'), false);
  assert.equal(isValidVideoId('-flag dQw4w9W'), false); // 12 chars / bad chars
  assert.equal(isValidVideoId(''), false);
});

test('normalizeQuery', () => {
  assert.equal(normalizeQuery('  hello   world  '), 'hello world');
  assert.equal(normalizeQuery('a'.repeat(250)), 'a'.repeat(200));
  assert.equal(normalizeQuery('   '), null);
  assert.equal(normalizeQuery(null), null);
});

test('searchVideos shells out with argument array (no shell)', async () => {
  const calls = [];
  const fakeRun = async (args) => { calls.push(args); return [
    JSON.stringify({ id: 'aaaaaaaaaaa', title: 'V1', duration: 61 }),
    JSON.stringify({ id: 'bbbbbbbbbbb', title: 'V2', duration: 120 }),
  ].join('\n'); };
  const out = await searchVideos('test query', { run: fakeRun });
  assert.equal(calls[0].at(-1), 'ytsearch20:test query');
  assert.ok(calls[0].every(a => typeof a === 'string')); // argument array, no shell string
  assert.equal(out[0].id, 'aaaaaaaaaaa');
  assert.equal(out[0].thumbnail, 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
  assert.equal(out[1].title, 'V2');
});

test('runYtDlp wraps execFile and rejects on nonzero exit', async () => {
  await assert.rejects(() => runYtDlp(['--version-nope'], { bin: 'false' }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/services/ytdlp.js`:
```js
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

export async function runYtDlp(args, { timeoutMs = 90000, bin = 'yt-dlp' } = {}) {
  const { stdout } = await execFileP(bin, args, {
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

export async function getVideoInfo(videoId, { run = runYtDlp } = {}) {
  if (!isValidVideoId(videoId)) throw new Error('invalid video id');
  return JSON.parse(await run(['-J', '--no-warnings', `https://www.youtube.com/watch?v=${videoId}`]));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/services/ytdlp.js tests/ytdlp.test.js
git commit -m "feat: yt-dlp service with strict validation and search"
```

---

### Task 5: Manifest route

**Files:**
- Create: `src/routes/manifest.js`
- Test: `tests/manifest.test.js`

**Interfaces:**
- Consumes: nothing yet (uses `process.env.ADDON_ID`, default `community.ytdlp`)
- Produces: `manifestRoute({ addonId })` Express handler; manifest shape (id `community.ytdlp`, catalog id `yt-search`, types `['movie']`, idPrefixes `['yt:']`) relied on by Tasks 6–8

- [ ] **Step 1: Write the failing test**

`tests/manifest.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { manifestRoute } from '../src/routes/manifest.js';

function app() {
  const app = express();
  app.get('/manifest.json', manifestRoute({ addonId: 'community.ytdlp' }));
  return app;
}

test('serves a valid Stremio manifest', async () => {
  const res = await request(app()).get('/manifest.json').expect(200);
  assert.equal(res.body.id, 'community.ytdlp');
  assert.deepEqual(res.body.types, ['movie']);
  assert.deepEqual(res.body.idPrefixes, ['yt:']);
  assert.deepEqual(res.body.resources, ['catalog', 'meta', 'stream']);
  assert.equal(res.body.catalogs[0].id, 'yt-search');
  assert.equal(res.body.catalogs[0].extra[0].name, 'search');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/routes/manifest.js`:
```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/manifest.js tests/manifest.test.js
git commit -m "feat: Stremio manifest route"
```

---

### Task 6: Catalog (search) route

**Files:**
- Create: `src/routes/catalog.js`
- Test: `tests/catalog.test.js`

**Interfaces:**
- Consumes: `searchVideos(query, { limit })` from Task 4, `createCache({ ttlMs })` from Task 3 (TTL 30 min = `30 * 60 * 1000`)
- Produces: `catalogRoute({ searchVideos, cache })` — responds `200 { metas: [...] }` with `{ id: 'yt:<id>', type: 'movie', name, poster }`; empty `metas` on search failure

- [ ] **Step 1: Write the failing test**

`tests/catalog.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { catalogRoute } from '../src/routes/catalog.js';
import { createCache } from '../src/services/cache.js';

const fakeSearch = async (query) => [{
  id: 'dQw4w9WgXcQ',
  title: 'Test Video',
  duration: 212,
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
}];

test('search catalog returns metas with yt: prefix', async () => {
  const app = express();
  app.get('/catalog/movie/yt-search/:extra?.json',
    catalogRoute({ searchVideos: fakeSearch, cache: createCache({ ttlMs: 1000 }) }));
  const res = await request(app).get('/catalog/movie/yt-search/search=test.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.metas[0].id, 'yt:dQw4w9WgXcQ');
  assert.equal(res.body.metas[0].name, 'Test Video');
  assert.equal(res.body.metas[0].type, 'movie');
});

test('missing search param returns empty metas', async () => {
  const app = express();
  app.get('/catalog/movie/yt-search/:extra?.json',
    catalogRoute({ searchVideos: fakeSearch, cache: createCache({ ttlMs: 1000 }) }));
  const res = await request(app).get('/catalog/movie/yt-search/search=.json');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.metas, []);
});

test('upstream failure returns empty metas, not a crash', async () => {
  const app = express();
  app.get('/catalog/movie/yt-search/:extra?.json',
    catalogRoute({ searchVideos: async () => { throw new Error('boom'); }, cache: createCache({ ttlMs: 1000 }) }));
  const res = await request(app).get('/catalog/movie/yt-search/search=x.json');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.metas, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/routes/catalog.js`:
```js
export function catalogRoute({ searchVideos, cache }) {
  return async (req, res) => {
    // Stremio requests /catalog/{type}/{id}/search={query}.json — Express 4
    // matches that with an :extra param, we strip the "search=" prefix.
    const raw = req.params.extra || '';
    const query = decodeURIComponent(raw.startsWith('search=') ? raw.slice(7) : raw);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/catalog.js tests/catalog.test.js
git commit -m "feat: YouTube search catalog route"
```

---

### Task 7: Meta route

**Files:**
- Create: `src/routes/meta.js`
- Test: `tests/meta.test.js`

**Interfaces:**
- Consumes: `getVideoInfo(videoId)` from Task 4, `createCache` from Task 3 (TTL 1 h = `3600 * 1000`), `isValidVideoId` from Task 4
- Produces: `metaRoute({ getVideoInfo, cache })` — responds `200 { meta }` with `{ id: 'yt:<id>', videos: [{ id: 'yt:<id>', title }] }` (Stremio needs `videos[].id` to issue stream requests); `404` on invalid ID; `502` on upstream failure

- [ ] **Step 1: Write the failing test**

`tests/meta.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { metaRoute } from '../src/routes/meta.js';
import { createCache } from '../src/services/cache.js';

const fakeInfo = {
  id: 'dQw4w9WgXcQ',
  title: 'Test Video',
  description: 'A description',
  duration: 212,
  upload_date: '20260101',
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
};

test('meta returns Stremio meta object', async () => {
  const app = express();
  app.get('/meta/movie/:videoId.json',
    metaRoute({ getVideoInfo: async () => fakeInfo, cache: createCache({ ttlMs: 1000 }) }));
  const res = await request(app).get('/meta/movie/yt:dQw4w9WgXcQ.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.meta.id, 'yt:dQw4w9WgXcQ');
  assert.equal(res.body.meta.name, 'Test Video');
  assert.equal(res.body.meta.videos[0].id, 'yt:dQw4w9WgXcQ');
  assert.equal(res.body.meta.releaseInfo, '2026');
  assert.equal(res.body.meta.runtime, '4 min');
});

test('invalid video id → 404', async () => {
  const app = express();
  app.get('/meta/movie/:videoId.json',
    metaRoute({ getVideoInfo: async () => fakeInfo, cache: createCache({ ttlMs: 1000 }) }));
  await request(app).get('/meta/movie/yt:bad-id!!.json').expect(404);
});

test('upstream failure → 502', async () => {
  const app = express();
  app.get('/meta/movie/:videoId.json',
    metaRoute({ getVideoInfo: async () => { throw new Error('boom'); }, cache: createCache({ ttlMs: 1000 }) }));
  const res = await request(app).get('/meta/movie/yt:dQw4w9WgXcQ.json');
  assert.equal(res.status, 502);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/routes/meta.js`:
```js
import { isValidVideoId } from '../services/ytdlp.js';

export function metaRoute({ getVideoInfo, cache }) {
  return async (req, res) => {
    const videoId = (req.params.videoId || '').replace(/^yt:/, '');
    if (!isValidVideoId(videoId)) return res.status(404).json({ error: 'invalid video id' });
    const cacheKey = `meta:${videoId}`;
    let meta = cache.get(cacheKey);
    if (!meta) {
      let info;
      try {
        info = await getVideoInfo(videoId);
      } catch (err) {
        console.error(`[meta] failed for ${videoId}:`, String(err.message || err));
        return res.status(502).json({ error: 'yt-dlp extraction failed' });
      }
      meta = {
        id: `yt:${info.id}`,
        type: 'movie',
        name: info.title,
        poster: info.thumbnail,
        background: info.thumbnail,
        description: info.description || null,
        releaseInfo: (info.upload_date || '').slice(0, 4) || null,
        runtime: info.duration ? `${Math.max(1, Math.round(info.duration / 60))} min` : null,
        videos: [{
          id: `yt:${info.id}`,
          title: info.title,
          released: info.upload_date
            ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
            : undefined,
        }],
      };
      cache.set(cacheKey, meta);
    }
    res.json({ meta });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/meta.js tests/meta.test.js
git commit -m "feat: meta route for video detail view"
```

---

### Task 8: Stream route — the playback ladder

**Files:**
- Create: `src/routes/stream.js`
- Test: `tests/stream.test.js`
- Create: `tests/fixtures/video-info.json` (trimmed yt-dlp `-J` fixture)

**Interfaces:**
- Consumes: `getVideoInfo` from Task 4, `createCache` from Task 3 (TTL 10 min = `10 * 60 * 1000`), `isValidVideoId` from Task 4
- Produces:
  - `buildStreams(info, playBaseUrl) → Array<Stremio stream>` where `playBaseUrl` is an absolute URL base ending in `/`; exported for reuse/testing
  - `streamRoute({ getVideoInfo, cache })` — responds `200 { streams }`; 404 on invalid id, 502 on upstream failure
  - Stream object shape: `{ title, name?, url, behaviorHints: { notWebReady: false } }` — later Task 9's `/play` URL must match: `${playBaseUrl}play/${id}.mp4?height=${h}`

- [ ] **Step 1: Create the fixture**

`tests/fixtures/video-info.json` — a trimmed, realistic yt-dlp `-J` payload (replace URL hosts with `googlevideo.com` placeholders; keep protocol fields exact):
```json
{
  "id": "dQw4w9WgXcQ",
  "title": "Fixture Video",
  "duration": 212,
  "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "formats": [
    { "format_id": "96", "protocol": "m3u8_native", "manifest_url": "https://manifest.googlevideo.com/api/manifest/hls_playlist/fixture.m3u8", "vcodec": "avc1.640028", "acodec": "mp4a.40.2", "height": 1080, "ext": "mp4" },
    { "format_id": "95", "protocol": "m3u8_native", "manifest_url": "https://manifest.googlevideo.com/api/manifest/hls_playlist/fixture720.m3u8", "vcodec": "avc1.64001f", "acodec": "mp4a.40.2", "height": 720, "ext": "mp4" },
    { "format_id": "137", "protocol": "https", "vcodec": "avc1.640028", "acodec": "none", "height": 1080, "ext": "mp4", "url": "https://rr1---sn-x.googlevideo.com/videoplayback?fixture=137" },
    { "format_id": "136", "protocol": "https", "vcodec": "avc1.4d401f", "acodec": "none", "height": 720, "ext": "mp4", "url": "https://rr1---sn-x.googlevideo.com/videoplayback?fixture=136" },
    { "format_id": "140", "protocol": "https", "vcodec": "none", "acodec": "mp4a.40.2", "ext": "m4a", "url": "https://rr1---sn-x.googlevideo.com/videoplayback?fixture=140" },
    { "format_id": "18", "protocol": "https", "vcodec": "avc1.42001E", "acodec": "mp4a.40.2", "height": 360, "ext": "mp4", "url": "https://rr1---sn-x.googlevideo.com/videoplayback?fixture=18" }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`tests/stream.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import express from 'express';
import { buildStreams, streamRoute } from '../src/routes/stream.js';
import { createCache } from '../src/services/cache.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/video-info.json', import.meta.url)));
const BASE = 'http://srv:7000/tok123/';

test('ladder: HLS first, then fMP4 for 1080p and 720p, then 360p', () => {
  const streams = buildStreams(fixture, `http://srv:7000/tok123/`);
  assert.equal(streams[0].url, 'https://manifest.googlevideo.com/api/manifest/hls_playlist/fixture.m3u8');
  assert.match(streams[0].title, /HLS.*1080p/);
  const fmp4 = streams.filter(s => s.url.includes('/play/'));
  assert.deepEqual(fmp4.map(s => s.url), [
    'http://srv:7000/tok123/play/dQw4w9WgXcQ.mp4?height=1080',
    'http://srv:7000/tok123/play/dQw4w9WgXcQ.mp4?height=720',
  ]);
  assert.equal(streams.at(-1).url, 'https://rr1---sn-x.googlevideo.com/videoplayback?fixture=18');
});

test('ladder when no HLS formats: no HLS entry, fMP4 still present', () => {
  const noHls = { ...fixture, formats: fixture.formats.filter(f => f.protocol !== 'm3u8_native') };
  const streams = buildStreams(noHls, 'http://srv:7000/tok123/');
  assert.ok(!streams.some(s => s.url.includes('m3u8')));
  assert.ok(streams.some(s => s.url.includes('/play/')));
});

test('stream route returns streams and validates the id', async () => {
  const app = express();
  app.get('/stream/:videoId.json', streamRoute({
    getVideoInfo: async () => fixture,
    cache: createCache({ ttlMs: 1000 }),
  }));
  const res = await request(app).get('/stream/yt:dQw4w9WgXcQ.json');
  assert.equal(res.status, 200);
  assert.ok(res.body.streams.length >= 3);
  await request(app).get('/stream/yt:bad!!.json').expect(404);
  const failing = express();
  failing.get('/stream/:videoId.json', streamRoute({
    getVideoInfo: async () => { throw new Error('boom'); },
    cache: createCache({ ttlMs: 1000 }),
  }));
  await request(failing).get('/stream/yt:dQw4w9WgXcQ.json').expect(502);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`src/routes/stream.js`:
```js
import { isValidVideoId, getVideoInfo } from '../services/ytdlp.js';

export function buildStreams(info, playBaseUrl) {
  const id = info.id;
  const formats = info.formats || [];
  const streams = [];
  const hls = formats
    .filter(f => f.manifest_url && (f.protocol || '').startsWith('m3u8') && (f.vcodec || '').startsWith('avc1'))
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
  if (hls) {
    streams.push({
      title: `HLS ${hls.height || '?'}p — seek & PiP`,
      name: `HLS ${hls.height || '?'}p`,
      url: hls.manifest_url,
      behaviorHints: { notWebReady: false },
    });
  }
  for (const h of [1080, 720]) {
    if (formats.some(f => (f.vcodec || '').startsWith('avc1') && f.acodec === 'none' && f.height === h)
        && formats.some(f => f.vcodec === 'none' && (f.acodec || '').startsWith('mp4a'))) {
      streams.push({
        title: `${h}p (remux)`,
        name: `${h}p`,
        url: `${playBaseUrl}play/${id}.mp4?height=${h}`,
        behaviorHints: { notWebReady: false },
      });
    }
  }
  const p18 = formats.find(f => f.format_id === '18');
  if (p18 && p18.url) {
    streams.push({
      title: '360p (direct)',
      name: '360p',
      url: p18.url,
      behaviorHints: { notWebReady: false },
    });
  }
  return streams;
}

export function streamRoute({ getVideoInfo = getVideoInfo, cache }) {
  return async (req, res) => {
    const videoId = (req.params.videoId || '').replace(/^yt:/, '');
    if (!isValidVideoId(videoId)) return res.status(404).json({ error: 'invalid video id' });
    const cacheKey = `streams:${videoId}`;
    let streams = cache.get(cacheKey);
    if (!streams) {
      let info;
      try {
        info = await getVideoInfo(videoId);
      } catch (err) {
        console.error(`[stream] extraction failed for ${videoId}:`, String(err.message || err));
        return res.status(502).json({ error: 'yt-dlp extraction failed' });
      }
      const playBaseUrl = `${req.protocol}://${req.headers.host}${req.baseUrl || ''}/`;
      streams = buildStreams(info, playBaseUrl);
      cache.set(cacheKey, streams);
    }
    res.json({ streams });
  };
}
```

Note on `req.baseUrl`: the route is mounted under `/:token`, so `req.baseUrl` there equals `/${token}` and the built play URL carries the token automatically. The test above passes `playBaseUrl` directly to `buildStreams`; the route test exercises the wrapper.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/stream.js tests/stream.test.js tests/fixtures/video-info.json
git commit -m "feat: playback ladder — HLS first, fMP4 remux, 360p fallback"
```

---

### Task 9: Play route — ffmpeg live remux fallback

**Files:**
- Create: `src/routes/play.js`
- Test: `tests/play.test.js`

**Interfaces:**
- Consumes: `getVideoInfo` from Task 4, `isValidVideoId` from Task 4
- Produces: `playRoute({ getVideoInfo })` and pure helpers `pickFormats(info, height) → { video, audio, progressive }` and `buildFfmpegArgs(videoUrl, audioUrl) → string[]` (unit-testable without spawning); response is `video/mp4` fMP4 on stdout pipe; 302-redirects to the progressive URL when no muxable pair exists; 404 invalid id; 502 extraction failure

- [ ] **Step 1: Write the failing test**

`tests/play.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFormatPair, buildFfmpegArgs } from '../src/routes/play.js';
import fixture from './fixtures/video-info.json' with { type: 'json' };

test('pickFormatPair selects best avc1 video + mp4a audio under height cap', () => {
  const { video, audio } = pickFormatPair(fixture.formats, 720);
  assert.equal(video.format_id, '136');
  assert.equal(audio.format_id, '140');
  const { video: v1080 } = pickFormatPair(fixture.formats, 1080);
  assert.equal(v1080.format_id, '137');
});

test('pickFormatPair with only progressive formats → nulls', () => {
  const progressive = fixture.formats.filter(f => f.format_id === '18');
  const { video, audio, progressive: p } = pickFormatPair(progressive, 1080);
  assert.equal(video, null);
  assert.equal(audio, null);
  assert.equal(p.format_id, '18');
});

test('buildFfmpegArgs uses stream copy, fMP4, pipe output — no shell', () => {
  const args = buildFfmpegArgs('https://v.example/v', 'https://a.example/a');
  assert.deepEqual(args, [
    '-hide_banner', '-loglevel', 'error',
    '-i', 'https://v.example/v', '-i', 'https://a.example/a',
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'copy',
    '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4', 'pipe:1',
  ]);
});
```

(The full HTTP streaming behavior — pipeline, disconnect-kill — is verified in the Task 12 manual runbook; unit tests cover the pure logic.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/routes/play.js`:
```js
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { isValidVideoId, getVideoInfo } from '../services/ytdlp.js';

export function pickFormatPair(formats, height = 1080) {
  const video = formats
    .filter(f => (f.vcodec || '').startsWith('avc1') && f.acodec === 'none' && (f.height || 0) <= height)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0] || null;
  const audio = formats
    .filter(f => f.vcodec === 'none' && (f.acodec || '').startsWith('mp4a'))
    .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0] || null;
  const progressive = formats.find(f => f.format_id === '18' && f.url) || null;
  return { video, audio, progressive };
}

export function buildFfmpegArgs(videoUrl, audioUrl) {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-i', videoUrl, '-i', audioUrl,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'copy',
    '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4', 'pipe:1',
  ];
}

export function playRoute({ getVideoInfo = getVideoInfo }) {
  return async (req, res) => {
    const videoId = req.params.videoId;
    if (!isValidVideoId(videoId)) return res.status(400).json({ error: 'invalid video id' });
    const height = Math.min(Math.max(parseInt(req.query.height, 10) || 1080, 360), 1080);
    let info;
    try {
      info = await getVideoInfo(videoId);
    } catch (err) {
      console.error(`[play] extraction failed for ${videoId}:`, String(err.message || err));
      return res.status(502).json({ error: 'yt-dlp extraction failed' });
    }
    const { video, audio, progressive } = pickFormatPair(info.formats || [], height);
    if ((!video || !audio) && progressive) {
      return res.redirect(302, progressive.url);
    }
    if (!video || !audio) return res.status(404).json({ error: 'no muxable formats' });

    res.setHeader('Content-Type', 'video/mp4');
    const ff = spawn('ffmpeg', buildFfmpegArgs(video.url, audio.url), { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
    pipeline(ff.stdout, res).catch(() => {});
    res.on('close', () => ff.kill('SIGKILL'));
    ff.on('close', code => {
      if (code !== 0 && !res.writableEnded) {
        console.error(`[play] ffmpeg exited ${code} for ${videoId}: ${stderr.slice(-500)}`);
        if (!res.headersSent) res.status(502).json({ error: 'ffmpeg failed' });
        else res.end();
      }
    });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/play.js tests/play.test.js
git commit -m "feat: ffmpeg fMP4 remux play route with disconnect cleanup"
```

---

### Task 10: App assembly — token auth, mounting, error policy

**Files:**
- Create: `src/index.js`
- Test: `tests/app.test.js`

**Interfaces:**
- Consumes: all routes (Tasks 5–9), `createCache`, `searchVideos`/`getVideoInfo` (overridable via `createApp` deps for tests)
- Produces:
  - `createApp({ token, deps }) → Express app` — `token` required (throws if missing/short); deps default to real services
  - Server startup: `src/index.js` reads `PORT` (default 7000), `ADDON_TOKEN` (required — exits with a clear message if unset), binds `0.0.0.0`
  - Error policy: yt-dlp errors already mapped to 502 by routes; final error handler returns 500 JSON, never crashes the process; unhandledRejection logged, not fatal

- [ ] **Step 1: Write the failing test**

`tests/app.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/index.js';

const deps = {
  searchVideos: async () => [{ id: 'aaaaaaaaaaa', title: 'T', duration: 60, thumbnail: 'x' }],
  getVideoInfo: async () => ({ id: 'aaaaaaaaaaa', title: 'T', formats: [] }),
};

test('requires a token at creation', () => {
  assert.throws(() => createApp({ token: '' }), /ADDON_TOKEN/);
  assert.throws(() => createApp({ token: 'short' }), /ADDON_TOKEN/);
});

test('correct token reaches routes; wrong token 404s', async () => {
  const app = createApp({ token: 'tok123', deps });
  const ok = await request(app).get('/tok123/manifest.json');
  assert.equal(ok.status, 200);
  const no = await request(app).get('/wrong/manifest.json');
  assert.equal(no.status, 404);
  const none = await request(app).get('/manifest.json');
  assert.equal(none.status, 404);
});

test('full happy path: catalog → meta → stream through the token prefix', async () => {
  const app = createApp({ token: 'tok123', deps });
  const cat = await request(app).get('/tok123/catalog/movie/yt-search/search=q.json');
  assert.equal(cat.body.metas[0].id, 'yt:aaaaaaaaaaa');
  const meta = await request(app).get('/tok123/meta/movie/yt:aaaaaaaaaaa.json');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.meta.videos[0].id, 'yt:aaaaaaaaaaa');
  const st = await request(app).get('/tok123/stream/movie/yt:aaaaaaaaaaa.json');
  assert.equal(st.status, 200);
  assert.ok('streams' in st.body);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/index.js`:
```js
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
```

Note on route paths: the meta/stream routes include the Stremio resource `type` segment (`/:type`), so the route tests from Tasks 6–8 that mounted handlers at slightly different paths still hold; this task's own tests exercise the real mounted paths.

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npm test`
Expected: PASS (all suites). If Tasks 6–8 route-path tests now mismatch the mounted shapes, update those tests to the real paths — the behavior contracts stay identical.

- [ ] **Step 5: Commit**

```bash
git add src/index.js tests/app.test.js
git commit -m "feat: assemble app with token auth and error policy"
```

---

### Task 11: Docker deployment

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`
- Modify: `.env.example` (final vars)

**Interfaces:**
- Consumes: complete app from Task 10
- Produces: `docker compose up` runnable container; runtime contract: reads `ADDON_TOKEN` (required), `PORT` (default 7000), `ADDON_ID`, `YTDLP_VERSION` (build arg)

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

ARG YTDLP_VERSION
RUN test -n "$YTDLP_VERSION" \
 && curl -fsSL -o /usr/local/bin/yt-dlp \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" \
 && curl -fsSL \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/SHA2-256SUMS" \
      | grep -E "  yt-dlp$" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/yt-dlp

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

USER node
EXPOSE 7000
CMD ["node", "src/index.js"]
```

- [ ] **Step 2: Write docker-compose.yml (no default token)**

```yaml
services:
  youtube-addon:
    build:
      context: .
      args:
        YTDLP_VERSION: ${YTDLP_VERSION:?set YTDLP_VERSION in .env}
    restart: unless-stopped
    ports:
      - "${PORT:-7000}:7000"
    environment:
      ADDON_TOKEN: ${ADDON_TOKEN:?ADDON_TOKEN required — generate: openssl rand -hex 16}
      ADDON_ID: ${ADDON_ID:-community.ytdlp}
    read_only: true
    tmpfs:
      - /tmp
```

- [ ] **Step 3: Finalize .env.example and build**

`.env.example`:
```
PORT=7000
ADDON_ID=community.ytdlp
YTDLP_VERSION=2025.09.26
ADDON_TOKEN=  # required — generate with: openssl rand -hex 16
```

(YTDLP_VERSION: set to the latest release listed at https://github.com/yt-dlp/yt-dlp/releases when building — the value above is the last known at plan-writing time; update it and note it in the runbook when you bump.)

Build and smoke-test:
```bash
cp .env.example .env
# edit .env: set ADDON_TOKEN=$(openssl rand -hex 16) and YTDLP_VERSION to latest release tag
docker compose up --build -d
curl -fsS "http://localhost:7000/$(grep ADDON_TOKEN .env | cut -d= -f2)/manifest.json" | head -c 400
```
Expected: manifest JSON. Then verify token rejection:
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:7000/wrongtoken/manifest.json
```
Expected: `404`.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml .env.example
git commit -m "build: Docker deployment with pinned checksummed yt-dlp"
```

---

### Task 12: Manual verification runbook (iPhone)

**Files:**
- Create: `docs/RUNBOOK.md`

**Interfaces:**
- Consumes: deployed container (Task 11), Stremio on iOS
- Produces: documented pass/fail checklist — this is the spec's integration test

- [ ] **Step 1: Write the runbook**

```markdown
# Runbook — youtube-addon

## Deploy
1. `cp .env.example .env` — set `ADDON_TOKEN=$(openssl rand -hex 16)` and current `YTDLP_VERSION`
   from https://github.com/yt-dlp/yt-dlp/releases
2. `docker compose up --build -d`
3. Install URL: `http://<server-ip>:7000/<ADDON_TOKEN>/manifest.json`
4. Keep the port LAN-only (firewall) or reach it via Tailscale.

## Update yt-dlp
`docker compose build --build-arg YTDLP_VERSION=<new> && docker compose up -d`
(YouTube breaks extraction periodically — when playback fails, bump the version first.)

## iPhone verification checklist (Stremio)
- [ ] Install addon via manifest URL
- [ ] Search returns results; detail page shows title/thumbnail
- [ ] HLS stream plays (default first stream)
- [ ] Seek/scrub works on the HLS stream
- [ ] Screen-off: audio continues; lock-screen controls work
- [ ] PiP works
- [ ] Via Tailscale (remote IP): playback still works (validates IP-portability)
- [ ] Wrong-token URL on any route → 404
```

- [ ] **Step 2: Execute the checklist**

Run every item on the iPhone against the deployed container. If the POC (Task 1) verified cross-IP playback, the VPN item should pass; if the addon URL needs to survive VPN IP changes and doesn't, note it in `poc-result.md` — extraction URLs may be IP-bound, in which case remote playback relies on the fMP4 path (server-side fetch is IP-stable).

- [ ] **Step 3: Commit**

```bash
git add docs/RUNBOOK.md
git commit -m "docs: deployment and iPhone verification runbook"
```

---

## Task Dependency Notes

- Task 1 (POC) gates the ladder implementation details but not the other tasks; run it first, but Tasks 2–8 can proceed while awaiting the iPhone-side playback check.
- Tasks 3–5 are independent of each other.
- Task 6 depends on Tasks 3–4. Tasks 7–9 depend on Tasks 3–5. Task 10 depends on 5–9. Task 11 depends on 10. Task 12 depends on 11.
- If Task 1's verdict is "no HLS," Task 8's ladder top entry is dropped (no code change needed — `buildStreams` already conditionally includes HLS), and the fMP4 path becomes primary; note the decision in `poc-result.md` regardless.
