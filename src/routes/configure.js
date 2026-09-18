// Minimal configure page: paste playlist/mix URLs/IDs (one per line),
// get back the install URL for the configured addon variant.
const esc = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function configureRoute({ encodeConfig, parsePlaylistInput }) {
  return (req, res) => {
    const submit = typeof req.query.playlists === 'string';
    const input = submit ? req.query.playlists : '';
    const parsed = submit ? parsePlaylistInput(input) : [];
    const cfgSegment = submit && parsed.length ? `cfg-${encodeConfig({ playlists: parsed })}` : '';

    const host = req.get('x-forwarded-host') || req.headers.host || '';
    // Token comes from the mount path (req.baseUrl) — this route itself has
    // no URL params, so req.params.token would be undefined here.
    const stremioUrl = `stremio://${host}${req.baseUrl || ''}${cfgSegment ? '/' + cfgSegment : ''}/manifest.json`;
    const httpsUrl = `https://${host}${req.baseUrl || ''}${cfgSegment ? '/' + cfgSegment : ''}/manifest.json`;

    const resultHtml = !submit
      ? ''
      : (parsed.length
        ? `<p>${parsed.length} playlist(s) configured. Install in Stremio:</p>` +
          `<pre><a href="${esc(stremioUrl)}">${esc(stremioUrl)}</a></pre>` +
          `<p>Or the https fallback: <a href="${esc(httpsUrl)}">${esc(httpsUrl)}</a></p>`
        : '<p>No valid playlists found in the input.</p>');

    res.type('html').send(
      '<!doctype html><html><body style="font-family:sans-serif;max-width:640px;margin:2rem auto">' +
      '<h2>YouTube addon — playlists</h2>' +
      '<form method="get">' +
      `<textarea name="playlists" rows="6" style="width:100%" placeholder="Playlist or mix URLs/IDs, one per line">${esc(input)}</textarea><br>` +
      '<button>Build install URL</button>' +
      '</form>' +
      resultHtml +
      '</body></html>');
  };
}
