import { SUMMARY_COPY } from './admin-summary-copy';

/** Admin → Summary: one month of the workspace at a glance (GET /v1/workspaces/{ws}/summary) — KPIs with the
 *  change from the month before, reading by day and the most read pages, pages & knowledge, AI & automations,
 *  each member, readers outside the team, and (owner only) who else may open it. Shares the admin lens IIFE scope. */
export const workspace_client_home_views_adminSummary_JS = `  var SUM_COPY = ${JSON.stringify(SUMMARY_COPY).replace(/</g, '\\u003c')};
  function st(k) { var de = document.documentElement, l = de && de.lang === 'es' ? 'es' : 'en'; return SUM_COPY[l][k] || SUM_COPY.en[k] || t(k); }
  var adSumMonth = null, adSumSort = 'active', adSumAsc = false;
  // The sidebar entry is rendered hidden; show it (and its group) only to people the API lets in. Once per workspace.
  function adSummaryGate() {
    var ws0 = window.WSX_WS; if (!ws0) return;
    if (adCacheWs !== ws0) { adDataCache = {}; adCacheWs = ws0; }
    function show(a) { ws.querySelectorAll('[data-ad-gate="summary"]').forEach(function (el) { el.hidden = !(a && a.can_view); }); }
    if (adDataCache._sumAccess) { show(adDataCache._sumAccess); return; }
    fetch(wsUrl('/summary/access'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (a) { if (window.WSX_WS !== ws0) return; adDataCache._sumAccess = a || {}; show(a); });
  }
  function sumMonthName(ym) {
    try { var s = new Date(ym + '-01T00:00:00Z').toLocaleDateString(locTag(), { month: 'long', year: 'numeric', timeZone: 'UTC' }); return s.charAt(0).toUpperCase() + s.slice(1); } catch (e) { return ym; }
  }
  function sumN(n) { return (Number(n) || 0).toLocaleString(locTag()); }
  function sumUsd(n) { return '$' + (Number(n) || 0).toFixed(2); }
  // Change from last month, neutral on purpose: a quieter month is not an error.
  function sumDelta(cur, prev, prevMonth) {
    cur = Number(cur) || 0; prev = Number(prev) || 0;
    if (!prev) return '';
    var pct = Math.round(((cur - prev) / prev) * 100);
    var title = ' title="' + esc(st('sum.vsPrev').replace('{month}', sumMonthName(prevMonth))) + '"';
    return '<span class="wsx-an__delta flat"' + title + '>' + (pct > 0 ? '\\u2191 ' : pct < 0 ? '\\u2193 ' : '') + Math.abs(pct) + '%</span>';
  }
  function sumFacts(rows) {
    return '<dl class="wsx-sum__facts">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>';
  }
  function sumPlus(n) { return n ? ' <span class="wsx-atbl__type">' + esc(st('sum.plus').replace('{n}', sumN(n))) + '</span>' : ''; }
  // One bar per day of the month (up to today for the current one), zeros included.
  function sumDays(month, daily) {
    var by = {}; (daily || []).forEach(function (d) { by[d.day] = d.views; });
    var y = +month.slice(0, 4), mo = +month.slice(5, 7), last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    var today = new Date().toISOString().slice(0, 10);
    var out = [];
    for (var i = 1; i <= last; i++) {
      var day = month + '-' + (i < 10 ? '0' : '') + i;
      if (day > today) break;
      out.push({ views: by[day] || 0 });
    }
    return out;
  }
  var SUM_SORT = { name: 'name', active: 'last_active_at', views: 'views', publishes: 'publishes', questions: 'ai_questions', lookups: 'knowledge_lookups', spend: 'ai_spend_usd', files: 'files' };
  function sumSorted(list) {
    var key = SUM_SORT[adSumSort] || 'last_active_at';
    return list.slice().sort(function (a, b) {
      var av = key === 'name' ? (a.name || a.email || '') : key === 'last_active_at' ? (a[key] || '') : Number(a[key]) || 0;
      var bv = key === 'name' ? (b.name || b.email || '') : key === 'last_active_at' ? (b[key] || '') : Number(b[key]) || 0;
      var c = sortCmp(av, bv); return adSumAsc ? c : -c;
    });
  }
  function adSummary() {
    var m = adM('summary'); if (needWs(m)) return;
    var month = adSumMonth || new Date().toISOString().slice(0, 7);
    function paint(d) {
      if (!d) { m.innerHTML = i18nEmpty('common.couldNotLoad'); return; }
      if (d.forbidden) { m.innerHTML = '<div class="wsx-empty">' + esc(st('sum.forbidden')) + '</div>'; return; }
      if (d.month) month = d.month;
      var tot = d.totals || {}, prev = d.previous || {}, pm = prev.month, pe = d.people || {}, vi = d.visits || {}, pg = d.pages || {}, kn = d.knowledge || {}, ai = d.ai || {}, au = d.automations || {};
      var months = d.months && d.months.length ? d.months : [month];
      var tools = '<div class="wsx-adm__tools"><label class="wsx-admin__field">' + esc(st('sum.month'))
        + ' <select class="wsx-sum__month" id="wsxSumMonth">' + months.map(function (x) { return '<option value="' + esc(x) + '"' + (x === month ? ' selected' : '') + '>' + esc(sumMonthName(x)) + '</option>'; }).join('') + '</select></label>'
        + (d.can_manage ? '<button class="wsx-abtn" type="button" id="wsxSumWhoBtn">' + esc(st('sum.who')) + '</button>' : '') + '</div>';
      var kpis = '<div class="wsx-admin__cards wsx-sum__kpis">'
        + adCard(st('sum.kpiActive'), sumN(pe.active) + sumDelta(pe.active, prev.active_people, pm), esc(st('sum.kpiActiveSub').replace('{n}', sumN(pe.members))) + (pe.new_members ? ' \\u00B7 ' + esc(st('sum.kpiNewMembers').replace('{n}', sumN(pe.new_members))) : ''))
        + adCard(st('sum.kpiViews'), sumN(vi.views) + sumDelta(vi.views, prev.views, pm), esc(st('sum.kpiViewsSub').replace('{n}', sumN(vi.readers))))
        + adCard(st('sum.kpiPublishes'), sumN(pg.publishes) + sumDelta(pg.publishes, prev.publishes, pm), esc(st('sum.kpiPublishesSub').replace('{n}', sumN(pg.created))))
        + adCard(st('sum.kpiAi'), sumN(ai.questions) + sumDelta(ai.questions, prev.ai_questions, pm), esc(st('sum.kpiAiSub').replace('{n}', sumN(kn.lookups))))
        + '</div>';
      var pageRows = (vi.top_pages || []).map(function (p) {
        return '<tr><td><span class="wsx-atbl__link">' + esc(p.name || '\\u2014') + '</span>' + (p.deleted ? '<span class="wsx-atbl__flag">' + esc(st('sum.deleted')) + '</span>' : '') + '</td>'
          + '<td class="wsx-atbl__owner">' + esc(p.owner_name || p.owner_email || '\\u2014') + '</td>'
          + '<td class="wsx-atbl__num">' + sumN(p.views) + '</td><td class="wsx-atbl__num">' + sumN(p.readers) + '</td>'
          + '<td class="wsx-atbl__date">' + adRelDate(p.last_viewed_at) + '</td></tr>';
      }).join('');
      var reading = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(st('sum.reading')) + '</div><p class="wsx-lens__intro">' + esc(st('sum.readingIntro')) + '</p>'
        + (vi.views ? '<div class="wsx-sum__chart">' + spark(sumDays(month, vi.daily)) + '</div>' : '')
        + (vi.all_views > vi.views ? '<p class="wsx-lens__intro">' + esc(st('sum.allViews').replace('{n}', sumN(vi.all_views))) + '</p>' : '')
        + (pageRows ? '<div class="wsx-admin__settings-title">' + esc(st('sum.topPages')) + '</div><div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th>' + esc(st('sum.colPage')) + '</th><th>' + esc(st('sum.colAuthor')) + '</th><th>' + esc(st('sum.colViews')) + '</th><th>' + esc(st('sum.colReaders')) + '</th><th>' + esc(st('sum.colLastView')) + '</th></tr></thead><tbody>' + pageRows + '</tbody></table></div>'
          : '<div class="wsx-empty">' + esc(st('sum.noReading')) + '</div>')
        + '</div>';
      var notes = kn.notes || {}, cat = kn.catalog || {}, files = kn.files || {};
      var pagesCard = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(st('sum.pagesKnowledge')) + '</div><p class="wsx-lens__intro">' + esc(st('sum.pagesKnowledgeIntro')) + '</p>'
        + sumFacts([
          [st('sum.pagesLive'), sumN(pg.live) + sumPlus(pg.created)],
          [st('sum.pagesUpdated'), sumN(pg.pages_updated)],
          [st('sum.publishes'), sumN(pg.publishes)],
          [st('sum.pagesDeleted'), sumN(pg.deleted)],
          [st('sum.notes'), sumN(notes.total) + sumPlus(notes.added)],
          [st('sum.catalog'), sumN(cat.total) + sumPlus(cat.added)],
          [st('sum.files'), sumN(files.live) + sumPlus(files.added)],
          [st('sum.lookups'), sumN(kn.lookups)],
        ]) + '</div>';
      var failed = function (n) { return n ? ' <span class="wsx-atbl__type">' + esc(st('sum.failed').replace('{n}', sumN(n))) + '</span>' : ''; };
      var aiCard = '<div class="wsx-admin__settings-section"><div class="wsx-admin__settings-title">' + esc(st('sum.ai')) + '</div><p class="wsx-lens__intro">' + esc(st('sum.aiIntro')) + '</p>'
        + sumFacts([
          [st('sum.questions'), sumN(ai.questions)],
          [st('sum.conversations'), sumN(ai.conversations)],
          [st('sum.aiPeople'), sumN(ai.people)],
          [st('sum.aiSpend'), sumUsd(ai.spend_usd) + ' <button class="wsx-adm__more wsx-sum__go" type="button" data-sum-go="billing">' + esc(st('sum.seeBilling')) + '</button>'],
          [st('sum.jobRuns'), sumN(au.job_runs) + failed(au.job_failed)],
          [st('sum.crewRuns'), sumN(au.crew_runs) + failed(au.crew_failed)],
          [st('sum.emails'), sumN(au.emails_sent)],
        ]) + '</div>';
      var list = d.members || [], out = d.outside || {};
      function memberRows() {
        return sumSorted(list).map(function (r) {
          var title = []; if (r.pages_created) title.push(st('sum.newPagesTitle').replace('{n}', r.pages_created)); if (r.comments) title.push(st('sum.commentsTitle').replace('{n}', r.comments));
          return '<tr><td><span class="wsx-atbl__link"' + (r.name && r.email ? ' title="' + esc(r.email) + '"' : '') + '>' + esc(r.name || r.email || '\\u2014') + '</span></td>'
            + '<td class="wsx-atbl__date">' + (r.last_active_at ? adRelDate(r.last_active_at) : esc(st('sum.noActivity'))) + '</td>'
            + '<td class="wsx-atbl__num">' + sumN(r.views) + '</td>'
            + '<td class="wsx-atbl__num"' + (title.length ? ' title="' + esc(title.join(' \\u00B7 ')) + '"' : '') + '>' + sumN(r.publishes) + '</td>'
            + '<td class="wsx-atbl__num">' + sumN(r.ai_questions) + '</td><td class="wsx-atbl__num">' + sumN(r.knowledge_lookups) + '</td>'
            + '<td class="wsx-atbl__num">' + sumUsd(r.ai_spend_usd) + '</td><td class="wsx-atbl__num">' + sumN(r.files) + '</td></tr>';
        }).join('') + (out.people ? '<tr><td><span class="wsx-atbl__type">' + esc(st('sum.outsideRow').replace('{n}', sumN(out.people))) + '</span></td><td></td><td class="wsx-atbl__num">' + sumN(out.views) + '</td><td colspan="5"></td></tr>' : '');
      }
      function memberTable() {
        var th = function (k, lbl) { return '<th class="' + (adSumSort === k ? 'is-sort' : '') + '" data-ssort="' + k + '"' + (adSumSort === k ? ' aria-sort="' + (adSumAsc ? 'ascending' : 'descending') + '"' : '') + '>' + esc(lbl) + '</th>'; };
        return '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr data-sort-own>' + th('name', st('sum.colMember')) + th('active', st('sum.colLastActive')) + th('views', st('sum.colViews'))
          + th('publishes', st('sum.colPublishes')) + th('questions', st('sum.colQuestions')) + th('lookups', st('sum.colLookups')) + th('spend', st('sum.colSpend')) + th('files', st('sum.colFiles'))
          + '</tr></thead><tbody>' + memberRows() + '</tbody></table></div>';
      }
      var members = '<div class="wsx-admin__settings-section" id="wsxSumMembers"><div class="wsx-admin__settings-title">' + esc(st('sum.byMember')) + '</div><p class="wsx-lens__intro">' + esc(st('sum.byMemberIntro').replace('{month}', sumMonthName(month))) + '</p>'
        + '<div id="wsxSumMemTbl">' + memberTable() + '</div></div>';
      var outRows = (out.top || []).map(function (r) { return '<tr><td>' + esc(r.email) + '</td><td class="wsx-atbl__num">' + sumN(r.views) + '</td><td class="wsx-atbl__date">' + adRelDate(r.last_at) + '</td></tr>'; }).join('');
      var outside = outRows ? '<details class="wsx-admin__settings-section wsx-adm__fold"><summary class="wsx-adm__foldsum"><span class="wsx-admin__settings-title">' + esc(st('sum.outside')) + ' (' + sumN(out.people) + ')</span><span class="wsx-lens__intro">' + esc(st('sum.outsideIntro')) + '</span></summary>'
        + '<div class="wsx-atbl__wrap"><table class="wsx-atbl"><thead><tr><th>' + esc(st('sum.colReader')) + '</th><th>' + esc(st('sum.colViews')) + '</th><th>' + esc(st('sum.colLastView')) + '</th></tr></thead><tbody>' + outRows + '</tbody></table></div></details>' : '';
      var who = d.can_manage ? '<details class="wsx-admin__settings-section wsx-adm__fold" id="wsxSumWho"><summary class="wsx-adm__foldsum"><span class="wsx-admin__settings-title">' + esc(st('sum.whoTitle')) + '</span><span class="wsx-lens__intro">' + esc(st('sum.whoIntro')) + '</span></summary><div id="wsxSumWhoBody">' + i18nSpin() + '</div></details>' : '';
      m.innerHTML = tools + kpis + reading + '<div class="wsx-adm__two">' + pagesCard + aiCard + '</div>' + members + outside + who;

      var sel = document.getElementById('wsxSumMonth');
      if (sel) sel.addEventListener('change', function () { adSumMonth = sel.value; adSummary(); });
      m.querySelectorAll('[data-sum-go]').forEach(function (b) { b.addEventListener('click', function () { adOpen(b.getAttribute('data-sum-go')); }); });
      function bindSort() {
        m.querySelectorAll('[data-ssort]').forEach(function (th) {
          th.addEventListener('click', function () {
            var k = th.getAttribute('data-ssort');
            if (adSumSort === k) adSumAsc = !adSumAsc; else { adSumSort = k; adSumAsc = k === 'name'; }
            document.getElementById('wsxSumMemTbl').innerHTML = memberTable(); bindSort();
          });
        });
      }
      bindSort();
      if (d.can_manage) sumWho();
    }
    swr('summary:' + month, paint, function () {
      return fetch(wsUrl('/summary?month=' + encodeURIComponent(month)), { credentials: 'same-origin' }).then(function (r) {
        if (r.status === 403) return { forbidden: true };
        return r.ok ? r.json() : null;
      });
    });
  }
  // Owner only: which admins may open the summary too. Saves on every tick.
  function sumWho() {
    var box = document.getElementById('wsxSumWhoBody'), card = document.getElementById('wsxSumWho'), btn = document.getElementById('wsxSumWhoBtn');
    if (btn && card) btn.addEventListener('click', function () { card.open = true; if (card.scrollIntoView) card.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
    if (!box) return;
    function render(list) {
      var admins = list.filter(function (v) { return v.role !== 'owner'; });
      box.innerHTML = '<div class="wsx-sum__who">' + list.map(function (v) {
        var owner = v.role === 'owner';
        return '<label><input type="checkbox" data-sum-who="' + esc(v.user_id) + '"' + (v.can_view ? ' checked' : '') + (owner ? ' disabled' : '') + '> <span>' + esc(v.name || v.email || v.user_id) + '</span>'
          + '<span class="wsx-atbl__type">' + esc(v.email || '') + (owner ? ' \\u00B7 ' + esc(st('sum.whoOwner')) : '') + '</span></label>';
      }).join('') + '</div>' + (admins.length ? '' : '<div class="wsx-empty">' + esc(st('sum.whoNone')) + '</div>');
      box.querySelectorAll('[data-sum-who]:not([disabled])').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var ids = Array.prototype.slice.call(box.querySelectorAll('[data-sum-who]:not([disabled])')).filter(function (x) { return x.checked; }).map(function (x) { return x.getAttribute('data-sum-who'); });
          box.querySelectorAll('[data-sum-who]').forEach(function (x) { x.disabled = true; });
          adReq(wsUrl('/summary/viewers'), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_ids: ids }) })
            .then(function (j) { showToast(st('sum.whoSaved'), 'success'); render((j && j.viewers) || []); })
            .catch(function (e) { showToast((e && e.userMessage) || st('sum.whoFailed'), 'error'); load(); });
        });
      });
    }
    function load() {
      fetch(wsUrl('/summary/viewers'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { if (!j) { box.innerHTML = i18nEmpty('common.couldNotLoad'); return; } render(j.viewers || []); });
    }
    load();
  }
`;
