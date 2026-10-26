/** Catalog lens — metrics: the Métricas list (status, owner, source, freshness) and a metric's formula + "Try it" panel. */
export const workspace_client_home_views_catalogMetrics_JS = `  // ----- Catalog — metrics (list columns, formula, Try it) -----
  var catMetrics = null, catMetricsLoading = false, catMetricInfo = {};
  function catMetricsBase() { return '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/catalog/metrics'; }

  // Numbers in the shell's language (es-AR / en-US), shaped by the metric's format.
  function catFmtNumber(v, f) {
    if (v === null || v === undefined || v === '') return '\\u2014';
    var n = Number(v); if (!isFinite(n)) return esc(String(v));
    f = f || { kind: 'number' };
    var fixed = typeof f.decimals === 'number';
    var o = { minimumFractionDigits: fixed ? f.decimals : (f.kind === 'number' ? 0 : 2), maximumFractionDigits: fixed ? f.decimals : 2 };
    try {
      if (f.kind === 'percent') return new Intl.NumberFormat(locTag(), Object.assign({ style: 'percent' }, o)).format(n);
      if (f.kind === 'currency' && f.currency) return new Intl.NumberFormat(locTag(), Object.assign({ style: 'currency', currency: f.currency }, o)).format(n);
      return (f.prefix || '') + new Intl.NumberFormat(locTag(), o).format(n) + (f.suffix || '');
    } catch (e) { return String(n); }
  }

  function catAggText(m) {
    if (!m) return '?';
    var x = m.expr === '*' ? '*' : m.expr;
    if (m.agg === 'sum') return '\\u03A3 ' + x;
    var k = ({ count: 'catalog.aggCount', count_distinct: 'catalog.aggDistinct', avg: 'catalog.aggAvg', min: 'catalog.aggMin', max: 'catalog.aggMax' })[m.agg];
    return (k ? t(k) : m.agg) + '(' + x + ')';
  }
  function catFormula(d) {
    if (d.type === 'ratio') return catAggText(d.numerator) + ' \\u00F7 ' + catAggText(d.denominator);
    return d.measure ? catAggText(d.measure) : (d.formula || '');
  }
  function catGrainLabel(g) {
    return ({ day: t('admin.usageColDay'), week: t('catalog.grainWeek'), month: t('catalog.grainMonth'), quarter: t('catalog.grainQuarter'), year: t('catalog.grainYear') })[g] || g;
  }
  function catMetricTitle(x) {
    return (window.__SO_HOME_LOCALE && window.__SO_HOME_LOCALE() === 'es' && x.title_es) ? x.title_es : x.title;
  }
  function catSourceText(s) {
    if (!s) return '';
    if (s.type === 'shared_table') return t('catalog.mSourceShared').replace('{name}', s.shared_table);
    return (s.connection_name || s.connection_id || '') + (s.fqn ? ' \\u00B7 ' + s.fqn : (s.type === 'sql' ? ' \\u00B7 SQL' : ''));
  }
  function catSla(sla) { return sla ? '\\u2264 ' + String(sla).replace(/^(\\d+)\\s*([mhdw])$/, '$1 $2') : ''; }

  // ---- Métricas list: the metric kind segment shows these columns instead.
  function catMetricHeads() {
    return ['catalog.colName', 'catalog.colStatus', 'catalog.mColOwner', 'catalog.kindSource', 'catalog.mColFreshness'].map(function (k) {
      return '<th>' + esc(t(k)) + '</th>';
    }).join('');
  }

  function catMetricRows(m) {
    if (!catMetrics) {
      if (!catMetricsLoading) {
        catMetricsLoading = true;
        fetch(catMetricsBase(), { credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { catMetrics = (d && d.metrics) || []; })
          .catch(function () { catMetrics = []; })
          .then(function () { catMetricsLoading = false; if (!catCurrentId && catState.kind === 'metric') catRenderList(m); });
      }
      return '<tr><td colspan="5" class="wsx-cat__hint">' + esc(t('common.loading')) + '</td></tr>';
    }
    if (!catMetrics.length) return '<tr><td colspan="5" class="wsx-cat__hint">' + esc(t('catalog.mNone')) + '</td></tr>';
    return catMetrics.map(function (x) {
      var text = [x.id, x.title, x.title_es || '', x.owner || ''].join(' ').toLowerCase();
      var status = catBadge(x.status) + (x.stale ? ' <span class="wsx-cat__chg">' + esc(t('catalog.statusChanged')) + '</span>' : '');
      var src = catSourceText(x.source);
      return '<tr class="wsx-cat__row" data-cat-id="' + esc(x.id) + '" data-cat-text="' + esc(text) + '" data-cat-kind="metric" data-cat-domain="' + esc(x.domain || '') + '" data-cat-status="' + esc(x.status) + '">'
        + '<td><span class="wsx-atbl__link">' + esc(catMetricTitle(x)) + '</span>' + (x.problem ? ' <span class="wsx-cat__unc" title="' + esc(x.problem.message) + '">' + esc(t('catalog.mNotRunnable')) + '</span>' : '') + '</td>'
        + '<td>' + status + '</td>'
        + '<td class="wsx-cat__cdom">' + (x.owner ? esc(x.owner) : '\\u2014') + '</td>'
        + '<td class="wsx-cat__corigin" title="' + esc(src) + '">' + (src ? esc(src) : '\\u2014') + '</td>'
        + '<td class="wsx-cat__cdom">' + (x.freshness_sla ? esc(catSla(x.freshness_sla)) : '\\u2014') + '</td></tr>';
    }).join('');
  }

  // ---- A metric's panel on its entry: formula, grains, dimensions, source, freshness, Try it.
  function catMetricPanel(m, id) {
    var box = document.getElementById('catMetric'); if (!box) return;
    box.innerHTML = '<div class="wsx-cat__hint">' + esc(t('common.loading')) + '</div>';
    fetch(catMetricsBase() + '/' + encodeURIComponent(id), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (catCurrentId !== id) return;
        var b = document.getElementById('catMetric'); if (!b) return;
        if (!d || !d.metric) { b.innerHTML = ''; return; }
        catMetricInfo[id] = d.metric;
        b.innerHTML = catMetricHtml(d.metric);
        catBindTry(id);
      })
      .catch(function () { var b = document.getElementById('catMetric'); if (b) b.innerHTML = ''; });
  }

  function catFreshText(f) {
    if (!f) return '';
    var parts = [];
    if (f.sla) parts.push(catSla(f.sla));
    if (f.last_updated_at) parts.push((f.stale ? t('catalog.mLate') : t('catalog.mUpdated')).replace('{when}', adRelDate(f.last_updated_at)));
    return parts.join(' \\u00B7 ');
  }

  function catMetricHtml(x) {
    var rows = [];
    if (x.formula) rows.push([t('catalog.mFormula'), '<span class="wsx-cat__formula">' + esc(catFormula(x)) + '</span>']);
    if (x.source) rows.push([t('catalog.kindSource'), esc(catSourceText(x.source))]);
    if (x.grains && x.grains.length) rows.push([t('catalog.mGrains'), esc(x.grains.map(catGrainLabel).join(', '))]);
    if (x.dimensions && x.dimensions.length) rows.push([t('catalog.mDims'), esc(x.dimensions.join(', '))]);
    var fresh = catFreshText(x.freshness);
    if (fresh) rows.push([t('catalog.mColFreshness'), esc(fresh)]);
    var html = rows.length ? '<dl class="wsx-cat__meta">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>' : '';
    if (x.problem) return html + '<p class="wsx-cat__hint wsx-cat__mproblem">' + esc(t('catalog.mProblem').replace('{reason}', x.problem.message)) + '</p>';
    if (!x.can_run) return html + '<p class="wsx-cat__hint">' + esc(t('catalog.mCantRun')) + '</p>';
    var grains = (x.grains || []).map(function (g) { return '<option value="' + esc(g) + '">' + esc(catGrainLabel(g)) + '</option>'; }).join('');
    var dims = (x.dimensions || []).map(function (n) {
      return '<label class="wsx-cat__trydim"><input type="checkbox" value="' + esc(n) + '" data-cat-by> ' + esc(n) + '</label>';
    }).join('');
    return html + '<div class="wsx-cat__try">'
      + '<div class="wsx-cat__tryhead">' + esc(t('catalog.mTry')) + '</div>'
      + '<div class="wsx-cat__tryrow">'
      + (grains ? '<label>' + esc(t('catalog.mPeriod')) + ' <select class="wsx-admin__role" id="catTryGrain">' + grains + '</select></label>'
        + '<label>' + esc(t('catalog.mFrom')) + ' <input class="so-c-input" type="date" id="catTryFrom"></label>'
        + '<label>' + esc(t('catalog.mTo')) + ' <input class="so-c-input" type="date" id="catTryTo"></label>' : '')
      + '</div>'
      + (dims ? '<div class="wsx-cat__tryrow"><span>' + esc(t('catalog.mBy')) + '</span>' + dims + '</div>' : '')
      + '<div class="wsx-cat__tryrow"><button class="so-c-btn so-c-btn--primary so-c-btn--sm" type="button" id="catTryRun">' + esc(t('catalog.mRun')) + '</button></div>'
      + '<div id="catTryOut" aria-live="polite"></div></div>';
  }

  function catBindTry(id) {
    var run = document.getElementById('catTryRun'); if (!run) return;
    run.addEventListener('click', function () { catTryRun(id); });
  }

  function catTryRun(id) {
    var run = document.getElementById('catTryRun'), out = document.getElementById('catTryOut');
    if (!run || !out) return;
    var q = {}, grain = document.getElementById('catTryGrain'), from = document.getElementById('catTryFrom'), to = document.getElementById('catTryTo');
    if (grain && grain.value) q.grain = grain.value;
    if (from && from.value) q.from = from.value;
    if (to && to.value) q.to = to.value;
    var by = []; document.querySelectorAll('[data-cat-by]').forEach(function (c) { if (c.checked) by.push(c.value); });
    if (by.length) q.by = by;
    var label = run.textContent; run.disabled = true; run.textContent = t('catalog.mRunning');
    fetch(catMetricsBase() + '/' + encodeURIComponent(id) + '/query', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q)
    })
      .then(okOr)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        run.disabled = false; run.textContent = label;
        if (d.query && from && to) { from.value = d.query.from || ''; to.value = d.query.to || ''; }
        out.innerHTML = catResultHtml(d);
      })
      .catch(function (e) {
        run.disabled = false; run.textContent = label;
        out.innerHTML = '<p class="wsx-cat__certerr">' + esc(errReason(e, t('catalog.mErr'))) + '</p>';
      });
  }

  function catResultHtml(d) {
    var rows = d.rows || [], fmt = d.format;
    if (!rows.length) return '<p class="wsx-cat__hint">' + esc(t('catalog.mNoRows')) + '</p>';
    var dims = (d.query && d.query.by) || [], hasPeriod = rows[0] && Object.prototype.hasOwnProperty.call(rows[0], 'period');
    var head = (hasPeriod ? '<th>' + esc(t('catalog.mPeriod')) + '</th>' : '') + dims.map(function (n) { return '<th>' + esc(n) + '</th>'; }).join('') + '<th class="wsx-atbl__num">' + esc(t('autof.value')) + '</th>';
    var body = rows.map(function (r) {
      return '<tr>' + (hasPeriod ? '<td>' + esc(r.period) + '</td>' : '') + dims.map(function (n) { return '<td>' + esc(r[n] == null ? '\\u2014' : r[n]) + '</td>'; }).join('')
        + '<td class="wsx-atbl__num">' + esc(catFmtNumber(r.value, fmt)) + '</td></tr>';
    }).join('');
    var trust = d.status === 'certified' && d.certified_by
      ? t('catalog.certBy').replace('{who}', d.certified_by.name || d.certified_by.email || '').replace('{when}', fmtDay(d.certified_at, true))
      : t('catalog.mDraftNote');
    return '<div class="wsx-atbl__wrap"><table class="wsx-atbl wsx-cat__tryt"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>'
      + (d.truncated ? '<p class="wsx-cat__hint">' + esc(t('catalog.mTruncated')) + '</p>' : '')
      + '<p class="wsx-cat__hint">' + esc(trust) + '</p>';
  }

`;
