import type { DataSourcesCopy } from '../../../../shared/data-sources/copy';
import { DATA_SOURCES_FORMAT_JS } from './format-js';

export interface DataSourcesScriptConfig {
  artifactId: string;
  /** The page the viewer shows (multi-page sites: ?page=). */
  page: string;
  lang: string;
  copy: DataSourcesCopy;
  /** Show the pill at once (the page declares live connections), without waiting for the frame. */
  visible: boolean;
}

// Stroke icons, same family and weight as the toolbar icons. Static strings only.
const ICONS = {
  data: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M12 3v18"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  metric: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  warn: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
};

export function dataSourcesIcon(name: keyof typeof ICONS, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/**
 * Client script (no <script> tag) for the viewer Data sources panel. Shows the pill when the artifact
 * frame says it shows data (or the page declares live connections), loads
 * GET /v1/artifacts/{id}/sources same-origin on first open, and asks the frame to
 * outline what a source feeds while it is hovered, focused or picked.
 */
export function renderDataSourcesScript(cfg: DataSourcesScriptConfig): string {
  const config = JSON.stringify({
    id: cfg.artifactId,
    page: cfg.page,
    lang: cfg.lang,
    c: cfg.copy,
    visible: cfg.visible,
    icons: {
      connection: dataSourcesIcon('data'),
      store: dataSourcesIcon('table'),
      mcp: dataSourcesIcon('plug'),
      knowledge: dataSourcesIcon('book'),
      metric: dataSourcesIcon('metric'),
      file: dataSourcesIcon('file'),
      external: dataSourcesIcon('globe'),
      warn: dataSourcesIcon('warn', 14),
    },
  }).replace(/</g, '\\u003c');
  return `
(function() {
  if (window.soDataSources) return;
  var CFG = ${config};
  var C = CFG.c;
  var pill = document.getElementById('so-ds-pill');
  var dock = document.getElementById('so-ds-dock');
  var panel = document.getElementById('so-ds-panel');
  var body = document.getElementById('so-ds-body');
  var foot = document.getElementById('so-ds-foot');
  var title = document.getElementById('so-ds-title');
  var status = document.getElementById('so-ds-status');
  var closeBtn = panel && panel.querySelector('.so-ds-close');
  if (!pill || !panel || !body) return;

  // Sit next to the toolbar trigger when there is a toolbar; otherwise keep our own corner.
  var toolbar = document.getElementById('shareout-admin-toolbar');
  var trigger = document.getElementById('so-toolbar-trigger');
  if (toolbar && trigger) {
    toolbar.insertBefore(pill, trigger);
    if (dock && dock.parentNode) dock.parentNode.removeChild(dock);
  }

  var data = null, loading = false, pinned = null, opener = null, byKey = {};

  function frame() { return document.querySelector('iframe'); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function icon(html) { var s = el('span', 'so-ds-ico'); s.innerHTML = html; return s; }
  function show() { pill.hidden = false; }
  function say(text) { if (status) status.textContent = text; }

  // The frame announces that it shows data; only our own artifact frame counts. The
  // answer tells the page this host shows its sources, so so.sources.mount() drops its
  // own floating button.
  window.addEventListener('message', function(e) {
    var f = frame();
    if (!f || e.source !== f.contentWindow) return;
    if (!e.data || e.data.type !== 'shareout:sources:hint') return;
    show();
    f.contentWindow.postMessage({ type: 'shareout:sources:host', panel: true }, '*');
  });
  function ping() { var f = frame(); if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'shareout:sources:ping' }, '*'); }
  if (CFG.visible) show();
  var f0 = frame();
  if (f0) f0.addEventListener('load', ping);
  ping();

  // ---- highlight inside the artifact frame ----
  function post(ref, selectors, scroll) {
    var f = frame();
    if (!f || !f.contentWindow) return;
    // The artifact runs in an opaque-origin sandbox, so the target can't be pinned;
    // the message carries only the page's own selectors.
    f.contentWindow.postMessage({ type: 'shareout:sources:highlight', ref: ref || null, selectors: selectors || [], scroll: !!scroll }, '*');
  }
  function send(ref, scroll) {
    var s = ref ? byKey[ref] : null;
    post(ref, s ? s.feeds.map(function(x) { return x.selector; }) : [], scroll);
  }
  function preview(ref) { send(ref || pinned, false); }
  function setPinned(ref) {
    pinned = ref;
    var buttons = body.querySelectorAll('.so-ds-src');
    for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute('aria-pressed', buttons[i].getAttribute('data-ref') === ref ? 'true' : 'false');
  }

  // ---- words (shared with the Studio tab: format-js.ts) ----
${DATA_SOURCES_FORMAT_JS}
  var F = soDsFormat(C, CFG.lang);
  function iconOf(s) {
    var i = CFG.icons;
    if (s.kind === 'connection') return i.connection;
    if (s.kind === 'mcp') return i.mcp;
    if (s.kind === 'knowledge') return i.knowledge;
    if (s.kind === 'metric') return i.metric;
    if (s.kind === 'file') return i.file;
    if (s.kind === 'external') return i.external;
    return i.store;
  }

  // ---- render ----
  function details(s) {
    var v = F.details(s.details);
    if (!v) return null;
    var box = el('details', 'so-ds-more');
    box.appendChild(el('summary', null, C.details));
    if (v.query) box.appendChild(el('pre', null, v.query));
    if (v.rows.length) {
      var dl = el('dl');
      v.rows.forEach(function(r) { dl.appendChild(el('dt', null, r[0])); dl.appendChild(el('dd', null, r[1])); });
      box.appendChild(dl);
    }
    if (v.links.length) {
      var links = el('div', 'so-ds-links');
      v.links.forEach(function(p) {
        var a = el('a', null, p[1]);
        a.href = p[0];
        a.target = '_blank';
        a.rel = 'noopener';
        links.appendChild(a);
      });
      box.appendChild(links);
    }
    return box;
  }
  function item(s) {
    var li = el('li', 'so-ds-item');
    var b = el('button', 'so-ds-src');
    b.type = 'button';
    b.setAttribute('data-ref', s.key);
    b.setAttribute('aria-pressed', 'false');
    b.appendChild(icon(iconOf(s)));
    var main = el('span', 'so-ds-main');
    var name = el('span', 'so-ds-name', F.label(s));
    if (!s.declared) {
      var tag = el('span', 'so-ds-tag', C.undeclared);
      tag.title = C.undeclaredTitle;
      name.appendChild(tag);
    }
    main.appendChild(name);
    var meta = F.meta(s, byKey);
    if (meta) main.appendChild(el('span', 'so-ds-meta', meta));
    if (s.freshness && s.freshness.stale) {
      var st = el('span', 'so-ds-stale');
      st.innerHTML = CFG.icons.warn;
      st.appendChild(document.createTextNode(C.stale));
      main.appendChild(st);
    }
    if (s.description) main.appendChild(el('span', 'so-ds-meta', s.description));
    main.appendChild(el('span', 'so-ds-feeds', F.feeds(s)));
    b.appendChild(main);
    b.addEventListener('mouseenter', function() { preview(s.key); });
    b.addEventListener('mouseleave', function() { preview(null); });
    b.addEventListener('focus', function() { preview(s.key); });
    b.addEventListener('blur', function() { preview(null); });
    b.addEventListener('click', function() {
      if (pinned === s.key) { setPinned(null); send(s.key, false); }
      else { setPinned(s.key); send(s.key, true); }
    });
    li.appendChild(b);
    var more = details(s);
    if (more) li.appendChild(more);
    return li;
  }
  function render() {
    body.removeAttribute('aria-busy');
    body.textContent = '';
    byKey = {};
    (data.sources || []).forEach(function(s) { byKey[s.key] = s; });
    var shown = (data.sources || []).filter(function(s) { return s.direct; });
    if (!shown.length) {
      body.appendChild(el('p', 'so-ds-state', C.empty));
      say(C.empty);
      if (foot) foot.hidden = true;
      return;
    }
    var ul = el('ul', 'so-ds-list');
    shown.forEach(function(s) { ul.appendChild(item(s)); });
    body.appendChild(ul);
    say('');
    if (foot) foot.hidden = data.access !== 'summary';
  }
  function load() {
    if (loading) return;
    loading = true;
    body.setAttribute('aria-busy', 'true');
    body.textContent = '';
    for (var i = 0; i < 3; i++) body.appendChild(el('div', 'so-ds-skel'));
    say(C.loading);
    var url = '/v1/artifacts/' + encodeURIComponent(CFG.id) + '/sources?page=' + encodeURIComponent(CFG.page);
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(d) { loading = false; data = d; render(); })
      .catch(function() {
        loading = false;
        body.removeAttribute('aria-busy');
        body.textContent = '';
        var box = el('div', 'so-ds-state');
        box.appendChild(el('p', null, C.error));
        var retry = el('button', 'so-ds-retry', C.retry);
        retry.type = 'button';
        retry.addEventListener('click', load);
        box.appendChild(retry);
        body.appendChild(box);
        say(C.error);
      });
  }

  // ---- open / close ----
  function open() {
    show();
    opener = document.activeElement;
    panel.hidden = false;
    pill.setAttribute('aria-expanded', 'true');
    if (title) title.focus();
    if (!data) load();
  }
  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    pill.setAttribute('aria-expanded', 'false');
    setPinned(null);
    send(null, false);
    var back = opener && document.contains(opener) && opener !== document.body ? opener : pill;
    try { back.focus(); } catch (er) {}
  }
  pill.addEventListener('click', function() { if (panel.hidden) open(); else close(); });
  if (closeBtn) closeBtn.addEventListener('click', close);
  panel.addEventListener('keydown', function(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  // Studio and editors reuse this page's frame bridge: highlight(ref, selectors, scroll).
  window.soDataSources = { open: open, close: close, highlight: post };
})();
`;
}
