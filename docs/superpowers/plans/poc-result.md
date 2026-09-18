# POC Result — yt-dlp HLS extraction gate

- **Date:** 2026-09-17
- **yt-dlp version:** 2026.08.19 (installed via Homebrew)
- **Script:** `poc/extract-check.sh` (yt-dlp `-J` dump + python3 filter for HLS/m3u8/avc1 formats)
- **Test video:** `dQw4w9WgXcQ` — "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)"

## Extraction result

- **Exit code:** 0
- **HLS height found:** 1080 (best avc1 m3u8 format; `hls_height` >= 720, as expected by the brief)
- **Manifest URL host:** `manifest.googlevideo.com` (full URL redacted; HLS variant playlist, `playlist_type/DVR`, itag 0)

## Cross-IP playback check (the iPhone test)

- **Same-IP curl of the manifest URL:** HTTP 200 — manifest is fetchable right after extraction.
- **Cross-IP check:** requires iPhone / differing egress IP. No VPN or proxy interface with a different egress IP was available on the extraction machine at POC time, so the definitive cross-IP test is **deferred to runbook Task 12** (manual iPhone check on cellular).

## Verdict / ladder decision

**HLS-first.** yt-dlp 2026.08.19 extracts HLS (m3u8, avc1) manifests from YouTube today, reaching 1080p, and the manifest URL is fetchable over HTTP immediately after extraction. The ladder's top rung is HLS, with fMP4 as the fallback rung. The only unverified element is IP portability of the signed manifest URL, to be confirmed on iPhone in Task 12; if that 403s, revisit the decision per the brief.
