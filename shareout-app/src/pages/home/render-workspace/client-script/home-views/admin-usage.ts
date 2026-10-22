/** Admin → Usage (what the workspace cost per day and category, month-end pace, CSV). Shares the admin lens IIFE scope. */
export const workspace_client_home_views_adminUsage_JS = `  // Usage: this month or last, from the nightly per-workspace usage ledger.
  var adUsageMonth = null;
  function adUsage() {
    var m = document.getElementById('wsxAdminMount'); if (needWs(m)) return;
    var groups = [
      ['storage', ['storage_bytes'], function (q) { return (q.storage_bytes || 0).toFixed(2) + ' GB-mo'; }],
      ['serving', ['serving_requests'], function (q) { return adCompact(q.serving_requests) + ' req'; }],
      ['automations', ['job_runs', 'job_duration_ms'], function (q) { return adCompact(q.job_runs) + ' runs'; }],
      ['ai', ['ai_llm_tokens', 'ai_other_events'], function (q) { return adCompact(q.ai_llm_tokens) + ' tok · ' + adCompact(q.ai_other_events) + ' calls'; }],
      ['email', ['email_sent'], function (q) { return adCompact(q.email_sent) + ' sent'; }],
      ['browser', ['browser_seconds'], function (q) { return adCompact(Math.round((q.browser_seconds || 0) / 60)) + ' min'; }]
    ];
    function usd(micro) { return '$' + ((Number(micro) || 0) / 1e6).toFixed(2); }
    function card(lbl, val, sub2) { return '<div class="wsx-admin__card"><div class="wsx-admin__cardlbl">' + esc(lbl) + '</div><div class="wsx-admin__cardval">' + val + '</div>' + (sub2 ? '<div class="wsx-admin__cardsub">' + esc(sub2) + '</div>' : '') + '</div>'; }
    var month = adUsageMonth || new Date().toISOString().slice(0, 7);
    function paint(res) {
      res = res || {};
      var cur = new Date().toISOString().slice(0, 7);
      var prevMonth = (res.previous && res.previous.month) || '';
      var bm = res.byMetric || {};
      var q = {}; Object.keys(bm).forEach(function (k) { q[k] = bm[k].quantity; });
      var days = res.days || [];
      var chips = '<div class="wsx__chips">'
        + '<button class="wsx-chip' + (month === cur ? ' is-on' : '') + '" data-us-month="' + esc(cur) + '" type="button">' + esc(t('admin.usageThisMonth')) + '</button>'
        + '<button class="wsx-chip' + (month !== cur ? ' is-on' : '') + '" data-us-month="' + esc(month === cur ? prevMonth : month) + '" type="button">' + esc(t('admin.usageLastMonth')) + '</button>'
        + '<a class="wsx-abtn" href="' + esc(wsUrl('/spend?month=' + encodeURIComponent(month) + '&format=csv')) + '" download>' + esc(t('admin.usageCsv')) + '</a></div>';
      var cards = card(t('admin.usageSpend') + ' · ' + month, usd(res.totalMicroUsd), days.length ? t('admin.usageThrough').replace('{day}', days[days.length - 1].day) : '')
        + (res.projectedMicroUsd != null ? card(t('admin.usageProjected'), usd(res.projectedMicroUsd), '') : '')
        + card(t('admin.usagePrev') + (prevMonth ? ' · ' + prevMonth : ''), usd(res.previous && res.previous.totalMicroUsd), '');
      var catRows = groups.map(function (g) {
        var cost = g[1].reduce(function (n, k) { return n + ((bm[k] && bm[k].costMicroUsd) || 0); }, 0);
        return '<tr><td>' + esc(t('admin.usageCat_' + g[0])) + '</td><td class="wsx-atbl__num">' + esc(g[2](q)) + '</td><td class="wsx-atbl__num">' + usd(cost) + '</td></tr>';
      }).join('');
      var dayRows = days.slice().reverse().map(function (d) {
        return '<tr><td>' + esc(d.day) + '</td><td class="wsx-atbl__num">' + usd(d.costMicroUsd) + '</td></tr>';
      }).join('');
      m.innerHTML = '<p class="wsx-lens__intro">' + esc(t('admin.usageIntro')) + '</p>' + chips
        + '<div class="wsx-admin__cards">' + cards + '</div>'
        + (days.length
          ? '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.usageByCategory')) + '</div>'
            + '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th>' + esc(t('admin.usageColCategory')) + '</th><th>' + esc(t('admin.usageColUsage')) + '</th><th>' + esc(t('admin.colCost')) + '</th></tr></thead><tbody>' + catRows + '</tbody></table></div></div>'
            + '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.usageByDay')) + '</div>'
            + '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th>' + esc(t('admin.usageColDay')) + '</th><th>' + esc(t('admin.colCost')) + '</th></tr></thead><tbody>' + dayRows + '</tbody></table></div></div>'
          : i18nEmpty('admin.usageNone'));
      m.querySelectorAll('[data-us-month]').forEach(function (b) {
        b.addEventListener('click', function () { var v = b.getAttribute('data-us-month'); if (!v || v === month) return; adUsageMonth = v; adUsage(); });
      });
    }
    swr('usage:' + month, paint, function () {
      return fetch(wsUrl('/spend?month=' + encodeURIComponent(month)), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : {}; });
    });
  }
`;
