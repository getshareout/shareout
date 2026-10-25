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
    function fmtUsd(n) { return '$' + (Number(n) || 0).toFixed(2); }
    function fmtDate(iso) { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }); } catch (e) { return iso || ''; } }
    // The monthly AI ceiling (every metered AI call), spend by kind, and today's per-member caps.
    function aiBudgetHtml(lim) {
      if (!lim || lim.month_spend_usd == null) return '';
      var isAdmin = !!lim.members, st = lim.budget_state || 'none', has = lim.budget_usd != null;
      var pct = has ? Math.min(100, lim.pct || 0) : 0;
      var head = '<div class="wsx-admin__budgethead"><div class="wsx-admin__cardlbl">' + esc(t('admin.budgetTitle')) + '</div>'
        + '<div class="wsx-admin__cardval" data-budget-val>' + esc(has ? t('admin.budgetSpent').replace('{spent}', fmtUsd(lim.month_spend_usd)).replace('{budget}', fmtUsd(lim.budget_usd)) : t('admin.budgetSpentOnly').replace('{spent}', fmtUsd(lim.month_spend_usd))) + '</div></div>';
      var bar = has ? '<div class="wsx-admin__budgetbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><div class="wsx-admin__budgetfill" style="width:' + pct + '%"></div><span class="wsx-admin__budgetmark" title="' + esc(t('admin.budgetMark')) + '"></span></div>' : '';
      var note = has
        ? '<div class="wsx-admin__budgetstate" data-budget-state>' + esc(st === 'reached' ? t('admin.budgetState_reached').replace('{date}', fmtDate(lim.budget_resets_at)) : t('admin.budgetState_' + st) + ' · ' + t('admin.budgetResets').replace('{date}', fmtDate(lim.budget_resets_at))) + '</div>'
        : '<div class="wsx-admin__budgetstate">' + esc(t('admin.budgetNone')) + '</div>';
      var edit = isAdmin ? '<div class="wsx-admin__domain-add" style="margin-top:12px"><label class="wsx-admin__field">' + esc(t('admin.budgetEditLbl')) + ' <input type="number" id="wsxBudgetUsd" min="1" max="100000" step="1" value="' + (has ? esc(String(lim.budget_usd)) : '') + '" style="width:110px"></label>'
        + '<button class="wsx-abtn" id="wsxBudgetSave" type="button">' + esc(t('common.save')) + '</button>'
        + (has ? '<button class="wsx-abtn" id="wsxBudgetClear" type="button">' + esc(t('admin.budgetRemove')) + '</button>' : '') + '</div>' : '';
      var html = '<div class="wsx-admin__budget is-' + esc(st) + '">' + head + bar + note + edit + '</div>';
      if (isAdmin) {
        var kinds = lim.spend_by_kind || [];
        html += '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.aiByKind')) + '</div>'
          + (kinds.length ? '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th>' + esc(t('admin.usageColCategory')) + '</th><th>' + esc(t('admin.colCost')) + '</th></tr></thead><tbody>'
            + kinds.map(function (k) { return '<tr><td>' + esc(tOr('admin.aiKind_' + k.kind, k.kind)) + '</td><td class="wsx-atbl__num">' + fmtUsd(k.usd) + '</td></tr>'; }).join('') + '</tbody></table></div>' : i18nEmpty('admin.aiByKindNone')) + '</div>';
      }
      var cap = lim.member_daily_cap || 0, auto = lim.automation || {};
      var rows = (isAdmin ? lim.members : [{ user_id: 'me', email: t('admin.aiTodayMe'), tokens_today: (lim.me || {}).tokens_today || 0 }]).map(function (r) {
        return '<tr><td>' + esc(r.email || r.user_id) + '</td><td class="wsx-atbl__num">' + adCompact(r.tokens_today) + '</td><td class="wsx-atbl__num">' + adCompact(cap) + '</td></tr>';
      }).join('')
        + '<tr><td>' + esc(t('admin.aiTodayAuto')) + '</td><td class="wsx-atbl__num">' + adCompact(auto.tokens_today || 0) + '</td><td class="wsx-atbl__num">' + adCompact(auto.daily_cap || 0) + '</td></tr>';
      html += '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.aiToday')) + '</div><p class="wsx-lens__intro">' + esc(t('admin.aiTodayIntro')) + '</p>'
        + '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th>' + esc(t('admin.colMember')) + '</th><th>' + esc(t('admin.aiTodayTokens')) + '</th><th>' + esc(t('admin.aiTodayCap')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
      return html;
    }
    function saveBudget(value) {
      return fetch(wsUrl('/llm/budget'), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monthlyBudgetUsd: value }) })
        .then(function (r) { if (!r.ok) throw new Error('budget'); showToast(t('admin.budgetSaved'), 'success'); adUsage(); })
        .catch(function () { showToast(t('admin.budgetFailed'), 'error'); });
    }
    function paint(all) {
      all = all || {};
      var lim = all.limits || null;
      var res = all.spend || {};
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
      m.innerHTML = aiBudgetHtml(lim) + '<p class="wsx-lens__intro">' + esc(t('admin.usageIntro')) + '</p>' + chips
        + '<div class="wsx-admin__cards">' + cards + '</div>'
        + (days.length
          ? '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.usageByCategory')) + '</div>'
            + '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th>' + esc(t('admin.usageColCategory')) + '</th><th>' + esc(t('admin.usageColUsage')) + '</th><th>' + esc(t('admin.colCost')) + '</th></tr></thead><tbody>' + catRows + '</tbody></table></div></div>'
            + '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(t('admin.usageByDay')) + '</div>'
            + '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th>' + esc(t('admin.usageColDay')) + '</th><th>' + esc(t('admin.colCost')) + '</th></tr></thead><tbody>' + dayRows + '</tbody></table></div></div>'
          : i18nEmpty('admin.usageNone'));
      var bSave = document.getElementById('wsxBudgetSave'), bClear = document.getElementById('wsxBudgetClear');
      if (bSave) bSave.addEventListener('click', function () {
        var v = Number(document.getElementById('wsxBudgetUsd').value);
        if (!isFinite(v) || v <= 0 || v > 100000) { showToast(t('admin.budgetInvalid'), 'error'); return; }
        saveBudget(v);
      });
      if (bClear) bClear.addEventListener('click', function () { saveBudget(null); });
      m.querySelectorAll('[data-us-month]').forEach(function (b) {
        b.addEventListener('click', function () { var v = b.getAttribute('data-us-month'); if (!v || v === month) return; adUsageMonth = v; adUsage(); });
      });
    }
    swr('usage:' + month, paint, function () {
      var get = function (path) { return fetch(wsUrl(path), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
      return Promise.all([get('/spend?month=' + encodeURIComponent(month)), get('/ai-limits')]).then(function (a) { return { spend: a[0] || {}, limits: a[1] }; });
    });
  }
`;
