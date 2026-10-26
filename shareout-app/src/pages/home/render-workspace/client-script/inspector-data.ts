import { DATA_SOURCES_COPY } from '../../../../../shared/data-sources/copy';
import { DATA_SOURCES_FORMAT_JS } from '../../../../serve/sandbox-viewer/data-sources/format-js';
import { dataSourcesIcon } from '../../../../serve/sandbox-viewer/data-sources/script';

const ICONS = JSON.stringify({
  connection: dataSourcesIcon('data'),
  store: dataSourcesIcon('table'),
  mcp: dataSourcesIcon('plug'),
  knowledge: dataSourcesIcon('book'),
  metric: dataSourcesIcon('metric'),
  file: dataSourcesIcon('file'),
  external: dataSourcesIcon('globe'),
  warn: dataSourcesIcon('warn', 14),
});

/**
 * Inspector Data tab (lazy chunk 'data'): the same GET /v1/artifacts/:id/sources list the
 * shared-link viewer shows, with the same words, plus editor details and links to the
 * lenses that manage each source. Hover, focus or pick a source to outline what it feeds
 * inside the stage, through the stage wrapper's frame bridge (window.soDataSources).
 */
export const workspace_client_inspector_data_JS = `  // ----- Data (GET /v1/artifacts/:id/sources) -----
  var DS_COPY = ${JSON.stringify(DATA_SOURCES_COPY).replace(/</g, '\\u003c')};
  var DS_ICONS = ${ICONS.replace(/</g, '\\u003c')};
${DATA_SOURCES_FORMAT_JS}
  var dsCache = {}, dsPinned = null, dsByKey = {}, dsWin = null;
  function dsLang() { return (window.__SO_HOME_LOCALE && window.__SO_HOME_LOCALE() === 'es') ? 'es' : 'en'; }
  function dsStageWin() {
    var pr = panes[activeKey];
    try { return pr && pr.iframe && pr.iframe.contentWindow; } catch (e) { return null; }
  }
  function dsPost(w, ref, selectors, scroll) {
    try { if (w && w.soDataSources) w.soDataSources.highlight(ref, selectors, scroll); } catch (e) { /* stage navigated away */ }
  }
  function dsHighlight(ref, scroll) {
    var s = ref ? dsByKey[ref] : null;
    var w = dsStageWin();
    if (dsWin && dsWin !== w) dsPost(dsWin, null, [], false);
    dsWin = w;
    dsPost(w, ref || null, s ? s.feeds.map(function (f) { return f.selector; }) : [], !!scroll);
  }
  // Leaving the tab (or the page) takes the outline with it.
  function dataClear() {
    dsPinned = null;
    if (dsWin) dsPost(dsWin, null, [], false);
    dsWin = null;
  }
  function dsIcon(s) {
    var k = s.kind === 'connection' ? 'connection' : s.kind === 'mcp' ? 'mcp' : s.kind === 'knowledge' ? 'knowledge' : s.kind === 'metric' ? 'metric' : s.kind === 'file' ? 'file' : s.kind === 'external' ? 'external' : 'store';
    return DS_ICONS[k];
  }
  function dsLens(url) { var m = /[?&]view=([a-z]+)/.exec(url || ''); return m ? m[1] : ''; }
  function dsItem(s, F, C) {
    var h = '<li><button class="wsx-ds__src" type="button" data-dsref="' + esc(s.key) + '" aria-pressed="false">'
      + '<span class="wsx-ds__ico">' + dsIcon(s) + '</span><span class="wsx-ds__main">'
      + '<span class="wsx-ds__name">' + esc(F.label(s))
      + (s.declared ? '' : '<span class="wsx-ds__tag" title="' + esc(C.undeclaredTitle) + '">' + esc(C.undeclared) + '</span>') + '</span>';
    var meta = F.meta(s, dsByKey);
    if (meta) h += '<span class="wsx-ds__meta">' + esc(meta) + '</span>';
    if (s.freshness && s.freshness.stale) h += '<span class="wsx-ds__stale">' + DS_ICONS.warn + esc(C.stale) + '</span>';
    if (s.description) h += '<span class="wsx-ds__meta">' + esc(s.description) + '</span>';
    h += '<span class="wsx-ds__meta">' + esc(F.feeds(s)) + '</span></span></button>';
    var v = F.details(s.details);
    if (v) {
      h += '<details class="wsx-ds__more"><summary>' + esc(C.details) + '</summary>';
      if (v.query) h += '<pre>' + esc(v.query) + '</pre>';
      if (v.rows.length) h += '<dl>' + v.rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
      var lenses = v.links.filter(function (p) { return dsLens(p[0]) && ws.querySelector('[data-lens="' + dsLens(p[0]) + '"]'); });
      if (lenses.length) h += '<div class="wsx-ds__links">' + lenses.map(function (p) { return '<button class="wsx-link" type="button" data-dslens="' + esc(dsLens(p[0])) + '">' + esc(p[1]) + '</button>'; }).join('') + '</div>';
      h += '</details>';
    }
    return h + '</li>';
  }
  function paintData(art, d) {
    var lang = dsLang(), C = DS_COPY[lang], F = soDsFormat(C, locTag());
    dsByKey = {};
    (d.sources || []).forEach(function (s) { dsByKey[s.key] = s; });
    var shown = (d.sources || []).filter(function (s) { return s.direct; });
    var h = '<div class="wsx-ds"><p class="wsx-ds__lead">' + esc(C.lead) + '</p>';
    h += shown.length
      ? '<ul class="wsx-ds__list">' + shown.map(function (s) { return dsItem(s, F, C); }).join('') + '</ul>'
      : '<div class="wsx-empty">' + esc(C.empty) + '</div>';
    if (d.version && d.version.number) h += '<p class="wsx-ds__note">' + esc(C.publishedVersion.split('{n}').join(String(d.version.number))) + '</p>';
    if (d.access === 'summary' && shown.length) h += '<p class="wsx-ds__note">' + esc(C.editorsOnly) + '</p>';
    dataClear();
    rbodyEl.innerHTML = h + '</div>';
    rbodyEl.querySelectorAll('[data-dsref]').forEach(function (b) {
      var ref = b.getAttribute('data-dsref');
      b.addEventListener('mouseenter', function () { dsHighlight(ref, false); });
      b.addEventListener('focus', function () { dsHighlight(ref, false); });
      b.addEventListener('mouseleave', function () { dsHighlight(dsPinned, false); });
      b.addEventListener('blur', function () { dsHighlight(dsPinned, false); });
      b.addEventListener('click', function () {
        dsPinned = dsPinned === ref ? null : ref;
        rbodyEl.querySelectorAll('[data-dsref]').forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-dsref') === dsPinned ? 'true' : 'false'); });
        dsHighlight(dsPinned || ref, !!dsPinned);
      });
    });
    rbodyEl.querySelectorAll('[data-dslens]').forEach(function (b) {
      b.addEventListener('click', function () { var lb = ws.querySelector('[data-lens="' + b.getAttribute('data-dslens') + '"]'); if (lb) lb.click(); });
    });
  }
  function renderData(art) {
    rbodyEl.innerHTML = '<div class="wsx-ds">' + i18nLoad() + '</div>';
    if (!art.id) {
      fetchMeta(art, function (m) {
        if (activeArt !== art) return;
        if (!m || !art.id) { railRetry('inspector.dataFailed', function () { renderData(art); }); return; }
        renderData(art);
      });
      return;
    }
    var pr = panes[activeKey];
    var page = pr && pr.page ? pr.page : '';
    var key = art.id + '|' + page;
    if (dsCache[key]) { paintData(art, dsCache[key]); return; }
    fetch('/v1/artifacts/' + encodeURIComponent(art.id) + '/sources' + (page ? '?page=' + encodeURIComponent(page) : ''), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(okOr)
      .then(function (r) { return r.json(); })
      .then(function (d) { dsCache[key] = d; if (activeArt === art && rActive === 'data') paintData(art, d); })
      .catch(function () { if (activeArt === art && rActive === 'data') railRetry('inspector.dataFailed', function () { renderData(art); }); });
  }

`;
