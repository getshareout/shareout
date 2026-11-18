/** Admin → Billing, between Usage and Invoices: the AI report (GET /v1/workspaces/{ws}/ai-report). One month of AI
 *  at the workspace's price — by use, model (input/output tokens), automation, page, person, kind and day — plus CSV.
 *  The operator also sees cost and margin, marked "Super admins only". Copy: BILL_COPY (admin-billing-copy.ts).
 *  Shares the admin lens IIFE scope. */
export const workspace_client_home_views_adminAiReport_JS = `  var adAiMonth = null;
  function adAiReport() {
    var m = adM('aireport'); if (needWs(m)) return;
    var cur = new Date().toISOString().slice(0, 7), month = adAiMonth || cur;
    function usd(micro) { var v = (Number(micro) || 0) / 1e6; return '$' + (v > 0 && v < 0.01 ? v.toFixed(4) : v.toFixed(2)); }
    function monthName(ym) { try { return new Date(ym + '-01T00:00:00Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return ym; } }
    function lastMonths(n) { var out = [], d = new Date(Date.UTC(+cur.slice(0, 4), +cur.slice(5, 7) - 1, 1)); for (var i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1); } return out; }
    function pill() { return '<span class="wsx-opbadge" data-op-badge>' + esc(bt('admin.superOnly')) + '</span>'; }
    // cols: which number columns a table shows; op adds cost and margin (the API sends cost only to the operator).
    function table(rows, nameHead, name, cols, op) {
      var heads = { runs: 'admin.airColRuns', calls: 'admin.airColCalls', input: 'admin.airColInput', output: 'admin.airColOutput', tokens: 'admin.airColTokens' };
      var vals = { runs: function (r) { return adCompact(r.runs || 0); }, calls: function (r) { return adCompact(r.calls); }, input: function (r) { return adCompact(r.input_tokens); },
        output: function (r) { return adCompact(r.output_tokens); }, tokens: function (r) { return adCompact(r.tokens); } };
      return '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th>' + esc(nameHead) + '</th>'
        + cols.map(function (c) { return '<th>' + esc(bt(heads[c])) + '</th>'; }).join('') + '<th>' + esc(bt('admin.airColPrice')) + '</th>'
        + (op ? '<th data-op-cost>' + esc(bt('admin.billColCost')) + '</th><th>' + esc(bt('admin.billColMargin')) + '</th>' : '') + '</tr></thead><tbody>'
        + rows.map(function (r) {
          return '<tr><td>' + esc(name(r)) + '</td>' + cols.map(function (c) { return '<td class="wsx-atbl__num">' + vals[c](r) + '</td>'; }).join('')
            + '<td class="wsx-atbl__num">' + usd(r.price_micro_usd) + '</td>'
            + (op ? '<td class="wsx-atbl__num" data-op-cost>' + usd(r.cost_micro_usd) + '</td><td class="wsx-atbl__num">' + usd((r.price_micro_usd || 0) - (r.cost_micro_usd || 0)) + '</td>' : '') + '</tr>';
        }).join('') + '</tbody></table></div>';
    }
    function card(key, rows, body) {
      return '<div class="wsx-admin__settings-section" data-air="' + key + '"><div class="wsx-admin__settings-title">' + esc(bt('admin.air_' + key)) + '</div>'
        + '<p class="wsx-lens__intro">' + esc(bt('admin.air_' + key + 'Intro')) + '</p>' + (rows.length ? body : '<div class="wsx-empty">' + esc(bt('admin.airNoneHere')) + '</div>') + '</div>';
    }
    function fold(key, rows, body) {
      return '<details class="wsx-admin__settings-section wsx-adm__fold" data-air="' + key + '"><summary class="wsx-adm__foldsum"><span class="wsx-admin__settings-title">' + esc(bt('admin.air_' + key)) + '</span>'
        + '<span class="wsx-lens__intro">' + esc(bt('admin.air_' + key + 'Intro')) + '</span></summary>' + body + '</details>';
    }
    function kpi(lbl, val, sub) { return '<div class="wsx-admin__card"><div class="wsx-admin__cardlbl">' + esc(lbl) + '</div><div class="wsx-admin__cardval">' + esc(val) + '</div>' + (sub ? '<div class="wsx-admin__cardsub">' + esc(sub) + '</div>' : '') + '</div>'; }
    function paint(r) {
      var tools = '<div class="wsx-adm__tools"><label class="wsx-field" style="margin:0"><select class="wsx-field__in" id="wsxAirMonth" aria-label="' + esc(bt('admin.airMonth')) + '">'
        + lastMonths(12).map(function (ym) { return '<option value="' + ym + '"' + (ym === month ? ' selected' : '') + '>' + esc(monthName(ym)) + '</option>'; }).join('') + '</select></label>'
        + '<a class="wsx-abtn" href="' + esc(wsUrl('/ai-report?month=' + encodeURIComponent(month) + '&format=csv')) + '" download>' + esc(bt('admin.airCsv')) + '</a></div>';
      var head = '<div class="wsx-admin__settings-title">' + esc(bt('admin.airTitle')) + '</div><p class="wsx-lens__intro">' + esc(bt('admin.airIntro')) + '</p>' + tools;
      if (!r) { m.innerHTML = '<div class="wsx-admin__settings-section">' + head + i18nEmpty('common.couldNotLoad') + '</div>'; wire(); return; }
      var tot = r.totals || {}, op = !!r.operator && tot.cost_micro_usd != null;
      if (!tot.calls) { m.innerHTML = '<div class="wsx-admin__settings-section">' + head + '<div class="wsx-empty">' + esc(bt('admin.airNone').replace('{month}', monthName(month))) + '</div></div>'; wire(); return; }
      var opNote = op ? '<p class="wsx-field__note" data-op-note>' + pill() + ' ' + esc(bt('admin.billOpCost').replace('{cost}', usd(tot.cost_micro_usd)).replace('{markup}', String((r.markup_bps || 10000) / 10000)).replace('{margin}', usd(tot.price_micro_usd - tot.cost_micro_usd))) + '</p>' : '';
      var kpis = '<div class="wsx-admin__cards">'
        + kpi(bt('admin.airSpend') + ' \\u00b7 ' + monthName(month), usd(tot.price_micro_usd), bt('admin.airSpendSub'))
        + kpi(bt('admin.airCalls'), adCompact(tot.calls), '')
        + kpi(bt('admin.airTokens'), adCompact(tot.tokens), bt('admin.airTokensInOut').replace('{in}', adCompact(tot.input_tokens)).replace('{out}', adCompact(tot.output_tokens)))
        + '</div>';
      var cat = r.by_category || [], mod = r.by_model || [], aut = r.by_automation || [], pag = r.by_page || [], mem = r.by_member || [], kin = r.by_kind || [], day = r.by_day || [];
      m.innerHTML = '<div class="wsx-admin__settings-section">' + head + kpis + opNote + '</div>'
        + card('category', cat, table(cat, bt('admin.airColUse'), function (x) { return bt('admin.airCat_' + x.key) || x.key; }, ['calls', 'tokens'], op))
        + card('model', mod, table(mod, bt('admin.airColModel'), function (x) { return x.key; }, ['calls', 'input', 'output', 'tokens'], op))
        + card('automation', aut, table(aut, bt('admin.airColAutomation'), function (x) { return x.label || bt('admin.airAutomationGone'); }, ['runs', 'calls', 'tokens'], op))
        + card('page', pag, table(pag, bt('admin.airColPage'), function (x) { return x.label || bt('admin.airPageGone'); }, ['calls', 'tokens'], op))
        + card('member', mem, table(mem, bt('admin.airColMember'), function (x) { return x.label || bt('admin.billNoMember'); }, ['calls', 'tokens'], op))
        + fold('kind', kin, table(kin, bt('admin.airColKind'), function (x) { return tOr('admin.aiKind_' + x.key, x.key); }, ['calls', 'input', 'output', 'tokens'], op))
        + fold('day', day, table(day, bt('admin.airColDay'), function (x) { return x.key; }, ['calls', 'tokens'], op));
      wire();
    }
    function wire() {
      var sel = document.getElementById('wsxAirMonth');
      if (sel) sel.addEventListener('change', function () { adAiMonth = sel.value; adAiReport(); });
    }
    swr('aireport:' + month, paint, function () {
      return fetch(wsUrl('/ai-report?month=' + encodeURIComponent(month)), { credentials: 'same-origin' }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; });
    });
  }
`;
