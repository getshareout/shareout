/** Templates lens (lazy): gallery, preview + install, Save as template, update available. */
export const workspace_client_home_views_templates_JS = `  // ----- Templates — gallery, install, save as template (lazy chunk) -----
  var tplState = { q: '', items: [] };
  var TPL_API = '/v1/artifact-templates';
  function tplT(k, vars) { var s = t(k); Object.keys(vars || {}).forEach(function (n) { s = s.split('{' + n + '}').join(String(vars[n])); }); return s; }
  function tplJson(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  }
  function tplCard(x) {
    var n = x.item_count === 1 ? t('tpl.page') : tplT('tpl.pages', { n: x.item_count });
    return '<div class="wsx-sched"><div class="wsx-sched__head"><div class="wsx-sched__title">' + esc(x.name) + (x.version ? ' <span class="wsx-sched__chip">v' + esc(x.version) + '</span>' : '') + '</div>'
      + '<span class="wsx-sched__badge' + (x.scope === 'instance' ? ' ok' : '') + '">' + esc(t('tpl.scope.' + x.scope)) + '</span></div>'
      + (x.description ? '<div class="wsx-sched__meta"><span>' + esc(x.description) + '</span></div>' : '')
      + '<div class="wsx-sched__flow"><span class="wsx-sched__chip">' + esc(n) + '</span>' + (x.tags || []).slice(0, 4).map(function (g) { return '<span class="wsx-sched__chip">' + esc(g) + '</span>'; }).join('') + '</div>'
      + '<div class="wsx-sched__actions">'
      + (x.preview_url ? '<button class="wsx-abtn" data-tpl-preview="' + esc(x.id) + '" type="button">' + esc(t('tpl.preview')) + '</button>' : '')
      + '<button class="wsx-abtn wsx-abtn--primary" data-tpl-install="' + esc(x.id) + '" type="button">' + esc(t('tpl.install')) + '</button>'
      + (x.can_manage ? '<button class="wsx-abtn" data-tpl-delete="' + esc(x.id) + '" type="button">' + esc(t('tpl.delete')) + '</button>' : '')
      + '</div></div>';
  }
  function tplPaint() {
    var m = document.getElementById('wsxTplList'); if (!m) return;
    var q = tplState.q.toLowerCase();
    var list = tplState.items.filter(function (x) { return !q || (x.name + ' ' + (x.description || '') + ' ' + (x.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0; });
    m.innerHTML = list.length ? list.map(tplCard).join('') : emptyState(t('tpl.empty'), t('tpl.emptySub'));
  }
  function loadTemplates() {
    var m = document.getElementById('wsxTplMount'); if (!m) return;
    m.innerHTML = i18nLoad();
    fetch(TPL_API + (window.WSX_WS ? '?workspace=' + encodeURIComponent(window.WSX_WS) : ''), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { m.innerHTML = i18nError('tpl.loadFailed'); return; }
        tplState.items = d.templates || [];
        m.innerHTML = '<div class="wsx-cat__controls"><div class="wsx-cat__bar"><input class="wsx-cat__search" id="wsxTplSearch" type="search" placeholder="' + esc(t('tpl.search')) + '" aria-label="' + esc(t('tpl.search')) + '"></div></div><div id="wsxTplList"></div>';
        var s = document.getElementById('wsxTplSearch');
        s.value = tplState.q;
        s.addEventListener('input', function () { tplState.q = s.value; tplPaint(); });
        tplPaint();
        if (!m.__tplWired) { m.__tplWired = 1; m.addEventListener('click', tplClick); }
      })
      .catch(function () { m.innerHTML = i18nError('tpl.loadFailed'); });
  }
  function tplById(id) { for (var i = 0; i < tplState.items.length; i++) if (tplState.items[i].id === id) return tplState.items[i]; return null; }
  function tplClick(e) {
    var b = e.target.closest && e.target.closest('[data-tpl-preview],[data-tpl-install],[data-tpl-delete]'); if (!b) return;
    var x = tplById(b.getAttribute('data-tpl-preview') || b.getAttribute('data-tpl-install') || b.getAttribute('data-tpl-delete')); if (!x) return;
    if (b.hasAttribute('data-tpl-preview')) tplPreview(x);
    else if (b.hasAttribute('data-tpl-install')) tplInstall(x);
    else if (window.confirm(t('tpl.deleteConfirm'))) {
      tplJson('DELETE', TPL_API + '/' + encodeURIComponent(x.id)).then(okOr)
        .then(function () { tplState.items = tplState.items.filter(function (y) { return y.id !== x.id; }); tplPaint(); })
        .catch(function (err) { failToast(err, t('tpl.saveFailed')); });
    }
  }
  function tplPreview(x) {
    var mo = wsxModal(x.name, '<iframe class="wsx-tpl__frame" sandbox="allow-scripts" referrerpolicy="no-referrer" src="' + esc(x.preview_url) + '" title="' + esc(x.name) + '" style="width:100%;height:60vh;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-bg-elevated)"></iframe>'
      + '<div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="tplPrevInstall" type="button">' + esc(t('tpl.install')) + '</button></div>');
    mo.body.querySelector('#tplPrevInstall').addEventListener('click', function () { mo.close(); tplInstall(x); });
  }
  function tplSetupHtml(setup) {
    if (!setup || !setup.length) return '';
    return '<p class="wsx-field__lbl">' + esc(t('tpl.finishSetup')) + '</p><ul class="wsx-tpl__setup">' + setup.map(function (s) {
      var st = s.step || s;
      var line = st.kind === 'connector' ? tplT('tpl.setupConnector', { provider: st.provider, name: st.name }) : tplT(st.kind === 'table' ? 'tpl.setupTable' : 'tpl.setupDataset', { name: st.name });
      return '<li>' + (s.done ? '\\u2713 ' : '') + esc(line) + (s.done ? ' \\u00B7 ' + esc(t('tpl.setupDone')) : '') + '</li>';
    }).join('') + '</ul>' + (setup.some(function (s) { return (s.step || s).kind === 'connector' && !s.done; }) && window.WSX_WS ? '<a class="wsx-link" href="#l/connectors" data-tpl-conn>' + esc(t('tpl.openConnectors')) + '</a>' : '');
  }
  function tplFolders(cb) {
    var url = window.WSX_WS ? '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/folders?all=1' : '/v1/folders';
    fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { cb((d && d.folders) || []); }).catch(function () { cb([]); });
  }
  function tplInstall(x) {
    var mo = wsxModal(tplT('tpl.install') + ' \\u00B7 ' + x.name, '<div class="wsx-cform"><label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('tpl.installHere')) + '</span><select class="wsx-field__in" id="tplFolder"><option value="">' + esc(t('tpl.rootFolder')) + '</option></select></label>'
      + tplSetupHtml(x.setup || []) + '<div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="tplGo" type="button">' + esc(t('tpl.install')) + '</button></div></div>');
    tplFolders(function (fs) {
      var sel = mo.body.querySelector('#tplFolder'); if (!sel) return;
      fs.forEach(function (f) { var o = document.createElement('option'); o.value = f.id; o.textContent = f.name; sel.appendChild(o); });
    });
    var go = mo.body.querySelector('#tplGo');
    go.addEventListener('click', function () {
      if (go.disabled) return;
      go.disabled = true; go.textContent = t('tpl.installing');
      var folder = mo.body.querySelector('#tplFolder').value || null;
      tplJson('POST', TPL_API + '/' + encodeURIComponent(x.id) + '/install', { workspace_id: window.WSX_WS || null, folder_id: folder })
        .then(okOr).then(function (r) { return r.json(); })
        .then(function (d) {
          mo.body.innerHTML = '<p class="wsx-field__lbl">' + esc(t('tpl.installed')) + '</p><ul class="wsx-tpl__arts">' + (d.artifacts || []).map(function (a) {
            return '<li><button class="wsx-link" type="button" data-tpl-open="' + esc(a.slug) + '" data-id="' + esc(a.artifact_id) + '" data-name="' + esc(a.name) + '">' + esc(a.name) + '</button></li>';
          }).join('') + '</ul>' + tplSetupHtml(d.setup);
          mo.body.addEventListener('click', function (e) {
            var o = e.target.closest && e.target.closest('[data-tpl-open]');
            if (o) { mo.close(); openArtifact(o.getAttribute('data-tpl-open'), o.getAttribute('data-name'), o.getAttribute('data-id')); return; }
            if (e.target.closest && e.target.closest('[data-tpl-conn]')) mo.close();
          });
          if (typeof loadArtifacts === 'function') try { loadArtifacts(); } catch (err) { /* list refresh is best effort */ }
        })
        .catch(function (err) { go.disabled = false; go.textContent = t('tpl.install'); failToast(err, t('tpl.installFailed')); });
    });
  }
  function tplPreviewHtml(p) {
    var inc = [], left = [];
    (p.items || []).forEach(function (it) {
      inc.push(esc(it.name) + ' \\u00B7 ' + esc(tplT('tpl.files', { n: it.files.length })));
      it.tables.forEach(function (tb) { inc.push(esc(tplT('tpl.tableSchema', { name: tb.name }))); });
      it.datasets.forEach(function (ds) { inc.push(esc(tplT('tpl.datasetSchema', { name: ds.name }))); });
      it.connectors.forEach(function (c) { inc.push(esc(tplT('tpl.connectorStep', { name: c.name, provider: c.provider }))); });
    });
    var x = p.excluded || {};
    left.push(esc(tplT('tpl.leftData', { rows: x.table_rows || 0, ds: x.dataset_rows || 0, keys: x.store_keys || 0 })));
    left.push(esc(tplT('tpl.leftComments', { n: x.comments || 0 })));
    left.push(esc(tplT('tpl.leftSecrets', { n: p.redactions || 0 })));
    if (p.removed_links) left.push(esc(tplT('tpl.leftLinks', { n: p.removed_links })));
    (x.skipped || []).forEach(function (s) { left.push(esc(tplT('tpl.skipped', { name: s.name }))); });
    var h = '<p class="wsx-field__lbl">' + esc(t('tpl.included')) + '</p><ul>' + inc.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>'
      + '<p class="wsx-field__lbl">' + esc(t('tpl.leftBehind')) + '</p><ul>' + left.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>';
    if ((p.findings || []).length) {
      h += '<div class="wsx-tpl__findings" role="group" aria-label="' + esc(t('tpl.findingsTitle')) + '"><p class="wsx-field__lbl">' + esc(t('tpl.findingsTitle')) + '</p><p class="wsx-field__note">' + esc(t('tpl.findingsHint')) + '</p><ul>'
        + p.findings.slice(0, 40).map(function (f) { return '<li>' + esc(t('tpl.kind.' + f.kind)) + ': <code>' + esc(f.sample) + '</code> \\u00B7 ' + esc(f.where) + (f.count > 1 ? ' \\u00D7' + f.count : '') + '</li>'; }).join('')
        + '</ul><label class="wsx-field"><input type="checkbox" id="tplAck"> ' + esc(t('tpl.findingsAck')) + '</label></div>';
    }
    return h;
  }
  function saveAsTemplate(src) {
    var mo = wsxModal(t('tpl.saveTitle'), i18nLoad());
    var base = src.artifact_id ? { artifact_id: src.artifact_id } : { folder_id: src.folder_id };
    function preview(samples) {
      return tplJson('POST', TPL_API + '/preview', Object.assign({ include_sample_rows: !!samples }, base)).then(okOr).then(function (r) { return r.json(); });
    }
    function render(p, samples) {
      mo.body.innerHTML = '<div class="wsx-cform">'
        + fld(t('tpl.name'), 'tpl_name', '') + fta(t('tpl.description'), 'tpl_desc', '', 2) + fld(t('tpl.tags'), 'tpl_tags', '') + fld(t('tpl.version'), 'tpl_ver', '1.0.0')
        + '<label class="wsx-field"><span class="wsx-field__lbl">' + esc(t('tpl.scope')) + '</span><select class="wsx-field__in" id="tpl_scope"><option value="private">' + esc(t('tpl.scope.private')) + '</option><option value="instance">' + esc(t('tpl.scopeInstance')) + '</option></select></label>'
        + '<label class="wsx-field"><input type="checkbox" id="tpl_samples"' + (samples ? ' checked' : '') + '> ' + esc(t('tpl.sampleRows')) + '</label>'
        + '<div class="wsx-tpl__preview">' + tplPreviewHtml(p) + '</div>'
        + '<div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="tpl_save" type="button">' + esc(t('tpl.save')) + '</button></div></div>';
      var nm = mo.body.querySelector('#tpl_name'); nm.value = src.name || p.source_name || '';
      var sm = mo.body.querySelector('#tpl_samples');
      sm.addEventListener('change', function () { var keep = readForm(); preview(sm.checked).then(function (np) { render(np, sm.checked); writeForm(keep); }).catch(function (err) { failToast(err, t('tpl.saveFailed')); }); });
      var ack = mo.body.querySelector('#tplAck'), save = mo.body.querySelector('#tpl_save');
      if (ack) { save.disabled = true; ack.addEventListener('change', function () { save.disabled = !ack.checked; }); }
      save.addEventListener('click', function () {
        if (save.disabled) return;
        save.disabled = true; save.textContent = t('tpl.saving');
        var f = readForm();
        tplJson('POST', TPL_API, Object.assign({ name: f.name, description: f.desc, tags: f.tags, version: f.ver || undefined, scope: f.scope, include_sample_rows: sm.checked, acknowledge_findings: !!(ack && ack.checked) }, base))
          .then(okOr).then(function () { mo.close(); if (typeof showToast === 'function') showToast(t('tpl.saved'), 'success'); if (typeof loaded === 'object' && loaded) loaded.templates = 0; })
          .catch(function (err) { save.disabled = false; save.textContent = t('tpl.save'); failToast(err, t('tpl.saveFailed')); });
      });
    }
    function readForm() { return { name: cv('tpl_name'), desc: cv('tpl_desc'), tags: cv('tpl_tags'), ver: cv('tpl_ver'), scope: (document.getElementById('tpl_scope') || {}).value || 'private' }; }
    function writeForm(v) { ['name', 'desc', 'tags', 'ver'].forEach(function (k) { var el = document.getElementById('tpl_' + k); if (el) el.value = v[k]; }); var s = document.getElementById('tpl_scope'); if (s) s.value = v.scope; }
    preview(false).then(function (p) { render(p, false); }).catch(function (err) { mo.close(); failToast(err, t('tpl.saveFailed')); });
  }
  // Inspector: "From template X · vN", and the update banner when a newer version exists.
  function tplInspect(artId, el) {
    if (!el) return;
    fetch(TPL_API + '/installed?artifact_id=' + encodeURIComponent(artId), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var i = d && d.installed; if (!i) return;
        el.hidden = false;
        el.innerHTML = '<div class="wsx-det__secsub">' + esc(tplT('tpl.fromTemplate', { name: i.template_name, v: i.version_label || i.version_no })) + '</div>'
          + (i.update_available ? '<div class="wsx-det__actions2"><span class="wsx-sched__badge warn">' + esc(tplT('tpl.updateAvailable', { v: i.latest_label || i.latest_version_no })) + '</span><button class="wsx-abtn" type="button" data-tpl-upd>' + esc(t('tpl.update')) + '</button></div>' : '');
        var b = el.querySelector('[data-tpl-upd]'); if (b) b.addEventListener('click', function () { tplUpdate(artId, el); });
      }).catch(function () {});
  }
  function tplUpdate(artId, el) {
    var mo = wsxModal(t('tpl.updateTitle'), i18nLoad());
    tplJson('POST', TPL_API + '/installed/update', { artifact_id: artId }).then(okOr).then(function (r) { return r.json(); })
      .then(function (d) {
        var p = d.plan;
        mo.body.innerHTML = '<p>' + esc(t('tpl.updateBody')) + '</p><ul>' + p.changes.map(function (c) {
          var line = c.change === 'add' ? tplT('tpl.updateAdd', { name: c.name }) : c.change === 'unchanged' ? tplT('tpl.updateUnchanged', { name: c.name }) : tplT('tpl.updateChanged', { name: c.name, n: c.files_changed + c.files_added + c.files_removed });
          return '<li>' + esc(line) + '</li>';
        }).join('') + '</ul><div class="wsx-cform__foot"><button class="wsx-abtn wsx-abtn--primary" id="tplApply" type="button">' + esc(t('tpl.applyUpdate')) + '</button></div>';
        var go = mo.body.querySelector('#tplApply');
        go.addEventListener('click', function () {
          if (go.disabled) return; go.disabled = true;
          tplJson('POST', TPL_API + '/installed/update', { artifact_id: artId, confirm: true }).then(okOr)
            .then(function () { mo.close(); if (typeof showToast === 'function') showToast(t('tpl.updated'), 'success'); tplInspect(artId, el); })
            .catch(function (err) { go.disabled = false; failToast(err, t('tpl.updateFailed')); });
        });
      })
      .catch(function (err) { mo.close(); failToast(err, t('tpl.updateFailed')); });
  }
`;
