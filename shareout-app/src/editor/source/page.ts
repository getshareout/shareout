// ShareOut Source Editor — dedicated editor for non-HTML artifacts
// (markdown, plain text, JSON, CSV). The visual HTML editor mangles these
// file types, so each gets a purpose-built editing surface instead.

import { colors, fonts, radius, shadows, googleFontsPreconnect } from '../../design-system/tokens';
import { componentStylesheet } from '../../design-system/components/index';
import { brandFaviconHead } from '../../brand';

export type SourceEditableType = 'markdown' | 'txt' | 'json' | 'csv';

export interface SourceEditorOptions {
  artifactId: string;
  slug: string;
  name: string;
  type: SourceEditableType;
  entrypoint: string;
  content: string;
  baseUrl: string;
  versionNo: number;
}

const TYPE_LABELS: Record<SourceEditableType, string> = {
  markdown: 'Markdown',
  txt: 'Text',
  json: 'JSON',
  csv: 'CSV',
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safe to embed an arbitrary string inside an inline <script> as a JS value.
function toScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function generateSourceEditorPage(opts: SourceEditorOptions): string {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const typeLabel = TYPE_LABELS[opts.type];
  const body =
    opts.type === 'csv' ? csvBody() :
    opts.type === 'markdown' ? markdownBody() :
    textBody(opts.type);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Editing ${escapeHtml(opts.name)} | ShareOut</title>
  ${brandFaviconHead}
  ${googleFontsPreconnect}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: ${colors.bg};
      --surface: ${colors.bgElevated};
      --text: ${colors.text};
      --text-muted: ${colors.textSecondary};
      --border: ${colors.border};
      --primary: ${colors.primary};
      --primary-hover: ${colors.primaryHover};
      --code-bg: ${colors.surface};
      --font-body: ${fonts.body};
      --font-display: ${fonts.display};
      --font-mono: ${fonts.mono};
      --radius-sm: ${radius.sm};
      --color-primary: ${colors.primary};
      --color-primary-hover: ${colors.primaryHover};
      --color-bg-elevated: ${colors.bgElevated};
      --color-surface: ${colors.surface};
      --color-text: ${colors.text};
      --color-text-secondary: ${colors.textSecondary};
      --color-text-inverse: ${colors.textInverse};
      --color-border: ${colors.border};
      --color-border-strong: ${colors.borderStrong};
      --color-error: ${colors.error};
      --duration-normal: 150ms;
      --duration-fast: 100ms;
      --ease-out: cubic-bezier(0, 0, 0.2, 1);
      --touch-target-min: 44px;
    }
    ${componentStylesheet()}
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: ${colors.text};
        --surface: #292524;
        --text: ${colors.bg};
        --text-muted: ${colors.textTertiary};
        --border: #44403c;
        --code-bg: #3f3f46;
      }
    }
    html, body { height: 100%; font-family: var(--font-body); background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
    .editor-shell { display: flex; flex-direction: column; height: 100%; }
    .topbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .topbar .info { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
    .name { font: 600 15px var(--font-display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .badge { display: inline-flex; align-items: center; padding: 3px 8px; background: var(--code-bg); border-radius: 4px; font-size: 12px; font-weight: 500; color: var(--text-muted); flex-shrink: 0; }
    .status { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    .status.dirty { color: ${colors.warning}; }
    .status.saved { color: ${colors.success}; }
    .body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .draft-banner { display: none; align-items: center; gap: 12px; padding: 8px 16px; background: #fef3c7; color: #92400e; border-bottom: 1px solid #fcd34d; font-size: 13px; }
    .draft-banner.show { display: flex; }
    .draft-banner .spacer { flex: 1; }
    .draft-banner button { border: 1px solid currentColor; background: transparent; color: inherit; padding: 4px 10px; border-radius: 4px; font-size: 12px; cursor: pointer; }
    /* Plain / JSON text editor */
    .text-pane { flex: 1; display: flex; min-height: 0; }
    textarea.source { flex: 1; width: 100%; resize: none; border: none; outline: none; padding: 20px; font-family: var(--font-mono); font-size: 14px; line-height: 1.6; background: var(--bg); color: var(--text); tab-size: 2; }
    .json-error { padding: 8px 16px; font-size: 12px; font-family: var(--font-mono); color: #dc2626; background: var(--code-bg); border-top: 1px solid var(--border); display: none; }
    .json-error.show { display: block; }
    /* Markdown split */
    .text-pane { position: relative; }
    .text-pane .format-btn { position: absolute; top: 8px; right: 12px; z-index: 2; }
    .md-toolbar { display: flex; gap: 4px; padding: 6px 12px; border-bottom: 1px solid var(--border); background: var(--surface); flex-wrap: wrap; }
    .md-toolbar .so-c-btn { min-width: 2rem; padding-inline: 9px; font: 600 13px var(--font-mono); }
    .md-split { flex: 1; display: flex; min-height: 0; }
    .md-split > .pane { flex: 1; min-width: 0; overflow: auto; }
    .md-split textarea.source { padding: 20px; }
    .md-split .preview { padding: 24px 28px; border-left: 1px solid var(--border); }
    .preview h1,.preview h2,.preview h3,.preview h4 { margin: 1.2em 0 .5em; font-weight: 600; line-height: 1.3; }
    .preview h1:first-child { margin-top: 0; }
    .preview h1 { font-size: 1.9em; border-bottom: 1px solid var(--border); padding-bottom: .3em; }
    .preview h2 { font-size: 1.45em; border-bottom: 1px solid var(--border); padding-bottom: .3em; }
    .preview h3 { font-size: 1.2em; }
    .preview p { margin: 1em 0; line-height: 1.7; }
    .preview a { color: var(--primary); }
    .preview ul,.preview ol { margin: 1em 0; padding-left: 1.6em; }
    .preview blockquote { margin: 1em 0; padding: .4em 1em; border-left: 4px solid var(--primary); background: var(--code-bg); color: var(--text-muted); }
    .preview pre { margin: 1em 0; padding: 14px; background: var(--code-bg); border-radius: 8px; overflow-x: auto; font-family: var(--font-mono); font-size: 13px; }
    .preview code { font-family: var(--font-mono); font-size: .9em; padding: .15em .4em; background: var(--code-bg); border-radius: 4px; }
    .preview pre code { padding: 0; background: none; }
    .preview img { max-width: 100%; border-radius: 8px; }
    .preview table { border-collapse: collapse; margin: 1em 0; width: 100%; }
    .preview th,.preview td { border: 1px solid var(--border); padding: 7px 11px; text-align: left; }
    .preview th { background: var(--code-bg); }
    .preview hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
    @media (max-width: 760px) { .md-split { flex-direction: column; } .md-split .preview { border-left: none; border-top: 1px solid var(--border); } }
    /* CSV grid */
    .csv-pane { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .csv-actions { display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--surface); }
    .csv-scroll { flex: 1; overflow: auto; padding: 12px; }
    table.grid { border-collapse: collapse; font-size: 13px; }
    table.grid th, table.grid td { border: 1px solid var(--border); padding: 0; }
    table.grid th.rownum, table.grid td.rownum { background: var(--code-bg); color: var(--text-muted); text-align: center; min-width: 34px; user-select: none; font-size: 11px; padding: 0 6px; }
    table.grid input { border: none; outline: none; background: transparent; color: var(--text); font: inherit; padding: 7px 10px; min-width: 120px; width: 100%; }
    table.grid input:focus { background: color-mix(in srgb, var(--primary) 12%, transparent); box-shadow: inset 0 0 0 2px var(--primary); }
    table.grid thead input { font-weight: 600; background: var(--code-bg); }
    .colmenu { display: flex; align-items: center; }
    .icon-btn { border: none; background: transparent; color: var(--text-muted); cursor: pointer; padding: 4px 6px; font-size: 13px; line-height: 1; border-radius: 4px; }
    .icon-btn:hover { background: color-mix(in srgb, #dc2626 16%, transparent); color: #dc2626; }
    .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(80px); background: ${colors.text}; color: ${colors.bg}; padding: 10px 18px; border-radius: ${radius.sm}; font: 500 13px var(--font-body); box-shadow: ${shadows.lg}; opacity: 0; transition: all .25s; z-index: 2000; }
    .toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
    .toast.error { background: #dc2626; color: #fff; }
  </style>
</head>
<body>
  <div class="editor-shell">
    <header class="topbar">
      <a href="${baseUrl}/a/${escapeHtml(opts.slug)}/" class="so-c-btn so-c-btn--ghost so-c-btn--icon" title="Back to view">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
      </a>
      <div class="info">
        <span class="name">${escapeHtml(opts.name)}</span>
        <span class="badge">${typeLabel}</span>
        <span class="status" id="status"></span>
      </div>
      <button class="so-c-btn so-c-btn--primary" id="publishBtn" onclick="publish()">Publish</button>
    </header>
    <div class="draft-banner" id="draftBanner">
      <span>You have unsaved local changes from a previous session.</span>
      <div class="spacer"></div>
      <button onclick="restoreDraft()">Restore</button>
      <button onclick="discardDraft()">Discard</button>
    </div>
    <div class="body">
      ${body}
    </div>
  </div>
  <div class="toast" id="toast"></div>
  <script>
  (function () {
    var CFG = {
      artifactId: ${toScriptJson(opts.artifactId)},
      slug: ${toScriptJson(opts.slug)},
      type: ${toScriptJson(opts.type)},
      entrypoint: ${toScriptJson(opts.entrypoint)},
      baseUrl: ${toScriptJson(baseUrl)},
      content: ${toScriptJson(opts.content)},
      versionNo: ${opts.versionNo}
    };
    var DRAFT_KEY = 'so-source-draft:' + CFG.artifactId;
    var dirty = false;

    function setStatus(text, cls) {
      var el = document.getElementById('status');
      el.textContent = text;
      el.className = 'status' + (cls ? ' ' + cls : '');
    }
    function markDirty() {
      dirty = true;
      setStatus('Unsaved changes', 'dirty');
      try { localStorage.setItem(DRAFT_KEY, getContent()); } catch (e) {}
    }
    function toast(msg, isError) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.className = 'toast show' + (isError ? ' error' : '');
      setTimeout(function () { t.className = 'toast' + (isError ? ' error' : ''); }, 2600);
    }

    /* ---------- content read/write per type ---------- */
    var getContent, setContent;
    if (CFG.type === 'csv') { initCsv(); }
    else if (CFG.type === 'markdown') { initMarkdown(); }
    else { initText(); }

    /* ---------- plain text / json ---------- */
    function initText() {
      var ta = document.getElementById('src');
      ta.value = CFG.content;
      getContent = function () { return ta.value; };
      setContent = function (v) { ta.value = v; };
      ta.addEventListener('input', function () { markDirty(); if (CFG.type === 'json') validateJson(); });
      if (CFG.type === 'json') validateJson();
    }
    function validateJson() {
      var box = document.getElementById('jsonError');
      if (!box) return true;
      var v = getContent().trim();
      if (!v) { box.className = 'json-error'; return true; }
      try { JSON.parse(v); box.className = 'json-error'; return true; }
      catch (e) { box.textContent = 'Invalid JSON: ' + e.message; box.className = 'json-error show'; return false; }
    }
    window.formatJson = function () {
      try { setContent(JSON.stringify(JSON.parse(getContent()), null, 2)); markDirty(); validateJson(); }
      catch (e) { toast('Cannot format: invalid JSON', true); }
    };

    /* ---------- markdown ---------- */
    function initMarkdown() {
      var ta = document.getElementById('src');
      ta.value = CFG.content;
      getContent = function () { return ta.value; };
      setContent = function (v) { ta.value = v; renderPreview(); };
      ta.addEventListener('input', function () { markDirty(); renderPreview(); });
      renderPreview();
    }
    function renderPreview() {
      document.getElementById('preview').innerHTML = mdToHtml(getContent());
    }
    window.mdWrap = function (before, after) {
      var ta = document.getElementById('src');
      var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
      var sel = v.slice(s, e);
      ta.value = v.slice(0, s) + before + sel + after + v.slice(e);
      ta.focus();
      ta.selectionStart = s + before.length;
      ta.selectionEnd = e + before.length;
      markDirty(); renderPreview();
    };
    window.mdPrefix = function (prefix) {
      var ta = document.getElementById('src');
      var s = ta.selectionStart, v = ta.value;
      var lineStart = v.lastIndexOf('\\n', s - 1) + 1;
      ta.value = v.slice(0, lineStart) + prefix + v.slice(lineStart);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + prefix.length;
      markDirty(); renderPreview();
    };
    function escHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function mdToHtml(md) {
      var h = md;
      h = h.replace(/^---\\n[\\s\\S]*?\\n---\\n?/, '');
      h = h.replace(/\\u0060\\u0060\\u0060(\\w*)\\n([\\s\\S]*?)\\u0060\\u0060\\u0060/g, function (_, lang, code) { return '<pre><code>' + escHtml(code.replace(/\\s+$/, '')) + '</code></pre>'; });
      h = h.replace(/\\u0060([^\\u0060]+)\\u0060/g, function (_, c) { return '<code>' + escHtml(c) + '</code>'; });
      h = h.replace(/^(#{1,6})\\s+(.+)$/gm, function (_, hashes, text) { var l = hashes.length; return '<h' + l + '>' + escHtml(text) + '</h' + l + '>'; });
      h = h.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
      h = h.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      h = h.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      h = h.replace(/~~(.+?)~~/g, '<del>$1</del>');
      h = h.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, '<img src="$2" alt="$1">');
      h = h.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');
      h = h.replace(/^(?:---|\\*\\*\\*|___)$/gm, '<hr>');
      h = h.replace(/^>\\s?(.*)$/gm, '<blockquote>$1</blockquote>');
      h = h.replace(/<\\/blockquote>\\n<blockquote>/g, '\\n');
      h = h.replace(/^\\|(.+)\\|\\n\\|[-:| ]+\\|\\n((?:\\|.+\\|\\n?)+)/gm, function (_, header, bodyRows) {
        var ths = header.split('|').filter(function (c) { return c.trim(); }).map(function (c) { return '<th>' + escHtml(c.trim()) + '</th>'; }).join('');
        var trs = bodyRows.trim().split('\\n').map(function (row) {
          var tds = row.split('|').filter(function (c) { return c.trim(); }).map(function (c) { return '<td>' + escHtml(c.trim()) + '</td>'; }).join('');
          return '<tr>' + tds + '</tr>';
        }).join('');
        return '<table><thead><tr>' + ths + '</tr></thead><tbody>' + trs + '</tbody></table>';
      });
      h = h.replace(/^(\\s*)[-*+]\\s+(.*)$/gm, '$1<li>$2</li>');
      h = h.replace(/^(\\s*)\\d+\\.\\s+(.*)$/gm, '$1<li>$2</li>');
      h = h.replace(/(<li>[\\s\\S]*?<\\/li>)(\\n(?!<li>))/g, '<ul>$1</ul>$2');
      h = h.replace(/^(?!<[a-z]|$)(.+)$/gm, '<p>$1</p>');
      h = h.replace(/<p>\\s*<\\/p>/g, '');
      h = h.replace(/<p>(<(?:ul|ol|blockquote|pre|table|h[1-6]))/g, '$1');
      h = h.replace(/(<\\/(?:ul|ol|blockquote|pre|table|h[1-6])>)<\\/p>/g, '$1');
      return h;
    }

    /* ---------- csv grid ---------- */
    var grid = { delim: ',', rows: [] };
    function initCsv() {
      grid.delim = detectDelim(CFG.content);
      grid.rows = parseCsv(CFG.content, grid.delim);
      if (grid.rows.length === 0) grid.rows = [['Column 1']];
      getContent = function () { return serializeCsv(grid.rows, grid.delim); };
      setContent = function (v) { grid.delim = detectDelim(v); grid.rows = parseCsv(v, grid.delim); renderGrid(); };
      renderGrid();
    }
    function detectDelim(text) {
      var line = (text.split('\\n')[0] || '');
      var best = ',', max = 0, cands = [',', ';', '\\t', '|'];
      for (var i = 0; i < cands.length; i++) {
        var d = cands[i];
        var n = line.split(d).length - 1;
        if (n > max) { max = n; best = d; }
      }
      return best;
    }
    function parseCsv(text, delim) {
      var rows = [], row = [], cur = '', q = false;
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (q) {
          if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') { q = false; }
          else { cur += ch; }
        } else if (ch === '"') { q = true; }
        else if (ch === delim) { row.push(cur); cur = ''; }
        else if (ch === '\\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else if (ch === '\\r') { /* skip */ }
        else { cur += ch; }
      }
      if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
      var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      rows.forEach(function (r) { while (r.length < width) r.push(''); });
      return rows;
    }
    function serializeCsv(rows, delim) {
      return rows.map(function (r) {
        return r.map(function (c) {
          c = c == null ? '' : String(c);
          if (c.indexOf(delim) >= 0 || c.indexOf('"') >= 0 || c.indexOf('\\n') >= 0) {
            return '"' + c.replace(/"/g, '""') + '"';
          }
          return c;
        }).join(delim);
      }).join('\\n');
    }
    function renderGrid() {
      var rows = grid.rows;
      var ncols = rows[0] ? rows[0].length : 0;
      var html = '<table class="grid"><thead><tr><th class="rownum"></th>';
      for (var c = 0; c < ncols; c++) {
        html += '<th><div class="colmenu"><input data-r="0" data-c="' + c + '" value="' + attr(rows[0][c]) + '">' +
          '<button class="icon-btn" title="Delete column" onclick="delCol(' + c + ')">\\u2715</button></div></th>';
      }
      html += '</tr></thead><tbody>';
      for (var r = 1; r < rows.length; r++) {
        html += '<tr><td class="rownum"><div class="colmenu">' + r + '<button class="icon-btn" title="Delete row" onclick="delRow(' + r + ')">\\u2715</button></div></td>';
        for (var c2 = 0; c2 < ncols; c2++) {
          html += '<td><input data-r="' + r + '" data-c="' + c2 + '" value="' + attr(rows[r][c2]) + '"></td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      var wrap = document.getElementById('grid');
      wrap.innerHTML = html;
      wrap.querySelectorAll('input').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var ri = +inp.getAttribute('data-r'), ci = +inp.getAttribute('data-c');
          grid.rows[ri][ci] = inp.value;
          markDirty();
        });
      });
    }
    function attr(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
    window.addRow = function () { var n = grid.rows[0] ? grid.rows[0].length : 1; var r = []; for (var i = 0; i < n; i++) r.push(''); grid.rows.push(r); renderGrid(); markDirty(); };
    window.addCol = function () { grid.rows.forEach(function (r, i) { r.push(i === 0 ? 'Column ' + (r.length + 1) : ''); }); renderGrid(); markDirty(); };
    window.delRow = function (r) { if (grid.rows.length <= 2) { toast('Need at least one data row', true); return; } grid.rows.splice(r, 1); renderGrid(); markDirty(); };
    window.delCol = function (c) { if ((grid.rows[0] ? grid.rows[0].length : 0) <= 1) { toast('Need at least one column', true); return; } grid.rows.forEach(function (r) { r.splice(c, 1); }); renderGrid(); markDirty(); };

    /* ---------- drafts ---------- */
    try {
      var saved = localStorage.getItem(DRAFT_KEY);
      if (saved != null && saved !== CFG.content) document.getElementById('draftBanner').classList.add('show');
    } catch (e) {}
    window.restoreDraft = function () {
      try { var v = localStorage.getItem(DRAFT_KEY); if (v != null) { setContent(v); markDirty(); } } catch (e) {}
      document.getElementById('draftBanner').classList.remove('show');
    };
    window.discardDraft = function () {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      document.getElementById('draftBanner').classList.remove('show');
    };

    /* ---------- publish ---------- */
    window.publish = function () {
      if (CFG.type === 'json' && !validateJson()) { toast('Fix JSON errors before publishing', true); return; }
      var btn = document.getElementById('publishBtn');
      btn.disabled = true; setStatus('Publishing\\u2026');
      fetch(CFG.baseUrl + '/a/' + encodeURIComponent(CFG.slug) + '/edit/source/publish', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: getContent() })
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok || !res.j.success) throw new Error(res.j && res.j.error || 'Publish failed');
          dirty = false; CFG.versionNo = res.j.versionNo;
          try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
          setStatus('Published v' + res.j.versionNo, 'saved');
          toast('Published \\u2713');
        })
        .catch(function (err) { setStatus('Publish failed', 'dirty'); toast(err.message || 'Publish failed', true); })
        .finally(function () { btn.disabled = false; });
    };

    window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); publish(); }
    });
  })();
  </script>
</body>
</html>`;
}

function textBody(type: SourceEditableType): string {
  const jsonExtras = type === 'json'
    ? `<button type="button" class="so-c-btn so-c-btn--secondary so-c-btn--sm format-btn" onclick="formatJson()">Format</button>`
    : '';
  return `
    <div class="text-pane" style="position:relative">
      ${jsonExtras}
      <textarea class="source" id="src" spellcheck="${type === 'txt' ? 'true' : 'false'}" placeholder="Start typing…"></textarea>
    </div>
    ${type === 'json' ? '<div class="json-error" id="jsonError"></div>' : ''}
  `;
}

function markdownBody(): string {
  return `
    <div class="md-toolbar">
      <button type="button" class="so-c-btn so-c-btn--ghost so-c-btn--sm" title="Heading" onclick="mdPrefix('## ')">H</button>
      <button type="button" class="so-c-btn so-c-btn--ghost so-c-btn--sm" title="Bold" onclick="mdWrap('**','**')">B</button>
      <button type="button" class="so-c-btn so-c-btn--ghost so-c-btn--sm" title="Italic" onclick="mdWrap('*','*')"><span style="font-style:italic">I</span></button>
      <button type="button" class="so-c-btn so-c-btn--ghost so-c-btn--sm" title="Inline code" onclick="mdWrap('\\u0060','\\u0060')">&lt;/&gt;</button>
      <button type="button" class="so-c-btn so-c-btn--ghost so-c-btn--sm" title="Link" onclick="mdWrap('[','](url)')">link</button>
      <button type="button" class="so-c-btn so-c-btn--ghost so-c-btn--sm" title="List item" onclick="mdPrefix('- ')">&bull; list</button>
      <button type="button" class="so-c-btn so-c-btn--ghost so-c-btn--sm" title="Quote" onclick="mdPrefix('&gt; ')">&ldquo; quote</button>
    </div>
    <div class="md-split">
      <div class="pane"><textarea class="source" id="src" spellcheck="false" placeholder="# Write markdown…"></textarea></div>
      <div class="pane"><div class="preview" id="preview"></div></div>
    </div>
  `;
}

function csvBody(): string {
  return `
    <div class="csv-pane">
      <div class="csv-actions">
        <button class="so-c-btn so-c-btn--secondary so-c-btn--sm" onclick="addRow()">+ Row</button>
        <button class="so-c-btn so-c-btn--secondary so-c-btn--sm" onclick="addCol()">+ Column</button>
      </div>
      <div class="csv-scroll"><div id="grid"></div></div>
    </div>
  `;
}
