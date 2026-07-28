/** Rail navigation, artifact browser filters, and folder drill-in. */
export const workspace_client_home_views_artifactsBrowser_JS = `  // ===== rail nav → Home pane views =====
  var views = homePane.querySelectorAll('.wsx__view');
  function show(view) { views.forEach(function (v) { v.classList.toggle('is-active', v.getAttribute('data-view') === view); }); }
  var wsq = window.WSX_WS ? '&workspace=' + encodeURIComponent(window.WSX_WS) : '';

  // All Artifacts: filterable grid (Recent / Favorites / Shared with me / Mine).
  // Cache each filter's payload on first fetch so re-selecting is instant (no reload);
  // prefetch the rest in the background after the first paint.
  var artFilter = 'recent';
  var curFolder = '';        // '' = root; otherwise the open folder id
  var curFolderName = '';
  var artSearch = '';        // '' = no filter; otherwise a client-side substring filter over the loaded cards/rows (name + tags)
  var ART_URL = { recent: '/v1/home/browser?sort=recent', favorites: '/v1/home/browser?scope=favorites', shared: '/v1/home/browser?scope=shared', mine: '/v1/home/browser?scope=owned' };
  var artCache = {};
  var artPending = {};
  function artKey(f, fld) { return f + '|' + (fld == null ? curFolder : fld); }
  function artUrl(f, fld) { var fo = (fld == null ? curFolder : fld); return ART_URL[f] + wsq + (fo ? '&folder=' + encodeURIComponent(fo) : ''); }
  function folderApiBase() { return window.WSX_WS ? '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/folders' : '/v1/folders'; }
  function newFolderBtn() { return '<button type="button" class="wsx-folder-new" onclick="newFolder(this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg><span>' + esc(t('artifacts.newFolder')) + '</span></button>'; }
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }
  // Root-to-current breadcrumb (arbitrary depth via parent_id); every ancestor
  // but the last is a clickable crumb (data-attr + getAttribute avoids quoting
  // user-controlled names into the onclick JS string).
  function folderCrumbs(d) {
    if (!curFolder) return '';
    var path = (d && d.folderPath && d.folderPath.length) ? d.folderPath : [{ id: curFolder, name: curFolderName || (d && d.folderName) || t('artifacts.folderDefault') }];
    var q = "'";
    var out = '<nav class="folders-breadcrumb"><button type="button" class="crumb-root" onclick="exitFolder()">' + esc(t('artifacts.crumbAll')) + '</button>';
    path.forEach(function (p, i) {
      out += '<span class="crumb-sep">\\u203a</span>';
      out += (i === path.length - 1)
        ? '<span class="crumb-current">' + esc(p.name) + '</span>'
        : '<button type="button" class="crumb-mid" data-nm="' + escAttr(p.name) + '" onclick="enterFolder(' + q + p.id + q + ',this.getAttribute(' + q + 'data-nm' + q + '))">' + esc(p.name) + '</button>';
    });
    return out + '</nav>';
  }
  var PENCIL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  var GUIDE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  // Folder guide (README): a markdown instruction surface shown at the top of a folder.
  // Human-readable and agent-readable — agents building into this folder read it first.
  // Only rendered inside a folder; managers get an edit affordance / empty-state CTA.
  function folderGuide(d) {
    if (!curFolder) return '';
    var html = d && d.folderReadmeHtml;
    var canManage = !!(d && d.canManageFolders);
    if (!html && !canManage) return '';
    if (!html) {
      return '<button type="button" class="wsx-fguide wsx-fguide--empty" onclick="editFolderReadme()">' + GUIDE_SVG + '<span class="wsx-fguide__cta"><strong>' + esc(t('artifacts.addGuide')) + '</strong><em>' + esc(t('artifacts.guideHint')) + '</em></span></button>';
    }
    var edit = canManage ? '<button type="button" class="wsx-fguide__edit" onclick="editFolderReadme()" title="' + escAttr(t('artifacts.editGuide')) + '" aria-label="' + escAttr(t('artifacts.editGuide')) + '">' + PENCIL_SVG + '</button>' : '';
    return '<section class="wsx-fguide"><div class="wsx-fguide__head">' + GUIDE_SVG + '<span class="wsx-fguide__label">' + esc(t('artifacts.guideLabel')) + '</span>' + edit + '</div><div class="wsx-fguide__body">' + html + '</div></section>';
  }
  function folderHead(d) {
    var crumbs = folderCrumbs(d);
    var guide = folderGuide(d);
    // Subfolders render the same "Folders" section whether at root or drilled in;
    // nesting repeats root behaviour, so managers get New folder / rename / delete at any depth.
    var hasFolders = !!(d && d.foldersHtml);
    var canManage = !!(d && d.canManageFolders);
    if (!hasFolders && !canManage) return crumbs + guide;
    var head = crumbs + guide + '<section class="wsx-folders-sec"><div class="wsx-sec-row"><span class="wsx-sec-label">' + esc(t('artifacts.foldersLabel')) + '</span>' + (canManage ? newFolderBtn() : '') + '</div>';
    head += '<div class="wsx-folder-grid">' + ((d && d.foldersHtml) || '') + '</div></section>';
    if (hasFolders) head += '<div class="wsx-sec-label wsx-sec-label--pages">' + esc(t('artifacts.pagesLabel')) + '</div>';
    return head;
  }
  function applyArt(f) {
    var d = artCache[artKey(f)]; if (!d) return;
    var empty = curFolder ? t('artifacts.folderEmpty') : t('artifacts.nothingHere');
    ART_DATA['wsxArtMount'] = { cardsHtml: d.cardsHtml, rowsHtml: d.rowsHtml, count: d.count, empty: empty, folderHead: folderHead(d) };
    renderArtView('wsxArtMount');
  }
  function fetchArt(f, cb, fld) {
    var k = artKey(f, fld);
    if (!artPending[k]) {
      artPending[k] = fetch(artUrl(f, fld), { credentials: 'same-origin' }).then(function (r) { return r.json(); })
        .then(function (d) { artCache[k] = { cardsHtml: d && d.cardsHtml, rowsHtml: d && d.rowsHtml, count: (d && d.cardsHtml) ? 1 : 0, foldersHtml: d && d.foldersHtml, folderName: d && d.folderName, folderPath: d && d.folderPath, canManageFolders: d && d.canManageFolders, folderReadme: d && d.folderReadme, folderReadmeHtml: d && d.folderReadmeHtml }; })
        .catch(function () {})
        .then(function () { delete artPending[k]; });
    }
    return cb ? artPending[k].then(cb) : artPending[k];
  }
  // After the root payload lands, prefetch each folder's contents during idle so
  // drilling into a folder is instant (caps the fan-out to avoid a query storm).
  function warmFolders() {
    var d = artCache[artKey('recent', '')]; if (!d || !d.foldersHtml) return;
    var tmp = document.createElement('div'); tmp.innerHTML = d.foldersHtml;
    var els = tmp.querySelectorAll('[data-folder-id]'); var n = 0;
    els.forEach(function (el) {
      if (n >= 16) return;
      var id = el.getAttribute('data-folder-id');
      if (id && !artCache[artKey('recent', id)]) { n++; fetchArt('recent', null, id); }
    });
  }
  function loadArtifacts() {
    if (artCache[artKey(artFilter)]) { applyArt(artFilter); return; }
    var m = document.getElementById('wsxArtMount'); m.innerHTML = i18nLoad();
    fetchArt(artFilter, function () {
      if (artCache[artKey(artFilter)]) applyArt(artFilter); else m.innerHTML = i18nEmpty('common.couldNotLoad');
      // warm the other root filters once so chip switches are instant (skip while searching)
      if (!curFolder) ['recent', 'favorites', 'shared', 'mine'].forEach(function (f) { if (!artCache[artKey(f)]) fetchArt(f); });
    });
  }
  // Silent refresh after a folder mutation: refetch the active view and swap it
  // in place (no i18nLoad spinner), so creating/renaming/deleting a folder never
  // flashes the whole pane as if the page reloaded.
  function reloadFolders() { artCache = {}; var k = artKey(artFilter); fetchArt(artFilter, function () { if (artCache[k]) applyArt(artFilter); }); }
  ws.querySelectorAll('[data-art-filter]').forEach(function (c) {
    c.addEventListener('click', function () {
      ws.querySelectorAll('[data-art-filter]').forEach(function (x) { x.classList.remove('is-on'); });
      c.classList.add('is-on'); artFilter = c.getAttribute('data-art-filter'); curFolder = ''; curFolderName = ''; loadArtifacts();
    });
  });
  // Filter box: pure client-side substring match over the cards/rows already in the
  // grid (name + tags). No network, no spinner, no dropdown — just toggle 'hidden'.
  function applyArtFilter() {
    var m = document.getElementById('wsxArtMount'); if (!m) return;
    var q = artSearch;
    var els = m.querySelectorAll('.artifact-card, .wsx-tr');
    var shown = 0;
    els.forEach(function (el) {
      var hit = !q || (el.getAttribute('data-name') || '').toLowerCase().indexOf(q) >= 0 || (el.getAttribute('data-tags') || '').toLowerCase().indexOf(q) >= 0;
      el.hidden = !hit; if (hit) shown++;
    });
    var note = m.querySelector('.wsx-art-nomatch');
    if (q && els.length && !shown) {
      if (!note) { note = document.createElement('div'); note.className = 'wsx-empty wsx-art-nomatch'; m.appendChild(note); }
      note.textContent = t('artifacts.searchNoMatch').replace('{q}', artSearch);
    } else if (note) { note.remove(); }
  }
  // Localize the server's English fallback count ("3 artifacts") into the active
  // language from data-count. Runs after every grid render (see observer below).
  function localizeFolderCounts(root) {
    (root || document).querySelectorAll('.wsx-folder-card__count[data-count]').forEach(function (el) {
      var n = parseInt(el.getAttribute('data-count'), 10) || 0;
      el.textContent = (n === 1 ? t('artifacts.folderCountOne') : t('artifacts.folderCountMany')).replace('{n}', n);
    });
  }
  (function () {
    var inp = document.getElementById('wsxArtSearch');
    if (inp) {
      inp.addEventListener('input', function () { artSearch = inp.value.trim().toLowerCase(); applyArtFilter(); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Escape' && inp.value) { inp.value = ''; artSearch = ''; applyArtFilter(); } });
    }
    // Re-apply the filter + localize folder counts after every grid re-render (chip
    // switch, folder drill, tile/table toggle). Disconnect during our own DOM writes
    // so the observer can't loop on them.
    var m = document.getElementById('wsxArtMount');
    if (m && window.MutationObserver) {
      var obs = new MutationObserver(function () { obs.disconnect(); localizeFolderCounts(m); if (artSearch) applyArtFilter(); obs.observe(m, { childList: true, subtree: true }); });
      obs.observe(m, { childList: true, subtree: true });
    }
  })();
  // Warm the default Artifacts payload during idle so the first rail click is instant
  // (a click before this lands coalesces onto the same in-flight fetch via artPending).
  (function () {
    var warm = function () {
      if (artCache[artKey('recent', '')]) { warmFolders(); return; }
      fetchArt('recent', warmFolders);
    };
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 2500 }); else setTimeout(warm, 800);
  })();
  // ===== folder navigation + management (Drive-style drill-in) =====
  window.enterFolder = function (id, name) { curFolder = id; curFolderName = name || ''; loadArtifacts(); };
  window.exitFolder = function () { curFolder = ''; curFolderName = ''; loadArtifacts(); };
  function folderNameModal(title, initial, action, go) {
    var mo = wsxModal(title, '<div class="wsx-cform">' + fld(t('artifacts.folderNameLabel'), 'fld_name', t('artifacts.folderNamePh')) + '<div class="wsx-cform__err" id="fld_err"></div><div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="fld_go" type="button">' + esc(action) + '</button></div></div>');
    var inp = document.getElementById('fld_name'); if (inp) { inp.value = initial || ''; inp.focus(); if (initial) inp.select(); }
    function submit() {
      var nm = cv('fld_name'); var err = document.getElementById('fld_err');
      if (!nm) { err.textContent = t('artifacts.nameRequired'); return; }
      var b = document.getElementById('fld_go'); b.disabled = true;
      go(nm, function (msg) { b.disabled = false; err.textContent = msg; }, mo);
    }
    document.getElementById('fld_go').addEventListener('click', submit);
    if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }
  // Inline create: the "+" swaps to a text field right in the Folders row —
  // type a name, Enter creates, Escape/empty-blur cancels. No modal, no reload.
  window.newFolder = function (btn) {
    var row = btn && btn.closest ? btn.closest('.wsx-sec-row') : null; if (!row) return;
    var open = row.querySelector('.wsx-folder-newin');
    if (open) { open.querySelector('input').focus(); return; }
    btn.style.display = 'none';
    var wrap = document.createElement('span'); wrap.className = 'wsx-folder-newin';
    var inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 80;
    inp.placeholder = t('artifacts.folderNamePh'); wrap.appendChild(inp);
    row.appendChild(wrap); inp.focus();
    var done = false;
    function cleanup() { if (done) return; done = true; wrap.remove(); btn.style.display = ''; }
    function submit() {
      var nm = inp.value.trim(); if (!nm) { cleanup(); return; }
      inp.disabled = true;
      fetch(folderApiBase(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm, parent_id: curFolder || undefined }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) { if (!res.ok) { inp.disabled = false; showToast((res.j && res.j.error) || t('artifacts.couldNotCreate'), 'error'); inp.focus(); return; } cleanup(); reloadFolders(); })
        .catch(function () { inp.disabled = false; showToast(t('modal.networkError'), 'error'); inp.focus(); });
    }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } else if (e.key === 'Escape') cleanup(); });
    inp.addEventListener('blur', function () { if (!inp.value.trim()) cleanup(); });
  };
  // ===== drag an artifact card onto a folder card (or the breadcrumb root) to move it =====
  // Delegated on homePane so it survives every grid re-render. moveArtifactsToFolder
  // is hoisted from the card-actions fragment (same IIFE); the breadcrumb root drops
  // to the workspace root (folder_id null).
  (function () {
    var dragId = null;
    function clearDrop() { homePane.querySelectorAll('.wsx-folder-card.drag-over,.crumb-root.drag-over').forEach(function (el) { el.classList.remove('drag-over'); }); }
    function dropEl(e) { return e.target && e.target.closest ? e.target.closest('.wsx-folder-card[data-folder-id],.crumb-root') : null; }
    homePane.addEventListener('dragstart', function (e) {
      var card = e.target.closest ? e.target.closest('.artifact-card[draggable="true"]') : null; if (!card) return;
      dragId = card.getAttribute('data-id'); card.classList.add('is-dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } catch (_) {}
    });
    homePane.addEventListener('dragend', function () { homePane.querySelectorAll('.artifact-card.is-dragging').forEach(function (c) { c.classList.remove('is-dragging'); }); dragId = null; clearDrop(); });
    homePane.addEventListener('dragover', function (e) { if (!dragId) return; var el = dropEl(e); if (!el) return; e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (_) {} if (!el.classList.contains('drag-over')) { clearDrop(); el.classList.add('drag-over'); } });
    homePane.addEventListener('dragleave', function (e) { var el = dropEl(e); if (el && !el.contains(e.relatedTarget)) el.classList.remove('drag-over'); });
    homePane.addEventListener('drop', function (e) { if (!dragId) return; var el = dropEl(e); if (!el) return; e.preventDefault(); var fid = el.getAttribute('data-folder-id') || null; var id = dragId; dragId = null; clearDrop(); moveArtifactsToFolder([id], fid, { close: function () {} }); });
  })();
  window.renameFolder = function (id, name) {
    folderNameModal(t('artifacts.renameFolder'), name || '', t('common.save'), function (nm, fail, mo) {
      fetch(folderApiBase() + '/' + encodeURIComponent(id), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) { if (!res.ok) { fail((res.j && res.j.error) || t('artifacts.couldNotRename')); return; } if (curFolder === id) curFolderName = nm; mo.close(); reloadFolders(); })
        .catch(function () { fail(t('modal.networkError')); });
    });
  };
  window.deleteFolder = function (id, name) {
    var mo = wsxModal(t('artifacts.deleteFolder'), '<div class="wsx-cform"><p class="wsx-field__note">' + esc(t('artifacts.deleteBody').replace('{name}', name || t('artifacts.thisFolder'))) + '</p><div class="wsx-cform__err" id="fld_err"></div><div class="wsx-cform__foot"><button class="wsx-abtn" id="fld_cancel" type="button">' + esc(t('artifacts.cancel')) + '</button><button class="wsx-abtn danger" id="fld_go" type="button">' + esc(t('artifacts.deleteFolder')) + '</button></div></div>');
    document.getElementById('fld_cancel').addEventListener('click', function () { mo.close(); });
    document.getElementById('fld_go').addEventListener('click', function () {
      var b = this; b.disabled = true; var err = document.getElementById('fld_err');
      fetch(folderApiBase() + '/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : r.json().then(function (j) { throw j; }); })
        .then(function () { mo.close(); if (curFolder === id) { curFolder = ''; curFolderName = ''; } reloadFolders(); })
        .catch(function (j) { b.disabled = false; err.textContent = (j && j.error) || t('artifacts.couldNotDelete'); });
    });
  };
  // Edit the current folder's guide (README markdown). PATCHes the folder, then a silent
  // reload re-renders the guide panel. Manager-gated at the API (owner/admin or owner).
  window.editFolderReadme = function () {
    if (!curFolder) return;
    var d = artCache[artKey(artFilter)];
    var cur = (d && d.folderReadme) || '';
    var mo = wsxModal(t('artifacts.guideTitle'), '<div class="wsx-cform"><p class="wsx-field__note">' + esc(t('artifacts.guideModalHint')) + '</p><textarea class="wsx-fguide__ta" id="fg_txt" rows="14" spellcheck="false" placeholder="' + escAttr(t('artifacts.guidePh')) + '"></textarea><div class="wsx-cform__err" id="fg_err"></div><div class="wsx-cform__foot"><button class="wsx-abtn" id="fg_cancel" type="button">' + esc(t('artifacts.cancel')) + '</button><button class="wsx-abtn wsx-abtn--primary" id="fg_go" type="button">' + esc(t('common.save')) + '</button></div></div>');
    var ta = document.getElementById('fg_txt'); if (ta) { ta.value = cur; ta.focus(); }
    document.getElementById('fg_cancel').addEventListener('click', function () { mo.close(); });
    document.getElementById('fg_go').addEventListener('click', function () {
      var b = this; b.disabled = true; var err = document.getElementById('fg_err');
      fetch(folderApiBase() + '/' + encodeURIComponent(curFolder), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readme: ta ? ta.value : '' }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) { if (!res.ok) { b.disabled = false; err.textContent = (res.j && res.j.error) || t('artifacts.couldNotSaveGuide'); return; } mo.close(); reloadFolders(); })
        .catch(function () { b.disabled = false; err.textContent = t('modal.networkError'); });
    });
  };

`;
