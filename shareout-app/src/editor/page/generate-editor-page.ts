// ShareOut Visual Editor - Page generation (orchestrator)

import { getEditorBaseUrl } from './config';
import { getEditorStyles } from './styles/editor-styles';
import { renderEditorConfigScript } from './template/config-script';
import { renderEditorShell } from './template/shell';
import type { EditorPageOptions } from './types';
import { googleFontsPreconnect } from '../../design-system/tokens';
import { brandFaviconHead } from '../../brand';

export type { EditorPageOptions } from './types';

/** Bundled editor app (built from editor-client/ via npm run build:editor). */
export const EDITOR_CLIENT_SCRIPT_URL = '/sdk/editor.js';

/** Build the full editor HTML page served to the browser. */
export function generateEditorPage(options: EditorPageOptions): string {
  const {
    artifactId, slug, theme = 'auto', name, description, userId, userName, userAvatar,
    openVisDisabled, aiEnabled,
  } = options;
  const baseUrl = getEditorBaseUrl(options.baseUrl);

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edit - ${name || slug} | ShareOut</title>
  ${brandFaviconHead}
  ${googleFontsPreconnect}
  <style>
${getEditorStyles()}
  </style>
</head>
<body>
${renderEditorShell({ slug })}

${renderEditorConfigScript({ artifactId, slug, theme, baseUrl, name, description, userId, userName, userAvatar, openVisDisabled, aiEnabled })}

  <script>
  (function() {
    var cfg = window.EDITOR_CONFIG || {};
    var btn = document.getElementById('btn-favorite');
    if (!btn || !cfg.artifactId) return;
    function paint(on) {
      btn.dataset.fav = on ? '1' : '0';
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = on ? 'Remove from favorites' : 'Add to favorites';
      var svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', on ? 'currentColor' : 'none');
    }
    function isFav(d) {
      // GET /v1/artifacts/:id returns a flat detail object; tolerate nested envelopes too.
      if (!d) return false;
      if (d.is_favorite === true || d.is_favorite === 1) return true;
      if (d.data && (d.data.is_favorite === true || d.data.is_favorite === 1)) return true;
      if (d.artifact && (d.artifact.is_favorite === true || d.artifact.is_favorite === 1)) return true;
      return false;
    }
    fetch('/v1/artifacts/' + cfg.artifactId, { credentials: 'same-origin' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) { paint(isFav(d)); })
      .catch(function() {});
    btn.addEventListener('click', function() {
      var on = btn.dataset.fav === '1';
      btn.disabled = true;
      fetch('/v1/artifacts/' + cfg.artifactId + '/favorite', { method: on ? 'DELETE' : 'POST', credentials: 'same-origin' })
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function() { paint(!on); })
        .catch(function(err) { console.error('Favorite error:', err); })
        .finally(function() { btn.disabled = false; });
    });
  })();
  </script>

  <script src="/sdk/v1/shareout.js"></script>
  <script src="/sdk/v1/shareout-charts.js"></script>
  <script type="module" src="${EDITOR_CLIENT_SCRIPT_URL}"></script>
</body>
</html>`;
}
