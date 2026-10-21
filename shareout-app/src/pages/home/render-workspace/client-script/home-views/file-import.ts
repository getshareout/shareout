/**
 * Import a folder from Google Drive / OneDrive / SharePoint (lazy chunk `drives`).
 * One modal, four screens: drives + imported folders → folder browser → target → progress.
 * Connecting opens the provider's consent in a popup; the callback page posts
 * `shareout:file-import:connected` back. The API (src/file-imports/routes.ts) enforces
 * who may import; this only draws it.
 */
export const workspace_client_home_views_fileImport_JS = `  // ===== Import from Drive / OneDrive / SharePoint =====
  var fiMo = null, fiTimer = null, fiListening = false;
  var FI_TERMINAL = ['done', 'stopped', 'failed'];
  function fiBase() { return '/v1/workspaces/' + encodeURIComponent(window.WSX_WS || '') + '/file-imports'; }
  function fiJson(method, path, body) {
    return fetch(fiBase() + path, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(okOr).then(function (r) { return r.json(); });
  }
  function fiStop() { if (fiTimer) { clearTimeout(fiTimer); fiTimer = null; } }
  function fiBody(html) { var b = fiMo && fiMo.body.querySelector('#fiBody'); if (b) b.innerHTML = html; return b; }
  function fiBtn(attr, label, primary, danger) { return '<button class="wsx-abtn' + (primary ? ' wsx-abtn--primary' : '') + (danger ? ' danger' : '') + '" type="button" ' + attr + '>' + esc(label) + '</button>'; }
  function fiCounts(c) {
    return '<div class="wsx-skill__btns">' + ['found', 'imported', 'converted', 'unchanged', 'skipped', 'failed'].map(function (k) {
      return '<span class="wsx-skill__hint"><b>' + esc(String(c[k] || 0)) + '</b> ' + esc(t('fimp.c.' + k)) + '</span>';
    }).join(' \\u00B7 ') + '</div>';
  }
  function openFileImport() {
    if (!window.WSX_WS) return;
    fiStop();
    if (fiMo) fiMo.close();
    fiMo = wsxModal(t('fimp.title'), '<div class="wsx-cform" id="fiBody">' + i18nLoad() + '</div>');
    var close = fiMo.close;
    fiMo.close = function () { fiStop(); close(); fiMo = null; };
    fiMo.ov.querySelector('.wsx-modal__x').addEventListener('click', fiStop);
    if (!fiListening) {
      fiListening = true;
      window.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'shareout:file-import:connected' && fiMo) fiHome();
      });
    }
    fiHome();
  }
  function fiHome() {
    fiStop();
    fiJson('GET', '').then(function (d) {
      var provs = (d.providers || []).map(function (p) {
        var label = t('fimp.p.' + p.id);
        var status = p.connected ? (p.accountEmail ? t('fimp.connectedAs').replace('{email}', p.accountEmail) : t('fimp.connected')) : '';
        return '<div class="wsx-cn__key"><span><b>' + esc(label) + '</b>' + (status ? ' <span class="wsx-skill__hint">' + esc(status) + '</span>' : '') + '</span><span>'
          + (p.connected
            ? fiBtn('data-fi-pick="' + esc(p.id) + '"', t('fimp.pick'), true) + ' ' + fiBtn('data-fi-disc="' + esc(p.id) + '"', t('fimp.disconnect'), false, true)
            : fiBtn('data-fi-conn="' + esc(p.id) + '"', t('fimp.connect'), true))
          + '</span></div>';
      }).join('');
      var srcs = (d.sources || []).map(function (s) {
        var r = s.lastRun;
        return '<div class="wsx-sched"><div class="wsx-sched__title">' + esc(s.remoteName) + ' <span class="wsx-skill__hint">' + esc(t('fimp.p.' + s.provider)) + ' \\u2192 ' + esc(s.targetFolderName || t('fimp.targetRoot')) + '</span></div>'
          + (r ? '<p class="wsx-field__note">' + esc(t('fimp.status.' + r.status)) + (r.stopMessage ? ' \\u2014 ' + esc(r.stopMessage) : '') + '</p>' + fiCounts(r.counts) : '')
          + '<div class="wsx-skill__btns">'
          + (s.connected ? fiBtn('data-fi-sync="' + esc(s.id) + '"', t('fimp.syncAgain'), false) : '<span class="wsx-field__note">' + esc(t('fimp.reconnect')) + '</span>')
          + (r ? ' ' + fiBtn('data-fi-run="' + esc(r.id) + '"', t('fimp.progress'), false) : '')
          + ' <label class="wsx-field__note"><input type="checkbox" data-fi-daily="' + esc(s.id) + '"' + (s.dailySync ? ' checked' : '') + (s.connected ? '' : ' disabled') + '> ' + esc(t('fimp.daily')) + '</label>'
          + ' ' + fiBtn('data-fi-rm="' + esc(s.id) + '"', t('fimp.remove'), false, true)
          + '</div></div>';
      }).join('');
      var b = fiBody('<p class="wsx-lens__intro">' + esc(t('fimp.intro')) + '</p>' + provs
        + '<p class="wsx-field__note">' + esc(t('fimp.consentNote')) + '</p>'
        + '<div class="wsx-sched__title">' + esc(t('fimp.sources')) + '</div>'
        + (srcs || '<p class="wsx-field__note">' + esc(t('fimp.noSources')) + '</p>')
        + '<p class="wsx-cform__err" id="fiErr"></p>');
      if (b) fiWireHome(b);
    }).catch(function (e) { fiBody('<p class="wsx-cform__err">' + esc(errReason(e, t('fimp.loadFailed'))) + '</p>'); });
  }
  function fiErr(e) { var el = document.getElementById('fiErr'); if (el) el.textContent = errReason(e, t('fimp.failed')); }
  function fiWireHome(b) {
    b.addEventListener('click', function (e) {
      var tg = e.target && e.target.closest ? e.target.closest('button') : null; if (!tg) return;
      var v;
      if ((v = tg.getAttribute('data-fi-conn'))) { window.open(fiBase() + '/connect/' + encodeURIComponent(v), 'soFileImport', 'width=520,height=680'); return; }
      if ((v = tg.getAttribute('data-fi-pick'))) { fiBrowse(v, [{ ref: 'root', name: t('fimp.p.' + v) }], ''); return; }
      if ((v = tg.getAttribute('data-fi-disc'))) {
        if (!window.confirm(t('fimp.disconnectConfirm'))) return;
        fiJson('DELETE', '/connections/' + encodeURIComponent(v)).then(fiHome, fiErr); return;
      }
      if ((v = tg.getAttribute('data-fi-sync'))) {
        tg.disabled = true;
        fiJson('POST', '/sources/' + encodeURIComponent(v) + '/sync').then(function (d) { fiProgress(d.run.id); }, function (err) { tg.disabled = false; fiErr(err); }); return;
      }
      if ((v = tg.getAttribute('data-fi-run'))) { fiProgress(v); return; }
      if ((v = tg.getAttribute('data-fi-rm'))) {
        if (!window.confirm(t('fimp.removeConfirm'))) return;
        fiJson('DELETE', '/sources/' + encodeURIComponent(v)).then(fiHome, fiErr);
      }
    });
    b.querySelectorAll('[data-fi-daily]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        fiJson('PATCH', '/sources/' + encodeURIComponent(cb.getAttribute('data-fi-daily')), { dailySync: cb.checked })
          .catch(function (err) { cb.checked = !cb.checked; fiErr(err); });
      });
    });
  }
  function fiBrowse(provider, stack, q) {
    var here = stack[stack.length - 1];
    fiBody(i18nLoad());
    fiJson('GET', '/browse/' + encodeURIComponent(provider) + '?ref=' + encodeURIComponent(here.ref) + (q ? '&q=' + encodeURIComponent(q) : '')).then(function (d) {
      var rows = (d.entries || []).map(function (en, i) {
        return '<div class="wsx-cn__key"><span><b>' + esc(en.name) + '</b></span><span>'
          + fiBtn('data-fi-open="' + i + '"', t('fimp.open'), false)
          + (en.selectable ? ' ' + fiBtn('data-fi-sel="' + i + '"', t('fimp.select'), true) : '') + '</span></div>';
      }).join('');
      var b = fiBody('<div class="wsx-sched__title">' + esc(t('fimp.browseTitle')) + '</div>'
        + '<p class="wsx-field__note">' + stack.map(function (s) { return esc(s.name); }).join(' / ') + '</p>'
        + (d.searchable ? '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('fimp.searchSites')) + '</span><input class="wsx-field__in" id="fiQ" value="' + esc(q || '') + '"></label>' : '')
        + (rows || '<p class="wsx-field__note">' + esc(t('fimp.empty')) + '</p>')
        + '<div class="wsx-cform__foot">' + fiBtn('data-fi-back="1"', t('fimp.back'), false) + '</div>');
      if (!b) return;
      var qi = b.querySelector('#fiQ');
      if (qi) qi.addEventListener('keydown', function (e) { if (e.key === 'Enter') fiBrowse(provider, stack, qi.value.trim()); });
      b.querySelector('[data-fi-back]').addEventListener('click', function () { if (stack.length > 1) fiBrowse(provider, stack.slice(0, -1), ''); else fiHome(); });
      b.querySelectorAll('[data-fi-open]').forEach(function (btn) {
        btn.addEventListener('click', function () { var en = d.entries[+btn.getAttribute('data-fi-open')]; fiBrowse(provider, stack.concat([{ ref: en.ref, name: en.name }]), ''); });
      });
      b.querySelectorAll('[data-fi-sel]').forEach(function (btn) {
        btn.addEventListener('click', function () { var en = d.entries[+btn.getAttribute('data-fi-sel')]; fiTarget(provider, en, stack); });
      });
    }).catch(function (e) {
      fiBody('<p class="wsx-cform__err">' + esc(errReason(e, t('fimp.failed'))) + '</p><div class="wsx-cform__foot">' + fiBtn('data-fi-home="1"', t('fimp.back'), false) + '</div>');
      var hb = fiMo && fiMo.body.querySelector('[data-fi-home]'); if (hb) hb.addEventListener('click', fiHome);
    });
  }
  function fiTarget(provider, entry, stack) {
    fetch('/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/folders?all=1', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { folders: [] }; }).catch(function () { return { folders: [] }; })
      .then(function (d) {
        var opts = '<option value="">' + esc(t('fimp.targetRoot')) + '</option>' + (d.folders || []).map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + '</option>'; }).join('');
        var b = fiBody('<div class="wsx-sched__title">' + esc(entry.name) + '</div>'
          + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('fimp.target')) + '</span><select class="wsx-field__in" id="fiTgt">' + opts + '</select></label>'
          + '<label class="wsx-field__note"><input type="checkbox" id="fiDaily"> ' + esc(t('fimp.daily')) + '</label>'
          + '<p class="wsx-cform__err" id="fiErr"></p>'
          + '<div class="wsx-cform__foot">' + fiBtn('data-fi-back="1"', t('fimp.back'), false) + ' ' + fiBtn('id="fiGo"', t('fimp.start'), true) + '</div>');
        if (!b) return;
        b.querySelector('[data-fi-back]').addEventListener('click', function () { fiBrowse(provider, stack, ''); });
        b.querySelector('#fiGo').addEventListener('click', function () {
          var go = this; go.disabled = true; go.textContent = t('fimp.starting');
          fiJson('POST', '/sources', {
            provider: provider, ref: entry.ref, name: entry.name, targetFolderId: cv('fiTgt') || null,
            dailySync: document.getElementById('fiDaily').checked,
          }).then(function (r) { fiProgress(r.run.id); }, function (err) { go.disabled = false; go.textContent = t('fimp.start'); fiErr(err); });
        });
      });
  }
  function fiProgress(runId) {
    fiStop();
    fiJson('GET', '/runs/' + encodeURIComponent(runId)).then(function (d) {
      var r = d.run, done = FI_TERMINAL.indexOf(r.status) >= 0;
      var errs = (r.errors || []).map(function (x) {
        return '<li><b>' + esc(x.path) + '</b> <span class="wsx-skill__hint">' + esc(x.message || x.code) + '</span></li>';
      }).join('');
      var b = fiBody('<div class="wsx-sched__title">' + esc(t('fimp.status.' + r.status)) + '</div>'
        + (r.stopMessage ? '<p class="wsx-field__note">' + esc(r.stopMessage) + '</p>' : '')
        + fiCounts(r.counts)
        + '<div class="wsx-sched__title">' + esc(t('fimp.errors')) + '</div>'
        + (errs ? '<ul class="wsx-cn__steps">' + errs + '</ul>' : '<p class="wsx-field__note">' + esc(t('fimp.noErrors')) + '</p>')
        + '<div class="wsx-cform__foot">' + fiBtn('data-fi-home="1"', t('fimp.back'), false) + '</div>');
      if (b) b.querySelector('[data-fi-home]').addEventListener('click', fiHome);
      if (!done && fiMo) fiTimer = setTimeout(function () { fiProgress(runId); }, 2500);
      if (done && typeof loadAssets === 'function') { try { loadAssets(); } catch (e) { /* view not open */ } }
    }).catch(function (e) { fiErr(e); if (fiMo) fiTimer = setTimeout(function () { fiProgress(runId); }, 5000); });
  }
`;
