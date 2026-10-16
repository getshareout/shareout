/**
 * Cmd/Ctrl+K command palette + inline quick-jump dropdown for the workspace shell.
 *
 * Two sections, so typing never waits on the network:
 *  - instant: pages, folders, people, actions and lenses ranked in the browser from the
 *    search index (search-store.ts + search-engine.ts), synchronously on every keystroke;
 *  - deep: page text, Knowledge passages and the other groups from /v1/home/deep-search,
 *    debounced, stale requests aborted, filled in below when the answer arrives.
 * Until the index has loaded once, the instant section falls back to /v1/home/quick-search.
 * An empty query shows recent searches (remembered on a pick or Enter) and recently
 * opened pages. Depends on helpers already in the shared IIFE: esc, t, openView,
 * openArtifact, wsxSearch, wsxSearchStore.
 */
export const workspace_client_command_palette_JS = `
  // ===== Cmd+K command palette + inline quick-jump =====
  (function () {
    var SEARCH_ICONS = {
      artifact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
      folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>',
      dataset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>',
      connector: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0Z"/><path d="M12 18v4"/></svg>',
      person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      schedule: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      crew: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M8 2h8"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/></svg>',
      alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
      action: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
      ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>'
    };
    var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';

    SEARCH_ICONS.skill = SEARCH_ICONS.ask;
    SEARCH_ICONS.passage = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';
    SEARCH_ICONS.recent = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>';
    var XMARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    var store = wsxSearchStore;

    function initials(s) { var p = (s || '').trim().split(/\\s+/); return ((p[0] || '')[0] || '') + (p.length > 1 ? (p[p.length - 1][0] || '') : ''); }
    function fmtViews(n) { n = n || 0; if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\\.0$/, '') + 'm'; if (n >= 1000) return (n / 1000).toFixed(1).replace(/\\.0$/, '') + 'k'; return String(n); }

    // ---- Actions: navigate a lens, or create. Only offer lenses that exist. ----
    function buildActions() {
      var acts = [];
      if (document.getElementById('wsxCreateBtn')) acts.push({ label: t('palette.newPage') || 'New page with AI', run: function () { var b = document.getElementById('wsxCreateBtn'); if (b) b.click(); } });
      if (window.WSX_ADMIN && window.WSX_WS) acts.push({ label: t('invite.cta'), run: function () { closePalette(); wsxInvite(); } });
      var rail = document.querySelectorAll('[data-lens]');
      rail.forEach(function (el) {
        var key = el.getAttribute('data-lens'); if (!key) return;
        var name = (el.textContent || key).trim();
        acts.push({ label: (t('palette.goTo') || 'Go to') + ' ' + name, run: function () { closePalette(); openView(key); } });
      });
      return acts.map(function (a) { a._n = wsxSearch.fold(a.label); return a; });
    }

    // ---- open a hit the way the studio does: in-app tab for pages, right lens otherwise ----
    var LENS_FOR = { schedule: 'schedules', crew: 'crew', alert: 'alerts', person: 'admin', dataset: 'datasets', connector: 'connectors', skill: 'library' };
    function openHit(h) {
      closePalette();
      if (h.kind === 'artifact') {
        store.noteOpened(h.id);
        if (typeof openArtifact === 'function' && h.slug) { try { openArtifact(h.slug, h.title || null, h.id || ''); return; } catch (e) {} }
        if (h.slug) location.href = '/a/' + h.slug + '/';
      } else if (h.kind === 'passage') {
        if (h.url) location.href = h.url;
      } else if (h.kind === 'folder') {
        openView('artifacts'); if (window.enterFolder) window.enterFolder(h.id, h.title);
      } else if (LENS_FOR[h.kind]) { openView(LENS_FOR[h.kind]); }
    }

    // ---- rich row pieces (shared by palette + inline dropdown) ----
    function leadVisual(h) {
      if (h.kind === 'artifact' && h.thumb) {
        return '<span class="wsx-cmdk__thumb"><img src="' + esc(h.thumb) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add(\\'is-empty\\');this.remove()">' +
          '<span class="wsx-cmdk__thumbfb">' + SEARCH_ICONS.artifact + '</span></span>';
      }
      if (h.kind === 'person') {
        var inner = h.avatar ? '<img src="' + esc(h.avatar) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()">' : esc(initials(h.title) || '?');
        return '<span class="wsx-cmdk__ava">' + inner + '</span>';
      }
      return '<span class="wsx-cmdk__tile wsx-cmdk__tile--' + h.kind + '">' + (SEARCH_ICONS[h.kind] || SEARCH_ICONS.artifact) + '</span>';
    }
    function trailMeta(h) {
      var out = '';
      if (h.badge) out += '<span class="wsx-cmdk__pill wsx-cmdk__pill--' + esc(String(h.badge).toLowerCase()) + '">' + esc(h.badge) + '</span>';
      if (h.kind === 'artifact' && h.views) out += '<span class="wsx-cmdk__views">' + EYE + fmtViews(h.views) + '</span>';
      if (h.kind === 'artifact' && h.avatar) out += '<span class="wsx-cmdk__own" title="' + esc(h.owner || '') + '"><img src="' + esc(h.avatar) + '" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></span>';
      return out ? '<span class="wsx-cmdk__metar">' + out + '</span>' : '';
    }
    function hitRowHtml(idx, h) {
      return '<button type="button" class="wsx-cmdk__item wsx-cmdk__item--' + h.kind + '" role="option" data-pi="' + idx + '">' +
        leadVisual(h) +
        '<span class="wsx-cmdk__txt"><span class="wsx-cmdk__ttl">' + esc(h.title) + '</span>' + (h.subtitle ? '<span class="wsx-cmdk__sub">' + esc(h.subtitle) + '</span>' : '') + '</span>' +
        trailMeta(h) +
        '</button>';
    }
    function actionRowHtml(idx, label) {
      return '<button type="button" class="wsx-cmdk__item wsx-cmdk__item--action" role="option" data-pi="' + idx + '">' +
        '<span class="wsx-cmdk__tile wsx-cmdk__tile--action">' + SEARCH_ICONS.action + '</span>' +
        '<span class="wsx-cmdk__txt"><span class="wsx-cmdk__ttl">' + esc(label) + '</span></span></button>';
    }
    function askRowHtml(idx, q) {
      return '<button type="button" class="wsx-cmdk__item wsx-cmdk__item--ask" role="option" data-pi="' + idx + '">' +
        '<span class="wsx-cmdk__tile wsx-cmdk__tile--ask">' + SEARCH_ICONS.ask + '</span>' +
        '<span class="wsx-cmdk__txt"><span class="wsx-cmdk__ttl">' + esc((t('palette.askQuery') || 'Ask AI: “{q}”').replace('{q}', q)) + '</span></span></button>';
    }
    // A div, not a button: it holds its own remove button.
    function recentRowHtml(idx, q) {
      return '<div class="wsx-cmdk__item wsx-cmdk__item--recent" role="option" tabindex="-1" data-pi="' + idx + '">' +
        '<span class="wsx-cmdk__tile wsx-cmdk__tile--recent">' + SEARCH_ICONS.recent + '</span>' +
        '<span class="wsx-cmdk__txt"><span class="wsx-cmdk__ttl">' + esc(q) + '</span></span>' +
        '<button type="button" class="wsx-cmdk__rm" data-rm="' + idx + '" aria-label="' + esc(t('search.removeOne') || 'Remove') + '" title="' + esc(t('search.removeOne') || 'Remove') + '">' + XMARK + '</button></div>';
    }

    // ---- server search: the fallback before the index loads (and the inline dropdowns) ----
    var cache = {}, inflight = {};
    function ckey(q, groups) { return (groups || '*') + '::' + (q || ''); }
    function fetchResults(q, groups, cb) {
      var k = ckey(q, groups);
      if (cache[k]) { cb(cache[k]); }
      var gq = groups ? '&groups=' + encodeURIComponent(groups) : '';
      var wsq = window.WSX_WS ? '&workspace=' + encodeURIComponent(window.WSX_WS) : '';
      if (!inflight[k]) {
        inflight[k] = fetch('/v1/home/quick-search?q=' + encodeURIComponent(q) + wsq + gq + '&limit=6', { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (d) { cache[k] = d; delete inflight[k]; return d; }, function (e) { delete inflight[k]; throw e; });
      }
      inflight[k].then(function (d) { cb(d); }, function () { if (!cache[k]) cb(null); });
    }
    function collectHits(data, groups) {
      if (!data) return [];
      var out = [];
      (groups || 'artifacts,folders,datasets,connectors,people,schedules,crew,alerts').split(',').forEach(function (g) {
        var arr = data[g.trim()]; if (arr && arr.length) out = out.concat(arr);
      });
      return out;
    }

    // ---- local ranking: every keystroke, no network ----
    // performance.measure('wsx-search-rank') keeps the last ranking's time for DevTools; nothing is sent.
    function rankLocal(q) {
      var ix = store.index(); if (!ix) return null;
      var pm = typeof performance !== 'undefined' && performance.mark ? performance : null;
      try { if (pm) pm.mark('wsx-search-rank:start'); } catch (e) { pm = null; }
      var out = { artifacts: wsxSearch.rank(ix.artifacts, q, 6), folders: wsxSearch.rank(ix.folders, q, 4), people: wsxSearch.rank(ix.people, q, 4) };
      try { if (pm) { pm.mark('wsx-search-rank:end'); if (pm.clearMeasures) pm.clearMeasures('wsx-search-rank'); pm.measure('wsx-search-rank', 'wsx-search-rank:start', 'wsx-search-rank:end'); pm.clearMarks('wsx-search-rank:start'); pm.clearMarks('wsx-search-rank:end'); } } catch (e) {}
      return out;
    }
    function warm(network) { return store.warm(network); }

    // =================== PALETTE ===================
    var pal = null, palInput = null, palList = null, palItems = [], palSel = -1, palQ = '', palTmr = null, palReqId = 0;
    var palServer = null, deepData = null, deepPending = false, deepCtl = null, deepTmr = null, deepCache = {}, deepKeys = [];

    function closePalette() {
      clearTimeout(deepTmr); clearTimeout(palTmr);
      if (deepCtl) { try { deepCtl.abort(); } catch (e) {} deepCtl = null; }
      if (pal) { pal.remove(); pal = null; palItems = []; palSel = -1; }
    }
    function openPalette() {
      if (pal) { palInput.focus(); return; }
      pal = document.createElement('div');
      pal.className = 'wsx-cmdk';
      pal.innerHTML =
        '<div class="wsx-cmdk__scrim"></div>' +
        '<div class="wsx-cmdk__panel" role="dialog" aria-label="' + esc(t('palette.aria') || 'Search') + '">' +
        '<div class="wsx-cmdk__inputrow">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
        '<input type="text" class="wsx-cmdk__input" autocomplete="off" spellcheck="false" placeholder="' + esc(t('palette.placeholder') || 'Search pages, folders, data, people, actions\\u2026') + '">' +
        '<kbd class="wsx-cmdk__esc">esc</kbd>' +
        '</div>' +
        '<div class="wsx-cmdk__list" role="listbox"></div>' +
        '<div class="wsx-cmdk__foot"><span class="wsx-cmdk__foothint"><kbd>\\u2191</kbd><kbd>\\u2193</kbd> ' + esc(t('palette.navigate') || 'navigate') + '</span><span class="wsx-cmdk__foothint"><kbd>\\u21b5</kbd> ' + esc(t('palette.open') || 'open') + '</span><span class="wsx-cmdk__footbrand">ShareOut</span></div>' +
        '</div>';
      document.body.appendChild(pal);
      palInput = pal.querySelector('.wsx-cmdk__input');
      palList = pal.querySelector('.wsx-cmdk__list');
      pal.querySelector('.wsx-cmdk__scrim').addEventListener('click', closePalette);
      palInput.addEventListener('input', function () { onQuery(palInput.value); });
      palInput.addEventListener('keydown', paletteKeys);
      palList.addEventListener('click', onListClick);
      palList.addEventListener('mousemove', onListHover);
      palInput.focus();
      palQ = ''; palServer = null; deepData = null; deepPending = false;
      onQuery('');
      warm(true).then(function () { if (pal && !palQ) renderPalette(); });
      store.syncSearches().then(function (changed) { if (changed && pal && !palQ) renderPalette(); });
    }
    store.onChange(function () { if (pal) renderPalette(); });

    // Instant section: synchronous, on the very first keystroke. Deep section: debounced.
    function onQuery(raw) {
      palQ = String(raw || '').trim();
      palServer = null;
      renderPalette();
      if (!store.index()) {
        clearTimeout(palTmr);
        var q = palQ, myId = ++palReqId;
        // Only while the index is still loading (first visit): give the disk copy a moment.
        palTmr = setTimeout(function () {
          if (store.index()) return;
          fetchResults(q, null, function (data) { if (myId === palReqId && pal && q === palQ && !store.index()) { palServer = data; renderPalette(); } });
        }, q ? 130 : 60);
      }
      scheduleDeep(palQ);
    }
    function scheduleDeep(q) {
      clearTimeout(deepTmr);
      if (deepCtl) { try { deepCtl.abort(); } catch (e) {} deepCtl = null; }
      deepData = deepCache[q] || null;
      deepPending = false;
      if (q.length < 2 || deepData) return;
      deepPending = true;
      deepTmr = setTimeout(function () {
        var ctl = typeof AbortController === 'function' ? new AbortController() : null;
        deepCtl = ctl;
        var ix = store.index();
        var url = '/v1/home/deep-search?q=' + encodeURIComponent(q) + (window.WSX_WS ? '&workspace=' + encodeURIComponent(window.WSX_WS) : '') + (ix && ix.truncated ? '&older=1' : '') + '&limit=5';
        fetch(url, ctl ? { credentials: 'same-origin', signal: ctl.signal } : { credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (ctl !== deepCtl || !pal || q !== palQ) return; // a newer query owns the section
            deepCtl = null; deepPending = false;
            if (d) { deepCache[q] = d; deepKeys.push(q); if (deepKeys.length > 30) delete deepCache[deepKeys.shift()]; }
            deepData = d;
            renderPalette();
          }, function () { if (ctl === deepCtl && pal && q === palQ) { deepCtl = null; deepPending = false; renderPalette(); } });
      }, 150);
    }

    function itemKey(it) {
      if (it.hit) return it.hit.kind + ':' + it.hit.id;
      if (it.action) return 'a:' + it.action.label;
      if (it.recent) return 'r:' + it.recent;
      return 'ask';
    }
    function renderPalette() {
      if (!pal) return;
      var q = palQ, prevKey = palSel >= 0 && palItems[palSel] ? itemKey(palItems[palSel]) : null, wasTop = palSel <= 0;
      palItems = [];
      var html = '';
      function head(title, n, extra) { html += '<div class="wsx-cmdk__gtitle">' + esc(title) + (n ? '<span class="wsx-cmdk__gcount">' + n + '</span>' : '') + (extra || '') + '</div>'; }
      function hits(title, rows, kind) {
        if (!rows || !rows.length) return;
        head(title, rows.length);
        rows.forEach(function (h) { if (kind) h.kind = kind; var i = palItems.push({ hit: h }) - 1; html += hitRowHtml(i, h); });
      }
      var actions = buildActions();
      var ix = store.index();
      if (!q) {
        var rs = store.searches();
        if (rs.length) {
          head(t('search.recentSearches') || 'Recent searches', 0, '<button type="button" class="wsx-cmdk__clear" data-clear="1">' + esc(t('search.clearAll') || 'Clear') + '</button>');
          rs.forEach(function (r) { var i = palItems.push({ recent: r.q }) - 1; html += recentRowHtml(i, r.q); });
        }
        if (ix) hits(t('search.recentlyOpened') || 'Recently opened', store.opened(5));
        else if (palServer) hits(t('palette.recent') || 'Recent', palServer.artifacts, 'artifact');
        var acts = actions.slice(0, 3);
        if (acts.length) { head(t('palette.actions') || 'Actions', acts.length); acts.forEach(function (a) { var i = palItems.push({ action: a }) - 1; html += actionRowHtml(i, a.label); }); }
        if (!palItems.length) html = '<div class="wsx-cmdk__empty">' + esc(t('palette.typeToSearch') || 'Type to search\\u2026') + '</div>';
      } else {
        // Instant section: ranked from the local index (or the server, until it loads).
        var inst = ix ? rankLocal(q) : palServer;
        var shown = {};
        if (inst) {
          hits(t('palette.pages') || 'Pages', inst.artifacts, 'artifact');
          hits(t('palette.folders') || 'Folders', inst.folders, 'folder');
          hits(t('palette.people') || 'People', inst.people, 'person');
          if (!ix) {
            hits(t('palette.datasets') || 'Datasets', inst.datasets, 'dataset');
            hits(t('palette.connectors') || 'Connectors', inst.connectors, 'connector');
            hits(t('palette.schedules') || 'Schedules', inst.schedules, 'schedule');
            hits(t('palette.crew') || 'Crew', inst.crew, 'crew');
            hits(t('palette.alerts') || 'Alerts', inst.alerts, 'alert');
          }
          (inst.artifacts || []).forEach(function (h) { shown[h.id] = 1; });
        }
        var acts2 = wsxSearch.rank(actions, q, 5);
        if (acts2.length) { head(t('palette.actions') || 'Actions', acts2.length); acts2.forEach(function (a) { var i = palItems.push({ action: a }) - 1; html += actionRowHtml(i, a.label); }); }
        // Deep section: fills in when the server answers; never holds up the rows above.
        var d = deepData;
        if (d) {
          hits(t('search.content') || 'In page text', (d.content || []).filter(function (h) { return !shown[h.id]; }), 'artifact');
          hits(t('search.passages') || 'In Knowledge', (d.passages || []).map(function (p, n) {
            return { kind: 'passage', id: (p.artifact && p.artifact.id || '') + '#' + n, title: p.section || (p.artifact && p.artifact.title) || '', subtitle: [p.artifact && p.artifact.title, p.excerpt].filter(Boolean).join(' \\u00b7 '), url: p.url };
          }));
          if (ix) {
            hits(t('palette.datasets') || 'Datasets', d.datasets, 'dataset');
            hits(t('palette.connectors') || 'Connectors', d.connectors, 'connector');
            hits(t('palette.schedules') || 'Schedules', d.schedules, 'schedule');
            hits(t('palette.crew') || 'Crew', d.crew, 'crew');
            hits(t('palette.alerts') || 'Alerts', d.alerts, 'alert');
            hits(t('search.skills') || 'AI skills', d.skills, 'skill');
          }
        } else if (deepPending) {
          html += '<div class="wsx-cmdk__pending">' + esc(t('search.searching') || 'Searching page text\\u2026') + '</div>';
        }
        // AI is an explicit opt-in, always last.
        head(t('palette.ask') || 'Ask AI', 0);
        var ai = palItems.push({ ask: q }) - 1; html += askRowHtml(ai, q);
      }
      palList.innerHTML = html;
      palSel = palItems.length ? 0 : -1;
      if (prevKey && !wasTop) for (var k = 0; k < palItems.length; k++) if (itemKey(palItems[k]) === prevKey) { palSel = k; break; }
      syncPaletteSel();
    }
    function onListClick(e) {
      var el = e.target && e.target.closest ? e.target : null; if (!el) return;
      if (el.closest('[data-clear]')) { e.preventDefault(); store.clearSearches(); renderPalette(); palInput.focus(); return; }
      var rm = el.closest('[data-rm]');
      if (rm) { e.preventDefault(); e.stopPropagation(); removeRecent(parseInt(rm.getAttribute('data-rm'), 10)); return; }
      var row = el.closest('[data-pi]');
      if (row) activatePalette(parseInt(row.getAttribute('data-pi'), 10));
    }
    function onListHover(e) {
      var row = e.target && e.target.closest ? e.target.closest('[data-pi]') : null; if (!row) return;
      var i = parseInt(row.getAttribute('data-pi'), 10); if (i !== palSel) { palSel = i; syncPaletteSel(); }
    }
    function removeRecent(i) {
      var it = palItems[i]; if (!it || !it.recent) return;
      store.forget(it.recent);
      renderPalette(); palInput.focus();
    }
    function syncPaletteSel() {
      var els = palList.querySelectorAll('[data-pi]');
      els.forEach(function (el) { var on = parseInt(el.getAttribute('data-pi'), 10) === palSel; el.classList.toggle('is-sel', on); el.setAttribute('aria-selected', on ? 'true' : 'false'); if (on && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); });
    }
    // A search is remembered when it is used (a pick or Enter), never per keystroke.
    function activatePalette(idx) {
      var it = palItems[idx]; if (!it) return;
      if (it.recent) { palInput.value = it.recent; onQuery(it.recent); palInput.focus(); return; }
      if (palQ) store.remember(palQ);
      if (it.action) { it.action.run(); } else if (it.ask) { runAsk(it.ask); } else if (it.hit) { openHit(it.hit); }
    }

    // ---- Ask your workspace: one call to /v1/ask, then answer + citations in-panel ----
    function runAsk(q) {
      palItems = []; palSel = -1;
      palList.innerHTML = '<div class="wsx-cmdk__ask"><div class="wsx-cmdk__ask-q">' + esc(q) + '</div>' +
        '<div class="wsx-cmdk__ask-status">' + esc(t('palette.askThinking') || 'Asking your workspace\\u2026') + '</div></div>';
      fetch('/v1/ask', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, workspace: window.WSX_WS || undefined }) })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (d) { if (pal) renderAnswer(q, d); })
        .catch(function () { if (pal) palList.innerHTML = '<div class="wsx-cmdk__ask"><div class="wsx-cmdk__ask-q">' + esc(q) + '</div><div class="wsx-cmdk__ask-err">' + esc(t('palette.askError') || 'Could not answer right now. Try again.') + '</div></div>'; });
    }
    function renderAnswer(q, d) {
      var ans = (d && d.answer) ? String(d.answer) : (t('palette.askEmpty') || 'No answer found.');
      var cites = (d && d.citations) || [];
      var h = '<div class="wsx-cmdk__ask"><div class="wsx-cmdk__ask-q">' + esc(q) + '</div>' +
        '<div class="wsx-cmdk__ask-answer">' + esc(ans).replace(/\\n/g, '<br>') + '</div>';
      if (cites.length) {
        h += '<div class="wsx-cmdk__ask-cites"><div class="wsx-cmdk__ask-citehd">' + esc(t('palette.askSources') || 'Sources') + '</div>';
        cites.forEach(function (c, i) { h += '<button type="button" class="wsx-cmdk__cite" data-ci="' + i + '"><span class="wsx-cmdk__cite-n">' + (i + 1) + '</span><span class="wsx-cmdk__cite-t">' + esc(c.title || t('agent.untitled')) + '</span></button>'; });
        h += '</div>';
      }
      h += '</div>';
      palList.innerHTML = h;
      palList.querySelectorAll('[data-ci]').forEach(function (el) { el.addEventListener('click', function (e) { e.stopPropagation(); openCitation(cites[parseInt(el.getAttribute('data-ci'), 10)]); }); });
    }
    function openCitation(c) {
      if (!c) return;
      closePalette();
      var slug = String(c.url || '').replace(/^\\/a\\//, '').replace(/\\/$/, '');
      if (typeof openArtifact === 'function' && slug) { try { openArtifact(slug, c.title || null, c.artifact_id || ''); return; } catch (e) {} }
      if (c.url) location.href = c.url;
    }
    function paletteKeys(e) {
      if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (palItems.length) { palSel = (palSel + 1) % palItems.length; syncPaletteSel(); } return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (palItems.length) { palSel = (palSel - 1 + palItems.length) % palItems.length; syncPaletteSel(); } return; }
      if (e.key === 'Enter') { e.preventDefault(); if (palSel >= 0) activatePalette(palSel); return; }
      if (e.key === 'Delete' && !palQ && palItems[palSel] && palItems[palSel].recent) { e.preventDefault(); removeRecent(palSel); }
    }

    // global hotkey; a held Cmd/Ctrl warms the index from disk
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Meta' || e.key === 'Control') { warm(false); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (pal) closePalette(); else openPalette(); }
    });
    var hdrSearch = document.getElementById('wsxOpenSearch');
    if (hdrSearch) { hdrSearch.addEventListener('mouseenter', function () { warm(false); }); hdrSearch.addEventListener('click', function () { openPalette(); }); }
    window.openCommandPalette = openPalette;
    // Idle after boot: load the index from disk, or fetch it once if there is no copy yet.
    (function () {
      var go = function () { warm(false); };
      try { if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 5000 }); else setTimeout(go, 2500); } catch (e) {}
    })();

    // =================== PER-LENS QUICK SEARCH (every .wsx-qsearch__inp) ===================
    // One binding per lens input; groups scoped by data-qs-groups. Pages, folders and
    // people rank locally once the index is loaded; other groups ask the server.
    var LOCAL_GROUPS = { artifacts: 1, folders: 1, people: 1 };
    function bindQuickSearch(inp) {
      var groups = inp.getAttribute('data-qs-groups') || 'artifacts';
      var local = groups.split(',').every(function (g) { return LOCAL_GROUPS[g.trim()]; });
      var wrap = inp.closest('.wsx-qsearch') || inp.parentNode;
      var dd = null, items = [], sel = -1, tmr = null, reqId = 0;
      function close() { if (dd) { dd.remove(); dd = null; items = []; sel = -1; } }
      function sync() { if (!dd) return; dd.querySelectorAll('[data-di]').forEach(function (el) { el.classList.toggle('is-sel', parseInt(el.getAttribute('data-di'), 10) === sel); }); }
      function show(rows) {
        if (!rows.length) { close(); return; }
        if (!dd) { dd = document.createElement('div'); dd.className = 'wsx-qsearch__dd'; wrap.appendChild(dd); }
        items = rows; sel = 0;
        dd.innerHTML = rows.map(function (h, i) { return hitRowHtml(i, h).replace('data-pi=', 'data-di='); }).join('');
        dd.querySelectorAll('[data-di]').forEach(function (el) {
          el.addEventListener('mousedown', function (ev) { ev.preventDefault(); var h = items[parseInt(el.getAttribute('data-di'), 10)]; close(); openHit(h); });
          el.addEventListener('mousemove', function () { sel = parseInt(el.getAttribute('data-di'), 10); sync(); });
        });
      }
      function open(q) {
        var myId = ++reqId;
        fetchResults(q, groups, function (data) {
          if (myId !== reqId || document.activeElement !== inp) return;
          show(collectHits(data, groups));
        });
      }
      inp.addEventListener('focus', function () { warm(false); });
      inp.addEventListener('input', function () {
        var q = inp.value.trim(); clearTimeout(tmr);
        if (!q) { close(); return; }
        var ranked = local ? rankLocal(q) : null;
        if (ranked) { ++reqId; show(collectHits(ranked, groups)); return; }
        tmr = setTimeout(function () { open(q); }, 130);
      });
      inp.addEventListener('keydown', function (e) {
        if (!dd || !items.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; sync(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; sync(); }
        else if (e.key === 'Enter') { if (sel >= 0) { e.preventDefault(); var h = items[sel]; close(); openHit(h); } }
        else if (e.key === 'Escape') { close(); }
      });
      inp.addEventListener('blur', function () { setTimeout(close, 120); });
    }
    // data-qs-local inputs filter their lens client-side (see artifacts-browser) — no jump dropdown.
    document.querySelectorAll('.wsx-qsearch__inp:not([data-qs-local])').forEach(bindQuickSearch);
  })();

`;
