import type { DataSourcesCopy } from './copy';

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
  function fill(s, map) { for (var k in map) s = s.split('{' + k + '}').join(String(map[k])); return s; }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function icon(html) { var s = el('span', 'so-ds-ico'); s.innerHTML = html; return s; }
  function show() { pill.hidden = false; }
  function say(text) { if (status) status.textContent = text; }

  // The frame announces that it shows data; only our own artifact frame counts.
  window.addEventListener('message', function(e) {
    var f = frame();
    if (!f || e.source !== f.contentWindow) return;
    if (e.data && e.data.type === 'shareout:sources:hint') show();
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

  // ---- words ----
  function ago(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return C.justNow;
    if (s < 3600) return fill(C.minAgo, { n: Math.floor(s / 60) });
    if (s < 86400) return fill(C.hAgo, { n: Math.floor(s / 3600) });
    var d = Math.floor(s / 86400);
    if (d === 1) return C.yesterday;
    if (d < 30) return fill(C.daysAgo, { n: d });
    return fill(C.onDate, { date: date(iso) });
  }
  function date(v) {
    var dateOnly = /^\\d{4}-\\d{2}-\\d{2}$/.test(v);
    var t = Date.parse(v);
    if (isNaN(t)) return v;
    try {
      return new Intl.DateTimeFormat(CFG.lang, dateOnly ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t));
    } catch (er) { return v; }
  }
  function labelOf(s) {
    if (s.key === 'knowledge:workspace') return C.kindKnowledge;
    if (s.key === 'file:uploads') return C.kindUploads;
    if (s.key.indexOf(':~') > 0) {
      if (s.provider_label) return s.provider_label;
      return { json: C.kindSaved, table: C.kindTable, dataset: C.kindDataset, file: C.kindFile, external: C.kindExternal, connection: C.kindConnection }[s.kind] || s.label;
    }
    return s.label;
  }
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
  function freshness(s) {
    var f = s.freshness || {}, r = f.refresher;
    if (r && r.type === 'live') return s.kind === 'mcp' ? C.liveAsYou : C.live;
    if (f.last_refresh_at) {
      var by = r ? (r.name ? fill(r.type === 'crew' ? C.byCrew : C.byJob, { name: r.name }) : (r.type === 'job' || r.type === 'crew' ? C.bySchedule : '')) : '';
      return fill(C.updated, { when: ago(f.last_refresh_at) }) + (by ? ' \\u00b7 ' + by : '');
    }
    if (r && (r.type === 'job' || r.type === 'crew')) return r.name ? fill(r.type === 'crew' ? C.keptByCrew : C.keptByJob, { name: r.name }) : C.keptBySchedule;
    if (f.as_of) return fill(C.asOf, { date: date(f.as_of) });
    if (f.refresh) return fill(C.refreshes, { text: f.refresh });
    if (r && r.type === 'manual') return C.manual;
    return C.notDeclared;
  }
  function origin(s) {
    if (s.kind === 'connection' || s.kind === 'external') return s.provider_label && s.provider_label !== labelOf(s) ? s.provider_label : '';
    if (s.kind === 'mcp') return '';
    var names = [];
    (s.upstream || []).forEach(function(k) { var u = byKey[k]; if (u) names.push(u.provider_label || labelOf(u)); });
    return names.length ? fill(C.from, { name: names.join(', ') }) : '';
  }
  function feeds(s) {
    var n = s.feed_count || 0;
    return n === 0 ? C.feedsNone : n === 1 ? C.feedsOne : fill(C.feedsMany, { n: n });
  }

  // ---- render ----
  function row(dl, term, value) {
    if (!value) return;
    dl.appendChild(el('dt', null, term));
    dl.appendChild(el('dd', null, value));
  }
  function details(s) {
    var d = s.details;
    if (!d) return null;
    var box = el('details', 'so-ds-more');
    box.appendChild(el('summary', null, C.details));
    var any = false;
    if (d.query) { box.appendChild(el('pre', null, d.query)); any = true; }
    var dl = el('dl');
    if (d.connection) {
      row(dl, C.connection, [d.connection.name, d.connection.scope === 'workspace' ? C.scopeWorkspace : C.scopeArtifact,
        d.connection.credential_scope === 'per_user' ? C.credsPerUser : C.credsShared].join(' \\u00b7 '));
    } else if (d.missing_connection) {
      row(dl, C.connection, fill(C.missingConnection, { name: d.missing_connection }));
    }
    if (d.tables && d.tables.length) row(dl, C.tables, d.tables.join(', '));
    (d.refreshers || []).forEach(function(r) {
      var parts = [fill(r.type === 'crew' ? C.refCrew : r.type === 'sync' ? C.refSync : C.refJob, { name: r.name })];
      if (r.schedule) parts.push(r.schedule);
      if (!r.enabled) parts.push(C.paused);
      else if (r.last_status === 'failed') parts.push(C.lastFailed);
      row(dl, C.updatedBy, parts.join(' \\u00b7 '));
    });
    if (d.tools && d.tools.length) row(dl, C.tools, d.tools.join(', '));
    if (d.hosts && d.hosts.length) row(dl, C.hosts, d.hosts.join(', '));
    var rep = d.replication || {};
    row(dl, C.credentials, rep.credentials);
    row(dl, C.rebuild, rep.build);
    row(dl, C.publishCmd, rep.publish);
    row(dl, C.notes, rep.notes);
    if (dl.children.length) { box.appendChild(dl); any = true; }
    var m = d.manage || {}, links = el('div', 'so-ds-links');
    [[m.connections, C.manageConnections], [m.jobs, C.manageJobs], [m.data, C.manageData]].forEach(function(p) {
      if (!p[0]) return;
      var a = el('a', null, p[1]);
      a.href = p[0];
      a.target = '_blank';
      a.rel = 'noopener';
      links.appendChild(a);
    });
    if (links.children.length) { box.appendChild(links); any = true; }
    return any ? box : null;
  }
  function item(s) {
    var li = el('li', 'so-ds-item');
    var b = el('button', 'so-ds-src');
    b.type = 'button';
    b.setAttribute('data-ref', s.key);
    b.setAttribute('aria-pressed', 'false');
    b.appendChild(icon(iconOf(s)));
    var main = el('span', 'so-ds-main');
    var name = el('span', 'so-ds-name', labelOf(s));
    if (!s.declared) {
      var tag = el('span', 'so-ds-tag', C.undeclared);
      tag.title = C.undeclaredTitle;
      name.appendChild(tag);
    }
    main.appendChild(name);
    var meta = [origin(s), freshness(s)].filter(Boolean).join(' \\u00b7 ');
    if (meta) main.appendChild(el('span', 'so-ds-meta', meta));
    if (s.freshness && s.freshness.stale) {
      var st = el('span', 'so-ds-stale');
      st.innerHTML = CFG.icons.warn;
      st.appendChild(document.createTextNode(C.stale));
      main.appendChild(st);
    }
    if (s.description) main.appendChild(el('span', 'so-ds-meta', s.description));
    main.appendChild(el('span', 'so-ds-feeds', feeds(s)));
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
