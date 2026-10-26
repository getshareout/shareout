/**
 * Artifact card action handlers (select, favorite, visibility, tag filter,
 * copy link, move to folder, delete) — restores the onclick targets that
 * render-cards.ts emits on every card but that got dropped when the legacy
 * catalog client scripts were deleted in favor of the workspace shell.
 */
export const workspace_client_home_views_cardActions_JS = `  // ===== artifact card actions =====
  function cardEls(id) { return document.querySelectorAll('.artifact-card[data-id="' + CSS.escape(id) + '"]'); }
  // Card + table row for one artifact (both views render it).
  function artEls(id) { return document.querySelectorAll('.artifact-card[data-id="' + CSS.escape(id) + '"], .wsx-tr[data-id="' + CSS.escape(id) + '"]'); }
  // Artifacts deleted optimistically whose DELETE hasn't landed (undo window / in flight);
  // renderArtView hides them so a background reload never flashes them back in.
  var pendingArtDeletes = {};
  function hidePendingArts(root) {
    (root || document).querySelectorAll('.artifact-card[data-id], .wsx-tr[data-id]').forEach(function (el) { if (pendingArtDeletes[el.getAttribute('data-id')]) el.style.display = 'none'; });
  }
  function showArtEls(id) { artEls(id).forEach(function (el) { el.classList.remove('so-c-leaving', 'is-removing'); el.style.display = ''; }); }

  // ── Favorite ──
  function applyFavoriteDom(id, on) {
    cardEls(id).forEach(function (card) {
      card.dataset.favorite = on ? '1' : '0';
      var btn = card.querySelector('.fav-toggle'); if (!btn) return;
      btn.classList.toggle('active', on);
      var label = on ? t('inspector.favRemove') : t('inspector.favAdd');
      btn.title = label; btn.setAttribute('aria-label', label);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var svg = btn.querySelector('svg'); if (svg) svg.setAttribute('fill', on ? 'currentColor' : 'none');
    });
    // Table rows: same state on the row and its inline star.
    document.querySelectorAll('.wsx-tr[data-id="' + CSS.escape(id) + '"]').forEach(function (row) {
      row.setAttribute('data-favorite', on ? '1' : '0');
      var st = row.querySelector('.wsx-tr__star'); if (!st) return;
      var label = on ? t('inspector.favRemove') : t('inspector.favAdd');
      st.classList.toggle('is-on', on); st.title = label; st.setAttribute('aria-label', label); st.setAttribute('aria-pressed', on ? 'true' : 'false');
      var svg = st.querySelector('svg'); if (svg) svg.setAttribute('fill', on ? 'currentColor' : 'none');
    });
  }
  window.toggleFavorite = function (id, silent) {
    var card = artEls(id)[0]; if (!card) return;
    var on = card.getAttribute('data-favorite') !== '1';
    optimistic({
      key: 'fav:' + id,
      apply: function () { applyFavoriteDom(id, on); },
      rollback: function () { applyFavoriteDom(id, !on); },
      request: function () { return fetch('/v1/artifacts/' + encodeURIComponent(id) + '/favorite', { method: on ? 'POST' : 'DELETE', credentials: 'same-origin' }); },
      success: silent ? '' : (on ? t('cards.favAdded') : t('cards.favRemoved')),
      error: t('cards.favFailed'),
    });
  };

  // ── Visibility ──
  var VIS_LOCK_ICON = '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
  var VIS_PEOPLE_ICON = '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>';
  var VIS_GLOBE_ICON = '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>';
  function applyVisibilityDom(id, vis) {
    var kind = vis === 'workspace' ? 'workspace' : (vis === 'public' || vis === 'unlisted') ? 'public' : 'private';
    var isWs = kind === 'workspace', toPrivate = kind !== 'private';
    var label = isWs ? t('cards.visWorkspace') : t('inspector.visName.' + kind);
    var icon = isWs ? VIS_PEOPLE_ICON : kind === 'public' ? VIS_GLOBE_ICON : VIS_LOCK_ICON;
    cardEls(id).forEach(function (card) {
      card.dataset.visibility = vis;
      card.querySelectorAll('.card-badge').forEach(function (badge) {
        badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg>' + esc(label);
        var cls = 'card-badge card-preview-badge ' + (isWs ? 'badge-workspace' : kind === 'public' ? 'badge-public' : 'badge-private');
        if (badge.tagName === 'BUTTON') {
          var nextVis = toPrivate ? 'private' : 'workspace';
          var title = toPrivate ? t('cards.makePrivateTip') : t('cards.shareWsTip');
          badge.className = cls + ' vis-toggle';
          badge.title = title; badge.setAttribute('aria-label', title);
          badge.setAttribute('onclick', "event.stopPropagation();event.preventDefault();toggleVisibility('" + id + "','" + nextVis + "')");
        } else {
          badge.className = cls;
        }
      });
    });
    // Table rows: Access cell + the attribute the context menu reads.
    document.querySelectorAll('.wsx-tr[data-id="' + CSS.escape(id) + '"]').forEach(function (row) {
      row.setAttribute('data-visibility', vis);
      var cell = row.querySelector('.wsx-tr__vis'); if (!cell) return;
      cell.classList.toggle('is-ws', isWs);
      cell.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg><span>' + esc(label) + '</span>';
    });
  }
  window.toggleVisibility = function (id, newVis) {
    var card = artEls(id)[0]; if (!card) return;
    var prevVis = card.getAttribute('data-visibility');
    optimistic({
      key: 'vis:' + id,
      apply: function () { applyVisibilityDom(id, newVis); },
      rollback: function () { applyVisibilityDom(id, prevVis); },
      request: function () {
        return fetch('/v1/artifacts/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ visibility: newVis }) })
          .then(function (r) {
            if (r.status !== 202) return r;
            // Held for approval: not an error to retry — roll back and say why.
            return r.json().catch(function () { return null; }).then(function (j) { var e = new Error('approval'); e.noRetry = true; e.userMessage = (j && j.message) || t('cards.approvalRequired'); throw e; });
          });
      },
      success: newVis === 'workspace' ? t('cards.sharedWs') : t('cards.nowPrivate'),
      error: function (e) { return (e && e.userMessage) || t('cards.visFailed'); },
    });
  };

  // ── Tag filter (client-side, over whichever cards are currently rendered) ──
  var activeTagFilter = null;
  window.filterByTag = function (tag) {
    tag = (tag || '').trim(); if (!tag) return;
    var norm = tag.toLowerCase();
    activeTagFilter = activeTagFilter === norm ? null : norm;
    document.querySelectorAll('.artifact-card').forEach(function (card) {
      var tags = (card.dataset.tags || '').split('\\n');
      card.hidden = !!activeTagFilter && tags.indexOf(activeTagFilter) === -1;
    });
    showToast(activeTagFilter ? t('cards.filteringBy').replace('{tag}', tag) : t('cards.filterCleared'));
  };

  // ── Copy link ──
  window.copyLink = function (url) {
    function ok() { showToast(t('cards.linkCopied'), 'success'); }
    function fallback() {
      try {
        var ta = document.createElement('textarea'); ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        ok();
      } catch (e) { showToast(t('cards.copyFailed'), 'error'); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, fallback);
    else fallback();
  };

  // ── Move to folder ──
  // Optimistic: the picker closes and the card leaves a folder view it no longer belongs
  // to right away; the POSTs run behind. A failed id comes back where it was.
  function moveArtifactsToFolder(ids, folderId, mo) {
    var prev = {}, leaving = {};
    ids.forEach(function (id) { var c = cardEls(id)[0]; prev[id] = c ? (c.dataset.folder || '') : ''; });
    function setFolder(id, f) { cardEls(id).forEach(function (c) { c.dataset.folder = f || ''; }); }
    function back(id) { setFolder(id, prev[id]); if (leaving[id]) { leaving[id].restore(); delete leaving[id]; } }
    optimistic({
      key: 'move:' + ids.join(','),
      apply: function () {
        mo.close();
        ids.forEach(function (id) {
          setFolder(id, folderId);
          if (curFolder && curFolder !== (folderId || '')) leaving[id] = window.soOptimistic.leave(artEls(id));
        });
        if (selectedIds.size) clearSelection();
      },
      rollback: function (err) { (err && err.failed ? err.failed : ids).forEach(back); },
      request: function () {
        return Promise.all(ids.map(function (id) {
          var card = artEls(id)[0];
          var wsId = card ? (card.getAttribute('data-workspace') || '') : '';
          var url = wsId ? '/v1/workspaces/' + encodeURIComponent(wsId) + '/artifacts/' + encodeURIComponent(id) + '/move' : '/v1/artifacts/' + encodeURIComponent(id) + '/folder';
          return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ folder_id: folderId }) })
            .then(function (r) { return r.ok; }).catch(function () { return false; });
        })).then(function (results) {
          var failed = ids.filter(function (id, i) { return !results[i]; });
          if (failed.length) { var e = new Error('move'); e.failed = failed; e.ok = ids.length - failed.length; throw e; }
        });
      },
      success: t(ids.length === 1 ? 'cards.movedOne' : 'cards.movedMany').replace('{n}', ids.length),
      error: function (e) { return e && e.ok ? t(e.ok === 1 ? 'cards.movedOne' : 'cards.movedMany').replace('{n}', e.ok) + ' \u00b7 ' + t('cards.moveFailed') : t('cards.moveFailed'); },
      done: function () { if (typeof reloadFolders === 'function') reloadFolders(); },
    }).then(function (ok) { if (!ok && typeof reloadFolders === 'function') reloadFolders(); });
  }
  window.openFolderPicker = function (ids) {
    ids = (ids || []).filter(Boolean); if (!ids.length) return;
    var mo = wsxModal(t('assets.moveToFolder'), '<div class="folder-picker-panel"><div class="folder-picker-list" id="fpList"><p class="wsx-field__note">' + esc(t('common.loading')) + '</p></div></div>');
    var list = document.getElementById('fpList');
    fetch(folderApiBase(), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var folders = (d && d.folders) || [];
        var rows = '<button type="button" class="folder-picker-item" data-folder=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>' + esc(t('inspector.noFolder')) + '</button>'
          + folders.map(function (f) { return '<button type="button" class="folder-picker-item" data-folder="' + esc(f.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' + esc(f.name) + '</button>'; }).join('');
        list.innerHTML = rows;
        list.querySelectorAll('.folder-picker-item').forEach(function (btn) {
          btn.addEventListener('click', function () { moveArtifactsToFolder(ids, btn.getAttribute('data-folder') || null, mo); });
        });
      })
      .catch(function () { list.innerHTML = '<p class="wsx-field__note">' + esc(t('inspector.couldNotFolders')) + '</p>'; });
  };

  // ── Delete (single + bulk share the same confirm flow) ──
  // Confirm closes at once, the cards leave, and an "Deleted · Undo" toast holds the
  // DELETE for a few seconds. Undo (or a failed DELETE) puts the cards back in place.
  function deleteArtifactsFlow(ids, title) {
    var mo = wsxModal(title, '<div class="wsx-cform"><p class="wsx-field__note">' + esc(t(ids.length === 1 ? 'cards.deleteNoteOne' : 'cards.deleteNoteMany')) + '</p><div class="wsx-cform__foot"><button class="wsx-abtn" id="fld_cancel" type="button">' + esc(t('artifacts.cancel')) + '</button><button class="wsx-abtn danger" id="fld_go" type="button">' + esc(t('common.delete')) + '</button></div></div>');
    document.getElementById('fld_cancel').addEventListener('click', function () { mo.close(); });
    document.getElementById('fld_go').addEventListener('click', function () { mo.close(); deleteArtifacts(ids); });
  }
  function deleteArtifacts(ids) {
    var leaving = {};
    function back(id) { delete pendingArtDeletes[id]; if (leaving[id]) leaving[id].restore(); showArtEls(id); }
    return optimistic({
      key: 'del:art:' + ids.join(','),
      undo: true,
      apply: function () {
        ids.forEach(function (id) { pendingArtDeletes[id] = true; leaving[id] = window.soOptimistic.leave(artEls(id)); });
        if (selectedIds.size) clearSelection();
      },
      rollback: function (err) { (err && err.failed ? err.failed : ids).forEach(back); },
      request: function () {
        return Promise.all(ids.map(function (id) {
          return fetch('/v1/artifacts/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin', keepalive: true })
            .then(function (r) { return r.ok || r.status === 404; }).catch(function () { return false; });
        })).then(function (results) {
          var failed = ids.filter(function (id, i) { return !results[i]; });
          ids.forEach(function (id, i) { if (results[i]) { delete pendingArtDeletes[id]; if (leaving[id]) leaving[id].commit(); } });
          if (typeof artCache !== 'undefined') artCache = {};
          if (failed.length) { var e = new Error('delete'); e.failed = failed; e.ok = ids.length - failed.length; throw e; }
        });
      },
      success: t(ids.length === 1 ? 'cards.deletedOne' : 'cards.deletedMany').replace('{n}', ids.length),
      error: function (e) { return e && e.ok ? t('cards.deletedSome').replace('{ok}', e.ok).replace('{n}', ids.length) : t('cards.deleteFailed'); },
    });
  }
  window.confirmDelete = function (id) {
    var card = artEls(id)[0];
    var titleEl = card && card.querySelector('.card-title, .wsx-tr__nm');
    var name = titleEl ? titleEl.textContent : t('cards.thisPage');
    deleteArtifactsFlow([id], t('cards.deleteTitle').replace('{name}', name));
  };

  // ── Multi-select + bulk command bar ──
  var selectedIds = new Set();
  var cmdbarEl = null;
  function cmdbar() {
    if (cmdbarEl) return cmdbarEl;
    cmdbarEl = document.createElement('div');
    cmdbarEl.className = 'cmdbar'; cmdbarEl.id = 'cmdbar'; cmdbarEl.hidden = true;
    cmdbarEl.innerHTML = '<span class="cmdbar-count"><span id="cmdbarCount">0</span> ' + esc(t('cards.selected')) + '</span>'
      + '<span class="cmdbar-sep"></span>'
      + '<span class="cmdbar-actions">'
      + '<button type="button" class="cmdbar-btn" id="cmdbarFav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' + esc(t('inspector.act.fav')) + '</button>'
      + '<button type="button" class="cmdbar-btn danger" id="cmdbarDelete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' + esc(t('common.delete')) + '</button>'
      + '</span>'
      + '<button type="button" class="cmdbar-clear" id="cmdbarClear" aria-label="' + esc(t('cards.clearSelection')) + '" title="' + esc(t('cards.clearSelection')) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
    document.body.appendChild(cmdbarEl);
    document.getElementById('cmdbarClear').addEventListener('click', clearSelection);
    document.getElementById('cmdbarFav').addEventListener('click', function () {
      var ids = Array.from(selectedIds); if (!ids.length) return;
      var n = 0;
      ids.forEach(function (id) { var el = artEls(id)[0]; if (el && el.getAttribute('data-favorite') !== '1') { window.toggleFavorite(id, true); n++; } });
      clearSelection();
      showToast(n ? t('cards.favAddedN').replace('{n}', n) : t('cards.favAlready'), 'success');
    });
    document.getElementById('cmdbarDelete').addEventListener('click', function () {
      var ids = Array.from(selectedIds); if (!ids.length) return;
      deleteArtifactsFlow(ids, t(ids.length === 1 ? 'cards.deleteCountOne' : 'cards.deleteCountMany').replace('{n}', ids.length));
    });
    return cmdbarEl;
  }
  function updateCmdbar() {
    var bar = cmdbar(); var n = selectedIds.size;
    document.getElementById('cmdbarCount').textContent = String(n);
    document.body.classList.toggle('selecting', n > 0);
    if (n > 0) { bar.hidden = false; requestAnimationFrame(function () { bar.classList.add('show'); }); }
    else { bar.classList.remove('show'); bar.hidden = true; }
  }
  // Grid cards and table rows share one selection. Shift+click selects the range from the
  // last pick (in on-screen order); Cmd/Ctrl+click, or any click while selecting, toggles.
  var lastSelId = '';
  function setSel(id, on) {
    if (on) selectedIds.add(id); else selectedIds.delete(id);
    artEls(id).forEach(function (c) { c.classList.toggle('is-selected', on); });
  }
  function visibleArtIds() {
    var seen = {}, out = [];
    document.querySelectorAll('.artifact-card[data-id], .wsx-tr[data-id]').forEach(function (el) {
      var id = el.getAttribute('data-id'); if (!id || seen[id] || !el.offsetParent) return; seen[id] = 1; out.push(id);
    });
    return out;
  }
  window.toggleSelect = function (id, ev) {
    var ids = ev && ev.shiftKey && lastSelId ? visibleArtIds() : null;
    var a = ids ? ids.indexOf(lastSelId) : -1, b = ids ? ids.indexOf(id) : -1;
    if (a >= 0 && b >= 0) ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(function (x) { setSel(x, true); });
    else setSel(id, !selectedIds.has(id));
    lastSelId = id;
    updateCmdbar();
  };
  function clearSelection() {
    selectedIds.forEach(function (id) { artEls(id).forEach(function (c) { c.classList.remove('is-selected'); }); });
    selectedIds.clear(); lastSelId = ''; updateCmdbar();
  }
  // Capture phase: beats the open-as-tab link handler. Buttons inside keep their own clicks.
  document.addEventListener('click', function (e) {
    if (!(e.metaKey || e.ctrlKey || e.shiftKey || selectedIds.size)) return;
    var el = e.target.closest && e.target.closest('.artifact-card[data-id], .wsx-tr[data-id]'); if (!el) return;
    if (e.target.closest('button') || e.target.closest('.card-actions')) return;
    e.preventDefault(); e.stopPropagation();
    window.toggleSelect(el.getAttribute('data-id'), e);
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && selectedIds.size) clearSelection(); });

`;
