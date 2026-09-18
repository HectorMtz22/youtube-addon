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
