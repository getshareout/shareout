/**
 * Cmd/Ctrl+K command palette + inline quick-jump dropdown for the workspace shell.
 * Both hit the same ranked endpoint (/v1/home/quick-search); the palette adds an
 * Actions group (navigate lenses, new page) resolved client-side, and renders rich
 * rows — artifact preview thumbnails, owner avatars, view counts, and status pills —
 * across pages, folders, datasets, connectors, people, schedules, crew and alerts.
 * Depends on helpers already in the shared IIFE: esc, t, openView, openArtifact.
 */
export const workspace_client_command_palette_JS = `
  // ===== Cmd+K command palette + inline quick-jump =====
  (function () {
    var wsq = window.WSX_WS ? '&workspace=' + encodeURIComponent(window.WSX_WS) : '';
    var SEARCH_ICONS = {
      artifact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
      folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>',
      dataset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>',
      connector: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0Z"/><path d="M12 18v4"/></svg>',
      person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      schedule: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      crew: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M8 2h8"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/></svg>',
      alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
      action: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>'
    };
    var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';

    function initials(s) { var p = (s || '').trim().split(/\\s+/); return ((p[0] || '')[0] || '') + (p.length > 1 ? (p[p.length - 1][0] || '') : ''); }
    function fmtViews(n) { n = n || 0; if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\\.0$/, '') + 'm'; if (n >= 1000) return (n / 1000).toFixed(1).replace(/\\.0$/, '') + 'k'; return String(n); }

    // ---- local fuzzy for the client-resolved Actions group (mirror of server tiers) ----
    function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/\\s+/g, ' ').trim(); }
    function localScore(q, text) {
      var nq = norm(q), nt = norm(text);
      if (!nq) return 0.001;
      if (nt === nq) return 1; if (nt.indexOf(nq) === 0) return 0.9;
      var i = nt.indexOf(nq); if (i >= 0) return 0.7;
      var ti = 0, ok = true; // subsequence
      for (var k = 0; k < nq.length; k++) { if (nq[k] === ' ') continue; var f = nt.indexOf(nq[k], ti); if (f < 0) { ok = false; break; } ti = f + 1; }
      return ok ? 0.3 : 0;
    }

    // ---- Actions: navigate a lens, or create. Only offer lenses that exist. ----
    function buildActions() {
      var acts = [];
      if (document.getElementById('wsxCreateBtn')) acts.push({ label: t('palette.newPage') || 'New page with AI', run: function () { var b = document.getElementById('wsxCreateBtn'); if (b) b.click(); } });
      var rail = document.querySelectorAll('[data-lens]');
      rail.forEach(function (el) {
        var key = el.getAttribute('data-lens'); if (!key) return;
        var name = (el.textContent || key).trim();
        acts.push({ label: (t('palette.goTo') || 'Go to') + ' ' + name, run: function () { closePalette(); openView(key); } });
      });
      return acts;
    }

    // ---- open a hit the way the studio does: in-app tab for pages, right lens otherwise ----
    var LENS_FOR = { schedule: 'schedules', crew: 'crew', alert: 'alerts', person: 'admin', dataset: 'datasets', connector: 'connectors' };
    function openHit(h) {
      closePalette();
      if (h.kind === 'artifact') {
        if (typeof openArtifact === 'function' && h.slug) { try { openArtifact(h.slug, h.title || null, h.id || ''); return; } catch (e) {} }
        if (h.slug) location.href = '/a/' + h.slug + '/';
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
        '<span class="wsx-cmdk__tile wsx-cmdk__tile--ask">' + SEARCH_ICONS.action + '</span>' +
        '<span class="wsx-cmdk__txt"><span class="wsx-cmdk__ttl">' + esc(t('palette.askAction') || 'Ask your workspace') + '</span><span class="wsx-cmdk__sub">' + esc(q) + '</span></span></button>';
    }

    // ---- shared fetch with in-memory cache + prefetch ----
    // Cache lets the palette/dropdown paint instantly on open; the network refresh
    // still runs and re-invokes cb, so results stay live. Recents are prewarmed at idle.
    var cache = {};
    function ckey(q, groups) { return (groups || '*') + '::' + (q || ''); }
    function fetchResults(q, groups, cb) {
      var k = ckey(q, groups);
      if (cache[k]) { cb(cache[k]); } // instant first paint
      var gq = groups ? '&groups=' + encodeURIComponent(groups) : '';
      fetch('/v1/home/quick-search?q=' + encodeURIComponent(q) + wsq + gq + '&limit=6', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) { cache[k] = d; cb(d); })
        .catch(function () { if (!cache[k]) cb(null); });
    }
    function collectHits(data, groups) {
      if (!data) return [];
      var out = [];
      (groups || 'artifacts,folders,datasets,connectors,people,schedules,crew,alerts').split(',').forEach(function (g) {
        var arr = data[g.trim()]; if (arr && arr.length) out = out.concat(arr);
      });
      return out;
    }
    var warmed = {};
    function prewarm(groups) { var g = groups || '*'; if (warmed[g]) return; warmed[g] = true; fetchResults('', groups || null, function () {}); }
    if ('requestIdleCallback' in window) requestIdleCallback(function () { prewarm(); }, { timeout: 1500 }); else setTimeout(function () { prewarm(); }, 600);

    // =================== PALETTE ===================
    var pal = null, palInput = null, palList = null, palItems = [], palSel = -1, palTmr = null, palReqId = 0;

    function closePalette() { if (pal) { pal.remove(); pal = null; palItems = []; palSel = -1; } }
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
      palInput.addEventListener('input', function () { schedulePalette(palInput.value); });
      palInput.addEventListener('keydown', paletteKeys);
      palInput.focus();
      schedulePalette('');
    }
    function schedulePalette(q) {
      clearTimeout(palTmr);
      var run = function () { runPalette(q); };
      palTmr = setTimeout(run, q ? 130 : 0);
    }
    function runPalette(q) {
      var myId = ++palReqId;
      var actions = buildActions().map(function (a) { return { s: localScore(q, a.label), a: a }; })
        .filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, q ? 5 : 3).map(function (x) { return x.a; });
      fetchResults(q, null, function (data) {
        if (myId !== palReqId || !pal) return;
        renderPalette(q, data, actions);
      });
    }
    function renderPalette(q, data, actions) {
      palItems = [];
      var html = '';
      function group(title, rows, render) { if (!rows || !rows.length) return; html += '<div class="wsx-cmdk__gtitle">' + esc(title) + '<span class="wsx-cmdk__gcount">' + rows.length + '</span></div>'; rows.forEach(render); }
      function renderActions() {
        if (!actions.length) return;
        group(t('palette.actions') || 'Actions', actions, function (a) {
          var idx = palItems.push({ action: a }) - 1;
          html += actionRowHtml(idx, a.label);
        });
      }
      function renderAsk() {
        if (!q) return;
        html += '<div class="wsx-cmdk__gtitle">' + esc(t('palette.ask') || 'Ask') + '</div>';
        var idx = palItems.push({ ask: q }) - 1;
        html += askRowHtml(idx, q);
      }
      if (/\\?\\s*$/.test(q)) { renderAsk(); renderActions(); } else { renderActions(); renderAsk(); }
      if (data) {
        pushGroup(q ? (t('palette.pages') || 'Pages') : (t('palette.recent') || 'Recent'), data.artifacts, 'artifact');
        pushGroup(t('palette.folders') || 'Folders', data.folders, 'folder');
        pushGroup(t('palette.datasets') || 'Datasets', data.datasets, 'dataset');
        pushGroup(t('palette.connectors') || 'Connectors', data.connectors, 'connector');
        pushGroup(t('palette.people') || 'People', data.people, 'person');
        pushGroup(t('palette.schedules') || 'Schedules', data.schedules, 'schedule');
        pushGroup(t('palette.crew') || 'Crew', data.crew, 'crew');
        pushGroup(t('palette.alerts') || 'Alerts', data.alerts, 'alert');
      }
      function pushGroup(title, rows, kind) {
        group(title, rows, function (h) { h.kind = kind; var idx = palItems.push({ hit: h }) - 1; html += hitRowHtml(idx, h); });
      }
      if (!palItems.length) html = '<div class="wsx-cmdk__empty">' + esc(q ? ((t('palette.noMatch') || 'No matches for') + ' \\u201c' + q + '\\u201d') : (t('palette.typeToSearch') || 'Type to search\\u2026')) + '</div>';
      palList.innerHTML = html;
      palSel = palItems.length ? 0 : -1;
      syncPaletteSel();
      palList.querySelectorAll('[data-pi]').forEach(function (el) {
        el.addEventListener('click', function () { activatePalette(parseInt(el.getAttribute('data-pi'), 10)); });
        el.addEventListener('mousemove', function () { palSel = parseInt(el.getAttribute('data-pi'), 10); syncPaletteSel(); });
      });
    }
    function syncPaletteSel() {
      var els = palList.querySelectorAll('[data-pi]');
      els.forEach(function (el) { var on = parseInt(el.getAttribute('data-pi'), 10) === palSel; el.classList.toggle('is-sel', on); if (on) el.scrollIntoView({ block: 'nearest' }); });
    }
    function activatePalette(idx) {
      var it = palItems[idx]; if (!it) return;
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
        cites.forEach(function (c, i) { h += '<button type="button" class="wsx-cmdk__cite" data-ci="' + i + '"><span class="wsx-cmdk__cite-n">' + (i + 1) + '</span><span class="wsx-cmdk__cite-t">' + esc(c.title || 'Untitled') + '</span></button>'; });
        h += '</div>';
      }
      h += '</div>';
      palList.innerHTML = h;
      palList.querySelectorAll('[data-ci]').forEach(function (el) { el.addEventListener('click', function () { openCitation(cites[parseInt(el.getAttribute('data-ci'), 10)]); }); });
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
    }

    // global hotkey
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (pal) closePalette(); else openPalette(); }
    });
    // let the header search icon (if present) open the palette
    var hdrSearch = document.getElementById('wsxOpenSearch');
    if (hdrSearch) { hdrSearch.addEventListener('mouseenter', function () { prewarm(); }); hdrSearch.addEventListener('click', function () { openPalette(); }); }
    window.openCommandPalette = openPalette;

    // =================== PER-LENS QUICK SEARCH (every .wsx-qsearch__inp) ===================
    // One binding per lens input; groups scoped by data-qs-groups so each lens searches
    // only its own entity type. Results are the same ranked hits as the palette, shown as
    // a jump-dropdown; clicking opens the page as a tab or routes to the lens.
    function bindQuickSearch(inp) {
      var groups = inp.getAttribute('data-qs-groups') || 'artifacts';
      var wrap = inp.closest('.wsx-qsearch') || inp.parentNode;
      var dd = null, items = [], sel = -1, tmr = null, reqId = 0;
      function close() { if (dd) { dd.remove(); dd = null; items = []; sel = -1; } }
      function sync() { if (!dd) return; dd.querySelectorAll('[data-di]').forEach(function (el) { el.classList.toggle('is-sel', parseInt(el.getAttribute('data-di'), 10) === sel); }); }
      function open(q) {
        var myId = ++reqId;
        fetchResults(q, groups, function (data) {
          if (myId !== reqId || document.activeElement !== inp) return;
          var rows = collectHits(data, groups);
          if (!rows.length) { close(); return; }
          if (!dd) { dd = document.createElement('div'); dd.className = 'wsx-qsearch__dd'; wrap.appendChild(dd); }
          items = rows; sel = 0;
          dd.innerHTML = rows.map(function (h, i) { return hitRowHtml(i, h).replace('data-pi=', 'data-di='); }).join('');
          dd.querySelectorAll('[data-di]').forEach(function (el) {
            el.addEventListener('mousedown', function (ev) { ev.preventDefault(); var h = items[parseInt(el.getAttribute('data-di'), 10)]; close(); openHit(h); });
            el.addEventListener('mousemove', function () { sel = parseInt(el.getAttribute('data-di'), 10); sync(); });
          });
        });
      }
      inp.addEventListener('focus', function () { prewarm(groups); });
      inp.addEventListener('input', function () {
        var q = inp.value.trim(); clearTimeout(tmr);
        if (!q) { close(); return; }
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
