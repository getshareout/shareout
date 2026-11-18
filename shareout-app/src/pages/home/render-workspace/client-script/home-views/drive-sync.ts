/**
 * Keep one of a page's datasets fresh from a Google Drive spreadsheet (lazy chunk
 * `drivesync`), opened from the Inspector's Automate tab. Its own Google consent, never the
 * folder import's: drive.file with the Google Picker inside the consent, in a popup
 * (`/file-imports/sheet-sync/pick`, or `?file=` for a pasted link so the Picker shows just
 * that file). The popup posts `shareout:drive-sheet:picked` back → tab, dataset name and how
 * often → a `drive_file_sync` job (POST /v1/jobs) and a first run so the page has data now.
 */
export const workspace_client_home_views_driveSync_JS = `  // ===== Sync a dataset from Google Drive — lazy chunk 'drivesync' =====
  var dsMo = null, dsListening = false, dsArt = null, dsDone = null, dsPop = null;
  function dsBase() { return '/v1/workspaces/' + encodeURIComponent(window.WSX_WS || '') + '/file-imports/sheet-sync'; }
  function dsGet(path) { return fetch(dsBase() + path, { credentials: 'same-origin' }).then(okOr).then(function (r) { return r.json(); }); }
  function dsOpen() { return !!(dsMo && dsMo.ov.isConnected); }
  function dsBody(html) { var b = dsOpen() ? dsMo.body.querySelector('#dsBody') : null; if (b) b.innerHTML = html; return b; }
  function dsBtn(attr, label, primary) { return '<button class="wsx-abtn' + (primary ? ' wsx-abtn--primary' : '') + '" type="button" ' + attr + '>' + esc(label) + '</button>'; }
  function dsFail(e) { dsBody('<p class="wsx-cform__err" role="alert">' + esc(errReason(e, t('dsync.failed'))) + '</p>'); }
  // art: { id, name }. onDone runs once the job exists (and again after its first run).
  function openDriveSync(art, onDone) {
    if (!window.WSX_WS || !art || !art.id) return;
    if (dsOpen()) dsMo.close();
    dsArt = art; dsDone = onDone || null;
    dsMo = wsxModal(t('dsync.title'), '<div class="wsx-cform" id="dsBody">' + i18nLoad() + '</div>');
    if (!dsListening) {
      dsListening = true;
      window.addEventListener('message', function (e) {
        // Only the popup this modal opened (the server posts it to this origin only).
        if (!e.data || e.data.type !== 'shareout:drive-sheet:picked' || !dsOpen() || !dsPop || e.source !== dsPop) return;
        dsPop = null;
        var f = e.data.file;
        if (e.data.ok && f && f.id) dsForm({ fileId: String(f.id), name: String(f.name || '') });
        else dsHome(String(e.data.error || t('dsync.failed')));
      });
    }
    dsHome();
  }
  function dsHome(problem) {
    dsBody(i18nLoad());
    dsGet('').then(function (d) {
      if (!d.available) { dsBody('<p class="wsx-field__note">' + esc(t('dsync.notSetUp')) + '</p>'); return; }
      var who = d.connected ? (d.accountEmail ? t('fimp.connectedAs').replace('{email}', d.accountEmail) : t('fimp.connected')) : '';
      var b = dsBody((problem ? '<p class="wsx-cform__err" role="alert">' + esc(problem) + '</p>' : '')
        + '<p class="wsx-lens__intro">' + esc(t('dsync.intro')) + '</p>'
        + '<div class="wsx-cn__key"><span><b>' + esc(t('fimp.p.google_drive')) + '</b>' + (who ? ' <span class="wsx-skill__hint">' + esc(who) + '</span>' : '') + '</span><span>'
        + dsBtn('data-ds-pick="1"', t('dsync.pick'), true) + '</span></div>'
        + '<p class="wsx-field__note">' + esc(t('dsync.consentNote')) + '</p>'
        + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('dsync.orLink')) + '</span><input class="wsx-field__in" id="dsLink" type="url" autocomplete="off" spellcheck="false" placeholder="https://docs.google.com/spreadsheets/d/\\u2026"></label>'
        + '<p class="wsx-cform__err" id="dsLinkErr" role="alert"></p>'
        + '<div class="wsx-cform__foot">' + (d.connected ? dsBtn('data-ds-disc="1"', t('fimp.disconnect'), false) : '') + dsBtn('data-ds-link="1"', t('dsync.useLink'), false) + '</div>');
      if (!b) return;
      b.querySelector('[data-ds-pick]').addEventListener('click', function () { dsPick(''); });
      function useLink() {
        var id = dsLinkId(b.querySelector('#dsLink').value);
        if (!id) { b.querySelector('#dsLinkErr').textContent = t('dsync.errLink'); return; }
        dsPick(id);
      }
      b.querySelector('[data-ds-link]').addEventListener('click', useLink);
      b.querySelector('#dsLink').addEventListener('keydown', function (e) { if (e.key === 'Enter') useLink(); });
      var dc = b.querySelector('[data-ds-disc]');
      if (dc) dc.addEventListener('click', function () {
        if (!window.confirm(t('dsync.disconnectConfirm'))) return;
        fetch(dsBase() + '/connection', { method: 'DELETE', credentials: 'same-origin' }).then(okOr).then(function () { dsHome(); }).catch(function (e) { dsFail(e); });
      });
    }).catch(function (e) { dsFail(e); });
  }
  // Google's consent with the Picker inside, in a popup. A pasted link's id narrows the Picker to that file.
  function dsPick(fileId) {
    dsPop = window.open(dsBase() + '/pick' + (fileId ? '?file=' + encodeURIComponent(fileId) : ''), 'soDriveSheet', 'width=900,height=720');
    var b = dsBody('<p class="wsx-field__note">' + esc(t('dsync.waiting')) + '</p><div class="wsx-cform__foot">' + dsBtn('data-ds-home="1"', t('fimp.back'), false) + '</div>');
    if (b) b.querySelector('[data-ds-home]').addEventListener('click', function () { dsPop = null; dsHome(); });
  }
  // A pasted Drive link carries the file id after /d/ or in ?id=; a bare id works too.
  function dsLinkId(v) {
    var s = String(v || '').trim();
    var m = /\\/d\\/([A-Za-z0-9_-]{20,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(s);
    return m ? m[1] : (/^[A-Za-z0-9_-]{20,}$/.test(s) ? s : '');
  }
  // "Sales 2026.xlsx" → "sales_2026": a dataset name the API accepts.
  function dsSlug(name) {
    var s = String(name || '').replace(/\\.(xlsx|xlsm|xls|ods|csv)$/i, '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '').slice(0, 64);
    return s || 'data';
  }
  function dsForm(file) {
    var def = afCron('daily', '08:00', '1', viewerTz());
    var b = dsBody('<p class="wsx-field__note"><b>' + esc(t('dsync.file')) + ':</b> ' + esc(file.name) + '</p>'
      + '<div class="wsx-cform__row"><label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('dsync.tab')) + '</span><input class="wsx-field__in" id="ds_tab" type="text" autocomplete="off" placeholder="' + esc(t('dsync.tabPh')) + '"></label>'
      + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('dsync.dataset')) + '</span><input class="wsx-field__in" id="ds_name" type="text" autocomplete="off" spellcheck="false" value="' + esc(dsSlug(file.name)) + '"></label></div>'
      + '<p class="wsx-field__note" id="ds_hint"></p>'
      + '<h4 class="wsx-adet__h">' + esc(t('adet.schedule')) + '</h4>' + afScheduleFields('ds', def.cron)
      + '<p class="wsx-field__note">' + esc(t('dsync.unchangedNote')) + '</p>'
      + '<div class="wsx-cform__err" id="ds_err" role="alert"></div>'
      + '<div class="wsx-cform__foot">' + dsBtn('data-ds-back="1"', t('fimp.back'), false) + dsBtn('data-ds-save="1"', t('dsync.save'), true) + '</div>');
    if (!b) return;
    afWireSchedule(b, 'ds');
    var nameIn = b.querySelector('#ds_name'), hint = b.querySelector('#ds_hint');
    function paintHint() { hint.textContent = t('dsync.hint').replace('{code}', "sdk.dataset('" + (nameIn.value.trim() || 'data') + "').get()"); }
    nameIn.addEventListener('input', paintHint); paintHint();
    b.querySelector('[data-ds-back]').addEventListener('click', function () { dsHome(); });
    b.querySelector('[data-ds-save]').addEventListener('click', function () { dsSave(file, b, this); });
  }
  function dsSave(file, root, btn) {
    var err = root.querySelector('#ds_err'); err.textContent = '';
    var name = root.querySelector('#ds_name').value.trim();
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) { err.textContent = t('dsync.errName'); return; }
    var sc = afReadSchedule(root, 'ds'); if (sc.err) { err.textContent = t(sc.err); return; }
    var tab = root.querySelector('#ds_tab').value.trim();
    var config = { provider: 'google_drive', fileId: file.fileId, fileName: file.name, dataset: name };
    if (tab) config.sheet = tab;
    var label = btn.textContent; btn.disabled = true; btn.textContent = t('common.saving');
    function reset(msg) { btn.disabled = false; btn.textContent = label; err.textContent = msg; }
    // Not optimistic: the server checks the file id, the dataset name and the schedule.
    fetch('/v1/jobs', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifact_id: dsArt.id, action: 'drive_file_sync', schedule: sc.cron, config: config, title: t('dsync.jobTitle').replace('{file}', file.name) }) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d || !res.d.job) { reset((res.d && res.d.error) || t('autof.couldNotSave')); return; }
        if (dsDone) dsDone();
        btn.textContent = t('dsync.syncing');
        // The first sync runs now, so the page has data before the first scheduled run.
        return fetch('/v1/jobs/' + encodeURIComponent(res.d.job.id) + '/run', { method: 'POST', credentials: 'same-origin' })
          .then(function (r) { return r.json().catch(function () { return null; }); })
          .then(function (d) {
            var ex = d && d.execution;
            if (dsDone) dsDone();
            if (ex && ex.status === 'success') { if (dsOpen()) dsMo.close(); wsxToast(t('dsync.syncedOk').replace('{name}', name)); return; }
            // The schedule is saved either way; say why the first run failed and keep it.
            dsBody('<p class="wsx-field__note">' + esc(t('dsync.savedNotSynced')) + '</p><p class="wsx-cform__err" role="alert">' + esc((ex && ex.error) || (d && d.error) || t('dsync.failed')) + '</p>'
              + '<div class="wsx-cform__foot">' + dsBtn('data-ds-close="1"', t('common.close'), true) + '</div>');
            var cb = dsOpen() && dsMo.body.querySelector('[data-ds-close]'); if (cb) cb.addEventListener('click', function () { dsMo.close(); });
          });
      })
      .catch(function () { reset(t('autof.couldNotSave')); });
  }
`;
