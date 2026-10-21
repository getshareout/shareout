/**
 * Rail "New" menu (no AI): upload files (the same routing as drag & drop: documents
 * become artifacts, the rest goes to Recursos), import a folder from a cloud drive (when the
 * instance configures one — lazy `drives` chunk), a blank document, or a document from a
 * template (POST /v1/home/new → opens it in Edit). The button is only rendered where
 * the viewer may create (template.ts canCreateHere); the API re-checks.
 */
export const workspace_client_new_menu_JS = `  // ===== New menu: upload a file · blank document · from a template =====
  var newBtn = document.getElementById('wsxNewBtn');
  var newMenu = document.getElementById('wsxNewMenu');
  var NEW_TPLS = ['report', 'meeting', 'proposal'];
  function newItem(act, title, hint) {
    return '<button class="wsx-newmenu__item" type="button" role="menuitem" data-new="' + act + '">' + esc(title) + '<span>' + esc(hint) + '</span></button>';
  }
  function paintNewMenu(page) {
    newMenu.innerHTML = page === 'tpl'
      ? '<button class="wsx-newmenu__back" type="button" data-new="back">' + esc(t('new.back')) + '</button>'
        + NEW_TPLS.map(function (k) { return newItem('tpl:' + k, t('new.tpl.' + k), t('new.tplHint.' + k)); }).join('')
      : newItem('upload', t('new.upload'), t('new.uploadHint')) + (window.WSX_WS && (window.WSX_FILE_IMPORT || []).length ? newItem('drive', t('fimp.menu'), t('fimp.menuHint')) : '') + newItem('blank', t('new.blank'), t('new.blankHint')) + newItem('tpl', t('new.template'), t('new.templateHint'));
    var first = newMenu.querySelector('[role="menuitem"]'); if (first) first.focus();
  }
  function openNewMenu() {
    if (!newBtn || !newMenu) return;
    // The button sits in the rail; on a phone the rail is an off-screen drawer.
    var r = newBtn.getBoundingClientRect(), shown = r.right > 0 && r.width > 0;
    newMenu.style.top = (shown ? Math.min(r.bottom + 6, window.innerHeight - 260) : 72) + 'px';
    newMenu.style.left = (shown ? Math.max(12, Math.min(r.left, window.innerWidth - 292)) : 12) + 'px';
    newMenu.hidden = false; newBtn.setAttribute('aria-expanded', 'true');
    paintNewMenu('main');
  }
  function closeNewMenu(refocus) {
    if (!newMenu || newMenu.hidden) return;
    newMenu.hidden = true; newBtn.setAttribute('aria-expanded', 'false');
    if (refocus) newBtn.focus();
  }
  function newPicked() { closeNewMenu(false); if (typeof setRail === 'function') setRail(false); }
  function newUpload() {
    newPicked();
    var inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
    inp.addEventListener('change', function () { if (inp.files && inp.files.length) importDropped(dropItems(inp.files)); });
    inp.click();
  }
  function newDoc(tpl) {
    newPicked();
    showToast(t('new.creating'), 'info');
    var lang = typeof window.__SO_HOME_LOCALE === 'function' ? window.__SO_HOME_LOCALE() : 'en';
    fetch('/v1/home/new' + (window.WSX_WS ? '?workspace=' + encodeURIComponent(window.WSX_WS) : ''), {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: tpl, lang: lang })
    })
      .then(okOr)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.slug) throw new Error('create');
        openArtifact(d.slug, d.name, d.artifactId);
        if (panes[d.artifactId]) setEditMode(panes[d.artifactId], 'edit');
      })
      .catch(function (e) { failToast(e, t('new.failed')); });
  }
  if (newBtn && newMenu) {
    newBtn.addEventListener('click', function (e) { e.stopPropagation(); if (newMenu.hidden) openNewMenu(); else closeNewMenu(true); });
    newMenu.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest && e.target.closest('[data-new]'); if (!b) return;
      var act = b.getAttribute('data-new');
      if (act === 'upload') newUpload();
      else if (act === 'drive') { newPicked(); openFileImport(); }
      else if (act === 'blank') newDoc('blank');
      else if (act === 'tpl') paintNewMenu('tpl');
      else if (act === 'back') paintNewMenu('main');
      else if (act.indexOf('tpl:') === 0) newDoc(act.slice(4));
    });
    document.addEventListener('click', function () { closeNewMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !newMenu.hidden) closeNewMenu(true); });
  }

`;
