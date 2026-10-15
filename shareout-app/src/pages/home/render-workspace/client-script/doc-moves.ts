/**
 * One-click switch between an artifact and Recursos for documents (the import rule in
 * import-rules.ts, applied after the fact). Both directions reuse existing endpoints:
 * the bytes travel through /a/{slug}/download or /v1/files/{dlv}/content, land via the
 * Assets upload or POST /v1/home/import, and only then is the old copy deleted (artifact
 * → Recently deleted; asset → removed). A failure before that leaves the original as is.
 */
export const workspace_client_doc_moves_JS = `  // ===== Move a document: artifact ⇄ Recursos =====
  var MOVE_DOC_TYPES = { pdf: 1, markdown: 1, csv: 1, txt: 1, json: 1 };
  var SVG_TO_ASSETS = '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>';
  function canMoveToAssets(meta) { return !!(meta && meta.can_delete && MOVE_DOC_TYPES[meta.artifact_type]); }
  function canPublishAsset(a) { return a.type === 'deliverable' && !!a.canDelete && DROP_EXTS.indexOf(dropExt(a.filename || a.name)) >= 0; }
  function moveFilename(r, fallback) {
    var m = /filename\\*=UTF-8''([^;]+)/i.exec(r.headers.get('Content-Disposition') || '');
    try { return m ? decodeURIComponent(m[1]) : fallback; } catch (e) { return fallback; }
  }
  function moveToAssets(art, meta) {
    showToast(t('move.moving'), 'info');
    fetch('/a/' + encodeURIComponent(meta.slug || art.slug) + '/download', { credentials: 'same-origin' })
      .then(okOr)
      .then(function (r) { return r.blob().then(function (b) { return new File([b], moveFilename(r, meta.name || 'file'), { type: b.type }); }); })
      .then(function (f) { return new Promise(function (ok, no) { uploadOne(f, null, function (done, err) { if (done === false) no(err); else ok(); }, 'private'); }); })
      .then(function () { return fetch('/v1/artifacts/' + encodeURIComponent(art.id), { method: 'DELETE', credentials: 'same-origin' }); })
      .then(okOr)
      .then(function () {
        if (panes[art.key]) closeTab(art.key);
        if (typeof reloadFolders === 'function') reloadFolders();
        if (document.getElementById('wsxAssetMount')) fetchAssets();
        showToast(t('move.toAssetsDone'), 'success');
      })
      .catch(function (e) { failToast(e, t('move.failed')); });
  }
  function publishFromAssets(a) {
    showToast(t('move.moving'), 'info');
    fetch('/v1/files/' + encodeURIComponent(a.id) + '/content', { credentials: 'same-origin' })
      .then(okOr)
      .then(function (r) { return r.blob(); })
      .then(function (b) { if (b.size > DROP_MAX) { var e = new Error(''); e.code = 'FILE_TOO_LARGE'; throw e; } return dropRead(new File([b], a.filename || a.name, { type: b.type })); })
      .then(dropPost)
      .then(function (d) { return fetch(assetApiBase() + '/deliverables/' + encodeURIComponent(a.id), { method: 'DELETE', credentials: 'same-origin' }).then(function () { return d; }); })
      .then(function (d) {
        fetchAssets();
        if (typeof reloadFolders === 'function') reloadFolders();
        showToast(t('move.toArtifactDone'), 'success');
        openArtifact(d.slug, d.name, d.artifactId, d.type);
      })
      .catch(function (e) { if (e && e.code && !e.status) showToast(dropErr(e, a.filename || a.name), 'error'); else failToast(e, t('move.failed')); });
  }

`;
