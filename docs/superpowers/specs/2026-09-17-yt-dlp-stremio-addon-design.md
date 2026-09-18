# Design: yt-dlp Stremio Addon (YouTube for Stremio on iOS)

**Date:** 2026-09-17
**Status:** Approved design (pending spec review)
**Repo:** `/Users/kilo/dev/youtube-addon`

## 1. Problem & Goal

Watch YouTube in Stremio on iOS with: no ads, working screen-off/PiP playback, and
no Google-account exposure. Third-party solutions failed the trust or reliability
bar (Tubio+: unreviewed code, broken seeking, dead SponsorBlock, deprecated in
favor of a riskier nightly rewrite; Piped: broken by YouTube's SABR rollout).

**Goal:** a minimal, auditable Stremio addon (~350 lines) self-hosted on the
user's home server in Docker, built entirely on yt-dlp for extraction.

**Non-goals (v1):**
- No YouTube cookies / personal feeds (subscriptions, history, recommendations)
- No SponsorBlock segment skipping (in-video sponsor segments remain)
- No DeArrow
- No public-internet exposure story (LAN/VPN only)
- No TLS (plain HTTP behind LAN/Tailscale)

## 2. Solution Shape

A single stateless Node.js/Express process in one Docker container alongside
pinned yt-dlp and ffmpeg. The iPhone runs Stremio and talks to the addon over
LAN/VPN. Two playback data paths:

```
Stremio iOS ──HTTP/LAN──► addon (token route) ──exec──► yt-dlp ──► youtube.com
                                │                        │
                                │◄── HLS manifest URL ───┘
Stremio iOS ──direct──► googlevideo.com (HLS path)
        or
addon ──ffmpeg -c copy──► googlevideo DASH ──fMP4──► Stremio (fallback path)
```

- **HLS path (primary):** the server never proxies video bytes; Stremio/AVPlayer
  streams directly from `googlevideo.com`.
- **Fallback path:** DASH h264 video + AAC audio are pulled by ffmpeg on the
  server, stream-copy-muxed into fragmented MP4, and served live.

## 3. Components

| File | Purpose |
|---|---|
| `src/index.js` | Express bootstrap, route mounting, error policy |
| `src/auth.js` | Token path-prefix middleware |
| `src/routes/manifest.js` | Stremio manifest endpoint |
| `src/routes/catalog.js` | Search catalog (`ytsearch`, flat, cached) |
| `src/routes/meta.js` | Video metadata (title/thumb/description/duration) |
| `src/routes/stream.js` | Playback ladder construction |
| `src/routes/play.js` | ffmpeg live-mux fallback endpoint |
| `src/services/ytdlp.js` | execFile wrapper, ID/query validation |
| `src/services/cache.js` | TTL Map cache |
| `poc/extract-check.sh` | Pre-implementation POC gate |
| `Dockerfile` / `docker-compose.yml` | Deployment |
| `.env.example` | Required env vars |

## 4. Stremio protocol routes

All routes live under a token path prefix (`/{token}/...`) so Stremio carries the
token automatically on every request after the manifest is installed:

- `GET /:token/manifest.json` — one `search` catalog (`id: yt-search`),
  `meta` + `stream` resources, h264-only streams profile
- `GET /:token/catalog/:type/:id/search={query}.json` — yt-dlp flat search,
  20 results, cached 30 min
- `GET /:token/meta/:videoId.json` — cached 1 h
- `GET /:token/stream/:videoId.json` — one yt-dlp JSON extraction per call
  (fresh URLs), cached 10 min; returns the ladder list below
- `GET /:token/play/:videoId.mp4?...` — ffmpeg live-mux fallback; only fetched
  by Stremio when it picks a non-HLS stream

## 5. Playback ladder (core logic)

Stream response priority order:

1. **HLS** — yt-dlp HLS `manifest_url` (h264 + AAC muxed, ≤1080p). Native
   seeking, PiP, screen-off. No server bandwidth used during playback.
2. **fMP4 mux** — `ffmpeg -c:v copy -c:a copy -movflags frag_keyframe+empty_moov`
   served live from `play` (seeking best-effort; known limitation, accepted).
3. **360p progressive** — itag 18 direct URL, last resort.

All three are offered as options in the stream response; Stremio's UI lets the
user pick. If the POC proves HLS extraction is unavailable, the ladder top
becomes fMP4 (approach 2 with fixes).

**POC gate (before any implementation):** `poc/extract-check.sh` runs yt-dlp on
the target server, confirms HLS URLs extract *and* play on the iPhone (different
IP than the server, including via VPN — extraction URLs can be IP-bound).

## 6. Security model

- `ADDON_TOKEN` (32-char random, **required** env; server refuses to start
  without it) on every route including `/play`; unknown token → 404
- Video IDs regex-validated (`[A-Za-z0-9_-]{11}`); search queries length-capped;
  **no shell** — `execFile`/`spawn` with argument arrays only
- yt-dlp pinned to a fixed release, SHA256-verified at Docker build
- Container runs as non-root, read-only filesystem, tmpfs `/tmp`
- Outbound endpoints: `youtube.com`/`googlevideo.com` (runtime), GitHub yt-dlp
  release (build only). Nothing else.
- No secrets on board: compromised container yields no Google session, no keys
  worth stealing
- Bearer token appears in URL path (Stremio protocol limitation); acceptable —
  revocable, rotates by env change, logs stay on our server

## 7. Error handling

- `pipeline()` for all stream piping; client disconnect terminates ffmpeg
- 90 s `AbortSignal` timeout on every yt-dlp run
- Upstream failures → HTTP 502 with the yt-dlp error message (truncated)
- Search/catalog failures → empty result set with 200 (Stremio-friendly) +
  server-side log; meta/stream failures → 502
- The process must never exit on per-request errors (no unhandledRejection exits)

## 8. Deployment

`docker-compose.yml` with `PORT`, `ADDON_TOKEN`, `YTDLP_VERSION` — no default
token (compose fails fast if unset). Non-root user, `read_only: true`,
`tmpfs: /tmp`. Documentation covers: LAN-only binding, firewall note,
Tailscale for remote use, update procedure (`docker compose pull && up -d`,
or rebuild with bumped `YTDLP_VERSION`).

## 9. Testing

- **Unit:** token middleware (accept/reject), ID/query validation, ladder
  construction from mocked yt-dlp JSON fixtures
- **Integration:** POC script; manual Stremio-on-iPhone runbook — search, play,
  seek, PiP, screen-off playback, VPN remote test
- **Lint** on CI-less local setup: `node --test` for units, no framework bloat

## 10. Migration / teardown

Stateless by design: deleting the container loses nothing. No cookies were ever
stored, so there is nothing to rotate or revoke beyond the addon URL.
