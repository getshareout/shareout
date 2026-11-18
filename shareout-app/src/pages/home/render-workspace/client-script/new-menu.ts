/**
 * Rail "New" menu, the one way to create: describe it to AI (when ai.create is on), upload files (the same routing as drag & drop: documents
 * become artifacts, the rest goes to Recursos), a table from an Excel or CSV file (POST /v1/home/new
 * template 'table' → opens it, then offers the ways to keep it up to date, email first), import a
 * folder from a cloud drive (when the instance configures one — lazy `drives` chunk), a blank
 * document, or a document from a template (POST /v1/home/new → opens it in Edit). The button is only
 * rendered where the viewer may create (template.ts canCreateHere); the API re-checks.
 */
import { XLSX_MAX_INPUT_BYTES } from '../../../../data/files/parse-xlsx';
export const workspace_client_new_menu_JS = `  // ===== New menu: describe it to AI · upload a file · table from an Excel · blank document · from a template =====
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
      : (newBtn.hasAttribute('data-ai') ? newItem('ai', t('new.ai'), t('new.aiHint')) : '') + newItem('upload', t('new.upload'), t('new.uploadHint')) + newItem('table', t('new.table'), t('new.tableHint')) + (window.WSX_WS && (window.WSX_FILE_IMPORT || []).length ? newItem('drive', t('fimp.menu'), t('fimp.menuHint')) : '') + newItem('blank', t('new.blank'), t('new.blankHint')) + newItem('tpl', t('new.template'), t('new.templateHint'));
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
  // ----- New → Table from an Excel file -----
  var NEW_TABLE_MAX = ${XLSX_MAX_INPUT_BYTES};
  function newT(key, vars) { return t(key).replace(/\\{(\\w+)\\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function newTable() {
    newPicked();
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.csv';
    inp.addEventListener('change', function () { if (inp.files && inp.files[0]) newTableFile(inp.files[0]); });
    inp.click();
  }
  // A file it cannot use: what to do, and the button that does it.
  function newTableErr(msg) {
    var mo = wsxModal(t('new.tableErrTitle'), '<div class="wsx-cform"><p class="wsx-cform__err" role="alert" data-nt-err="1"></p><div class="wsx-cform__foot"><button class="wsx-abtn" type="button" data-nt-close="1">' + esc(t('common.close')) + '</button><button class="wsx-abtn wsx-abtn--primary" type="button" data-nt-again="1">' + esc(t('new.tablePickAgain')) + '</button></div></div>');
    mo.body.querySelector('[data-nt-err]').textContent = msg;
    mo.body.querySelector('[data-nt-close]').addEventListener('click', function () { mo.close(); });
    mo.body.querySelector('[data-nt-again]').addEventListener('click', function () { mo.close(); newTable(); });
  }
  function newTableFile(f) {
    var ext = (/\\.([a-z0-9]+)$/i.exec(f.name || '') || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    if (ext !== 'xlsx' && ext !== 'csv') { newTableErr(newT('new.tableErrType', { file: f.name })); return; }
    if (f.size > NEW_TABLE_MAX) { newTableErr(newT('new.tableErrBig', { file: f.name, mb: NEW_TABLE_MAX / 1000000 })); return; }
    var busy = showToast(t('new.tableCreating'), 'info', { duration: 60000 });
    function idle() { if (busy && typeof busy.close === 'function') busy.close(); }
    var r = new FileReader();
    r.onerror = function () { idle(); newTableErr(t('new.tableFailed')); };
    r.onload = function () {
      var lang = typeof window.__SO_HOME_LOCALE === 'function' ? window.__SO_HOME_LOCALE() : 'en';
      fetch('/v1/home/new' + (window.WSX_WS ? '?workspace=' + encodeURIComponent(window.WSX_WS) : ''), {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: 'table', lang: lang, file: { name: f.name, content: String(r.result).split(',')[1] || '' } })
      })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { return { ok: res.ok, d: d || {} }; }); })
        .then(function (x) {
          var d = x.d;
          idle();
          // Saved but its rows were not (rare): open what was made and say why it is empty.
          if (!x.ok && d.slug) { openArtifact(d.slug, d.name, d.artifactId); newTableErr(d.error || t('new.tableFailed')); return; }
          if (!x.ok || !d.slug) { newTableErr(d.error || t('new.tableFailed')); return; }
          openArtifact(d.slug, d.name, d.artifactId);
          var done = d.rowCount === 1 ? newT('new.tableReadyOne', { file: f.name }) : newT('new.tableReady', { rows: Number(d.rowCount || 0).toLocaleString(locTag()), file: f.name });
          if (window.WSX_WS) newTableKeep(d, done); else showToast(done, 'success');
        })
        .catch(function () { idle(); newTableErr(t('new.tableFailed')); });
    };
    r.readAsDataURL(f);
  }
  // Right after: the three ways to keep it up to date, email first. Each opens its own panel,
  // already pointed at this table's data (the page reads one name).
  function newTableKeep(d, done) {
    var mo = wsxModal(t('new.keepTitle'), '<div class="wsx-cform wsx-newtable">'
      + '<p class="wsx-lens__intro" role="status" data-nt-done="1"><b>\\u2713 ' + esc(done) + '</b></p>'
      + '<p class="wsx-lens__intro">' + esc(t('new.keepIntro')) + '</p>'
      + '<div class="wsx-qa-grid">' + dataInTiles(['emailsync', 'drivesync', 'sheetlink'], false) + '</div>'
      + '<p class="wsx-field__note">' + esc(t('new.keepEasiest')) + ' ' + esc(t('new.keepLaterNote')) + '</p>'
      + '<div class="wsx-cform__foot"><button class="wsx-abtn" type="button" data-nt-later="1">' + esc(t('new.keepLater')) + '</button></div></div>');
    var art = { id: d.artifactId, name: d.name };
    mo.body.querySelector('[data-nt-later]').addEventListener('click', function () { mo.close(); });
    mo.body.querySelectorAll('[data-aauto]').forEach(function (b) {
      b.addEventListener('click', function () {
        mo.close();
        openDataIn(b.getAttribute('data-aauto'), art, function () { if (typeof autoCache === 'object') delete autoCache[art.id]; });
      });
    });
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
      if (act === 'ai') { newPicked(); enterCreate(); }
      else if (act === 'upload') newUpload();
      else if (act === 'table') newTable();
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
