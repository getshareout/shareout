/** Deliverables library (versions) and asset collections. */
export const workspace_client_home_views_assets_JS = `  // ----- Assets — deliverables library (versions) + collections (share/send) -----
  var ASSET_STATE = {};
  var assetFilter = 'all';
  var assetFolders = [];
  // Team Space folder creation follows members_can_create_folders; the folder list says
  // can_create. Admins (and personal folders) always can, so they never see it flicker.
  var assetCanCreateFolder = !window.WSX_WS || !!window.WSX_ADMIN;
  var assetFolder = '';
  var assetsWired = false;
  var assetSelect = false;
  var assetSel = {};
  // Files deleted optimistically whose DELETE hasn't landed — a reload keeps them hidden.
  var assetPendingDel = {};
  var ASVG = {
    dl: '<path d="M12 3v12"/><path d="M7 12l5 5 5-5"/><path d="M5 21h14"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>'
  };
  function commentsBase() { return '/v1/data/' + encodeURIComponent(ASSET_STATE.bucketId) + '/comments'; }
  function assetApiBase() { return window.WSX_WS ? '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/assets' : '/v1/assets'; }
  function folderApiBase() { return window.WSX_WS ? '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/folders' : '/v1/folders'; }
  function assetKind(m) { m = m || ''; if (m.indexOf('image/') === 0) return 'image'; if (m.indexOf('video/') === 0) return 'video'; return 'doc'; }
  function assetExt(name) { var p = (name || '').split('.'); return p.length > 1 ? p.pop().slice(0, 4).toUpperCase() : 'FILE'; }
  function assetItems() {
    var ds = (ASSET_STATE.deliverables || []).map(function (d) { return { type: 'deliverable', id: d.id, blobId: d.blobId, name: d.name, filename: d.filename, mimeType: d.mimeType, sizeBytes: d.sizeBytes, url: d.url, versionCount: d.versionCount, latestVersion: d.latestVersion, visibility: d.visibility, folderId: d.folderId || '', enrichment: d.enrichment || null, usageCount: d.usageCount || 0, canDelete: !!d.canDelete }; });
    var ls = (ASSET_STATE.loose || []).map(function (b) { return { type: 'loose', id: b.id, blobId: b.id, name: b.filename, filename: b.filename, mimeType: b.mimeType, sizeBytes: b.sizeBytes, url: b.url, versionCount: 1, latestVersion: 1, visibility: null, folderId: '', canDelete: !!b.canDelete }; });
    return ds.concat(ls).filter(function (x) { return !assetPendingDel[x.id]; });
  }
  function findItem(id) { return assetItems().filter(function (x) { return x.id === id; })[0]; }
  function selCount() { return Object.keys(assetSel).filter(function (k) { return assetSel[k]; }).length; }
  function assetThumb(a) {
    var kind = assetKind(a.mimeType);
    if (kind === 'image') return '<div class="wsx-asset__thumb"><img src="' + esc(a.url) + '" alt="" loading="lazy"></div>';
    if (kind === 'video') return '<div class="wsx-asset__thumb wsx-asset__thumb--vid"><video src="' + esc(a.url) + '#t=0.1" preload="metadata" muted></video><span class="wsx-asset__play">' + isvg('<path d="M8 5v14l11-7z"/>') + '</span></div>';
    return '<div class="wsx-asset__thumb wsx-asset__thumb--file">' + isvg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>') + '<span class="wsx-asset__ext">' + esc(assetExt(a.filename)) + '</span></div>';
  }
  // Visibility of a workspace File: team (members), private (owner + direct shares),
  // workspace (anyone with the link — the legacy, link-shareable value).
  var ASSET_VIS = [
    { v: 'team', label: 'assets.visTeam', hint: 'assets.visTeamHint', icon: 'lock' },
    { v: 'private', label: 'assets.visPrivate', hint: 'assets.visPrivateHint', icon: 'lock' },
    { v: 'workspace', label: 'assets.visLink', hint: 'assets.visLinkHint', icon: 'globe' }
  ];
  function visInfo(v) { return ASSET_VIS.filter(function (o) { return o.v === v; })[0] || null; }
  function visBadge(a) {
    var o = window.WSX_WS && a.type === 'deliverable' ? visInfo(a.visibility) : null;
    if (!o) return '';
    return '<span class="wsx-asset__vis wsx-asset__vis--' + o.v + '" title="' + esc(t(o.hint)) + '">' + isvg(ASVG[o.icon]) + esc(t(o.label)) + '</span>';
  }
  function assetTile(a) {
    var on = assetSel[a.id];
    var check = assetSelect ? '<button class="wsx-asset__check' + (on ? ' on' : '') + '" data-asset-sel="' + esc(a.id) + '" aria-label="' + esc(t('assets.select')) + '"></button>' : '';
    var ver = a.versionCount > 1 ? '<span class="wsx-asset__ver">v' + a.latestVersion + '</span>' : '';
    var enr = a.enrichment && a.enrichment.status === 'ok' ? a.enrichment : null;
    var tags = enr && enr.tags && enr.tags.length
      ? '<div class="wsx-asset__tags">' + enr.tags.slice(0, 4).map(function (tg) { return '<span class="wsx-asset__tag">' + esc(tg) + '</span>'; }).join('') + '</div>'
      : '';
    var nameTitle = enr && enr.summary ? enr.summary : a.filename;
    return '<article class="wsx-asset' + (on ? ' is-sel' : '') + '" data-asset-id="' + esc(a.id) + '" data-type="' + a.type + '" data-kind="' + assetKind(a.mimeType) + '" tabindex="0" role="button" aria-label="' + esc(a.name) + '">'
      + check + assetThumb(a) + ver
      + '<div class="wsx-asset__meta"><span class="wsx-asset__name" title="' + esc(nameTitle) + '">' + esc(a.name) + '</span><span class="wsx-asset__sz">' + adBytes(a.sizeBytes) + (a.versionCount > 1 ? ' \\u00b7 ' + esc(t('assets.versionsCount').replace('{n}', String(a.versionCount))) : '') + '</span>' + visBadge(a) + tags + '</div>'
      + '</article>';
  }
  // Click a file → preview with labeled actions (no hover-only icons; works on touch).
  function openAssetPreview(id) {
    var a = findItem(id); if (!a) return;
    var kind = assetKind(a.mimeType);
    var mime = (a.mimeType || '').split(';')[0].trim().toLowerCase();
    // PDF and audio are the doc types the content route serves inline; Office files download.
    var media = kind === 'image' ? '<img src="' + esc(a.url) + '" alt="">'
      : kind === 'video' ? '<video src="' + esc(a.url) + '" controls preload="metadata"></video>'
      : mime === 'application/pdf' ? '<iframe class="wsx-asset-pv__pdf" src="' + esc(a.url) + '" title="' + esc(a.name) + '"></iframe>'
      : mime.indexOf('audio/') === 0 ? '<audio src="' + esc(a.url) + '" controls preload="metadata"></audio>'
      : '<div class="wsx-asset__thumb--file">' + isvg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>') + '<span class="wsx-asset__ext">' + esc(assetExt(a.filename)) + '</span></div>';
    var isDlv = a.type === 'deliverable';
    var inWs = !!window.WSX_WS;
    var vis = '';
    if (isDlv && inWs) {
      var cur = visInfo(a.visibility) || ASSET_VIS[2];
      vis = '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('assets.visLabel')) + '</span><select class="wsx-field__in" id="pv_vis">'
        + ASSET_VIS.map(function (o) { return '<option value="' + o.v + '"' + (o.v === cur.v ? ' selected' : '') + '>' + esc(t(o.label)) + '</option>'; }).join('')
        + '</select></label><p class="wsx-field__note" id="pv_vishint">' + esc(t(cur.hint)) + '</p>';
    }
    function btn(act, label) { return '<button class="wsx-abtn" type="button" data-pv-act="' + act + '">' + esc(label) + '</button>'; }
    var acts = '<a class="wsx-abtn wsx-abtn--primary" href="' + esc(a.url) + '" download>' + isvg(ASVG.dl) + esc(t('assets.download')) + '</a>'
      + btn('copy', t('assets.copyLink'))
      + (isDlv && inWs ? btn('sharep', t('assets.share')) : '')
      + (canPublishAsset(a) ? btn('publish', t('move.toArtifact')) : '')
      + (isDlv ? btn('move', t('assets.move')) + btn('ver', t('assets.uploadNewVersion')) + btn('hist', t('assets.versionHistory')) + btn('cmt', t('assets.comments')) : '')
      + (isDlv && a.usageCount > 0 ? btn('usage', t('assets.usedIn')) : '')
      + (a.canDelete ? '<button class="so-c-btn so-c-btn--danger-outline" type="button" data-pv-act="del">' + esc(t('common.delete')) + '</button>' : '');
    var mo = wsxModal(a.name, '<div class="wsx-asset-pv"><div class="wsx-asset-pv__media' + (mime === 'application/pdf' ? ' wsx-asset-pv__media--doc' : '') + '">' + media + '</div>'
      + '<p class="wsx-field__note">' + adBytes(a.sizeBytes) + (a.versionCount > 1 ? ' \\u00b7 ' + esc(t('assets.versionsCount').replace('{n}', String(a.versionCount))) : '') + '</p>'
      + vis + '<div class="wsx-asset-pv__acts">' + acts + '</div></div>');
    var sel = mo.body.querySelector('#pv_vis');
    if (sel) sel.addEventListener('change', function () {
      var before = a.visibility;
      function hint(v) { var o = visInfo(v); var h = mo.body.querySelector('#pv_vishint'); if (o && h) h.textContent = t(o.hint); }
      hint(sel.value);
      patchDeliverable(a.id, { visibility: sel.value }, null, function () { sel.value = before; hint(before); });
    });
    mo.body.querySelectorAll('[data-pv-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-pv-act');
        if (act === 'copy') { copyText(a.url, b); return; }
        mo.close();
        if (act === 'del') deleteAsset(a);
        else if (act === 'ver') uploadVersion(a.id);
        else if (act === 'hist') showHistory(a.id);
        else if (act === 'cmt') openComments(a.id);
        else if (act === 'sharep') openSharePerson(a.id);
        else if (act === 'usage') openUsage(a.id);
        else if (act === 'move') moveAsset(a.id);
        else if (act === 'publish') publishFromAssets(a);
      });
    });
  }
  function assetRow(a) {
    var on = assetSel[a.id];
    var lead = assetSelect
      ? '<button class="wsx-asset__check wsx-asset__check--row' + (on ? ' on' : '') + '" data-asset-sel="' + esc(a.id) + '" aria-label="' + esc(t('assets.select')) + '"></button>'
      : '<span class="wsx-tr__icon">' + isvg(assetKind(a.mimeType) === 'image' ? '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>' : assetKind(a.mimeType) === 'video' ? '<path d="M8 5v14l11-7z"/>' : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>') + '</span>';
    var o = window.WSX_WS && a.type === 'deliverable' ? visInfo(a.visibility) : null;
    return '<div class="wsx-tr wsx-asset-row' + (on ? ' is-sel' : '') + '" data-asset-id="' + esc(a.id) + '" tabindex="0" role="button" aria-label="' + esc(a.name) + '">'
      + lead + '<span class="wsx-tr__name" title="' + esc(a.filename) + '">' + esc(a.name) + (a.versionCount > 1 ? ' <span class="wsx-asset__ver wsx-asset__ver--row">v' + a.latestVersion + '</span>' : '') + '</span>'
      + '<span class="wsx-tr__type">' + esc(assetExt(a.filename)) + '</span><span class="wsx-tr__views">' + adBytes(a.sizeBytes) + '</span>'
      + '<span class="wsx-tr__date">' + (o ? esc(t(o.label)) : '') + '</span></div>';
  }
  var FOLDER_ICON = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>';
  // Same shape as the Artifacts lens: a "Folders" row of cards at the root, a breadcrumb inside one.
  function renderFolderBar(all) {
    if (assetFolder) {
      var cur = assetFolders.filter(function (f) { return f.id === assetFolder; })[0];
      return '<div class="wsx-fbar"><nav class="folders-breadcrumb"><button type="button" class="crumb-root" data-folder="">' + esc(t('assets.allFiles')) + '</button><span class="crumb-sep">\\u203a</span><span class="crumb-current">' + esc(cur ? cur.name : '') + '</span></nav>'
        + (window.WSX_WS ? '<div class="wsx-fbar__acts"><button class="wsx-abtn" id="wsxFolderShare" type="button">' + esc(t('assets.shareFolder')) + '</button></div>' : '') + '</div>';
    }
    if (!assetFolders.length && !assetCanCreateFolder) return '';
    var cards = assetFolders.map(function (f) {
      var n = all.filter(function (a) { return a.folderId === f.id; }).length;
      return '<article class="wsx-folder-card" data-folder="' + esc(f.id) + '" tabindex="0" role="button"><span class="wsx-folder-card__icon">' + isvg(FOLDER_ICON) + '</span>'
        + '<span class="wsx-folder-card__txt"><span class="wsx-folder-card__name" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="wsx-folder-card__count">' + esc((n === 1 ? t('assets.filesCountOne') : t('assets.filesCount')).replace('{n}', String(n))) + '</span></span></article>';
    }).join('');
    var nf = assetCanCreateFolder ? '<button type="button" class="wsx-folder-new" id="wsxFolderNew">' + isvg('<path d="M12 5v14M5 12h14"/>') + '<span>' + esc(t('assets.newFolder')) + '</span></button>' : '';
    return '<section class="wsx-folders-sec"><div class="wsx-sec-row"><span class="wsx-sec-label">' + esc(t('artifacts.foldersLabel')) + '</span>' + nf + '</div>'
      + (cards ? '<div class="wsx-folder-grid">' + cards + '</div>' : '') + '</section>'
      + (cards ? '<div class="wsx-sec-label wsx-sec-label--pages">' + esc(t('assets.filesLabel')) + '</div>' : '');
  }
  function wireFolderBar(m) {
    m.querySelectorAll('[data-folder]').forEach(function (b) {
      function go() { assetFolder = b.getAttribute('data-folder'); renderAssets(); }
      b.addEventListener('click', go);
      b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    var nf = m.querySelector('#wsxFolderNew'); if (nf) nf.addEventListener('click', newAssetFolder);
    var fs = m.querySelector('#wsxFolderShare'); if (fs) fs.addEventListener('click', function () { openSharePerson(assetFolder, 'folder'); });
  }
  function renderAssets() {
    var m = document.getElementById('wsxAssetMount'); if (!m) return;
    var all = assetItems();
    if (assetFolder && !assetFolders.some(function (f) { return f.id === assetFolder; })) assetFolder = '';
    var known = {}; assetFolders.forEach(function (f) { known[f.id] = true; });
    // Root shows files outside any folder (or in one this viewer can't list), like Artifacts.
    var items = all.filter(function (a) { return assetFolder ? a.folderId === assetFolder : !known[a.folderId]; });
    if (assetFilter !== 'all') items = items.filter(function (a) { return assetKind(a.mimeType) === assetFilter; });
    var n = selCount();
    var selLbl = n === 1 ? t('assets.selectedOne') : t('assets.selectedMany');
    var bar = assetSelect
      ? '<div class="wsx-asset-bar"><span>' + esc(selLbl.replace('{n}', String(n))) + '</span><div class="wsx-asset-bar__r"><button class="wsx-abtn" id="wsxAssetCancel" type="button">' + esc(t('assets.cancel')) + '</button><button class="wsx-abtn wsx-abtn--primary" id="wsxAssetShare" type="button">' + esc(t('assets.createDelivery')) + '</button></div></div>'
      : (items.length ? '<div class="wsx-asset-bar"><button class="wsx-abtn" id="wsxAssetSelect" type="button">' + esc(t('assets.bundleFiles')) + '</button></div>' : '');
    var head = '<div class="wsx-tbl__head"><span></span><span>' + esc(t('widget.colName')) + '</span><span>' + esc(t('widget.colType')) + '</span><span>' + esc(t('assets.colSize')) + '</span><span>' + esc(t('assets.colAccess')) + '</span></div>';
    var grid = !items.length ? i18nEmpty(assetFolder ? 'assets.folderEmpty' : 'assets.empty')
      : widgetView('wsxAssetMount') === 'table' ? '<div class="wsx-tbl wsx-asset-tbl">' + head + items.map(assetRow).join('') + '</div>'
      : '<div class="wsx-asset-grid">' + items.map(assetTile).join('') + '</div>';
    m.innerHTML = renderFolderBar(all) + bar + grid;
    wireBar(m);
    wireFolderBar(m);
    m.querySelectorAll('[data-asset-sel]').forEach(function (b) {
      b.addEventListener('click', function () { var id = b.getAttribute('data-asset-sel'); assetSel[id] = !assetSel[id]; renderAssets(); });
    });
    m.querySelectorAll('.wsx-asset[data-asset-id], .wsx-asset-row[data-asset-id]').forEach(function (card) {
      var id = card.getAttribute('data-asset-id');
      function open(e) { if (e.target.closest('[data-asset-sel]')) return; if (assetSelect) { assetSel[id] = !assetSel[id]; renderAssets(); return; } openAssetPreview(id); }
      card.addEventListener('click', open);
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
    });
  }
  // Optimistic: the folder pill appears at once; the real one replaces it when the POST lands.
  function newAssetFolder() {
    var mo = wsxModal(t('assets.newFolder'), '<div class="wsx-cform">' + fld(t('assets.folderName'), 'fld_name', '') + '<div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="fld_go" type="button">' + esc(t('common.create')) + '</button></div></div>');
    document.getElementById('fld_go').addEventListener('click', function () {
      var name = cv('fld_name'); if (!name) return;
      var tmp = { id: 'tmp_' + Date.now(), name: name };
      optimistic({
        key: 'asset:folder:' + name,
        apply: function () { mo.close(); assetFolders = assetFolders.concat([tmp]); renderAssets(); },
        rollback: function () { assetFolders = assetFolders.filter(function (f) { return f !== tmp; }); if (assetFolder === tmp.id) assetFolder = ''; renderAssets(); },
        request: function () { return fetch(folderApiBase(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) }); },
        error: t('assets.toast.folderFailed'),
        errors: { ADMIN_REQUIRED: t('assets.err.adminFolders') },
        done: function () { fetchFolders(); },
      });
    });
  }
  function moveAsset(id) {
    var opts = '<option value="">' + esc(t('assets.folderNone')) + '</option>' + assetFolders.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>'; }).join('');
    var mo = wsxModal(t('assets.moveToFolder'), '<div class="wsx-cform"><label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('assets.folder')) + '</span><select class="wsx-field__in" id="mv_f">' + opts + '</select></label><div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="mv_go" type="button">' + esc(t('assets.move')) + '</button></div></div>');
    document.getElementById('mv_go').addEventListener('click', function () { patchDeliverable(id, { folderId: cv('mv_f') || null }, mo); });
  }
  function openComments(dlv) {
    var ctxq = 'file:' + dlv;
    var replyTo = null;
    var mo = wsxModal(t('assets.comments'), '<div class="wsx-cform"><div id="cmtList" class="wsx-cform__note">' + esc(t('common.loading')) + '</div>'
      + '<div id="cmt_replying" class="wsx-field__note" style="display:none"></div>'
      + '<label class="wsx-field"><textarea class="wsx-field__in" id="cmt_in" rows="2" placeholder="' + esc(t('assets.commentPlaceholder')) + '"></textarea></label>'
      + '<div id="cmt_err" class="wsx-field__note" style="color:var(--wsx-danger,#b91c1c)"></div>'
      + '<div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="cmt_go" type="button">' + esc(t('assets.postComment')) + '</button></div></div>');
    function cmtPayload(d) {
      // Data API envelope: { success, data: { comments, count } }
      if (!d) return [];
      if (d.data && Array.isArray(d.data.comments)) return d.data.comments;
      if (Array.isArray(d.comments)) return d.comments;
      return [];
    }
    function cmtRow(c, depth) {
      var when = c.createdAt ? ' \\u00b7 ' + esc(String(c.createdAt).slice(0, 10)) : '';
      var pad = depth ? ' style="margin-left:' + (depth * 14) + 'px;border-left:2px solid var(--wsx-border,#e5e7eb);padding-left:8px"' : '';
      return '<div class="wsx-share-send" data-cmt-id="' + esc(c.id) + '"' + pad + '><span><strong>' + esc(c.authorName || '') + '</strong>' + when + '<br>' + esc(c.content || '') + '</span>'
        + (depth < 2 ? '<button class="wsx-abtn" type="button" data-cmt-reply="' + esc(c.id) + '" data-cmt-author="' + esc(c.authorName || '') + '">' + esc(t('assets.reply') || 'Reply') + '</button>' : '')
        + '</div>';
    }
    function renderThread(cs) {
      if (!cs.length) return '<p class="wsx-field__note">' + esc(t('assets.noComments')) + '</p>';
      var byParent = {};
      cs.forEach(function (c) {
        var p = c.parentId || '';
        (byParent[p] = byParent[p] || []).push(c);
      });
      Object.keys(byParent).forEach(function (k) {
        byParent[k].sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); });
      });
      var roots = (byParent[''] || []).slice().reverse(); // newest roots first
      function kids(id, depth) {
        return (byParent[id] || []).map(function (c) {
          return cmtRow(c, depth) + kids(c.id, depth + 1);
        }).join('');
      }
      return roots.map(function (c) { return cmtRow(c, 0) + kids(c.id, 1); }).join('');
    }
    function setReply(id, author) {
      replyTo = id || null;
      var bar = document.getElementById('cmt_replying');
      if (!bar) return;
      if (!id) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
      bar.style.display = 'block';
      bar.innerHTML = esc((t('assets.replyingTo') || 'Replying to') + ' ' + (author || '')) + ' <button class="wsx-abtn" type="button" id="cmt_reply_cancel">' + esc(t('assets.cancel') || 'Cancel') + '</button>';
      var cancel = document.getElementById('cmt_reply_cancel');
      if (cancel) cancel.addEventListener('click', function () { setReply(null); });
    }
    function load() {
      var err = document.getElementById('cmt_err'); if (err) err.textContent = '';
      fetch(commentsBase() + '?contextId=' + encodeURIComponent(ctxq), { credentials: 'same-origin' })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          var el = document.getElementById('cmtList'); if (!el) return;
          if (!res.ok) {
            el.innerHTML = '<p class="wsx-field__note">' + esc(t('assets.noComments')) + '</p>';
            if (err) err.textContent = (res.j && (typeof res.j.error === 'string' ? res.j.error : res.j.message)) || t('common.error');
            return;
          }
          el.innerHTML = renderThread(cmtPayload(res.j));
          el.querySelectorAll('[data-cmt-reply]').forEach(function (b) {
            b.addEventListener('click', function () {
              setReply(b.getAttribute('data-cmt-reply'), b.getAttribute('data-cmt-author'));
              var ta = document.getElementById('cmt_in'); if (ta) ta.focus();
            });
          });
        }).catch(function () {
          var el = document.getElementById('cmtList');
          if (el) el.innerHTML = '<p class="wsx-field__note">' + esc(t('common.error')) + '</p>';
        });
    }
    load();
    // Exception to optimistic: the comment needs its server id + author to thread replies.
    document.getElementById('cmt_go').addEventListener('click', function () {
      var v = cv('cmt_in'); if (!v) return;
      var btn = document.getElementById('cmt_go'); if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = t('assets.sending'); }
      function idle() { if (btn) { btn.disabled = false; btn.textContent = t('assets.postComment'); } }
      var err = document.getElementById('cmt_err'); if (err) err.textContent = '';
      var body = { content: v, contextId: ctxq };
      if (replyTo) body.parentId = replyTo;
      fetch(commentsBase(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(okOr)
        .then(function () {
          idle();
          var i = document.getElementById('cmt_in'); if (i) i.value = '';
          setReply(null);
          load();
        }).catch(function (e) {
          idle();
          if (err) err.textContent = errReason(e, '') || t('common.error');
        });
    });
  }
  function openSharePerson(resId, resType) {
    var rt = resType || 'file';
    var grantsBase = '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/grants';
    var pendingRevokes = {};
    var cap = '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('assets.shareAccess')) + '</span><select class="wsx-field__in" id="sp_cap"><option value="view">' + esc(t('assets.shareCapView')) + '</option><option value="comment">' + esc(t('assets.shareCapComment')) + '</option></select></label>';
    var mo = wsxModal(t(rt === 'folder' ? 'assets.shareFolder' : 'assets.shareWithPerson'), '<div class="wsx-cform">'
      + '<div id="sp_shared" class="wsx-cform__note">' + esc(t('common.loading')) + '</div>'
      + fld(t('assets.shareEmail'), 'sp_email', '') + cap
      + '<p class="wsx-field__note">' + esc(t('assets.shareHint')) + '</p><div id="sp_msg" class="wsx-field__note"></div>'
      + '<div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="sp_go" type="button">' + esc(t('assets.shareSend')) + '</button></div></div>');
    function loadShares() {
      fetch(grantsBase + '?resource_type=' + encodeURIComponent(rt) + '&resource_id=' + encodeURIComponent(resId), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var gs = ((d && d.grants) || []).filter(function (g) { return !pendingRevokes[g.id]; }); var el = document.getElementById('sp_shared'); if (!el) return;
          el.innerHTML = gs.length ? '<div class="wsx-field__lbl">' + esc(t('assets.sharedWith')) + '</div>' + gs.map(function (g) {
            return '<div class="wsx-share-send"><span>' + esc(g.subject_label || g.subject_id) + ' \\u00b7 ' + esc(g.capability) + '</span><button class="wsx-abtn" type="button" data-rv="' + esc(g.id) + '">' + esc(t('assets.revoke')) + '</button></div>';
          }).join('') : '<p class="wsx-field__note">' + esc(t('assets.noShares')) + '</p>';
          Array.prototype.forEach.call(el.querySelectorAll('[data-rv]'), function (b) {
            b.addEventListener('click', function () {
              var gid = b.getAttribute('data-rv'), gone = null;
              optimistic({
                key: 'grant:del:' + gid,
                undo: true,
                apply: function () { pendingRevokes[gid] = true; gone = window.soOptimistic.leave(b.closest('.wsx-share-send')); },
                rollback: function () { delete pendingRevokes[gid]; if (gone) gone.restore(); },
                request: function () { return fetch(grantsBase + '/' + encodeURIComponent(gid), { method: 'DELETE', credentials: 'same-origin', keepalive: true }); },
                success: t('assets.toast.revoked'),
                error: t('assets.toast.revokeFailed'),
                done: function () { delete pendingRevokes[gid]; if (gone) gone.commit(); },
              });
            });
          });
        }).catch(function () {});
    }
    loadShares();
    // Exception to optimistic: the server resolves the email to a person and invites them.
    document.getElementById('sp_go').addEventListener('click', function () {
      var email = cv('sp_email'); var msg = document.getElementById('sp_msg'); if (!email) return;
      var go = this; if (go.disabled) return;
      var label = go.textContent; go.disabled = true; go.textContent = t('assets.sending');
      function idle() { go.disabled = false; go.textContent = label; }
      fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/share-person', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource_type: rt, resource_id: resId, email: email, capability: cv('sp_cap') || 'view' }) })
        .then(okOr)
        .then(function () { idle(); var i = document.getElementById('sp_email'); if (i) i.value = ''; if (msg) msg.textContent = ''; loadShares(); })
        .catch(function (e) { idle(); if (msg) msg.textContent = errReason(e, '') || t('assets.shareErr'); });
    });
  }
  function openUsage(dlv) {
    var mo = wsxModal(t('assets.usedIn'), '<div class="wsx-cform"><div id="use_list" class="wsx-field__note">' + esc(t('common.loading')) + '</div></div>');
    fetch(assetApiBase() + '/deliverables/' + encodeURIComponent(dlv) + '/usage', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var us = (d && d.usage) || []; var el = document.getElementById('use_list'); if (!el) return;
        el.innerHTML = us.length ? us.map(function (a) {
          var href = a.slug ? '/a/' + encodeURIComponent(a.slug) + '/' : null;
          var label = esc(a.name || a.slug || a.artifactId);
          return '<div class="wsx-share-send"><span>' + (href ? '<a href="' + href + '" target="_blank" rel="noopener">' + label + '</a>' : label) + '</span></div>';
        }).join('') : '<p class="wsx-field__note">' + esc(t('assets.usedInNone')) + '</p>';
      }).catch(function () {});
  }
  // Optimistic: the file's folder / visibility changes in the list at once; a failed PATCH
  // restores the old values (and onRollback fixes any control that showed the new one).
  function patchDeliverable(id, body, mo, onRollback) {
    var d = (ASSET_STATE.deliverables || []).filter(function (x) { return x.id === id; })[0];
    var prev = {};
    Object.keys(body).forEach(function (k) { prev[k] = d ? d[k] : undefined; });
    optimistic({
      key: 'asset:patch:' + id,
      apply: function () { if (mo) mo.close(); if (d) { Object.keys(body).forEach(function (k) { d[k] = body[k]; }); renderAssets(); } },
      rollback: function () { if (d) { Object.keys(prev).forEach(function (k) { d[k] = prev[k]; }); renderAssets(); } if (onRollback) onRollback(); },
      request: function () { return fetch(assetApiBase() + '/deliverables/' + encodeURIComponent(id), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); },
      error: t('assets.toast.updateFailed'),
      done: function () { fetchAssets(); },
    });
  }
  function fetchFolders() {
    fetch(folderApiBase(), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { assetFolders = (d && d.folders) || []; if (d && typeof d.can_create === 'boolean') assetCanCreateFolder = d.can_create; renderAssets(); }).catch(function () {});
  }
  function wireBar(m) {
    var s = m.querySelector('#wsxAssetSelect'); if (s) s.addEventListener('click', function () { assetSelect = true; assetSel = {}; renderAssets(); });
    var c = m.querySelector('#wsxAssetCancel'); if (c) c.addEventListener('click', function () { assetSelect = false; assetSel = {}; renderAssets(); });
    var sh = m.querySelector('#wsxAssetShare'); if (sh) sh.addEventListener('click', openShareModal);
  }
  // Delete: confirm closes at once, the tile leaves, and an Undo toast holds the DELETE.
  function deleteAsset(it) {
    if (!it) return;
    var mo = wsxModal(t('assets.deleteTitle'), '<div class="wsx-cform"><p class="wsx-field__note">' + esc(t('assets.deleteConfirm').replace('{name}', it.name || t('assets.thisAsset'))) + '</p>'
      + '<div class="wsx-cform__foot"><button class="wsx-abtn" type="button" id="del_no">' + esc(t('assets.cancel')) + '</button><button class="so-c-btn so-c-btn--danger" type="button" id="del_go">' + esc(t('common.delete')) + '</button></div></div>');
    mo.body.querySelector('#del_no').addEventListener('click', mo.close);
    mo.body.querySelector('#del_go').addEventListener('click', function () {
      mo.close();
      var url = it.type === 'deliverable' ? assetApiBase() + '/deliverables/' + encodeURIComponent(it.id) : assetApiBase() + '/' + encodeURIComponent(it.blobId);
      optimistic({
        key: 'asset:del:' + it.id,
        undo: true,
        apply: function () { assetPendingDel[it.id] = true; delete assetSel[it.id]; renderAssets(); },
        rollback: function () { delete assetPendingDel[it.id]; renderAssets(); },
        request: function () { return fetch(url, { method: 'DELETE', credentials: 'same-origin', keepalive: true }); },
        success: t('assets.toast.deleted'),
        error: t('assets.toast.deleteFailed'),
        done: function () { delete assetPendingDel[it.id]; fetchAssets(); },
      });
    });
  }
  function fetchAssets() {
    var m = document.getElementById('wsxAssetMount'); if (m && !ASSET_STATE.deliverables) m.innerHTML = i18nLoad();
    fetch(assetApiBase(), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (!d) { if (m) m.innerHTML = i18nError('common.couldNotLoad'); return; } ASSET_STATE = d; renderAssets(); })
      .catch(function () { if (m) m.innerHTML = i18nError('common.couldNotLoad'); });
    fetchFolders();
  }
  // Upload one file, then link it as a new deliverable (default) or a new version.
  // cb(false, reason, err) on failure — every step's reply is checked, the last one too.
  function uploadOne(f, deliverableId, cb, visibility) {
    var mime = f.type || 'application/octet-stream';
    function json(r) { return r.json(); }
    fetch(assetApiBase() + '/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f.name, mimeType: mime, size: f.size }) })
      .then(okOr).then(json)
      .then(function (j) { var d = j && j.data; if (!d || !d.uploadUrl) throw new Error('upload'); return fetch(d.uploadUrl, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': mime }, body: f }).then(okOr).then(json); })
      .then(function (pj) { var blobId = pj && pj.data && pj.data.id; if (!blobId) throw new Error('upload');
        if (deliverableId) return fetch(assetApiBase() + '/deliverables/' + encodeURIComponent(deliverableId) + '/version', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blobId: blobId }) });
        var name = (f.name || t('assets.untitled')).replace(/\\.[^.]+$/, '');
        var dbody = { blobId: blobId, name: name }; if (visibility) dbody.visibility = visibility;
        return fetch(assetApiBase() + '/deliverables', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dbody) });
      })
      .then(okOr)
      .then(function () { if (cb) cb(true); })
      .catch(function (err) { if (cb) cb(false, window.soOptimistic.describe(err).detail || '', err); });
  }
  // Upload blob only (no deliverable) — for chat attach + share-target handoff.
  function uploadBlobOnly(f, cb) {
    var mime = f.type || 'application/octet-stream';
    fetch(assetApiBase() + '/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f.name, mimeType: mime, size: f.size }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { var d = j && j.data; if (!d || !d.uploadUrl) throw 0; return fetch(d.uploadUrl, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': mime }, body: f }).then(function (r) { return r.json(); }); })
      .then(function (pj) {
        var blobId = pj && pj.data && pj.data.id;
        if (!blobId) throw 0;
        return fetch(assetApiBase() + '/' + encodeURIComponent(blobId) + '/origin', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'chat' }) }).then(function () { return blobId; });
      })
      .then(function (blobId) { if (cb) cb(blobId, f.name); })
      .catch(function () { if (cb) cb(null, f.name); });
  }
  // In a workspace, ask who can see the files before uploading (team is preselected).
  function askUploadVisibility(files) {
    if (!files.length) return;
    if (!window.WSX_WS) { uploadAssets(files); return; }
    var opts = ASSET_VIS.map(function (o, i) {
      return '<label class="wsx-vis-opt"><input type="radio" name="up_vis" value="' + o.v + '"' + (i === 0 ? ' checked' : '') + '>'
        + '<span><b>' + isvg(ASVG[o.icon]) + esc(t(o.label)) + '</b><span class="wsx-field__note">' + esc(t(o.hint)) + '</span></span></label>';
    }).join('');
    var mo = wsxModal(t('assets.visAsk'), '<div class="wsx-cform"><div class="wsx-vis-opts">' + opts + '</div>'
      + '<div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" type="button" id="up_go">' + esc(t('assets.upload')) + '</button></div></div>');
    mo.body.querySelector('#up_go').addEventListener('click', function () {
      var c = mo.body.querySelector('input[name="up_vis"]:checked');
      mo.close();
      uploadAssets(files, c ? c.value : 'team');
    });
  }
  function uploadAssets(files, visibility) {
    if (!files.length) return;
    var btn = document.getElementById('wsxAssetUpload'); if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    var failed = 0; var firstErr = null;
    function next(i) {
      if (i >= files.length) {
        if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
        fetchAssets();
        if (failed) failToast(firstErr, failed === 1 ? t('assets.uploadFailedOne') : t('assets.uploadFailedMany').replace('{n}', String(failed)));
        return;
      }
      uploadOne(files[i], null, function (ok, msg, err) { if (ok === false) { failed++; if (!firstErr) firstErr = err; } next(i + 1); }, visibility);
    }
    next(0);
  }
  function uploadVersion(deliverableId) {
    var inp = document.createElement('input'); inp.type = 'file';
    // Exception to optimistic (upload): say it started, then report the outcome.
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      showToast(t('common.uploading'));
      uploadOne(f, deliverableId, function (ok, msg, err) { fetchAssets(); if (ok) showToast(t('common.uploaded'), 'success'); else failToast(err, t('assets.uploadFailedOne')); });
    });
    inp.click();
  }
  function showHistory(deliverableId) {
    fetch(assetApiBase() + '/deliverables/' + encodeURIComponent(deliverableId) + '/versions', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var vs = (d && d.versions) || [];
        var rows = vs.map(function (v) { var u = '/v1/files/' + encodeURIComponent(deliverableId) + '/content?v=' + v.versionNo; return '<div class="wsx-share-send"><span>v' + v.versionNo + ' \\u00b7 ' + esc(v.filename) + ' \\u00b7 ' + adBytes(v.sizeBytes) + '</span><a class="wsx-abtn" href="' + u + '" download>' + esc(t('assets.download')) + '</a></div>'; }).join('');
        wsxModal(t('assets.versionHistory'), '<div class="wsx-cform">' + (rows || '<p class="wsx-field__note">' + esc(t('assets.noVersions')) + '</p>') + '</div>');
      }).catch(function () {});
  }
  function openShareModal() {
    var ids = Object.keys(assetSel).filter(function (k) { return assetSel[k]; });
    if (!ids.length) return;
    var mo = wsxModal(t('assets.createDeliveryTitle'), '<div class="wsx-cform">'
      + fld(t('assets.deliveryName'), 'dl_name', t('assets.deliveryNamePh'))
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('assets.linkExpires')) + '</span><input class="wsx-field__in" id="dl_exp" type="date"></label>'
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('assets.protectLink')) + '</span><select class="wsx-field__in" id="dl_gate"><option value="none">' + esc(t('assets.gateAnyone')) + '</option><option value="password">' + esc(t('assets.gatePassword')) + '</option><option value="domain">' + esc(t('assets.gateDomain')) + '</option></select></label>'
      + '<div id="dl_gatefields"></div>'
      + '<div class="wsx-cform__err" id="dl_err"></div>'
      + '<div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="dl_go" type="button">' + esc(t('assets.createLink')) + '</button></div>'
      + '<div id="dl_result"></div></div>');
    var gsel = document.getElementById('dl_gate');
    function renderGateFields() {
      var g = gsel.value; var c = document.getElementById('dl_gatefields');
      c.innerHTML = g === 'password' ? fld(t('assets.password'), 'dl_pw', '')
        : g === 'domain' ? fld(t('assets.allowedDomains'), 'dl_doms', t('assets.allowedDomainsPh'))
        : '';
    }
    gsel.addEventListener('change', renderGateFields);
    // Collect the gate payload; returns null + sets the error on invalid input.
    function gatePayload(err) {
      var g = gsel.value;
      if (g === 'password') { var pw = cv('dl_pw'); if (!pw) { err.textContent = t('assets.errEnterPassword'); return null; } return { gate: 'password', password: pw }; }
      if (g === 'domain') { var doms = (cv('dl_doms') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); if (!doms.length) { err.textContent = t('assets.errEnterDomain'); return null; } return { gate: 'domain', domains: doms }; }
      return { gate: 'none' };
    }
    document.getElementById('dl_go').addEventListener('click', function () {
      var name = cv('dl_name') || t('assets.defaultDeliveryName'); var exp = cv('dl_exp'); var err = document.getElementById('dl_err'); var b = this; err.textContent = '';
      var gp = gatePayload(err); if (!gp) return;
      // Exception to optimistic: the share link is generated by the server.
      var label = b.textContent; b.disabled = true; b.textContent = t('common.creating');
      var expIso = exp ? new Date(exp).toISOString() : null;
      function shareBody() { var o = { gate: gp.gate }; if (expIso) o.expiresAt = expIso; if (gp.password) o.password = gp.password; if (gp.domains) o.domains = gp.domains; return o; }
      fetch(assetApiBase() + '/collections', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, deliverableIds: ids }) })
        .then(okOr).then(function (r) { return r.json(); })
        .then(function (c) { if (!c || !c.id) throw new Error('collection'); return fetch(assetApiBase() + '/collections/' + encodeURIComponent(c.id) + '/share', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(shareBody()) }).then(okOr).then(function (r) { return r.json().then(function (s) { return { id: c.id, url: s.url }; }); }); })
        .then(function (res) { b.disabled = false; b.textContent = label; showShareResult(res.id, res.url, expIso, gp); })
        .catch(function (e) { b.disabled = false; b.textContent = label; err.textContent = errReason(e, t('assets.errCreateLink')); });
    });
  }
  function showShareResult(colId, url, expIso, gp) {
    var r = document.getElementById('dl_result'); if (!r) return;
    r.innerHTML = '<div class="wsx-share-out"><div class="wsx-share-link"><input class="wsx-field__in" id="dl_url" value="' + esc(url) + '" readonly><button class="wsx-abtn" id="dl_copy" type="button">' + esc(t('assets.copy')) + '</button></div>'
      + '<div class="wsx-share-send">' + fld(t('assets.sendToClient'), 'dl_to', t('assets.sendToClientPh')) + '<button class="wsx-abtn wsx-abtn--primary" id="dl_send" type="button">' + esc(t('assets.send')) + '</button></div>'
      + '<div id="dl_sendmsg" class="wsx-field__note"></div></div>';
    document.getElementById('dl_copy').addEventListener('click', function () { copyText(url, this); });
    document.getElementById('dl_send').addEventListener('click', function () {
      var to = cv('dl_to'); var msg = document.getElementById('dl_sendmsg'); if (!to) { msg.textContent = t('assets.errEnterEmail'); return; }
      var b = this; b.disabled = true; msg.textContent = t('assets.sending');
      var sendBody = { to: to }; if (expIso) sendBody.expiresAt = expIso;
      if (gp && gp.gate && gp.gate !== 'none') { sendBody.gate = gp.gate; if (gp.password) sendBody.password = gp.password; if (gp.domains) sendBody.domains = gp.domains; }
      fetch(assetApiBase() + '/collections/' + encodeURIComponent(colId) + '/send', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sendBody) })
        .then(okOr).then(function (r) { return r.json(); }).then(function (j) { b.disabled = false; msg.textContent = j && j.sent ? t('assets.sentTo').replace('{email}', to) : t('assets.errCouldNotSend'); })
        .catch(function (e) { b.disabled = false; msg.textContent = errReason(e, t('assets.errCouldNotSend')); });
    });
    assetSelect = false; assetSel = {}; renderAssets();
  }
`;
