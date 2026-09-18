// Addon configuration: playlists configured via the /configure page are
// encoded as base64url JSON in the addon URL path (segment `cfg-<encoded>`).
// No secrets — public playlist/mix identifiers only.
const MAX_PLAYLISTS = 50;

export function parsePlaylistInput(text) {
  if (typeof text !== 'string') return [];
  return text
    .split(/[\n,]+/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, MAX_PLAYLISTS)
    .map(extractPlaylist)
    .filter(Boolean);
}

function extractPlaylist(line) {
  // Bare list id (PL..., RD..., UU..., LL..., FL..., OL...)
  if (/^[A-Za-z0-9_-]{12,}$/.test(line)) return { id: line, url: `https://www.youtube.com/playlist?list=${line}` };
  // Any URL carrying list=
  const m = line.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return { id: m[1], url: `https://www.youtube.com/playlist?list=${m[1]}` };
  return null;
}

export function encodeConfig(config) {
  return Buffer.from(JSON.stringify(config)).toString('base64url');
}

export function decodeConfig(segment) {
  try {
    const parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (!parsed || !Array.isArray(parsed.playlists)) return null;
    if (parsed.playlists.length > MAX_PLAYLISTS) return null;
    if (!parsed.playlists.every(p => p && typeof p.id === 'string' && typeof p.url === 'string'
        && /^[A-Za-z0-9_-]{12,}$/.test(p.id))) return null;
    return parsed;
  } catch {
    return null;
  }
}
