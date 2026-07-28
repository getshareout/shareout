/** Deliverables library (versions) and asset collections. */
export const workspace_client_home_views_assets_JS = `  // ----- Assets — deliverables library (versions) + collections (share/send) -----
  var ASSET_STATE = {};
  var assetFilter = 'all';
  var assetFolders = [];
  var assetFolder = '';
  var assetsWired = false;
  var assetSelect = false;
  var assetSel = {};
  var ASVG = {
    copy: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    dl: '<path d="M12 3v12"/><path d="M7 12l5 5 5-5"/><path d="M5 21h14"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    chat: '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5a8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5z"/>',
    userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    link: '<path d="M4 5a1 1 0 0 1 1-1h6l2 2h6a1 1 0 0 1 1 1v3"/><rect x="3" y="10" width="12" height="10" rx="1"/><path d="M18 13v7M21 13v7"/>'
  };
  function commentsBase() { return '/v1/data/' + encodeURIComponent(ASSET_STATE.bucketId) + '/comments'; }
  function assetApiBase() { return window.WSX_WS ? '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/assets' : '/v1/assets'; }
  function folderApiBase() { return window.WSX_WS ? '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/folders' : '/v1/folders'; }
  function assetKind(m) { m = m || ''; if (m.indexOf('image/') === 0) return 'image'; if (m.indexOf('video/') === 0) return 'video'; return 'doc'; }
  function assetExt(name) { var p = (name || '').split('.'); return p.length > 1 ? p.pop().slice(0, 4).toUpperCase() : 'FILE'; }
  function assetItems() {
    var ds = (ASSET_STATE.deliverables || []).map(function (d) { return { type: 'deliverable', id: d.id, blobId: d.blobId, name: d.name, filename: d.filename, mimeType: d.mimeType, sizeBytes: d.sizeBytes, url: d.url, versionCount: d.versionCount, latestVersion: d.latestVersion, visibility: d.visibility, folderId: d.folderId || '', enrichment: d.enrichment || null, usageCount: d.usageCount || 0 }; });
    var ls = (ASSET_STATE.loose || []).map(function (b) { return { type: 'loose', id: b.id, blobId: b.id, name: b.filename, filename: b.filename, mimeType: b.mimeType, sizeBytes: b.sizeBytes, url: b.url, versionCount: 1, latestVersion: 1, visibility: null, folderId: '' }; });
    return ds.concat(ls);
  }
  function findItem(id) { return assetItems().filter(function (x) { return x.id === id; })[0]; }
  function selCount() { return Object.keys(assetSel).filter(function (k) { return assetSel[k]; }).length; }
  function assetThumb(a) {
    var kind = assetKind(a.mimeType);
    if (kind === 'image') return '<div class="wsx-asset__thumb"><img src="' + esc(a.url) + '" alt="" loading="lazy"></div>';
    if (kind === 'video') return '<div class="wsx-asset__thumb wsx-asset__thumb--vid"><video src="' + esc(a.url) + '#t=0.1" preload="metadata" muted></video><span class="wsx-asset__play">' + isvg('<path d="M8 5v14l11-7z"/>') + '</span></div>';
    return '<div class="wsx-asset__thumb wsx-asset__thumb--file">' + isvg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>') + '<span class="wsx-asset__ext">' + esc(assetExt(a.filename)) + '</span></div>';
  }
  function aBtn(act, title, svg, cls) { return '<button class="wsx-asset__act' + (cls ? ' ' + cls : '') + '" data-asset-act="' + act + '" title="' + esc(title) + '" aria-label="' + esc(title) + '">' + isvg(svg) + '</button>'; }
  function assetTile(a) {
    var on = assetSel[a.id];
    var check = assetSelect ? '<button class="wsx-asset__check' + (on ? ' on' : '') + '" data-asset-sel="' + esc(a.id) + '" aria-label="' + esc(t('assets.select')) + '"></button>' : '';
    var ver = a.versionCount > 1 ? '<span class="wsx-asset__ver">v' + a.latestVersion + '</span>' : '';
    var priv = (window.WSX_WS && a.visibility === 'private') ? '<span class="wsx-asset__ver wsx-asset__ver--lock">' + esc(t('assets.private')) + '</span>' : '';
    var actions = '';
    if (a.type === 'deliverable') {
      actions += aBtn('ver', t('assets.uploadNewVersion'), ASVG.plus) + aBtn('hist', t('assets.versionHistory'), ASVG.clock) + aBtn('cmt', t('assets.comments'), ASVG.chat) + aBtn('move', t('assets.moveToFolder'), ASVG.folder);
      if (window.WSX_WS) actions += aBtn('vis', a.visibility === 'private' ? t('assets.makeWorkspace') : t('assets.makePrivate'), a.visibility === 'private' ? ASVG.lock : ASVG.globe)
        + aBtn('sharep', t('assets.shareWithPerson'), ASVG.userplus);
      if (a.usageCount > 0) actions += aBtn('usage', t('assets.usedIn'), ASVG.link);
    }
    var enr = a.enrichment && a.enrichment.status === 'ok' ? a.enrichment : null;
    var tags = enr && enr.tags && enr.tags.length
      ? '<div class="wsx-asset__tags">' + enr.tags.slice(0, 4).map(function (tg) { return '<span class="wsx-asset__tag">' + esc(tg) + '</span>'; }).join('') + '</div>'
      : '';
    var nameTitle = enr && enr.summary ? enr.summary : a.filename;
    return '<article class="wsx-asset' + (on ? ' is-sel' : '') + '" data-asset-id="' + esc(a.id) + '" data-type="' + a.type + '" data-kind="' + assetKind(a.mimeType) + '">'
      + check + assetThumb(a) + ver + priv
      + '<div class="wsx-asset__meta"><span class="wsx-asset__name" title="' + esc(nameTitle) + '">' + esc(a.name) + '</span><span class="wsx-asset__sz">' + adBytes(a.sizeBytes) + (a.versionCount > 1 ? ' \\u00b7 ' + esc(t('assets.versionsCount').replace('{n}', String(a.versionCount))) : '') + '</span>' + tags + '</div>'
      + '<div class="wsx-asset__actions">' + actions + aBtn('copy', t('assets.copyLink'), ASVG.copy)
      +   '<a class="wsx-asset__act" href="' + esc(a.url) + '" download title="' + esc(t('assets.download')) + '" aria-label="' + esc(t('assets.download')) + '">' + isvg(ASVG.dl) + '</a>'
      +   aBtn('del', t('common.delete'), ASVG.trash, 'danger')
      + '</div></article>';
  }
  function renderFolderBar() {
    var pills = '<button class="wsx-abtn' + (assetFolder ? '' : ' wsx-abtn--primary') + '" data-folder="" type="button">' + esc(t('assets.allFiles')) + '</button>';
    pills += assetFolders.map(function (f) { return '<button class="wsx-abtn' + (assetFolder === f.id ? ' wsx-abtn--primary' : '') + '" data-folder="' + esc(f.id) + '" type="button">' + esc(f.name) + '</button>'; }).join('');
    pills += '<button class="wsx-abtn" id="wsxFolderNew" type="button">' + esc(t('assets.newFolder')) + '</button>';
    if (assetFolder && window.WSX_WS) pills += '<button class="wsx-abtn" id="wsxFolderShare" type="button">' + esc(t('assets.shareFolder')) + '</button>';
    return '<div class="wsx-asset-folders">' + pills + '</div>';
  }
  function wireFolderBar(m) {
    m.querySelectorAll('[data-folder]').forEach(function (b) {
      b.addEventListener('click', function () { assetFolder = b.getAttribute('data-folder'); renderAssets(); });
    });
    var nf = m.querySelector('#wsxFolderNew'); if (nf) nf.addEventListener('click', newAssetFolder);
    var fs = m.querySelector('#wsxFolderShare'); if (fs) fs.addEventListener('click', function () { openSharePerson(assetFolder, 'folder'); });
  }
  function renderAssets() {
    var m = document.getElementById('wsxAssetMount'); if (!m) return;
    var items = assetItems();
    if (assetFilter !== 'all') items = items.filter(function (a) { return assetKind(a.mimeType) === assetFilter; });
    if (assetFolder) items = items.filter(function (a) { return a.folderId === assetFolder; });
    var n = selCount();
    var selLbl = n === 1 ? t('assets.selectedOne') : t('assets.selectedMany');
    var bar = assetSelect
      ? '<div class="wsx-asset-bar"><span>' + esc(selLbl.replace('{n}', String(n))) + '</span><div class="wsx-asset-bar__r"><button class="wsx-abtn" id="wsxAssetCancel" type="button">' + esc(t('assets.cancel')) + '</button><button class="wsx-abtn wsx-abtn--primary" id="wsxAssetShare" type="button">' + esc(t('assets.createDelivery')) + '</button></div></div>'
      : (items.length ? '<div class="wsx-asset-bar"><button class="wsx-abtn" id="wsxAssetSelect" type="button">' + esc(t('assets.bundleFiles')) + '</button></div>' : '');
    var grid = items.length ? '<div class="wsx-asset-grid">' + items.map(assetTile).join('') + '</div>' : i18nEmpty('assets.empty');
    m.innerHTML = renderFolderBar() + bar + grid;
    wireBar(m);
    wireFolderBar(m);
    m.querySelectorAll('[data-asset-sel]').forEach(function (b) {
      b.addEventListener('click', function () { var id = b.getAttribute('data-asset-sel'); assetSel[id] = !assetSel[id]; renderAssets(); });
    });
    m.querySelectorAll('[data-asset-act]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        var act = b.getAttribute('data-asset-act'); if (act === 'copy') e.preventDefault();
        var card = b.closest('[data-asset-id]'); var id = card.getAttribute('data-asset-id'); var it = findItem(id);
        if (act === 'copy') { if (it) copyText(it.url, b); }
        else if (act === 'del') { e.preventDefault(); deleteAsset(it); }
        else if (act === 'ver') { e.preventDefault(); uploadVersion(id); }
        else if (act === 'hist') { e.preventDefault(); showHistory(id); }
        else if (act === 'cmt') { e.preventDefault(); openComments(id); }
        else if (act === 'sharep') { e.preventDefault(); openSharePerson(id); }
        else if (act === 'usage') { e.preventDefault(); openUsage(id); }
        else if (act === 'move') { e.preventDefault(); moveAsset(id); }
        else if (act === 'vis') { e.preventDefault(); toggleAssetVis(it); }
      });
    });
  }
  function newAssetFolder() {
    var mo = wsxModal(t('assets.newFolder'), '<div class="wsx-cform">' + fld(t('assets.folderName'), 'fld_name', '') + '<div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="fld_go" type="button">' + esc(t('common.create')) + '</button></div></div>');
    document.getElementById('fld_go').addEventListener('click', function () {
      var name = cv('fld_name'); if (!name) return;
      fetch(folderApiBase(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function () { mo.close(); fetchFolders(); }).catch(function () {});
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
    document.getElementById('cmt_go').addEventListener('click', function () {
      var v = cv('cmt_in'); if (!v) return;
      var btn = document.getElementById('cmt_go'); if (btn) btn.disabled = true;
      var err = document.getElementById('cmt_err'); if (err) err.textContent = '';
      var body = { content: v, contextId: ctxq };
      if (replyTo) body.parentId = replyTo;
      fetch(commentsBase(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (btn) btn.disabled = false;
          if (!res.ok) {
            if (err) err.textContent = (res.j && (typeof res.j.error === 'string' ? res.j.error : res.j.message)) || t('common.error');
            return;
          }
          var i = document.getElementById('cmt_in'); if (i) i.value = '';
          setReply(null);
          load();
        }).catch(function () {
          if (btn) btn.disabled = false;
          if (err) err.textContent = t('common.error');
        });
    });
  }
  function openSharePerson(resId, resType) {
    var rt = resType || 'file';
    var grantsBase = '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/grants';
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
          var gs = (d && d.grants) || []; var el = document.getElementById('sp_shared'); if (!el) return;
          el.innerHTML = gs.length ? '<div class="wsx-field__lbl">' + esc(t('assets.sharedWith')) + '</div>' + gs.map(function (g) {
            return '<div class="wsx-share-send"><span>' + esc(g.subject_label || g.subject_id) + ' \\u00b7 ' + esc(g.capability) + '</span><button class="wsx-abtn" type="button" data-rv="' + esc(g.id) + '">' + esc(t('assets.revoke')) + '</button></div>';
          }).join('') : '<p class="wsx-field__note">' + esc(t('assets.noShares')) + '</p>';
          Array.prototype.forEach.call(el.querySelectorAll('[data-rv]'), function (b) {
            b.addEventListener('click', function () {
              fetch(grantsBase + '/' + encodeURIComponent(b.getAttribute('data-rv')), { method: 'DELETE', credentials: 'same-origin' })
                .then(function (r) { if (r.ok) loadShares(); }).catch(function () {});
            });
          });
        }).catch(function () {});
    }
    loadShares();
    document.getElementById('sp_go').addEventListener('click', function () {
      var email = cv('sp_email'); var msg = document.getElementById('sp_msg'); if (!email) return;
      fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/share-person', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource_type: rt, resource_id: resId, email: email, capability: cv('sp_cap') || 'view' }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) { if (res.ok) { var i = document.getElementById('sp_email'); if (i) i.value = ''; if (msg) msg.textContent = ''; loadShares(); } else if (msg) { msg.textContent = (res.j && (res.j.error || res.j.message)) || t('assets.shareErr'); } })
        .catch(function () { if (msg) msg.textContent = t('assets.shareErr'); });
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
  function toggleAssetVis(it) { if (it) patchDeliverable(it.id, { visibility: it.visibility === 'private' ? 'workspace' : 'private' }); }
  function patchDeliverable(id, body, mo) {
    fetch(assetApiBase() + '/deliverables/' + encodeURIComponent(id), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function () { if (mo) mo.close(); fetchAssets(); }).catch(function () {});
  }
  function fetchFolders() {
    fetch(folderApiBase(), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { assetFolders = (d && d.folders) || []; renderAssets(); }).catch(function () {});
  }
  function wireBar(m) {
    var s = m.querySelector('#wsxAssetSelect'); if (s) s.addEventListener('click', function () { assetSelect = true; assetSel = {}; renderAssets(); });
    var c = m.querySelector('#wsxAssetCancel'); if (c) c.addEventListener('click', function () { assetSelect = false; assetSel = {}; renderAssets(); });
    var sh = m.querySelector('#wsxAssetShare'); if (sh) sh.addEventListener('click', openShareModal);
  }
  function deleteAsset(it) {
    if (!it) return;
    if (!window.confirm(t('assets.deleteConfirm').replace('{name}', it.name || t('assets.thisAsset')))) return;
    var url = it.type === 'deliverable' ? assetApiBase() + '/deliverables/' + encodeURIComponent(it.id) : assetApiBase() + '/' + encodeURIComponent(it.blobId);
    fetch(url, { method: 'DELETE', credentials: 'same-origin' }).then(function () { fetchAssets(); }).catch(function () {});
  }
  function fetchAssets() {
    var m = document.getElementById('wsxAssetMount'); if (m && !ASSET_STATE.deliverables) m.innerHTML = i18nLoad();
    fetch(assetApiBase(), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (!d) { if (m) m.innerHTML = i18nError('common.couldNotLoad'); return; } ASSET_STATE = d; renderAssets(); })
      .catch(function () { if (m) m.innerHTML = i18nError('common.couldNotLoad'); });
    fetchFolders();
  }
  // Upload one file, then link it as a new deliverable (default) or a new version.
  function uploadOne(f, deliverableId, cb) {
    var mime = f.type || 'application/octet-stream';
    fetch(assetApiBase() + '/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f.name, mimeType: mime, size: f.size }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { var d = j && j.data; if (!d || !d.uploadUrl) throw new Error((j && (j.message || j.error)) || ''); return fetch(d.uploadUrl, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': mime }, body: f }).then(function (r) { return r.json(); }); })
      .then(function (pj) { var blobId = pj && pj.data && pj.data.id; if (!blobId) throw new Error((pj && (pj.message || pj.error)) || '');
        if (deliverableId) return fetch(assetApiBase() + '/deliverables/' + encodeURIComponent(deliverableId) + '/version', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blobId: blobId }) });
        var name = (f.name || t('assets.untitled')).replace(/\\.[^.]+$/, '');
        return fetch(assetApiBase() + '/deliverables', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blobId: blobId, name: name }) });
      })
      .then(function () { if (cb) cb(true); })
      .catch(function (err) { if (cb) cb(false, err && err.message); });
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
  function uploadAssets(files) {
    if (!files.length) return;
    var btn = document.getElementById('wsxAssetUpload'); if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    var failed = 0; var firstErr = '';
    function next(i) {
      if (i >= files.length) {
        if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
        fetchAssets();
        if (failed) showToast(firstErr || (failed === 1 ? t('assets.uploadFailedOne') : t('assets.uploadFailedMany').replace('{n}', String(failed))), 'error');
        return;
      }
      uploadOne(files[i], null, function (ok, msg) { if (ok === false) { failed++; if (!firstErr && msg) firstErr = msg; } next(i + 1); });
    }
    next(0);
  }
  function uploadVersion(deliverableId) {
    var inp = document.createElement('input'); inp.type = 'file';
    inp.addEventListener('change', function () { var f = inp.files && inp.files[0]; if (!f) return; uploadOne(f, deliverableId, fetchAssets); });
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
      b.disabled = true;
      var expIso = exp ? new Date(exp).toISOString() : null;
      function shareBody() { var o = { gate: gp.gate }; if (expIso) o.expiresAt = expIso; if (gp.password) o.password = gp.password; if (gp.domains) o.domains = gp.domains; return o; }
      fetch(assetApiBase() + '/collections', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, deliverableIds: ids }) })
        .then(function (r) { return r.json(); })
        .then(function (c) { if (!c || !c.id) throw 0; return fetch(assetApiBase() + '/collections/' + encodeURIComponent(c.id) + '/share', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(shareBody()) }).then(function (r) { return r.json().then(function (s) { return { id: c.id, url: s.url }; }); }); })
        .then(function (res) { b.disabled = false; showShareResult(res.id, res.url, expIso, gp); })
        .catch(function () { b.disabled = false; err.textContent = t('assets.errCreateLink'); });
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
        .then(function (r) { return r.json(); }).then(function (j) { b.disabled = false; msg.textContent = j && j.sent ? t('assets.sentTo').replace('{email}', to) : t('assets.errCouldNotSend'); })
        .catch(function () { b.disabled = false; msg.textContent = t('assets.errCouldNotSend'); });
    });
    assetSelect = false; assetSel = {}; renderAssets();
  }
`;
