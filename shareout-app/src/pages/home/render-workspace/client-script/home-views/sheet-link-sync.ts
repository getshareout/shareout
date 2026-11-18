/**
 * Keep one of a page's datasets fresh from a spreadsheet shared as "Anyone with the link can
 * view" — no Google sign-in (lazy chunk `sheetlink`; its "private file" button opens the
 * Drive sync, chunk `drivesync`). Says up front that anyone with the link can read the file →
 * paste the link → the server checks it (POST /v1/workspaces/{ws}/sheet-links/inspect: public?
 * title, tabs) → tab, dataset name and how often → a `public_sheet_sync` job (POST /v1/jobs)
 * and a first run.
 */
export const workspace_client_home_views_sheetLinkSync_JS = `  // ===== Sync a dataset from a public Google link — lazy chunk 'sheetlink' =====
  var slMo = null, slArt = null, slDone = null;
  function slOpen() { return !!(slMo && slMo.ov.isConnected); }
  function slBody(html) { var b = slOpen() ? slMo.body.querySelector('#slBody') : null; if (b) b.innerHTML = html; return b; }
  function slBtn(attr, label, primary) { return '<button class="wsx-abtn' + (primary ? ' wsx-abtn--primary' : '') + '" type="button" ' + attr + '>' + esc(label) + '</button>'; }
  // art: { id, name }. onDone runs once the job exists (and again after its first run).
  function openSheetLinkSync(art, onDone) {
    if (!window.WSX_WS || !art || !art.id) return;
    if (slOpen()) slMo.close();
    slArt = art; slDone = onDone || null;
    slMo = wsxModal(t('slink.title'), '<div class="wsx-cform" id="slBody"></div>');
    slHome('');
  }
  // Shown before anything is saved: who can read a link-shared file, and the private path.
  function slWarn() {
    return '<div class="wsx-slink__warn" role="note"><b>' + esc(t('slink.warnTitle')) + '</b><p>' + esc(t('slink.warnBody')) + '</p>'
      + slBtn('data-sl-private="1"', t('slink.usePrivate'), false) + '</div>';
  }
  function slHome(value) {
    var b = slBody('<p class="wsx-lens__intro">' + esc(t('slink.intro')) + '</p>' + slWarn()
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('slink.link')) + '</span><input class="wsx-field__in" id="slLink" type="url" autocomplete="off" spellcheck="false" placeholder="https://docs.google.com/spreadsheets/d/\\u2026"></label>'
      + '<p class="wsx-field__note">' + esc(t('slink.howto')) + '</p>'
      + '<p class="wsx-cform__err" id="slErr" role="alert"></p>'
      + '<div class="wsx-cform__foot">' + slBtn('data-sl-check="1"', t('slink.check'), true) + '</div>');
    if (!b) return;
    b.querySelector('[data-sl-private]').addEventListener('click', function () { var a = slArt, d = slDone; slMo.close(); openDriveSync(a, d); });
    var inp = b.querySelector('#slLink'), go = b.querySelector('[data-sl-check]'), errEl = b.querySelector('#slErr');
    inp.value = value || '';
    function check() {
      var link = inp.value.trim(); errEl.textContent = '';
      if (!link) { errEl.textContent = t('slink.errEmpty'); return; }
      var label = go.textContent; go.disabled = true; go.textContent = t('slink.checking');
      function reset(msg) { go.disabled = false; go.textContent = label; errEl.textContent = msg; }
      fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/sheet-links/inspect', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link: link }) })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!slOpen()) return;
          var d = res.d || {};
          if (res.ok && d.sheets) { slForm(link, d); return; }
          reset(d.code === 'NOT_PUBLIC' ? t('slink.errNotPublic') : d.code === 'NOT_FOUND' ? t('slink.errNotFound') : (d.error || t('slink.failed')));
        })
        .catch(function () { reset(t('slink.failed')); });
    }
    go.addEventListener('click', check);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });
  }
  // "Sales 2026.xlsx" → "sales_2026": a dataset name the API accepts.
  function slSlug(name) {
    var s = String(name || '').replace(/\\.(xlsx|xlsm|xls|ods|csv)$/i, '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '').slice(0, 64);
    return s || 'data';
  }
  // info: { fileName, sheets, sheet, rowCount } from the inspect call.
  function slForm(link, info) {
    var name = info.fileName || t('slink.untitled'), sheets = info.sheets || [];
    var def = afCron('daily', '08:00', '1', viewerTz());
    var tabField = sheets.length > 1
      ? '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('dsync.tab')) + '</span><select class="wsx-field__in" id="sl_tab">'
        + sheets.map(function (s) { return '<option value="' + esc(s) + '"' + (s === info.sheet ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></label>'
      : '';
    var b = slBody('<p class="wsx-field__note"><b>' + esc(t('dsync.file')) + ':</b> ' + esc(name) + '</p>'
      + '<p class="wsx-field__note" id="sl_preview"></p>'
      + '<div class="wsx-cform__row">' + tabField
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('dsync.dataset')) + '</span><input class="wsx-field__in" id="sl_name" type="text" autocomplete="off" spellcheck="false" value="' + esc(slSlug(name)) + '"></label></div>'
      + '<p class="wsx-field__note" id="sl_hint"></p>'
      + '<h4 class="wsx-adet__h">' + esc(t('adet.schedule')) + '</h4>' + afScheduleFields('sl', def.cron)
      + '<p class="wsx-field__note">' + esc(t('slink.unchangedNote')) + '</p>'
      + '<p class="wsx-field__note"><b>' + esc(t('slink.remind')) + '</b></p>'
      + '<div class="wsx-cform__err" id="sl_err" role="alert"></div>'
      + '<div class="wsx-cform__foot">' + slBtn('data-sl-back="1"', t('fimp.back'), false) + slBtn('data-sl-save="1"', t('dsync.save'), true) + '</div>');
    if (!b) return;
    afWireSchedule(b, 'sl');
    var nameIn = b.querySelector('#sl_name'), hint = b.querySelector('#sl_hint'), tabSel = b.querySelector('#sl_tab'), prev = b.querySelector('#sl_preview');
    function tab() { return tabSel ? tabSel.value : (info.sheet || sheets[0] || ''); }
    // The row count is for the tab the check read; another tab has its own.
    function paintPreview() { prev.textContent = tab() === info.sheet ? t('slink.preview').replace('{tab}', info.sheet).replace('{rows}', String(info.rowCount || 0)) : ''; }
    function paintHint() { hint.textContent = t('dsync.hint').replace('{code}', "sdk.dataset('" + (nameIn.value.trim() || 'data') + "').get()"); }
    nameIn.addEventListener('input', paintHint); paintHint(); paintPreview();
    if (tabSel) tabSel.addEventListener('change', paintPreview);
    b.querySelector('[data-sl-back]').addEventListener('click', function () { slHome(link); });
    b.querySelector('[data-sl-save]').addEventListener('click', function () { slSave(link, name, info, tab(), b, this); });
  }
  function slSave(link, fileName, info, tab, root, btn) {
    var err = root.querySelector('#sl_err'); err.textContent = '';
    var name = root.querySelector('#sl_name').value.trim();
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) { err.textContent = t('dsync.errName'); return; }
    var sc = afReadSchedule(root, 'sl'); if (sc.err) { err.textContent = t(sc.err); return; }
    // The tab is kept by name, so a tab added in front later does not change what syncs.
    var config = { link: link, dataset: name };
    if (info.fileName) config.fileName = info.fileName;
    if (tab) config.sheet = tab;
    var label = btn.textContent; btn.disabled = true; btn.textContent = t('common.saving');
    function reset(msg) { btn.disabled = false; btn.textContent = label; err.textContent = msg; }
    fetch('/v1/jobs', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact_id: slArt.id, action: 'public_sheet_sync', schedule: sc.cron, config: config, title: t('slink.jobTitle').replace('{file}', fileName) }) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d || !res.d.job) { reset((res.d && res.d.error) || t('autof.couldNotSave')); return; }
        if (slDone) slDone();
        btn.textContent = t('dsync.syncing');
        // The first sync runs now, so the page has data before the first scheduled run.
        return fetch('/v1/jobs/' + encodeURIComponent(res.d.job.id) + '/run', { method: 'POST', credentials: 'same-origin' })
          .then(function (r) { return r.json().catch(function () { return null; }); })
          .then(function (d) {
            var ex = d && d.execution;
            if (slDone) slDone();
            if (ex && ex.status === 'success') { if (slOpen()) slMo.close(); wsxToast(t('dsync.syncedOk').replace('{name}', name)); return; }
            // The schedule is saved either way; say why the first run failed and keep it.
            slBody('<p class="wsx-field__note">' + esc(t('dsync.savedNotSynced')) + '</p><p class="wsx-cform__err" role="alert">' + esc((ex && ex.error) || (d && d.error) || t('slink.failed')) + '</p>'
              + '<div class="wsx-cform__foot">' + slBtn('data-sl-close="1"', t('common.close'), true) + '</div>');
            var cb = slOpen() && slMo.body.querySelector('[data-sl-close]'); if (cb) cb.addEventListener('click', function () { slMo.close(); });
          });
      })
      .catch(function () { reset(t('autof.couldNotSave')); });
  }
`;
