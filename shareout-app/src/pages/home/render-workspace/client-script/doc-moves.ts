/**
 * One-click "Publish as artifact" for a file still in Recursos (the import rule in
 * import-rules.ts, applied after the fact): the bytes travel through
 * /v1/files/{dlv}/content into POST /v1/home/import, and only then is the file removed.
 * A failure before that leaves the file as is.
 */
export const workspace_client_doc_moves_JS = `  // ===== Publish a Recursos file as an artifact =====
  function canPublishAsset(a) { return a.type === 'deliverable' && !!a.canDelete && DROP_EXTS.indexOf(dropExt(a.filename || a.name)) >= 0; }
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
