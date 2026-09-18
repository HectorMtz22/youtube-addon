# Runbook — youtube-addon

## Deploy on TrueNAS SCALE (custom app)

Prerequisite: the image must exist on ghcr.io. It is built automatically by the
`docker-publish` workflow on every merge to `main`. After the first successful
workflow run, go to your GitHub profile → Packages → youtube-addon → Package
settings → change visibility to **public** (the image contains no secrets;
TrueNAS can then pull it without registry credentials — alternatively keep it
private and add ghcr.io credentials in the TrueNAS app's registry settings).

1. Generate a token on any machine: `openssl rand -hex 16`
2. TrueNAS → Apps → Discover Apps → ⋮ (top right) → **Install via YAML**
3. Paste the contents of `deploy/docker-compose.truenas.yml`
4. Replace `REPLACE_ME_openssl_rand_hex_16` with your token
5. In the app form, set the Web UI port to 7000 (must match the ports mapping)
6. Install. Verify: the app shows `Running`, then from a LAN machine:
   `curl -fsS http://<nas-ip>:7000/` → `{"status":"ok",...}` and
   `curl -s -o /dev/null -w '%{http_code}\n' http://<nas-ip>:7000/wrongtoken/manifest.json` → `404`

#### poToken provider (bgutil)
Deployed as the internal `bgutil` service (no published ports — it is
unauthenticated; nothing else may reach it). The addon requests
proof-of-origin tokens from it via `POT_PROVIDER_URL=http://bgutil:4416`;
if the provider is down, extraction continues without tokens (fail-open).
If the provider's version drifts from the plugin baked into the addon image
(major mismatch), yt-dlp logs a version error — re-run the `docker-publish`
workflow and pull, or bump the pinned `bgutil` image tag.

## Update yt-dlp on TrueNAS
The yt-dlp version is baked into the image at CI build time (resolved to the
latest yt-dlp release on every main-branch build). To update:
re-run the `docker-publish` workflow (Actions tab → docker-publish → Run
workflow), wait for it to finish, then in TrueNAS: Apps → youtube-addon →
⋮ → **Pull New Image** (or reinstall the app). Never expose 7000 to the
internet; use Tailscale/VPN for remote access.

## Deploy on plain Docker (any host)
1. `cp .env.example .env` — set `ADDON_TOKEN=$(openssl rand -hex 16)` and current `YTDLP_VERSION`
   from https://github.com/yt-dlp/yt-dlp/releases
2. `docker compose up --build -d`
   - Note: if `docker compose build` fails at the SHA256 step, verify the `YTDLP_VERSION` tag
     exists in yt-dlp releases; the checksum grep fails closed on wrong tags.
3. Install URL: `http://<server-ip>:7000/<ADDON_TOKEN>/manifest.json`
4. Keep the port LAN-only (firewall) or reach it via Tailscale.

## Update yt-dlp (plain Docker)
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
