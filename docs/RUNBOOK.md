# Runbook — youtube-addon

## Deploy
1. `cp .env.example .env` — set `ADDON_TOKEN=$(openssl rand -hex 16)` and current `YTDLP_VERSION`
   from https://github.com/yt-dlp/yt-dlp/releases
2. `docker compose up --build -d`
   - Note: if `docker compose build` fails at the SHA256 step, verify the `YTDLP_VERSION` tag
     exists in yt-dlp releases; the checksum grep fails closed on wrong tags.
3. Install URL: `http://<server-ip>:7000/<ADDON_TOKEN>/manifest.json`
4. Keep the port LAN-only (firewall) or reach it via Tailscale.

## Update yt-dlp
`docker compose build --build-arg YTDLP_VERSION=<new> && docker compose up -d`
(YouTube breaks extraction periodically — when playback fails, bump the version first.)
- Note: if HLS playback fails from a different IP than the server's, fall back to the fMP4
  stream option in Stremio and record the finding (extraction URLs may be IP-bound).

## iPhone verification checklist (Stremio)
- [ ] Install addon via manifest URL
- [ ] Search returns results; detail page shows title/thumbnail
- [ ] HLS stream plays (default first stream)
- [ ] Seek/scrub works on the HLS stream
- [ ] Screen-off: audio continues; lock-screen controls work
- [ ] PiP works
- [ ] Via Tailscale (remote IP): playback still works (validates IP-portability)
- [ ] Wrong-token URL on any route → 404
