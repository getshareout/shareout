/**
 * Artifact card action handlers (select, favorite, visibility, tag filter,
 * copy link, move to folder, delete) — restores the onclick targets that
 * render-cards.ts emits on every card but that got dropped when the legacy
 * catalog client scripts were deleted in favor of the workspace shell.
 */
export const workspace_client_home_views_cardActions_JS = `  // ===== artifact card actions =====
  function cardEls(id) { return document.querySelectorAll('.artifact-card[data-id="' + CSS.escape(id) + '"]'); }
  function removeCardDom(id) {
    cardEls(id).forEach(function (card) {
      card.classList.add('is-removing');
      var done = function () { if (card.parentNode) card.remove(); };
      card.addEventListener('animationend', done, { once: true });
      setTimeout(done, 400);
    });
    if (typeof artCache !== 'undefined') artCache = {};
  }

  // ── Favorite ──
  function applyFavoriteDom(id, on) {
    cardEls(id).forEach(function (card) {
      card.dataset.favorite = on ? '1' : '0';
      var btn = card.querySelector('.fav-toggle'); if (!btn) return;
      btn.classList.toggle('active', on);
      var label = on ? 'Remove from favorites' : 'Add to favorites';
      btn.title = label; btn.setAttribute('aria-label', label);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var svg = btn.querySelector('svg'); if (svg) svg.setAttribute('fill', on ? 'currentColor' : 'none');
    });
  }
  window.toggleFavorite = function (id, silent) {
    var card = cardEls(id)[0]; if (!card) return;
    var on = card.dataset.favorite !== '1';
    applyFavoriteDom(id, on);
    fetch('/v1/artifacts/' + encodeURIComponent(id) + '/favorite', { method: on ? 'POST' : 'DELETE', credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('failed'); if (!silent) showToast(on ? 'Added to favorites' : 'Removed from favorites', 'success'); })
      .catch(function () { applyFavoriteDom(id, !on); if (!silent) showToast('Couldn\\u2019t update favorite', 'error'); });
  };

  // ── Visibility ──
  var VIS_LOCK_ICON = '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
  var VIS_PEOPLE_ICON = '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>';
  function applyVisibilityDom(id, vis) {
    var isWs = vis === 'workspace';
    var label = isWs ? 'All Workspace' : 'Private';
    var icon = isWs ? VIS_PEOPLE_ICON : VIS_LOCK_ICON;
    cardEls(id).forEach(function (card) {
      card.dataset.visibility = vis;
      card.querySelectorAll('.card-badge').forEach(function (badge) {
        badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg>' + esc(label);
        var cls = 'card-badge card-preview-badge ' + (isWs ? 'badge-workspace' : 'badge-private');
        if (badge.tagName === 'BUTTON') {
          var nextVis = isWs ? 'private' : 'workspace';
          var title = isWs ? 'Make private \\u2014 click to toggle' : 'Share with workspace \\u2014 click to toggle';
          badge.className = cls + ' vis-toggle';
          badge.title = title; badge.setAttribute('aria-label', title);
          badge.setAttribute('onclick', "event.stopPropagation();event.preventDefault();toggleVisibility('" + id + "','" + nextVis + "')");
        } else {
          badge.className = cls;
        }
      });
    });
  }
  window.toggleVisibility = function (id, newVis) {
    var card = cardEls(id)[0]; if (!card) return;
    var prevVis = card.dataset.visibility;
    applyVisibilityDom(id, newVis);
    fetch('/v1/artifacts/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ visibility: newVis }) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.status === 202) { applyVisibilityDom(id, prevVis); showToast((res.j && res.j.message) || 'Approval required to publish', 'error'); return; }
        if (!res.ok) throw new Error('failed');
        showToast(newVis === 'workspace' ? 'Shared with workspace' : 'Now private', 'success');
      })
      .catch(function () { applyVisibilityDom(id, prevVis); showToast('Couldn\\u2019t change visibility', 'error'); });
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
    showToast(activeTagFilter ? ('Filtering by \\u201c' + tag + '\\u201d \\u2014 click the tag again to clear') : 'Filter cleared');
  };

  // ── Copy link ──
  window.copyLink = function (url) {
    function ok() { showToast('Link copied', 'success'); }
    function fallback() {
      try {
        var ta = document.createElement('textarea'); ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        ok();
      } catch (e) { showToast('Couldn\\u2019t copy link', 'error'); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, fallback);
    else fallback();
  };

  // ── Move to folder ──
  function moveArtifactsToFolder(ids, folderId, mo) {
    Promise.all(ids.map(function (id) {
      var card = cardEls(id)[0];
      var wsId = card ? (card.dataset.workspace || '') : '';
      var url = wsId ? '/v1/workspaces/' + encodeURIComponent(wsId) + '/artifacts/' + encodeURIComponent(id) + '/move' : '/v1/artifacts/' + encodeURIComponent(id) + '/folder';
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ folder_id: folderId }) })
        .then(function (r) { return r.ok; }).catch(function () { return false; });
    })).then(function (results) {
      mo.close();
      var ok = results.filter(Boolean).length;
      ids.forEach(function (id, i) { if (results[i]) cardEls(id).forEach(function (c) { c.dataset.folder = folderId || ''; }); });
      if (typeof reloadFolders === 'function') reloadFolders();
      if (ok && selectedIds.size) clearSelection();
      showToast(ok ? ('Moved ' + ok + ' artifact' + (ok === 1 ? '' : 's')) : 'Couldn\\u2019t move', ok ? 'success' : 'error');
    });
  }
  window.openFolderPicker = function (ids) {
    ids = (ids || []).filter(Boolean); if (!ids.length) return;
    var mo = wsxModal('Move to folder', '<div class="folder-picker-panel"><div class="folder-picker-list" id="fpList"><p class="wsx-field__note">Loading\\u2026</p></div></div>');
    var list = document.getElementById('fpList');
    fetch(folderApiBase(), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var folders = (d && d.folders) || [];
        var rows = '<button type="button" class="folder-picker-item" data-folder=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>No folder</button>'
          + folders.map(function (f) { return '<button type="button" class="folder-picker-item" data-folder="' + esc(f.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' + esc(f.name) + '</button>'; }).join('');
        list.innerHTML = rows;
        list.querySelectorAll('.folder-picker-item').forEach(function (btn) {
          btn.addEventListener('click', function () { moveArtifactsToFolder(ids, btn.getAttribute('data-folder') || null, mo); });
        });
      })
      .catch(function () { list.innerHTML = '<p class="wsx-field__note">Couldn\\u2019t load folders.</p>'; });
  };

  // ── Delete (single + bulk share the same confirm flow) ──
  function deleteArtifactsFlow(ids, title) {
    var mo = wsxModal(title, '<div class="wsx-cform"><p class="wsx-field__note">' + (ids.length === 1 ? 'It' : 'They') + ' will be recoverable from Recently deleted for 30 days, then permanently removed.</p><div class="wsx-cform__err" id="fld_err"></div><div class="wsx-cform__foot"><button class="wsx-abtn" id="fld_cancel" type="button">Cancel</button><button class="wsx-abtn danger" id="fld_go" type="button">Delete</button></div></div>');
    document.getElementById('fld_cancel').addEventListener('click', function () { mo.close(); });
    document.getElementById('fld_go').addEventListener('click', function () {
      var b = this; b.disabled = true;
      Promise.all(ids.map(function (id) {
        return fetch('/v1/artifacts/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' })
          .then(function (r) { return r.ok || r.status === 404; }).catch(function () { return false; });
      })).then(function (results) {
        mo.close();
        var ok = 0;
        ids.forEach(function (id, i) { if (results[i]) { removeCardDom(id); ok++; } });
        if (selectedIds.size) clearSelection();
        showToast(ok === ids.length ? ('Deleted ' + ok + (ok === 1 ? ' artifact' : ' artifacts')) : ('Deleted ' + ok + ' of ' + ids.length), ok === ids.length ? 'success' : 'error');
      });
    });
  }
  window.confirmDelete = function (id) {
    var card = cardEls(id)[0];
    var titleEl = card && card.querySelector('.card-title');
    var name = titleEl ? titleEl.textContent : 'this artifact';
    deleteArtifactsFlow([id], 'Delete \\u201c' + name + '\\u201d?');
  };

  // ── Multi-select + bulk command bar ──
  var selectedIds = new Set();
  var cmdbarEl = null;
  function cmdbar() {
    if (cmdbarEl) return cmdbarEl;
    cmdbarEl = document.createElement('div');
    cmdbarEl.className = 'cmdbar'; cmdbarEl.id = 'cmdbar'; cmdbarEl.hidden = true;
    cmdbarEl.innerHTML = '<span class="cmdbar-count"><span id="cmdbarCount">0</span> selected</span>'
      + '<span class="cmdbar-sep"></span>'
      + '<span class="cmdbar-actions">'
      + '<button type="button" class="cmdbar-btn" id="cmdbarFav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>Favorite</button>'
      + '<button type="button" class="cmdbar-btn danger" id="cmdbarDelete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>Delete</button>'
      + '</span>'
      + '<button type="button" class="cmdbar-clear" id="cmdbarClear" aria-label="Clear selection" title="Clear selection"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>';
    document.body.appendChild(cmdbarEl);
    document.getElementById('cmdbarClear').addEventListener('click', clearSelection);
    document.getElementById('cmdbarFav').addEventListener('click', function () {
      var ids = Array.from(selectedIds); if (!ids.length) return;
      var n = 0;
      ids.forEach(function (id) { var card = cardEls(id)[0]; if (card && card.dataset.favorite !== '1') { window.toggleFavorite(id, true); n++; } });
      clearSelection();
      showToast(n ? ('Added ' + n + ' to favorites') : 'Already in favorites', 'success');
    });
    document.getElementById('cmdbarDelete').addEventListener('click', function () {
      var ids = Array.from(selectedIds); if (!ids.length) return;
      deleteArtifactsFlow(ids, 'Delete ' + ids.length + ' artifact' + (ids.length === 1 ? '' : 's') + '?');
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
  window.toggleSelect = function (id) {
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    cardEls(id).forEach(function (c) { c.classList.toggle('is-selected', selectedIds.has(id)); });
    updateCmdbar();
  };
  function clearSelection() {
    selectedIds.forEach(function (id) { cardEls(id).forEach(function (c) { c.classList.remove('is-selected'); }); });
    selectedIds.clear(); updateCmdbar();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && selectedIds.size) clearSelection(); });

`;
