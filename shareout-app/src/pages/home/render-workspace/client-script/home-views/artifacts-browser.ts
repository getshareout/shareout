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
    var canManage = !!(d && (d.canEditFolder != null ? d.canEditFolder : d.canManageFolders));
    if (!html && !canManage) return '';
    if (!html) {
      return '<button type="button" class="wsx-fguide wsx-fguide--empty" onclick="editFolderReadme()">' + GUIDE_SVG + '<span class="wsx-fguide__cta"><strong>' + esc(t('artifacts.addGuide')) + '</strong><em>' + esc(t('artifacts.guideHint')) + '</em></span></button>';
    }
    var edit = canManage ? '<button type="button" class="wsx-fguide__edit" onclick="editFolderReadme()" title="' + escAttr(t('artifacts.editGuide')) + '" aria-label="' + escAttr(t('artifacts.editGuide')) + '">' + PENCIL_SVG + '</button>' : '';
    return '<section class="wsx-fguide"><div class="wsx-fguide__head">' + GUIDE_SVG + '<span class="wsx-fguide__label">' + esc(t('artifacts.guideLabel')) + '</span>' + edit + '</div><div class="wsx-fguide__body">' + html + '</div></section>';
  }
  var ACCESS_SVG = {
    private: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    workspace: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    public: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    external: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  };
  var LINK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  function accessIcon(a) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ACCESS_SVG[a] || ACCESS_SVG.workspace) + '</svg>'; }
  function initials(s) { var b = String(s || '').split('@')[0].split(/[\\s._-]+/).filter(Boolean); return ((b[0] || '?').charAt(0) + (b[1] ? b[1].charAt(0) : '')).toUpperCase(); }
  function inheritedNote(name) { return t('artifacts.access.inheritedFrom').replace('{name}', name || t('artifacts.folderDefault')); }
  function grantPeople(fa) {
    var seen = {}, out = [];
    ((fa && fa.grants) || []).forEach(function (g) { var k = g.subject_type + ':' + g.subject_label; if (!seen[k]) { seen[k] = 1; out.push(g); } });
    return out;
  }
  function personAvatar(g) {
    var tip = g.subject_label + (g.inherited ? ' \\u00b7 ' + inheritedNote(g.folder_name) : '');
    return '<span class="wsx-fav' + (g.inherited ? ' is-inherited' : '') + (g.subject_type === 'sharee' ? ' is-org' : '') + '" title="' + escAttr(tip) + '">' + esc(initials(g.subject_label)) + '</span>';
  }
  // The folder's setting is not enforced on what is inside it, so the pill shows the real
  // audience and this note says why it differs from the setting.
  function moreOpenNote(fa) {
    var m = fa && fa.moreOpen; if (!m || !(m.public || m.workspace)) return '';
    var n = function (k, c) { return t('artifacts.access.' + k + (c === 1 ? 'One' : 'Many')).replace('{n}', String(c)); };
    var parts = [t('artifacts.access.folderIs').replace('{setting}', t('artifacts.access.' + fa.effective))];
    if (m.public) parts.push(n('morePublic', m.public));
    if (m.workspace) parts.push(n('moreWorkspace', m.workspace));
    return parts.join(' \\u00b7 ');
  }
  // Managers get the items to fix, each linking to its page; files have no page of their own.
  function openItemsHtml(fa) {
    var items = (fa && fa.openItems) || []; if (!items.length) return '';
    var total = (fa.moreOpen.public || 0) + (fa.moreOpen.workspace || 0);
    return '<div class="wsx-field__lbl">' + esc(t('artifacts.access.openItems')) + '</div>' + items.map(function (i) {
      var name = i.kind === 'artifact' && i.slug ? '<a href="/a/' + encodeURIComponent(i.slug) + '/" target="_blank" rel="noopener">' + esc(i.name) + '</a>' : esc(i.name);
      return '<div class="wsx-faccess__row wsx-faccess__open"><span class="wsx-faccess__pill" data-access="' + escAttr(i.visibility) + '">' + accessIcon(i.visibility) + '<span>' + esc(t('artifacts.access.' + i.visibility)) + '</span></span><span class="wsx-faccess__who"><b>' + name + '</b></span></div>';
    }).join('') + (total > items.length ? '<p class="wsx-field__note">' + esc(t('artifacts.access.openItemsMore').replace('{n}', String(total - items.length))) + '</p>' : '')
      + '<p class="wsx-field__note">' + esc(t('artifacts.access.openItemsHint')) + '</p>';
  }
  // Who can see the open folder: one pill (Private / Workspace / Public / Shared externally)
  // plus the people and orgs holding a grant on it or an ancestor; opens the access panel.
  function folderAccessBar(d) {
    var fa = d && d.folderAccess;
    var link = '<button type="button" class="wsx-fbar__btn" onclick="copyFolderLink()">' + LINK_SVG + '<span>' + esc(t('artifacts.copyLink')) + '</span></button>';
    if (!fa) return '<div class="wsx-fbar__acts">' + link + '</div>';
    var lbl = t('artifacts.access.' + fa.access);
    var pill = '<span class="wsx-faccess__pill" data-access="' + escAttr(fa.access) + '">' + accessIcon(fa.access) + '<span>' + esc(lbl) + '</span></span>';
    var ppl = grantPeople(fa);
    var avs = ppl.length ? '<span class="wsx-favs">' + ppl.slice(0, 4).map(personAvatar).join('') + (ppl.length > 4 ? '<span class="wsx-fav wsx-fav--more">+' + (ppl.length - 4) + '</span>' : '') + '</span>' : '';
    var more = moreOpenNote(fa);
    var note = more ? '<span class="wsx-faccess__note">' + esc(more) + '</span>' : '';
    var tip = [lbl, fa.inheritedFrom ? inheritedNote(fa.inheritedFrom.name) : '', more].filter(Boolean).join(' \\u00b7 ');
    var opens = d.folderScope === 'workspace' || (fa.openItems && fa.openItems.length);
    var ctl = opens
      ? '<button type="button" class="wsx-faccess" onclick="openFolderAccess()" title="' + escAttr(tip) + '" aria-label="' + escAttr(t('artifacts.access.title') + ': ' + tip) + '">' + pill + avs + note + '</button>'
      : '<span class="wsx-faccess is-static" title="' + escAttr(tip) + '">' + pill + note + '</span>';
    return '<div class="wsx-fbar__acts">' + ctl + link + '</div>';
  }
  function folderHead(d) {
    var crumbs = curFolder ? '<div class="wsx-fbar">' + folderCrumbs(d) + folderAccessBar(d) + '<button type="button" class="wsx-abtn" onclick="saveFolderAsTemplate()">' + esc(t('tpl.saveAs')) + '</button></div>' : '';
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
    hidePendingFolders();
  }
  // Folders deleted optimistically whose DELETE hasn't landed (undo window / in flight).
  var pendingFolderDeletes = {};
  function folderEls(id) { return document.querySelectorAll('.wsx-folder-card[data-folder-id="' + CSS.escape(id) + '"]'); }
  function hidePendingFolders() { Object.keys(pendingFolderDeletes).forEach(function (id) { folderEls(id).forEach(function (el) { el.style.display = 'none'; }); }); }
  function fetchArt(f, cb, fld) {
    var k = artKey(f, fld);
    if (!artPending[k]) {
      artPending[k] = fetch(artUrl(f, fld), { credentials: 'same-origin' }).then(function (r) { return r.json(); })
        .then(function (d) { artCache[k] = { cardsHtml: d && d.cardsHtml, rowsHtml: d && d.rowsHtml, count: (d && d.cardsHtml) ? 1 : 0, foldersHtml: d && d.foldersHtml, folderName: d && d.folderName, folderPath: d && d.folderPath, canManageFolders: d && d.canManageFolders, canEditFolder: d && d.canEditFolder, folderScope: d && d.folderScope, folderAccess: d && d.folderAccess, folderReadme: d && d.folderReadme, folderReadmeHtml: d && d.folderReadmeHtml }; })
        .catch(function () {})
        .then(function () { delete artPending[k]; });
    }
    return cb ? artPending[k].then(cb) : artPending[k];
  }
  // Prefetch a folder's contents when the pointer or focus reaches its card, so the
  // drill-in is instant without a boot-time fan-out of one request per folder.
  function warmFolder(e) {
    var el = e.target && e.target.closest && e.target.closest('[data-folder-id]'); if (!el) return;
    var id = el.getAttribute('data-folder-id');
    if (id && !artCache[artKey(artFilter, id)]) fetchArt(artFilter, null, id);
  }
  (function () {
    var m = document.getElementById('wsxArtMount'); if (!m) return;
    m.addEventListener('pointerover', warmFolder);
    m.addEventListener('focusin', warmFolder);
  })();
  function loadArtifacts() {
    if (typeof syncHash === 'function') syncHash();
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
  function reloadFolders(cb) { artCache = {}; var k = artKey(artFilter); fetchArt(artFilter, function () { if (artCache[k]) applyArt(artFilter); if (cb) cb(); }); }
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
    var warm = function () { if (!artCache[artKey('recent', '')]) fetchArt('recent'); };
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 2500 }); else setTimeout(warm, 800);
  })();
  // ===== folder navigation + management (Drive-style drill-in) =====
  window.enterFolder = function (id, name) { curFolder = id; curFolderName = name || ''; loadArtifacts(); };
  window.saveFolderAsTemplate = function () { if (curFolder) saveAsTemplate({ folder_id: curFolder, name: curFolderName }); };
  window.exitFolder = function () { curFolder = ''; curFolderName = ''; loadArtifacts(); };
  // Hash router entry (#l/artifacts/<folderId>); runs before openView loads the grid.
  function artRoute(id) { id = id || ''; if (id !== curFolder) { curFolder = id; curFolderName = ''; } }
  function fToast(msg, isError) { if (typeof window.showToast === 'function') window.showToast(msg, isError ? 'error' : 'success'); }
  window.copyFolderLink = function () {
    if (!curFolder) return;
    var url = location.origin + location.pathname + location.search + '#l/artifacts/' + encodeURIComponent(curFolder);
    var fail = function () { fToast(t('artifacts.couldNotCopy'), true); };
    try { navigator.clipboard.writeText(url).then(function () { fToast(t('artifacts.linkCopied')); }, fail); } catch (e) { fail(); }
  };
  // Access panel: managers (admins, or the folder's creator while members manage their
  // folders) change visibility, share with a person by email and remove grants; everyone
  // else sees the same list read-only. Re-renders from the silent reload after each change.
  window.openFolderAccess = function () {
    if (!curFolder) return;
    var fid = curFolder;
    var mo = wsxModal(t('artifacts.access.title'), '<div class="wsx-cform" id="fa_body"></div>');
    var grantsBase = '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/grants';
    var pendingRevokes = {};
    var activity = null;
    function refresh() { reloadFolders(render); }
    function expiryNote(iso) {
      var n = Math.ceil((Date.parse(iso) - Date.now()) / 86400000);
      return n <= 1 ? t('folderPortal.expiresToday') : t('folderPortal.expiresIn').replace('{n}', String(n));
    }
    function activityHtml() {
      if (!activity) return '<p class="wsx-field__note">\u2026</p>';
      if (activity.err) return '<p class="wsx-field__note">' + esc(t('common.couldNotLoad')) + '</p>';
      if (!activity.rows.length) return '<p class="wsx-field__note">' + esc(t('folderPortal.noActivity')) + '</p>';
      return activity.rows.slice(0, 20).map(function (a) {
        var verb = t('folderPortal.action.' + a.action) || a.action;
        return '<div class="wsx-faccess__row wsx-faccess__act"><span class="wsx-faccess__who"><b>' + esc(a.user_email || '?') + '</b><em>' + esc(verb + ' ' + (a.resource_name || a.resource_id)) + ' \u00b7 ' + esc(adRelDate(a.created_at)) + '</em></span></div>';
      }).join('');
    }
    function loadActivity() {
      fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/folders/' + encodeURIComponent(fid) + '/activity', { credentials: 'same-origin' })
        .then(okOr)
        .then(function (r) { return r.json(); })
        .then(function (j) { activity = { rows: (j && j.activity) || [] }; })
        .catch(function () { activity = { rows: [], err: true }; })
        .then(function () { var el = document.getElementById('fa_act'); if (el) el.innerHTML = activityHtml(); });
    }
    function render() {
      var b = document.getElementById('fa_body'); if (!b) return;
      var d = artCache[artKey(artFilter, fid)], fa = d && d.folderAccess;
      if (!fa) { b.innerHTML = i18nEmpty('common.couldNotLoad'); return; }
      var can = !!d.canEditFolder;
      var lbl = t('artifacts.access.' + fa.access);
      var more = moreOpenNote(fa);
      var html = '<p class="wsx-faccess__now"><span class="wsx-faccess__pill" data-access="' + escAttr(fa.access) + '">' + accessIcon(fa.access) + '<span>' + esc(lbl) + '</span></span>' + (fa.inheritedFrom ? '<span class="wsx-field__note">' + esc(inheritedNote(fa.inheritedFrom.name)) + '</span>' : '') + (more ? '<span class="wsx-field__note">' + esc(more) + '</span>' : '') + '</p>';
      html += openItemsHtml(fa);
      if (d.folderScope !== 'workspace') { b.innerHTML = html; return; }
      if (can) {
        html += '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('artifacts.access.visibility')) + '</span><select class="wsx-field__in" id="fa_vis">'
          + ['inherit', 'workspace', 'public', 'private'].map(function (v) { return '<option value="' + v + '"' + (fa.visibility === v ? ' selected' : '') + '>' + esc(t('artifacts.access.opt.' + v)) + '</option>'; }).join('')
          + '</select></label>' + gcFolderHtml();
      }
      var gs = (fa.grants || []).filter(function (g) { return !pendingRevokes[g.id]; });
      html += '<div class="wsx-field__lbl">' + esc(t('artifacts.access.people')) + '</div>';
      html += gs.length ? gs.map(function (g) {
        var meta = esc(g.capability === 'comment' ? t('assets.shareCapComment') : g.capability === 'view' ? t('assets.shareCapView') : g.capability) + (g.inherited ? ' \\u00b7 ' + esc(inheritedNote(g.folder_name)) : '') + (g.expires_at ? ' \\u00b7 ' + esc(expiryNote(g.expires_at)) : '');
        var rm = can && !g.inherited ? '<button class="wsx-abtn" type="button" data-rv="' + escAttr(g.id) + '">' + esc(t('artifacts.access.remove')) + '</button>' : '';
        return '<div class="wsx-share-send wsx-faccess__row">' + personAvatar(g) + '<span class="wsx-faccess__who"><b>' + esc(g.subject_label) + '</b><em>' + meta + '</em></span>' + rm + '</div>';
      }).join('') : '<p class="wsx-field__note">' + esc(t('artifacts.access.nobody')) + '</p>';
      if (can) {
        html += fld(t('assets.shareEmail'), 'fa_email', 'alex@example.com', 'email')
          + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('assets.shareAccess')) + '</span><select class="wsx-field__in" id="fa_cap"><option value="view">' + esc(t('assets.shareCapView')) + '</option><option value="comment">' + esc(t('assets.shareCapComment')) + '</option></select></label>'
          + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('folderPortal.expiry')) + '</span><select class="wsx-field__in" id="fa_exp">' + ['', '7', '30', '90', 'date'].map(function (v) { return '<option value="' + v + '">' + esc(t('folderPortal.expiry.' + (v || 'never'))) + '</option>'; }).join('') + '</select></label>'
          + '<input class="wsx-field__in" id="fa_exp_date" type="date" hidden>'
          + '<div id="fa_msg" class="wsx-field__note"></div><div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="fa_go" type="button">' + esc(t('assets.shareSend')) + '</button></div>';
      } else {
        html += '<p class="wsx-field__note">' + esc(t('artifacts.access.readOnly')) + '</p>';
      }
      if (gs.length) html += '<div class="wsx-cform__foot"><button class="wsx-abtn" id="fa_portal" type="button">' + esc(t('folderPortal.copyLink')) + '</button></div>';
      if (can) html += '<div class="wsx-field__lbl">' + esc(t('folderPortal.activity')) + '</div><div id="fa_act">' + activityHtml() + '</div>';
      b.innerHTML = html;
      if (can) wireGuestFolder(fid);
      var pl = document.getElementById('fa_portal');
      if (pl) pl.addEventListener('click', function () {
        var fail = function () { fToast(t('artifacts.couldNotCopy'), true); };
        try { navigator.clipboard.writeText(location.origin + '/shared?folder=' + encodeURIComponent(fid)).then(function () { fToast(t('artifacts.linkCopied')); }, fail); } catch (e) { fail(); }
      });
      var expSel = document.getElementById('fa_exp'), expDate = document.getElementById('fa_exp_date');
      if (expSel && expDate) expSel.addEventListener('change', function () { expDate.hidden = expSel.value !== 'date'; });
      var sel = document.getElementById('fa_vis');
      if (sel) sel.addEventListener('change', function () {
        var v = sel.value;
        optimistic({
          key: 'folder:vis:' + fid,
          request: function () {
            return fetch(folderApiBase() + '/' + encodeURIComponent(fid), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: v }) });
          },
          rollback: function () { sel.value = fa.visibility; },
          success: t('common.saved'),
          error: t('artifacts.access.couldNotSave'),
          done: refresh,
        });
      });
      Array.prototype.forEach.call(b.querySelectorAll('[data-rv]'), function (btn) {
        btn.addEventListener('click', function () {
          var gid = btn.getAttribute('data-rv'), gone = null;
          optimistic({
            key: 'grant:del:' + gid,
            undo: true,
            apply: function () { pendingRevokes[gid] = true; gone = window.soOptimistic.leave(btn.closest('.wsx-share-send')); },
            rollback: function () { delete pendingRevokes[gid]; if (gone) gone.restore(); },
            request: function () { return fetch(grantsBase + '/' + encodeURIComponent(gid), { method: 'DELETE', credentials: 'same-origin', keepalive: true }); },
            success: t('assets.toast.revoked'),
            error: t('assets.toast.revokeFailed'),
            done: function () { delete pendingRevokes[gid]; refresh(); },
          });
        });
      });
      var go = document.getElementById('fa_go');
      if (go) go.addEventListener('click', function () {
        var email = cv('fa_email'), msg = document.getElementById('fa_msg'); if (!email || go.disabled) return;
        var payload = { resource_type: 'folder', resource_id: fid, email: email, capability: cv('fa_cap') || 'view' };
        var ev = cv('fa_exp');
        if (ev === 'date') {
          var dv = cv('fa_exp_date'), end = dv ? new Date(dv + 'T23:59:59') : null;
          if (!end || isNaN(end.getTime())) { if (msg) msg.textContent = t('folderPortal.pickDate'); return; }
          payload.expires_at = end.toISOString();
        } else if (ev) payload.expires_in_days = Number(ev);
        var label = go.textContent; go.disabled = true; go.textContent = t('assets.sending');
        fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/share-person', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          .then(okOr)
          .then(function () { fToast(t('artifacts.access.shared').replace('{email}', email)); refresh(); })
          .catch(function (e) { go.disabled = false; go.textContent = label; if (msg) msg.textContent = errReason(e, '') || t('assets.shareErr'); });
      });
    }
    function wantsActivity(d) { return d && d.canEditFolder && d.folderScope === 'workspace'; }
    render();
    if (wantsActivity(artCache[artKey(artFilter, fid)])) loadActivity();
    if (mo && !artCache[artKey(artFilter, fid)]) fetchArt(artFilter, function () { render(); if (wantsActivity(artCache[artKey(artFilter, fid)])) loadActivity(); }, fid);
  };
  function folderNameModal(title, initial, action, go) {
    var mo = wsxModal(title, '<div class="wsx-cform">' + fld(t('artifacts.folderNameLabel'), 'fld_name', t('artifacts.folderNamePh')) + '<div class="wsx-cform__err" id="fld_err"></div><div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="fld_go" type="button">' + esc(action) + '</button></div></div>');
    var inp = document.getElementById('fld_name'); if (inp) { inp.value = initial || ''; inp.focus(); if (initial) inp.select(); }
    function submit() {
      var nm = cv('fld_name'); var err = document.getElementById('fld_err');
      if (!nm) { err.textContent = t('artifacts.nameRequired'); return; }
      go(nm, mo);
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
    // Optimistic: the folder card appears at once (inert until the real one lands on the
    // silent reload); a failed create removes it and says why, with Retry.
    function submit() {
      var nm = inp.value.trim(); if (!nm) { cleanup(); return; }
      var parent = curFolder, ph = null;
      cleanup();
      optimistic({
        key: 'folder:new:' + parent + ':' + nm,
        apply: function () {
          var grid = row.parentNode && row.parentNode.querySelector('.wsx-folder-grid'); if (!grid) return;
          ph = document.createElement('article'); ph.className = 'wsx-folder-card'; ph.setAttribute('aria-busy', 'true');
          ph.innerHTML = '<span class="wsx-folder-card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span><span class="wsx-folder-card__txt"><span class="wsx-folder-card__name"></span></span>';
          ph.querySelector('.wsx-folder-card__name').textContent = nm;
          grid.appendChild(ph);
        },
        rollback: function () { if (ph && ph.parentNode) ph.remove(); },
        request: function () {
          return fetch(folderApiBase(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm, parent_id: parent || undefined }) });
        },
        error: t('artifacts.couldNotCreate'),
        errors: { ADMIN_REQUIRED: t('assets.err.adminFolders') },
        done: function () { reloadFolders(); },
      });
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
    folderNameModal(t('artifacts.renameFolder'), name || '', t('common.save'), function (nm, mo) {
      var prev = name || '', prevCur = curFolderName;
      function setName(n) {
        folderEls(id).forEach(function (el) { el.setAttribute('data-folder-name', n); var nmEl = el.querySelector('.wsx-folder-card__name'); if (nmEl) nmEl.textContent = n; });
        document.querySelectorAll('.folders-breadcrumb .crumb-current').forEach(function (c) { if (curFolder === id) c.textContent = n; });
      }
      optimistic({
        key: 'folder:rename:' + id,
        apply: function () { mo.close(); setName(nm); if (curFolder === id) curFolderName = nm; },
        rollback: function () { setName(prev); if (curFolder === id) curFolderName = prevCur; },
        request: function () {
          return fetch(folderApiBase() + '/' + encodeURIComponent(id), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm }) });
        },
        error: t('artifacts.couldNotRename'),
        done: function () { reloadFolders(); },
      });
    });
  };
  window.deleteFolder = function (id, name) {
    var mo = wsxModal(t('artifacts.deleteFolder'), '<div class="wsx-cform"><p class="wsx-field__note">' + esc(t('artifacts.deleteBody').replace('{name}', name || t('artifacts.thisFolder'))) + '</p><div class="wsx-cform__foot"><button class="wsx-abtn" id="fld_cancel" type="button">' + esc(t('artifacts.cancel')) + '</button><button class="wsx-abtn danger" id="fld_go" type="button">' + esc(t('artifacts.deleteFolder')) + '</button></div></div>');
    document.getElementById('fld_cancel').addEventListener('click', function () { mo.close(); });
    document.getElementById('fld_go').addEventListener('click', function () {
      mo.close();
      var leaving = null, wasIn = curFolder === id;
      optimistic({
        key: 'folder:del:' + id,
        undo: true,
        apply: function () {
          pendingFolderDeletes[id] = true;
          if (wasIn) { curFolder = ''; curFolderName = ''; loadArtifacts(); }
          leaving = window.soOptimistic.leave(folderEls(id));
        },
        rollback: function () {
          delete pendingFolderDeletes[id];
          if (leaving) leaving.restore();
          folderEls(id).forEach(function (el) { el.classList.remove('so-c-leaving'); el.style.display = ''; });
          if (wasIn) window.enterFolder(id, name);
        },
        request: function () {
          return fetch(folderApiBase() + '/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin', keepalive: true })
            .then(function (r) { return r.status === 404 ? null : r; });
        },
        success: t('artifacts.folderDeleted'),
        error: t('artifacts.couldNotDelete'),
        done: function () { delete pendingFolderDeletes[id]; reloadFolders(); },
      });
    });
  };
  // Edit the current folder's guide (README markdown). PATCHes the folder, then a silent
  // reload re-renders the guide panel. Manager-gated at the API (owner/admin or owner).
  window.editFolderReadme = function () {
    if (!curFolder) return;
    var d = artCache[artKey(artFilter)];
    var cur = (d && d.folderReadme) || '';
    var mo = wsxModal(t('artifacts.guideTitle'), '<div class="wsx-cform"><p class="wsx-field__note">' + esc(t('artifacts.guideModalHint')) + '</p><textarea class="wsx-fguide__ta" id="fg_txt" rows="14" spellcheck="false" placeholder="' + escAttr(t('artifacts.guidePh')) + '"></textarea><div class="wsx-cform__foot"><button class="wsx-abtn" id="fg_cancel" type="button">' + esc(t('artifacts.cancel')) + '</button><button class="wsx-abtn wsx-abtn--primary" id="fg_go" type="button">' + esc(t('common.save')) + '</button></div></div>');
    var ta = document.getElementById('fg_txt'); if (ta) { ta.value = cur; ta.focus(); }
    document.getElementById('fg_cancel').addEventListener('click', function () { mo.close(); });
    document.getElementById('fg_go').addEventListener('click', function () {
      var fid = curFolder, txt = ta ? ta.value : '';
      optimistic({
        key: 'folder:readme:' + fid,
        apply: function () { mo.close(); if (d) d.folderReadme = txt; },
        rollback: function () { if (d) d.folderReadme = cur; },
        request: function () {
          return fetch(folderApiBase() + '/' + encodeURIComponent(fid), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readme: txt }) });
        },
        success: t('common.saved'),
        error: t('artifacts.couldNotSaveGuide'),
        done: function () { reloadFolders(); },
      });
    });
  };

`;
