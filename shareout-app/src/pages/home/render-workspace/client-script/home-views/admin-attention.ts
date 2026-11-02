/** Admin → what needs you (sidebar badges + the banner on top of a page) and long-list folding.
 *  Part of the lazy admin chunk (lazy-chunks.ts); shares the admin lens IIFE scope. */
export const workspace_client_home_views_adminAttention_JS = `  // What needs an admin, per page: [tone, text, selector to scroll to, count]. Feeds the sidebar badges
  // and the banner on top of that page. One fetch per workspace, refreshed by adReload().
  function adNeeds() {
    var ws0 = window.WSX_WS;
    if (adCacheWs !== ws0) { adDataCache = {}; adCacheWs = ws0; }
    if (adDataCache._needs) { adPaintNeeds(adDataCache._needs); return; }
    var get = function (u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    Promise.all([get(wsUrl('/invites')), get('/v1/access-requests/incoming?workspace_id=' + encodeURIComponent(ws0)), get(wsUrl('/publish-approvals')),
      get(wsUrl('/schedules')), get(wsUrl('/automations')), get(wsUrl('/ai-limits')), get(wsUrl('/invoices'))]).then(function (r) {
      if (window.WSX_WS !== ws0) return;
      function n(k, c) { return at(c === 1 ? k : k + 'Plural').replace('{n}', String(c)); }
      var inv = ((r[0] && r[0].invites) || []).length;
      var reqs = ((r[1] && r[1].requests) || []).length;
      var appr = ((r[2] && r[2].approvals) || []).filter(function (a) { return a.viewer_can_decide; }).length;
      var failing = ((r[3] && r[3].schedules) || []).filter(function (j) { return j.last_status === 'error' || j.last_status === 'failed'; }).length
        + ((r[4] && r[4].automations) || []).filter(function (c) { return c.crew_status === 'error' || c.crew_status === 'failed'; }).length;
      var lim = r[5] || {}, bst = lim.budget_state;
      var open = ((r[6] && r[6].invoices) || []).filter(function (i) { return i.status === 'open'; }).length;
      var d = { members: [], access: [], publishing: [], automation: [], billing: [] };
      if (inv) d.members.push(['warn', n('admin.pendingInvites', inv), '#wsxAdInvites', inv]);
      if (reqs) d.access.push(['warn', n('admin.attnAccess', reqs), '[data-req]', reqs]);
      if (appr) d.publishing.push(['warn', n('admin.attnApprovals', appr), '[data-appr]', appr]);
      if (failing) d.automation.push(['bad', n('admin.failingAutomations', failing), '#wsxAdAutoJobs', failing]);
      if (open) d.billing.push(['warn', n('admin.attnInvoices', open), '.wsx-bill', open]);
      if (bst === 'reached') d.billing.push(['bad', at('admin.attnBudgetReached'), '.wsx-admin__budget', 1]);
      else if (bst === 'near') d.billing.push(['warn', at('admin.attnBudgetNear').replace('{pct}', String(Math.round(lim.pct || 0))), '.wsx-admin__budget', 1]);
      adDataCache._needs = d;
      adPaintNeeds(d);
    });
  }
  function adPaintNeeds(d) {
    ws.querySelectorAll('[data-ad-bdg]').forEach(function (b) {
      var items = d[b.getAttribute('data-ad-bdg')] || [];
      var count = items.reduce(function (s, x) { return s + (x[3] || 1); }, 0);
      b.hidden = !count;
      b.textContent = count ? String(count) : '';
      b.classList.toggle('is-bad', items.some(function (x) { return x[0] === 'bad'; }));
    });
    var box = document.getElementById('wsxAdAlert'); if (!box) return;
    box.innerHTML = (d[adminTab] || []).map(function (x, i) {
      return '<div class="wsx-adm__alert' + (x[0] === 'bad' ? ' is-bad' : '') + '" role="status"><span class="wsx-adm__alertic" aria-hidden="true">' + (x[0] === 'bad' ? '\\u00D7' : '!') + '</span>'
        + '<span class="wsx-adm__alerttx">' + esc(x[1]) + '</span><button class="wsx-abtn" type="button" data-ad-jump="' + i + '">' + esc(at('admin.review')) + '</button></div>';
    }).join('');
    box.querySelectorAll('[data-ad-jump]').forEach(function (b) {
      b.addEventListener('click', function () {
        var it = (d[adminTab] || [])[+b.getAttribute('data-ad-jump')];
        var el = it && document.querySelector('#wsxAdminMount ' + it[2]);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    });
  }
  // Long lists show their first rows and a "Show all (N)" toggle; the choice survives repaints and re-sorts.
  var AD_ROWS = 8, adOpenFold = {}, adObs = null;
  function adFold(root) {
    var i = 0;
    root.querySelectorAll('table.wsx-atbl > tbody, .wsx-admin__list, .wsx-admin__auditfeed').forEach(function (box) {
      var key = adminTab + ':' + (i++), rows = Array.prototype.slice.call(box.children);
      var host = box.tagName === 'TBODY' ? (box.closest('.wsx-atbl__wrap') || box.parentNode) : box;
      var btn = box.__adFold;
      if (rows.length <= AD_ROWS + 2) { if (btn) { btn.remove(); box.__adFold = null; } rows.forEach(function (r) { r.classList.remove('is-folded'); }); return; }
      if (!btn) {
        btn = box.__adFold = document.createElement('button');
        btn.type = 'button'; btn.className = 'wsx-adm__more';
        btn.addEventListener('click', function () { adOpenFold[key] = !adOpenFold[key]; adFold(root); });
        host.parentNode.insertBefore(btn, host.nextSibling);
      }
      var open = !!adOpenFold[key];
      rows.forEach(function (r, j) { r.classList.toggle('is-folded', !open && j >= AD_ROWS); });
      btn.textContent = open ? at('admin.showLess') : at('admin.showAll').replace('{n}', String(rows.length));
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  function adWatchFold(mount) {
    if (adObs || typeof MutationObserver !== 'function') return;
    var queued = false, later = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    adObs = new MutationObserver(function () { if (queued) return; queued = true; later(function () { queued = false; adFold(mount); }); });
    adObs.observe(mount, { childList: true, subtree: true });
  }
`;
