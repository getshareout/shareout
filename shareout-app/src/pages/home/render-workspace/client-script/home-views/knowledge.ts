/** Knowledge lens — workspace brain. Two-pane indented tree (default) + flat Table toggle,
 *  right-pane markdown detail, pin/edit/forget, tooltips + How-it-works. (work/041 P3a) */
export const workspace_client_home_views_knowledge_JS = `  // ----- Knowledge — auto-learned workspace tree (tree/table browse + pin/edit/forget) -----
  var knState = { nodes: [], guidance: [], byPath: {}, counts: {}, lastUpdated: '', q: '', kind: '', sort: 'kind', asc: true, view: '', collapsed: {}, _cinit: false };
  var knCurrentPath = '', knReady = false, knPendingPath = '';
  var knPollTimer = null, knPolls = 0, knPollErrs = 0;
  function knMount() { return document.getElementById('wsxKnMount'); }
  function knNarrow() { return !!(window.matchMedia && window.matchMedia('(max-width: 860px)').matches); }
  function knWsBase() { return '/v1/workspaces/' + encodeURIComponent(window.WSX_WS); }
  function knBase() { return knWsBase() + '/knowledge'; }
  function knIsGuidance(path) { return String(path || '').indexOf('guidance/') === 0; }
  // Deep-link entry point — called by the hash router for #l/knowledge/<path> (and '' = list).
  function knRoute(path) {
    path = path || '';
    if (!knReady) { knPendingPath = path; return; }
    var m = knMount(); if (!m) return;
    knCurrentPath = (path && knState.byPath[path]) ? path : '';
    knRenderShell(m);
  }

  function knApiPath(path) { return String(path || '').split('/').map(encodeURIComponent).join('/'); }
  function knKindLabel(k) {
    return ({ 'artifact-digest': t('knowledge.kindPage'), topic: t('knowledge.kindTopic'), entity: t('knowledge.kindEntity'), decision: t('knowledge.kindDecision'), timeline: t('knowledge.kindTimeline'), overview: t('knowledge.kindOverview') })[k] || k;
  }
  function knStale(n) { return !!(n && n.stale_after && new Date(n.stale_after).getTime() < Date.now()); }
  function knBadge(n) {
    if (!n) return '';
    if (n.pinned) return '<span class="so-c-badge so-c-badge--primary wsx-kn__bdg" data-tip="' + esc(t('knowledge.tipPinned')) + '">' + esc(t('knowledge.badgePinned')) + '</span>';
    if (knStale(n)) return '<span class="so-c-badge so-c-badge--warning wsx-kn__bdg" data-tip="' + esc(t('knowledge.tipStale')) + '">' + esc(t('knowledge.badgeStale')) + '</span>';
    return '';
  }

  var KN_ICO_ATTR = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
  var KN_ICONS = {
    overview: '<svg ' + KN_ICO_ATTR + '><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    topic: '<svg ' + KN_ICO_ATTR + '><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    entity: '<svg ' + KN_ICO_ATTR + '><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    'artifact-digest': '<svg ' + KN_ICO_ATTR + '><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    decision: '<svg ' + KN_ICO_ATTR + '><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
    timeline: '<svg ' + KN_ICO_ATTR + '><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    guidance: '<svg ' + KN_ICO_ATTR + '><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>'
  };
  var KN_PLUS = '<svg ' + KN_ICO_ATTR + '><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  var KN_CHEV = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  function knIcon(k) { return KN_ICONS[k] || KN_ICONS.overview; }

  function loadKnowledge() {
    var m = knMount(); if (needWs(m)) return;
    knStopPoll();
    m.innerHTML = i18nLoad();
    if (!knState.view) { var v = ''; try { v = localStorage.getItem('wsx_kn_view') || ''; } catch (e) {} knState.view = v === 'table' ? 'table' : 'tree'; }
    var base = knBase();
    fetch(base, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { m.innerHTML = i18nError('knowledge.couldNotLoad'); return; }
        if (d.enabled === false) { knRenderOnboard(m, 'off'); return; }
        knState.counts = d.counts || {};
        knState.lastUpdated = d.lastUpdated || '';
        return Promise.all([
          fetch(base + '/tree', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
          fetch(knWsBase() + '/context', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        ]).then(function (res) {
          var tree = res[0], ctx = res[1];
          var groups = (tree && tree.groups) || {};
          var nodes = [];
          for (var gk in groups) { if (groups.hasOwnProperty(gk)) nodes = nodes.concat(groups[gk] || []); }
          var gfiles = (ctx && ctx.files) || [];
          knState.guidance = gfiles.map(function (f) { return { path: 'guidance/' + f.name, kind: 'guidance', name: f.name, title: f.name, is_entry: !!f.is_entry, size: f.size, updated_at: f.updated_at }; });
          var admin = !!window.WSX_ADMIN;
          if (!nodes.length && !knState.guidance.length && !admin) { knReady = false; knRenderOnboard(m, 'empty'); return; }
          knState.nodes = nodes;
          knState.byPath = {};
          nodes.forEach(function (n) { knState.byPath[n.path] = n; });
          knState.guidance.forEach(function (g) { knState.byPath[g.path] = g; });
          if (!knState._cinit) {
            var pc = 0; nodes.forEach(function (n) { if (n.kind === 'artifact-digest') pc++; });
            if (pc > 30) knState.collapsed['artifact-digest'] = true;
            knState._cinit = true;
          }
          knReady = true;
          if (knPendingPath) { knCurrentPath = knState.byPath[knPendingPath] ? knPendingPath : ''; knPendingPath = ''; }
          else if (knCurrentPath && !knState.byPath[knCurrentPath]) knCurrentPath = '';
          knRenderShell(m);
        });
      })
      .catch(function () { m.innerHTML = i18nError('knowledge.couldNotLoad'); });
  }

  function knRenderOnboard(m, mode) {
    var admin = !!window.WSX_ADMIN;
    var paid = !!window.WSX_KNOWLEDGE_PAID;
    var msg = mode === 'off' ? t('knowledge.offTitle') : t('knowledge.emptyTitle');
    var sub = mode === 'off' ? t('knowledge.offSub') : t('knowledge.emptySub');
    var btn = '';
    if (mode === 'off') {
      if (!paid) btn = '<p class="wsx-cat__hint">' + esc(t('knowledge.upsellTitle')) + '</p>'
        + '<a class="so-c-btn so-c-btn--primary" href="/app/billing?workspace_id=' + encodeURIComponent(window.WSX_WS || '') + '">' + esc(t('knowledge.seePlans')) + '</a>';
      else btn = admin
        ? '<button class="so-c-btn so-c-btn--primary" id="knEnable" type="button">' + esc(t('knowledge.turnOn')) + '</button>'
        : '<p class="wsx-cat__hint">' + esc(t('knowledge.askAdmin')) + '</p>';
    }
    m.innerHTML = '<div class="wsx-cat__onboard"><p>' + esc(msg) + '</p><p class="wsx-cat__hint">' + esc(sub) + '</p>' + btn + '</div>';
    var en = document.getElementById('knEnable');
    if (en) en.addEventListener('click', function () {
      en.disabled = true;
      fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/knowledge/enable', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{"enabled":true}' })
        .then(function () { loadKnowledge(); })
        .catch(function () { en.disabled = false; showToast(t('knowledge.updateError'), 'error'); });
    });
  }

  // ---- Train flow (backfill + status poller) ----
  function knStopPoll() { if (knPollTimer) { clearTimeout(knPollTimer); knPollTimer = null; } }
  function knShowProg(show) { var p = document.getElementById('knProg'); if (!p) return; if (show) p.removeAttribute('hidden'); else p.setAttribute('hidden', ''); }
  var knLastProg = null;
  function knSetProg(done, total) {
    knLastProg = { done: done, total: total };
    var fill = document.getElementById('knProgFill'), lbl = document.getElementById('knProgLabel');
    var pct = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
    if (fill) fill.style.width = pct + '%';
    if (lbl) lbl.textContent = t('knowledge.progLabel').replace('{done}', done.toLocaleString()).replace('{total}', total.toLocaleString());
  }
  function knPoll() {
    knPollTimer = null;
    fetch(knBase() + '/status', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s) throw new Error('no status');
        knPollErrs = 0;
        var done = Number(s.processed || 0), total = Number(s.total || 0), queued = Number(s.queued || 0);
        knSetProg(done, total);
        if (queued === 0) { knShowProg(false); showToast(t('knowledge.trainDone').replace('{n}', done.toLocaleString()), 'success'); loadKnowledge(); return; }
        knPolls++;
        if (knPolls >= 75) { knShowProg(false); showToast(t('knowledge.trainBg'), 'info'); return; }
        knPollTimer = setTimeout(knPoll, 4000);
      })
      .catch(function () {
        knPollErrs++;
        if (knPollErrs >= 2) { knShowProg(false); return; }
        knPollTimer = setTimeout(knPoll, 4000);
      });
  }
  function knStartTrain(btn) {
    if (btn) btn.disabled = true;
    fetch(knBase() + '/backfill', { method: 'POST', credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 403) return { __gate: true };
        if (!r.ok) throw new Error('failed');
        return r.json();
      })
      .then(function (d) {
        if (btn) btn.disabled = false;
        if (d && d.__gate) { showToast(t('knowledge.upsellTitle'), 'info'); return; }
        if (!d) return;
        var q = Number(d.queued || 0);
        if (q === 0) { showToast(t('knowledge.trainNothing'), 'info'); return; }
        showToast(t('knowledge.trainStarted').replace('{n}', q.toLocaleString()), 'success');
        if (d.kicked === false) { showToast(t('knowledge.trainBg'), 'info'); return; }
        knStopPoll(); knPolls = 0; knPollErrs = 0; knShowProg(true); knSetProg(0, q);
        knPollTimer = setTimeout(knPoll, 4000);
      })
      .catch(function () { if (btn) btn.disabled = false; showToast(t('knowledge.updateError'), 'error'); });
  }

  function knKpiTiles() {
    var c = knState.counts || {};
    function n(k) { return Number(c[k] || 0); }
    var tiles = [
      [n('artifact-digest').toLocaleString(), t('knowledge.kpiPages')],
      [n('topic').toLocaleString(), t('knowledge.kpiTopics')],
      [n('entity').toLocaleString(), t('knowledge.kpiEntities')],
      [knState.lastUpdated ? adRelDate(knState.lastUpdated) : '\\u2014', t('knowledge.kpiUpdated'), t('knowledge.tipUpdated')]
    ];
    return '<div class="wsx-an__cards wsx-cat__kpis">' + tiles.map(function (tile) {
      return '<div class="wsx-an__card"' + (tile[2] ? ' data-tip="' + esc(tile[2]) + '"' : '') + '><div class="wsx-an__n">' + tile[0] + '</div><div class="wsx-an__l">' + esc(tile[1]) + '</div></div>';
    }).join('') + '</div>';
  }

  function knToggle() {
    return '<div class="wsx__modetog wsx-kn2__viewtog">'
      + '<button class="' + (knState.view === 'tree' ? 'is-on' : '') + '" data-kn-view="tree" type="button">' + esc(t('knowledge.viewTree')) + '</button>'
      + '<button class="' + (knState.view === 'table' ? 'is-on' : '') + '" data-kn-view="table" type="button">' + esc(t('knowledge.viewTable')) + '</button>'
      + '</div>';
  }
  function knHowBtn() {
    return '<button class="wsx-kn2__how" id="knHow" type="button"><span class="wsx-kn2__q">?</span>' + esc(t('knowledge.howBtn')) + '</button>';
  }
  function knHowP(key) {
    var s = t(key), i = s.indexOf('. ');
    if (i < 0) return '<p>' + esc(s) + '</p>';
    return '<p><strong>' + esc(s.slice(0, i + 1)) + '</strong> ' + esc(s.slice(i + 2)) + '</p>';
  }
  function knHowModal() {
    wsxModal(t('knowledge.howTitle'), '<div class="wsx-kn2__how-body">'
      + knHowP('knowledge.howLearn') + knHowP('knowledge.howDream') + knHowP('knowledge.howAgents') + knHowP('knowledge.howControl') + '</div>');
  }

  // ---- Table view (the alternate, kept intact behind the toggle) ----
  var KN_SEGS = [['topic', 'knowledge.segTopics'], ['entity', 'knowledge.segEntities'], ['artifact-digest', 'knowledge.segPages'], ['decision', 'knowledge.segDecisions']];
  function knSeg() {
    var btns = '<button class="' + (knState.kind === '' ? 'is-on' : '') + '" data-kn-kind-seg="" type="button">' + esc(t('knowledge.segAll')) + '</button>';
    btns += KN_SEGS.map(function (s) {
      return '<button class="' + (knState.kind === s[0] ? 'is-on' : '') + '" data-kn-kind-seg="' + s[0] + '" type="button">' + esc(t(s[1])) + '</button>';
    }).join('');
    return '<div class="wsx__modetog wsx-cat__seg">' + btns + '</div>';
  }

  var KN_COLS = [['title', 'knowledge.colTitle', 1], ['kind', 'knowledge.colKind', 1], ['topics', 'knowledge.colTopics', 0], ['sources', 'knowledge.colSources', 0], ['learned', 'knowledge.colLearned', 1]];
  function knArrow(k) { return knState.sort === k ? (knState.asc ? ' \\u25B2' : ' \\u25BC') : ''; }

  function knTopicsCell(n) {
    var ts = (n.topics || []).slice(0, 3);
    if (!ts.length) return '<span class="wsx-atbl__date">\\u2014</span>';
    return ts.map(function (x) { return '<span class="wsx-cat__tag">' + esc(x) + '</span>'; }).join(' ');
  }

  function knRow(n) {
    var text = [n.id || '', n.title || '', n.path || ''].concat(n.topics || []).concat(n.entities || []).join(' ').toLowerCase();
    var sc = Number(n.sourcesCount || 0);
    return '<tr class="wsx-cat__row" data-kn-path="' + esc(n.path) + '" data-kn-text="' + esc(text) + '" data-kn-kind="' + esc(n.kind) + '">'
      + '<td><span class="wsx-atbl__link">' + esc(n.title || n.path) + '</span>' + knBadge(n) + '</td>'
      + '<td><span class="wsx-atbl__type">' + esc(knKindLabel(n.kind)) + '</span></td>'
      + '<td>' + knTopicsCell(n) + '</td>'
      + '<td class="wsx-atbl__num"><span class="wsx-cat__lc' + (sc ? '' : ' z') + '">\\u2191' + sc + '</span></td>'
      + '<td class="wsx-atbl__date">' + (n.learned_at ? esc(adRelDate(n.learned_at)) : '\\u2014') + '</td></tr>';
  }

  function knSortedRows() {
    var k = knState.sort, asc = knState.asc;
    return knState.nodes.filter(function (n) { return n.kind !== 'overview'; }).slice().sort(function (a, b) {
      var av, bv;
      if (k === 'learned') { av = a.learned_at || ''; bv = b.learned_at || ''; }
      else if (k === 'kind') { av = knKindLabel(a.kind); bv = knKindLabel(b.kind); }
      else { av = a.title || a.path || ''; bv = b.title || b.path || ''; }
      av = String(av).toLowerCase(); bv = String(bv).toLowerCase();
      var c = av < bv ? -1 : av > bv ? 1 : 0; return asc ? c : -c;
    });
  }

  function knTableBody() {
    var heads = KN_COLS.map(function (c) {
      if (!c[2]) return '<th>' + esc(t(c[1])) + '</th>';
      return '<th class="' + (knState.sort === c[0] ? 'is-sort' : '') + '" data-knsort="' + c[0] + '">' + esc(t(c[1])) + knArrow(c[0]) + '</th>';
    }).join('');
    return '<div class="wsx-atbl__wrap"><table class="wsx-atbl wsx-cat__table"><thead><tr>' + heads + '</tr></thead>'
      + '<tbody id="knList">' + knSortedRows().map(knRow).join('') + '</tbody></table></div>'
      + '<div class="wsx-empty" id="knNone" style="display:none">' + esc(t('knowledge.noMatch')) + '</div>';
  }

  function knApplyFilter() {
    var list = document.getElementById('knList'); if (!list) return;
    var none = document.getElementById('knNone'), cnt = document.getElementById('knCount'), shown = 0;
    Array.prototype.forEach.call(list.children, function (c) {
      var ok = !knState.q || (c.getAttribute('data-kn-text') || '').indexOf(knState.q) >= 0;
      if (ok && knState.kind && c.getAttribute('data-kn-kind') !== knState.kind) ok = false;
      c.style.display = ok ? '' : 'none'; if (ok) shown++;
    });
    if (none) none.style.display = shown ? 'none' : 'block';
    if (cnt) cnt.textContent = t(shown === 1 ? 'knowledge.resultOne' : 'knowledge.resultMany').replace('{n}', shown.toLocaleString());
  }

  function knBindTable(m) {
    m.querySelectorAll('[data-kn-kind-seg]').forEach(function (b) {
      b.addEventListener('click', function () { knState.kind = b.getAttribute('data-kn-kind-seg'); knRenderShell(m); });
    });
    m.querySelectorAll('th[data-knsort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-knsort');
        if (knState.sort === k) knState.asc = !knState.asc; else { knState.sort = k; knState.asc = true; }
        knRenderShell(m);
      });
    });
    m.querySelectorAll('#knList [data-kn-path]').forEach(function (r) {
      r.addEventListener('click', function () { knFullDetail(m, r.getAttribute('data-kn-path')); });
    });
  }

  // ---- Tree view ----
  var KN_BRANCHES = [['topic', 'knowledge.branchTopics'], ['entity', 'knowledge.branchEntities'], ['artifact-digest', 'knowledge.branchPages'], ['decision', 'knowledge.branchDecisions'], ['timeline', 'knowledge.branchTimeline']];

  function knNodeRow(n, depth) {
    var text = [n.id || '', n.title || '', n.path || ''].concat(n.topics || []).concat(n.entities || []).join(' ').toLowerCase();
    var sc = Number(n.sourcesCount || 0);
    var tail = '';
    if (sc) tail += '<span class="wsx-kn2__src">\\u2191' + sc + '</span>';
    tail += knBadge(n);
    var fresh = n.learned_at ? adRelDate(n.learned_at) : (n.updated_at ? adRelDate(n.updated_at) : '');
    if (fresh) tail += '<span class="wsx-kn2__fresh">' + esc(fresh) + '</span>';
    var label = n.kind === 'overview' ? t('knowledge.overviewTitle') : (n.title || n.path);
    return '<button class="wsx-kn2__node' + (knCurrentPath === n.path ? ' is-sel' : '') + '" data-depth="' + depth + '" data-kn-path="' + esc(n.path) + '" data-kn-text="' + esc(text) + '" type="button">'
      + '<span class="wsx-kn2__ico">' + knIcon(n.kind) + '</span>'
      + '<span class="wsx-kn2__lbl">' + esc(label) + '</span>'
      + '<span class="wsx-kn2__tail">' + tail + '</span></button>';
  }

  function knBranchNodes(kind) {
    return knState.nodes.filter(function (n) { return n.kind === kind; }).slice().sort(function (a, b) {
      var av = (a.title || a.path || '').toLowerCase(), bv = (b.title || b.path || '').toLowerCase();
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
  }

  function knBranch(kind, labelKey) {
    var nodes = knBranchNodes(kind);
    if (!nodes.length) return '';
    var collapsed = !!knState.collapsed[kind];
    var head = '<button class="wsx-kn2__branch" data-kn-branch="' + esc(kind) + '" type="button">'
      + '<span class="wsx-kn2__chev' + (collapsed ? '' : ' is-open') + '">' + KN_CHEV + '</span>'
      + '<span class="wsx-kn2__blabel">' + esc(t(labelKey)) + '</span>'
      + '<span class="wsx-kn2__count" data-kn-bcount="' + esc(kind) + '">' + nodes.length + '</span></button>';
    var kids = '<div class="wsx-kn2__kids' + (collapsed ? ' is-collapsed' : '') + '" data-kn-kids="' + esc(kind) + '">'
      + nodes.map(function (n) { return knNodeRow(n, 1); }).join('') + '</div>';
    return head + kids;
  }

  function knGuidanceRow(n) {
    var badges = '';
    if (n.is_entry) badges += '<span class="so-c-badge wsx-kn__bdg" data-tip="' + esc(t('knowledge.tipEntry')) + '">' + esc(t('knowledge.badgeEntry')) + '</span>';
    badges += '<span class="so-c-badge wsx-kn__bdg">' + esc(t('knowledge.badgeManual')) + '</span>';
    var fresh = n.updated_at ? adRelDate(n.updated_at) : '';
    var tail = badges + (fresh ? '<span class="wsx-kn2__fresh">' + esc(fresh) + '</span>' : '');
    return '<button class="wsx-kn2__node' + (knCurrentPath === n.path ? ' is-sel' : '') + '" data-depth="1" data-kn-path="' + esc(n.path) + '" data-kn-text="' + esc(String(n.name || '').toLowerCase()) + '" type="button">'
      + '<span class="wsx-kn2__ico">' + knIcon('guidance') + '</span>'
      + '<span class="wsx-kn2__lbl">' + esc(n.name) + '</span>'
      + '<span class="wsx-kn2__tail">' + tail + '</span></button>';
  }

  function knGuidanceBranch() {
    var admin = !!window.WSX_ADMIN;
    var g = (knState.guidance || []).slice().sort(function (a, b) { var av = (a.name || '').toLowerCase(), bv = (b.name || '').toLowerCase(); return av < bv ? -1 : av > bv ? 1 : 0; });
    if (!g.length && !admin) return '';
    var collapsed = !!knState.collapsed.guidance;
    var head = '<button class="wsx-kn2__branch" data-kn-branch="guidance" type="button">'
      + '<span class="wsx-kn2__chev' + (collapsed ? '' : ' is-open') + '">' + KN_CHEV + '</span>'
      + '<span class="wsx-kn2__blabel">' + esc(t('knowledge.branchGuidance')) + '</span>'
      + '<span class="wsx-kn2__gq" data-tip="' + esc(t('knowledge.tipGuidance')) + '">?</span>'
      + '<span class="wsx-kn2__count" data-kn-bcount="guidance">' + g.length + '</span></button>';
    var rows = g.map(knGuidanceRow).join('');
    if (admin) rows += '<button class="wsx-kn2__node wsx-kn2__gnew" data-depth="1" data-kn-gnew="1" type="button"><span class="wsx-kn2__ico">' + KN_PLUS + '</span><span class="wsx-kn2__lbl">' + esc(t('knowledge.gNew')) + '</span></button>';
    return head + '<div class="wsx-kn2__kids' + (collapsed ? ' is-collapsed' : '') + '" data-kn-kids="guidance">' + rows + '</div>';
  }

  function knTreeHtml() {
    var ov = knState.nodes.filter(function (n) { return n.kind === 'overview'; })[0];
    var html = ov ? knNodeRow(ov, 0) : '';
    KN_BRANCHES.forEach(function (b) { html += knBranch(b[0], b[1]); });
    html += knGuidanceBranch();
    return html;
  }

  function knEmptyPaneHtml() {
    var learned = knState.nodes.filter(function (n) { return n.kind !== 'guidance'; }).length;
    if (!learned) {
      var hint = window.WSX_ADMIN ? t('knowledge.emptyHint') : t('knowledge.askAdminTrain');
      return '<div class="wsx-kn2__empty"><p>' + esc(t('knowledge.emptyLead')) + '</p><p>' + esc(hint) + '</p></div>';
    }
    return '<div class="wsx-kn2__empty">' + esc(t('knowledge.paneEmpty')) + '</div>';
  }

  function knHighlightTree() {
    var tree = document.getElementById('knTree'); if (!tree) return;
    tree.querySelectorAll('.wsx-kn2__node.is-sel').forEach(function (n) { n.classList.remove('is-sel'); });
    if (!knCurrentPath) return;
    tree.querySelectorAll('.wsx-kn2__node').forEach(function (n) {
      if (n.getAttribute('data-kn-path') === knCurrentPath) n.classList.add('is-sel');
    });
  }

  function knApplyTreeFilter() {
    var tree = document.getElementById('knTree'); if (!tree) return;
    var q = knState.q, shown = 0;
    tree.querySelectorAll('.wsx-kn2__node').forEach(function (n) {
      var ok = !q || (n.getAttribute('data-kn-text') || '').indexOf(q) >= 0;
      n.style.display = ok ? '' : 'none'; if (ok) shown++;
    });
    tree.querySelectorAll('[data-kn-kids]').forEach(function (kids) {
      var kind = kids.getAttribute('data-kn-kids'), vis = 0;
      Array.prototype.forEach.call(kids.children, function (c) { if (c.style.display !== 'none') vis++; });
      var head = tree.querySelector('.wsx-kn2__branch[data-kn-branch="' + kind + '"]');
      var cnt = tree.querySelector('[data-kn-bcount="' + kind + '"]');
      if (cnt) cnt.textContent = vis;
      if (head) head.style.display = vis > 0 ? '' : 'none';
      var open = q ? true : !knState.collapsed[kind];
      kids.classList.toggle('is-collapsed', !open);
      var chev = head && head.querySelector('.wsx-kn2__chev'); if (chev) chev.classList.toggle('is-open', open);
    });
    var none = document.getElementById('knNone');
    if (none) none.style.display = (q && shown === 0) ? 'block' : 'none';
  }

  function knBindTree(m) {
    var tree = document.getElementById('knTree'); if (!tree) return;
    tree.querySelectorAll('.wsx-kn2__branch').forEach(function (b) {
      b.addEventListener('click', function () {
        var kind = b.getAttribute('data-kn-branch');
        knState.collapsed[kind] = !knState.collapsed[kind];
        var kids = tree.querySelector('[data-kn-kids="' + kind + '"]');
        var chev = b.querySelector('.wsx-kn2__chev');
        if (kids) kids.classList.toggle('is-collapsed', !!knState.collapsed[kind]);
        if (chev) chev.classList.toggle('is-open', !knState.collapsed[kind]);
      });
    });
    tree.querySelectorAll('.wsx-kn2__node').forEach(function (r) {
      r.addEventListener('click', function () {
        if (r.getAttribute('data-kn-gnew')) { knNewGuidance(); return; }
        var p = r.getAttribute('data-kn-path'); if (!p) return;
        if (knNarrow()) knFullDetail(m, p); else knPanePaint(p, true);
      });
    });
  }

  // ---- Shell (KPIs + controls + tree|table body) ----
  function knRenderShell(m) {
    var byPath = knState.byPath || {};
    if (knCurrentPath && byPath[knCurrentPath] && (knState.view === 'table' || knNarrow())) { knFullDetail(m, knCurrentPath); return; }
    var trainBtn = window.WSX_ADMIN ? '<button class="so-c-btn so-c-btn--primary wsx-kn2__train" id="knTrain" type="button" data-tip="' + esc(t('knowledge.tipTrain')) + '">' + esc(t('knowledge.train')) + '</button>' : '';
    var prog = '<div class="wsx-kn2__prog" id="knProg" hidden><div class="wsx-kn2__progtrack"><div class="wsx-kn2__progfill" id="knProgFill"></div></div><span class="wsx-kn2__proglabel" id="knProgLabel"></span></div>';
    var top = knKpiTiles()
      + '<div class="wsx-cat__controls"><div class="wsx-cat__bar wsx-kn2__bar">'
      + (knState.view === 'table'
          ? '<input class="wsx-cat__search" id="knSearch" type="search" placeholder="' + esc(t('knowledge.searchPlaceholder')) + '" autocomplete="off">' + knSeg() + '<span class="wsx-cat__count" id="knCount"></span>'
          : '')
      + '<div class="wsx-kn2__ctlright">' + trainBtn + knHowBtn() + knToggle() + '</div>'
      + '</div>' + prog + '</div>';
    if (knState.view === 'table') {
      m.innerHTML = top + knTableBody();
      knBindShell(m); knBindTable(m); knApplyFilter();
    } else {
      m.innerHTML = top
        + '<div class="wsx-kn2">'
        + '<div class="wsx-kn2__pane wsx-kn2__treewrap">'
        + '<input class="wsx-cat__search wsx-kn2__search" id="knSearch" type="search" placeholder="' + esc(t('knowledge.searchPlaceholder')) + '" autocomplete="off">'
        + '<div class="wsx-kn2__tree" id="knTree">' + knTreeHtml() + '</div>'
        + '<div class="wsx-empty" id="knNone" style="display:none">' + esc(t('knowledge.noMatch')) + '</div>'
        + '</div>'
        + '<div class="wsx-kn2__pane wsx-kn2__detail" id="knPane"></div>'
        + '</div>';
      knBindShell(m); knBindTree(m);
      if (knState.q) knApplyTreeFilter();
      if (knCurrentPath && byPath[knCurrentPath]) knPanePaint(knCurrentPath, true);
      else {
        var ov = knState.nodes.filter(function (n) { return n.kind === 'overview'; })[0];
        if (ov) knPanePaint(ov.path, false);
        else { var pane = document.getElementById('knPane'); if (pane) pane.innerHTML = knEmptyPaneHtml(); }
      }
    }
  }

  function knBindShell(m) {
    if (knPollTimer && knLastProg) { knShowProg(true); knSetProg(knLastProg.done, knLastProg.total); }
    m.querySelectorAll('[data-kn-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-kn-view'); if (v === knState.view) return;
        knState.view = v; try { localStorage.setItem('wsx_kn_view', v); } catch (e) {}
        knRenderShell(m);
      });
    });
    var how = document.getElementById('knHow'); if (how) how.addEventListener('click', knHowModal);
    var tr = document.getElementById('knTrain'); if (tr) tr.addEventListener('click', function () { knStartTrain(tr); });
    var s = document.getElementById('knSearch');
    if (s) { s.value = knState.q; s.addEventListener('input', function () { knState.q = s.value.trim().toLowerCase(); if (knState.view === 'tree') knApplyTreeFilter(); else knApplyFilter(); }); }
  }

  function knFetchNode(path, cb) {
    fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/knowledge/files/' + knApiPath(path), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { var node = d && d.node; if (node) node.path = node.path || path; cb(node); })
      .catch(function () { cb(null); });
  }

  function knGuidanceMeta(path) { return (knState.guidance || []).filter(function (g) { return g.path === path; })[0] || { path: path, name: String(path).replace('guidance/', '') }; }
  function knFetchGuidance(path, cb) {
    var meta = knGuidanceMeta(path);
    fetch(knWsBase() + '/context/' + encodeURIComponent(meta.name), { credentials: 'same-origin' })
      .then(function (r) { return r.status === 404 ? '' : (r.ok ? r.text() : null); })
      .then(function (txt) { if (txt == null) { cb(null); return; } cb({ path: path, kind: 'guidance', name: meta.name, is_entry: !!meta.is_entry, updated_at: meta.updated_at, body: txt, content: txt }); })
      .catch(function () { cb(null); });
  }

  // Paint into the right-hand pane (wide tree). select=false → overview preview, no hash change.
  function knPanePaint(path, select) {
    var pane = document.getElementById('knPane'); if (!pane) return;
    if (select !== false) { knCurrentPath = path; if (typeof syncHash === 'function') syncHash(); knHighlightTree(); }
    pane.innerHTML = i18nLoad();
    if (knIsGuidance(path)) { knFetchGuidance(path, function (node) { if (!node) { pane.innerHTML = i18nError('knowledge.couldNotLoad'); return; } knPaintGuidance(pane, node, false); }); return; }
    knFetchNode(path, function (node) {
      if (!node) { pane.innerHTML = i18nError('knowledge.couldNotLoad'); return; }
      knPaintDetail(pane, node, false);
    });
  }

  // Full-mount detail with a back button (table view + narrow tree).
  function knFullDetail(m, path) {
    knCurrentPath = path; if (typeof syncHash === 'function') syncHash();
    m.innerHTML = i18nLoad();
    var back = function () { knCurrentPath = ''; if (typeof syncHash === 'function') syncHash(); knRenderShell(m); };
    if (knIsGuidance(path)) { knFetchGuidance(path, function (node) { if (!node) { m.innerHTML = i18nError('knowledge.couldNotLoad'); return; } knPaintGuidance(m, node, back); }); return; }
    knFetchNode(path, function (node) {
      if (!node) { m.innerHTML = i18nError('knowledge.couldNotLoad'); return; }
      knPaintDetail(m, node, back);
    });
  }

  // Re-render the shell keeping the current selection (used after pin/edit/forget).
  function knReopen(path) { var m = knMount(); if (!m) return; knCurrentPath = path || ''; knRenderShell(m); }

  function knSrcRows(sources) {
    if (!sources || !sources.length) return '<div class="wsx-cat__linnone">' + esc(t('knowledge.srcNone')) + '</div>';
    var rows = sources.map(function (s) {
      if (typeof s === 'string') s = { id: s };
      var label = s.title || s.id || s.slug || '';
      var unc = s.title ? '' : ' <span class="wsx-cat__unc">' + esc(t('knowledge.srcNotLearned')) + '</span>';
      return '<tr class="wsx-cat__linrow wsx-kn__srclink" data-kn-src-slug="' + esc(s.slug || '') + '" data-kn-src-id="' + esc(s.id || '') + '" data-kn-src-title="' + esc(label) + '">'
        + '<td><span class="wsx-atbl__link">' + esc(label) + '</span>' + unc + '</td></tr>';
    }).join('');
    return '<div class="wsx-atbl__wrap"><table class="wsx-atbl wsx-cat__lintable"><tbody>' + rows + '</tbody></table></div>';
  }

  function knRaw(node) { return node.content || node.raw || node.body || ''; }
  function knSetPinnedLine(content, pinned) {
    var re = /^pinned:.*$/m;
    if (re.test(content)) return content.replace(re, 'pinned: ' + pinned);
    if (/^---\\r?\\n/.test(content)) return content.replace(/^---\\r?\\n/, '---\\npinned: ' + pinned + '\\n');
    return content;
  }

  function knPaintDetail(host, node, back) {
    var topics = node.topics || [], entities = node.entities || [];
    var rows = [[esc(t('knowledge.metaKind')), esc(knKindLabel(node.kind))]];
    if (topics.length) rows.push([esc(t('knowledge.metaTopics')), topics.map(function (x) { return '<span class="wsx-cat__tag">' + esc(x) + '</span>'; }).join(' ')]);
    if (entities.length) rows.push([esc(t('knowledge.metaEntities')), entities.map(function (x) { return '<span class="wsx-cat__tag">' + esc(x) + '</span>'; }).join(' ')]);
    rows.push([esc(t('knowledge.metaLearned')), node.learned_at ? esc(adRelDate(node.learned_at)) : '\\u2014']);
    if (node.confidence) rows.push([esc(t('knowledge.metaConfidence')), esc(node.confidence)]);
    rows.push([esc(t('knowledge.metaPinned')), node.pinned ? esc(t('knowledge.yes')) : esc(t('knowledge.no'))]);
    var meta = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('');
    var sources = node.sources || [];
    var fresh = t('knowledge.freshLearned') + ' ' + adRelDate(node.learned_at);
    if (node.updated_at && node.updated_at !== node.learned_at) fresh += ' \\u00B7 ' + t('knowledge.freshUpdated') + ' ' + adRelDate(node.updated_at);
    var title = node.kind === 'overview' ? t('knowledge.overviewTitle') : (node.title || node.path);
    var backBtn = back ? '<button class="wsx-cat__back" id="knBack" type="button">' + esc(t('knowledge.back')) + '</button>' : '';
    host.innerHTML = backBtn
      + '<div class="wsx-cat__dhead"><span class="wsx-atbl__type">' + esc(knKindLabel(node.kind)) + '</span><h3>' + esc(title) + '</h3>' + knBadge(node) + '</div>'
      + '<div class="wsx-sched__meta">' + esc(node.path) + '</div>'
      + '<dl class="wsx-cat__meta">' + meta + '</dl>'
      + '<div id="knBody">' + (node.kind === 'overview' ? knOverviewChrome(node.body) : (node.body ? '<div class="wsx-cat__body">' + mdToHtml(node.body) + '</div>' : '')) + '</div>'
      + '<div class="wsx-cat__lin"><div class="wsx-cat__linhead"><span data-tip="' + esc(t('knowledge.tipSources')) + '">' + esc(t('knowledge.srcHeader')) + '</span> <span class="wsx-cat__lcount">' + sources.length + '</span><span class="wsx-cat__linhint">' + esc(t('knowledge.srcHint')) + '</span></div>' + knSrcRows(sources) + '</div>'
      + '<div class="wsx-kn__fresh">' + esc(fresh) + '</div>'
      + '<div class="wsx-kn__controls">'
      + '<button class="so-c-btn" id="knPin" type="button">' + esc(t(node.pinned ? 'knowledge.unpin' : 'knowledge.pin')) + '</button>'
      + '<button class="so-c-btn" id="knEdit" type="button">' + esc(t('knowledge.edit')) + '</button>'
      + (window.WSX_ADMIN ? '<button class="so-c-btn wsx-kn__danger" id="knForget" type="button">' + esc(t('knowledge.forget')) + '</button>' : '')
      + '</div>';
    if (back) { var bk = document.getElementById('knBack'); if (bk) bk.addEventListener('click', back); }
    host.querySelectorAll('[data-kn-src-id]').forEach(function (r) {
      r.addEventListener('click', function () {
        if (typeof openArtifact !== 'function') return;
        openArtifact(r.getAttribute('data-kn-src-slug') || '', r.getAttribute('data-kn-src-title') || '', r.getAttribute('data-kn-src-id') || '');
      });
    });
    document.getElementById('knPin').addEventListener('click', function () { knPin(node); });
    document.getElementById('knEdit').addEventListener('click', function () { knEdit(node); });
    var fg = document.getElementById('knForget');
    if (fg) fg.addEventListener('click', function () { knForget(node); });
  }

  function knPut(node, raw) {
    return fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/knowledge/files/' + knApiPath(node.path), {
      method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'text/markdown' }, body: raw
    }).then(function (r) { if (!r.ok) throw new Error('failed'); });
  }

  function knPin(node) {
    var btn = document.getElementById('knPin'); if (btn) btn.disabled = true;
    var next = !node.pinned;
    knPut(node, knSetPinnedLine(knRaw(node), next))
      .then(function () {
        showToast(t('knowledge.updated'), 'success');
        node.pinned = next; if (knState.byPath[node.path]) knState.byPath[node.path].pinned = next;
        knReopen(node.path);
      })
      .catch(function () { if (btn) btn.disabled = false; showToast(t('knowledge.updateError'), 'error'); });
  }

  function knEdit(node) {
    var host = document.getElementById('knBody'); if (!host) return;
    host.innerHTML = '<div class="wsx-kn__edit"><textarea id="knText" spellcheck="false"></textarea>'
      + '<div class="wsx-kn__controls"><button class="so-c-btn so-c-btn--primary" id="knSave" type="button">' + esc(t('knowledge.save')) + '</button>'
      + '<button class="so-c-btn" id="knCancel" type="button">' + esc(t('knowledge.cancel')) + '</button></div></div>';
    document.getElementById('knText').value = knRaw(node);
    document.getElementById('knCancel').addEventListener('click', function () { knReopen(node.path); });
    document.getElementById('knSave').addEventListener('click', function () {
      var sv = document.getElementById('knSave'); sv.disabled = true; sv.textContent = t('knowledge.saving');
      knPut(node, document.getElementById('knText').value)
        .then(function () { showToast(t('knowledge.updated'), 'success'); knReopen(node.path); })
        .catch(function () { sv.disabled = false; sv.textContent = t('knowledge.save'); showToast(t('knowledge.updateError'), 'error'); });
    });
  }

  function knForget(node) {
    var modal = wsxModal(t('knowledge.forgetTitle'), '<p class="wsx-cat__hint">' + esc(t('knowledge.forgetBody')) + '</p>'
      + '<div class="wsx-kn__controls"><button class="so-c-btn wsx-kn__danger" id="knForgetGo" type="button">' + esc(t('knowledge.forget')) + '</button>'
      + '<button class="so-c-btn" id="knForgetKeep" type="button">' + esc(t('knowledge.keep')) + '</button></div>');
    modal.body.querySelector('#knForgetKeep').addEventListener('click', modal.close);
    modal.body.querySelector('#knForgetGo').addEventListener('click', function () {
      var go = modal.body.querySelector('#knForgetGo'); go.disabled = true;
      fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/knowledge/files/' + knApiPath(node.path) + '?forget=1', { method: 'DELETE', credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('failed'); })
        .then(function () {
          modal.close();
          showToast(t('knowledge.updated'), 'success');
          delete knState.byPath[node.path];
          knState.nodes = knState.nodes.filter(function (n) { return n.path !== node.path; });
          knCurrentPath = ''; knReopen('');
        })
        .catch(function () { go.disabled = false; showToast(t('knowledge.updateError'), 'error'); });
    });
  }

  // ---- Overview i18n chrome (localized around the deterministic code-gen body) ----
  function knOverviewChrome(body) {
    body = String(body || '');
    var marker = '## Top topics', pos = body.indexOf(marker);
    var above = pos >= 0 ? body.slice(0, pos) : body;
    var topics = pos >= 0 ? body.slice(pos + marker.length) : '';
    var lines = above.split('\\n');
    if (lines.length && /^\\d+ pages learned\\. Updated \\d{4}-\\d{2}-\\d{2}\\.$/.test(String(lines[0]).trim())) {
      var n = Number((knState.counts && knState.counts['artifact-digest']) || 0);
      lines[0] = t('knowledge.pagesLearned').replace('{n}', n.toLocaleString());
    }
    var html = '<div class="wsx-cat__body">' + mdToHtml(lines.join('\\n')) + '</div>';
    if (pos >= 0) html += '<h3 class="wsx-kn2__toptopics">' + esc(t('knowledge.topTopics')) + '</h3><div class="wsx-cat__body">' + mdToHtml(topics) + '</div>';
    return html;
  }

  // ---- Guidance detail pane + actions (manual house-rule files via /context REST) ----
  function knPaintGuidance(host, node, back) {
    var admin = !!window.WSX_ADMIN;
    var badges = '';
    if (node.is_entry) badges += '<span class="so-c-badge wsx-kn__bdg" data-tip="' + esc(t('knowledge.tipEntry')) + '">' + esc(t('knowledge.badgeEntry')) + '</span>';
    badges += '<span class="so-c-badge wsx-kn__bdg">' + esc(t('knowledge.badgeManual')) + '</span>';
    var fresh = node.updated_at ? (t('knowledge.freshUpdated') + ' ' + adRelDate(node.updated_at)) : '';
    var backBtn = back ? '<button class="wsx-cat__back" id="knBack" type="button">' + esc(t('knowledge.back')) + '</button>' : '';
    host.innerHTML = backBtn
      + '<div class="wsx-cat__dhead"><span class="wsx-atbl__type">' + esc(t('knowledge.branchGuidance')) + '</span><h3>' + esc(node.name) + '</h3>' + badges + '</div>'
      + '<div class="wsx-sched__meta">' + esc(node.path) + '</div>'
      + '<div id="knBody"><div class="wsx-cat__body">' + mdToHtml(node.body || '') + '</div></div>'
      + (fresh ? '<div class="wsx-kn__fresh">' + esc(fresh) + '</div>' : '')
      + (admin ? '<div class="wsx-kn__controls">'
        + '<button class="so-c-btn" id="knGEdit" type="button">' + esc(t('knowledge.edit')) + '</button>'
        + (node.is_entry ? '' : '<button class="so-c-btn" id="knGEntry" type="button">' + esc(t('knowledge.gSetEntry')) + '</button>')
        + '<button class="so-c-btn wsx-kn__danger" id="knGDel" type="button">' + esc(t('knowledge.gDelete')) + '</button>'
        + '</div>' : '');
    if (back) { var bk = document.getElementById('knBack'); if (bk) bk.addEventListener('click', back); }
    var ed = document.getElementById('knGEdit'); if (ed) ed.addEventListener('click', function () { knGuidanceEdit(node); });
    var ge = document.getElementById('knGEntry'); if (ge) ge.addEventListener('click', function () { knGuidanceSetEntry(node); });
    var gd = document.getElementById('knGDel'); if (gd) gd.addEventListener('click', function () { knGuidanceDelete(node); });
  }

  function knGuidancePut(name, body) {
    return fetch(knWsBase() + '/context/' + encodeURIComponent(name), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'text/markdown' }, body: body })
      .then(function (r) { if (!r.ok) throw new Error('failed'); });
  }

  function knGuidanceEdit(node) {
    var host = document.getElementById('knBody'); if (!host) return;
    host.innerHTML = '<div class="wsx-kn__edit"><textarea id="knGText" spellcheck="false"></textarea>'
      + '<div class="wsx-kn__controls"><button class="so-c-btn so-c-btn--primary" id="knGSave" type="button">' + esc(t('knowledge.save')) + '</button>'
      + '<button class="so-c-btn" id="knGCancel" type="button">' + esc(t('knowledge.cancel')) + '</button></div></div>';
    document.getElementById('knGText').value = node.body || '';
    document.getElementById('knGCancel').addEventListener('click', function () { knReopen(node.path); });
    document.getElementById('knGSave').addEventListener('click', function () {
      var sv = document.getElementById('knGSave'); sv.disabled = true; sv.textContent = t('knowledge.saving');
      knGuidancePut(node.name, document.getElementById('knGText').value)
        .then(function () { showToast(t('knowledge.updated'), 'success'); knReopen(node.path); })
        .catch(function () { sv.disabled = false; sv.textContent = t('knowledge.save'); showToast(t('knowledge.updateError'), 'error'); });
    });
  }

  function knGuidanceSetEntry(node) {
    fetch(knWsBase() + '/context', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: node.name }) })
      .then(function (r) { if (!r.ok) throw new Error('failed'); })
      .then(function () { showToast(t('knowledge.updated'), 'success'); loadKnowledge(); })
      .catch(function () { showToast(t('knowledge.updateError'), 'error'); });
  }

  function knGuidanceDelete(node) {
    var modal = wsxModal(t('knowledge.gDeleteTitle'), '<p class="wsx-cat__hint">' + esc(t('knowledge.gDeleteBody')) + '</p>'
      + '<div class="wsx-kn__controls"><button class="so-c-btn wsx-kn__danger" id="knGDelGo" type="button">' + esc(t('knowledge.gDelete')) + '</button>'
      + '<button class="so-c-btn" id="knGDelKeep" type="button">' + esc(t('knowledge.keep')) + '</button></div>');
    modal.body.querySelector('#knGDelKeep').addEventListener('click', modal.close);
    modal.body.querySelector('#knGDelGo').addEventListener('click', function () {
      var go = modal.body.querySelector('#knGDelGo'); go.disabled = true;
      fetch(knWsBase() + '/context/' + encodeURIComponent(node.name), { method: 'DELETE', credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('failed'); })
        .then(function () { modal.close(); showToast(t('knowledge.updated'), 'success'); knCurrentPath = ''; loadKnowledge(); })
        .catch(function () { go.disabled = false; showToast(t('knowledge.updateError'), 'error'); });
    });
  }

  function knNewGuidance() {
    var modal = wsxModal(t('knowledge.gNew'), '<label class="wsx-cat__hint" for="knGName">' + esc(t('knowledge.gNameLabel')) + '</label>'
      + '<input class="wsx-cat__search wsx-kn2__gname" id="knGName" type="text" autocomplete="off" placeholder="voice.md">'
      + '<div class="wsx-kn2__ginvalid" id="knGNameErr" style="display:none">' + esc(t('knowledge.gNameInvalid')) + '</div>'
      + '<div class="wsx-kn__controls"><button class="so-c-btn so-c-btn--primary" id="knGCreate" type="button">' + esc(t('knowledge.gNew')) + '</button>'
      + '<button class="so-c-btn" id="knGCancel2" type="button">' + esc(t('knowledge.cancel')) + '</button></div>');
    modal.body.querySelector('#knGCancel2').addEventListener('click', modal.close);
    modal.body.querySelector('#knGCreate').addEventListener('click', function () {
      var inp = modal.body.querySelector('#knGName'), err = modal.body.querySelector('#knGNameErr');
      var name = (inp.value || '').trim().toLowerCase();
      if (name.length > 64 || !/^[a-z0-9][a-z0-9._-]*\\.md$/.test(name)) { err.style.display = 'block'; return; }
      err.style.display = 'none';
      var go = modal.body.querySelector('#knGCreate'); go.disabled = true;
      knGuidancePut(name, t('knowledge.gStarter').replace('{name}', name.replace(/\\.md$/, '')) + '\\n')
        .then(function () { modal.close(); showToast(t('knowledge.updated'), 'success'); knCurrentPath = 'guidance/' + name; loadKnowledge(); })
        .catch(function () { go.disabled = false; showToast(t('knowledge.updateError'), 'error'); });
    });
  }

`;
