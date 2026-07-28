/** Workspace analytics roll-up: totals, trends, daily chart. */
export const workspace_client_home_views_analytics_JS = `  // ----- Analytics — workspace roll-up: totals + trend vs prior period, daily chart,
  // top pages / countries / referrers, and load-perf p75. -----
  var anRange = 30;
  function anDelta(cur, prev) {
    if (!prev) return '';
    var pct = Math.round(((cur - prev) / prev) * 100);
    if (!pct) return '<span class="wsx-an__delta flat">0%</span>';
    var up = pct > 0;
    return '<span class="wsx-an__delta ' + (up ? 'up' : 'down') + '">' + (up ? '\\u2191' : '\\u2193') + ' ' + Math.abs(pct) + '%</span>';
  }
  function anList(title, rows, unit) {
    if (!rows || !rows.length) return '';
    var max = Math.max.apply(null, rows.map(function (r) { return r.count || r.views || 0; })) || 1;
    return '<div class="wsx-an__panel"><div class="wsx-panel-title">' + esc(title) + '</div>' + rows.slice(0, 6).map(function (r) {
      var v = r.count || r.views || 0; var nm = r.name || t('analytics.unknown');
      return '<div class="wsx-an__bar"><span class="wsx-an__barname" title="' + esc(nm) + '">' + esc(nm) + '</span><span class="wsx-an__bartrack"><span style="width:' + Math.round((v / max) * 100) + '%"></span></span><span class="wsx-an__barval">' + v + '</span></div>';
    }).join('') + '</div>';
  }
  function paintAnalytics(d) {
    var m = document.getElementById('wsxAnalyticsMount');
    var tot = d.totals || {}, prev = d.prev || {};
    var views = tot.views || 0, uniq = tot.uniques || 0, active = tot.activeArtifacts || 0;
    var seg = [7, 30, 90].map(function (r) { return '<button class="wsx-an__seg' + (r === anRange ? ' is-on' : '') + '" data-an-range="' + r + '" type="button">' + r + 'd</button>'; }).join('');
    if (!views && !uniq) {
      m.innerHTML = '<div class="wsx-an__top"><div class="wsx-an__rangeseg">' + seg + '</div></div><div class="wsx-empty" style="padding:32px">' + esc(t('analytics.noViews').replace('{n}', String(anRange))) + '</div>';
      wireAnRange(m); return;
    }
    var perf = d.perf || {};
    var cards = '<div class="wsx-an__cards">'
      + '<div class="wsx-an__card"><div class="wsx-an__n">' + views + '</div><div class="wsx-an__l">' + esc(t('analytics.kpiViews')) + '</div>' + anDelta(views, prev.views) + '</div>'
      + '<div class="wsx-an__card"><div class="wsx-an__n">' + uniq + '</div><div class="wsx-an__l">' + esc(t('analytics.kpiVisitors')) + '</div>' + anDelta(uniq, prev.uniques) + '</div>'
      + '<div class="wsx-an__card"><div class="wsx-an__n">' + active + '</div><div class="wsx-an__l">' + esc(t('analytics.kpiActivePages')) + '</div></div>'
      + (perf.samples ? '<div class="wsx-an__card"><div class="wsx-an__n">' + (perf.lcp_p75 ? Math.round(perf.lcp_p75) + '<span class="wsx-an__u">ms</span>' : '\\u2014') + '</div><div class="wsx-an__l">' + esc(t('analytics.kpiLcpP75')) + '</div></div>' : '')
      + '</div>';
    var topArt = (d.topArtifacts || []).map(function (a) { return { name: a.name, count: a.views }; });
    m.innerHTML = '<div class="wsx-an__top"><div class="wsx-an__rangeseg">' + seg + '</div></div>'
      + cards
      + '<div class="wsx-an__chart">' + spark((d.series || []).map(function (s) { return { views: s.views }; })) + '</div>'
      + '<div class="wsx-an__cols">' + anList(t('analytics.topPages'), topArt) + anList(t('analytics.topCountries'), d.topCountries) + anList(t('analytics.topReferrers'), d.topReferrers) + '</div>';
    wireAnRange(m);
  }
  function wireAnRange(root) {
    root.querySelectorAll('[data-an-range]').forEach(function (b) {
      b.addEventListener('click', function () { anRange = parseInt(b.getAttribute('data-an-range'), 10) || 30; loadAccountAnalytics(); });
    });
  }
  function loadAccountAnalytics() {
    var m = document.getElementById('wsxAnalyticsMount'); m.innerHTML = i18nLoad();
    fetch('/v1/home/analytics?range=' + anRange, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (!d) { m.innerHTML = i18nEmpty('analytics.none'); return; } paintAnalytics(d); })
      .catch(function () { m.innerHTML = i18nError('common.couldNotLoad'); });
  }

  var DB_SVG = '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>';
  function needWs(m) { if (window.WSX_WS) return false; m.innerHTML = i18nEmpty('analytics.needTeamSpace'); return true; }

`;
